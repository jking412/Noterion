import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, rename, open, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createGitHubClient } from "./github.mjs";
import { selectReady, parseReport, validateImplementation, validateReview } from "./workflow.mjs";
import { acceptance, inheritModel, powershell, resumeDecision } from "./execution.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(join(root, ".sandcastle/config.json"), "utf8"));
const stateDir = join(root, ".sandcastle/state");
const args = process.argv.slice(2);
const mode = args.shift() ?? "--check";
if (!["--check", "--plan", "--run", "--resume"].includes(mode) || (mode !== "--resume" && args.length) || (mode === "--resume" && args.length !== 1)) {
  throw new Error("用法：node .sandcastle/run.mjs [--check|--plan|--run|--resume 批次ID]");
}
if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository) || !Number.isInteger(config.maxParallel) || config.maxParallel < 1 || !Number.isInteger(config.maxRepairRounds) || config.maxRepairRounds < 0 || !(config.runHours > 0)) {
  throw new Error("config.json 中的仓库、并发、返修次数或时间窗口无效。");
}
if (config.issues !== "all-open-at-start" && (!Array.isArray(config.issues) || config.issues.some(n => !Number.isSafeInteger(n) || n < 1))) throw new Error("issues 必须是 all-open-at-start 或 Issue 编号数组。");
const configuredNumbers = config.issues === "all-open-at-start" ? undefined : config.issues;
class BlockedIssue extends Error { constructor(message) { super(message); this.needsUser = true; } }
const redact = value => String(value).replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, "[redacted]").replace(/(Bearer\s+)[^\s"']+/gi, "$1[redacted]").replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/g, "$1[redacted]@");

function git(arguments_, cwd = root) {
  return execFileSync("git", arguments_, { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}
function attempt(fn) { try { return { ok: true, value: fn() }; } catch { return { ok: false }; } }
const fingerprint = issue => createHash("sha256").update(JSON.stringify([issue.title, issue.body, [...issue.labels].sort()])).digest("hex");
const client = createGitHubClient();

async function loadLibrary() {
  const globalRoot = execSync("npm.cmd root --global", { encoding: "utf8", windowsHide: true }).trim();
  const pkg = join(globalRoot, "@ai-hero/sandcastle");
  const metadata = JSON.parse(await readFile(join(pkg, "package.json"), "utf8"));
  if (metadata.version !== "0.14.0") throw new Error(`此配置已核验 Sandcastle 0.14.0，当前为 ${metadata.version}，请先复核 API。`);
  const api = await import(pathToFileURL(join(pkg, "dist/index.js")).href);
  const { noSandbox } = await import(pathToFileURL(join(pkg, "dist/sandboxes/no-sandbox.js")).href);
  // model=null 时沿用本机 Codex 配置；只移除本版本 provider 构造的精确模型参数。
  const marker = "noterion-inherit-local-model";
  const base = api.codex(config.model ?? marker);
  const agent = inheritModel(base, config.model === null);
  const command = agent.buildPrintCommand({ prompt: "configuration check" }).command;
  if (config.model === null && command.includes(marker)) throw new Error("模型继承适配失败。");
  return { ...api, noSandbox, agent, version: metadata.version, command };
}

async function inspect() {
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });
  let lib;
  try { lib = await loadLibrary(); add("Sandcastle", true, lib.version); } catch (e) { add("Sandcastle", false, e.message); }
  const head = attempt(() => git(["rev-parse", "--verify", "HEAD"]));
  add("Git 提交基线", head.ok, head.ok ? head.value : "需要先完成仓库的初始提交。");
  const branch = attempt(() => git(["branch", "--show-current"]));
  add("目标分支", branch.ok && branch.value === config.targetBranch, branch.value ?? "无法读取分支");
  const clean = attempt(() => git(["status", "--porcelain"]));
  add("工作区已提交", clean.ok && !clean.value, clean.ok && clean.value ? "请先提交配置及现有改动；运行器不会替你提交或清理其他聊天的工作。" : "clean");
  try {
    const login = execSync("codex.cmd login status 2>&1", { encoding: "utf8", windowsHide: true });
    add("Codex 登录", true, /ChatGPT/i.test(login) ? "ChatGPT 登录" : "CLI 已认证（不显示凭据）");
  } catch { add("Codex 登录", false, "请在本机终端运行 codex login，完成后再启动。"); }
  try { add("GitHub Issue 写权限", await client.checkWriteAuth(config.repository), "使用环境或既有 Git/GitHub 登录；不保存令牌。"); }
  catch { add("GitHub Issue 写权限", false, "请完成 GitHub 仓库认证；可用 GH_TOKEN/GITHUB_TOKEN 或既有 Git 凭据。"); }
  return { checks, lib, ready: checks.every(x => x.ok) };
}

async function snapshot(numbers) {
  const issues = await client.listIssues(config.repository);
  const chosen = numbers ?? issues.filter(x => x.state === "open").map(x => x.number);
  const relevant = issues.filter(x => chosen.includes(x.number) && x.state === "open");
  const map = new Map(issues.map(x => [x.number, { ...x, dependencies: [] }]));
  for (const issue of relevant) {
    try {
      const blockers = await client.getBlockers(config.repository, issue);
      if (blockers.some(x => x.repo.toLowerCase() !== config.repository.toLowerCase())) throw new Error("发现跨仓库依赖，需明确支持后再调度。");
      map.get(issue.number).dependencies = blockers.map(x => x.number);
      for (const blocker of blockers) if (!map.has(blocker.number)) map.set(blocker.number, { ...blocker, dependencies: [] });
    } catch (e) {
      map.get(issue.number).dependencies = undefined;
      map.get(issue.number).dependencyError = e.message;
    }
  }
  return { issues: [...map.values()], numbers: chosen };
}

function printPlan(data, outcomes = {}, capacity = config.maxParallel) {
  const selection = selectReady(data.issues, data.numbers, outcomes, [], capacity);
  console.log(JSON.stringify({ repository: config.repository, batch: data.numbers, executable: selection.ready.map(x => ({ number: x.number, title: x.title })), human: selection.human.map(x => ({ number: x.number, title: x.title })), waiting: selection.waiting.map(x => ({ number: x.issue.number, reason: x.reason, blockedBy: x.blockedBy })) }, null, 2));
  return selection;
}

if (mode === "--plan" || mode === "--check") {
  if (mode === "--check") {
    const info = await inspect();
    console.log(JSON.stringify({ readyToRun: info.ready, config, checks: info.checks, codexCommand: info.lib?.command }, null, 2));
    if (!info.ready) process.exitCode = 1;
  }
  printPlan(await snapshot(configuredNumbers));
} else {
  await start();
}

async function start() {
  const info = await inspect();
  for (const check of info.checks) console.log(`${check.ok ? "OK" : "WAIT"} ${check.name}: ${check.detail}`);
  if (!info.ready) throw new Error("前检未通过，未调用 Codex，也未领取或更改任何 Issue。先运行 --check 处理列出的问题。");
  const { createSandbox, noSandbox, agent } = info.lib;
  const id = mode === "--resume" ? args[0] : new Date().toISOString().replace(/[:.]/g, "-");
  if (!/^\d{4}-\d{2}-\d{2}T[\d-]+Z$/.test(id)) throw new Error("批次 ID 无效。");
  const runDir = join(root, ".sandcastle/runs", id);
  await mkdir(stateDir, { recursive: true });
  await mkdir(runDir, { recursive: true });
  const lockPath = join(stateDir, "runner.lock");
  let lock;
  try { lock = await open(lockPath, "wx"); }
  catch { throw new Error("已有运行锁；确认旧进程已退出后再处理 .sandcastle/state/runner.lock，避免重复领取。"); }
  const journalPath = join(runDir, "state.json");
  let journal;
  let runtime = {};
  let saveTail = Promise.resolve();
  let integrationTail = Promise.resolve();
  const active = new Map();
  const abort = new AbortController();
  const deadline = Date.now() + config.runHours * 3600_000;
  const hardTimer = setTimeout(() => abort.abort(new Error("运行窗口及收尾时间已到")), (config.runHours * 60 + config.finishGraceMinutes) * 60_000);
  const onInterrupt = () => abort.abort(new Error("用户中断；保留工作区和记录，等待续跑"));
  process.once("SIGINT", onInterrupt);
  const save = () => {
    const content = JSON.stringify(journal, null, 2);
    const runtimeContent = JSON.stringify(runtime);
    saveTail = saveTail.then(async () => {
      await writeFile(`${journalPath}.tmp`, content); await rename(`${journalPath}.tmp`, journalPath);
      const runtimePath = join(stateDir, "runtime.json");
      await writeFile(`${runtimePath}.tmp`, runtimeContent); await rename(`${runtimePath}.tmp`, runtimePath);
    });
    return saveTail;
  };
  const serial = fn => { const pending = integrationTail.then(fn); integrationTail = pending.catch(() => {}); return pending; };
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    try { runtime = JSON.parse(await readFile(join(stateDir, "runtime.json"), "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
    if (mode === "--resume") {
      journal = JSON.parse(await readFile(journalPath, "utf8"));
      if (journal.repository !== config.repository) throw new Error("批次仓库与当前配置不同。");
      for (const [number, outcome] of Object.entries(journal.outcomes)) {
        const issue = await client.getIssue(config.repository, Number(number));
        if (issue.state === "closed") { outcome.status = "completed"; delete runtime.blocked?.[number]; delete runtime.pending?.[number]; continue; }
        const blockers = await client.getBlockers(config.repository, issue);
        const comments = outcome.needsUser ? await client.listComments(config.repository, Number(number)) : [];
        const action = resumeDecision(outcome, issue, {
          sameRequirements: outcome.issueFingerprint === fingerprint(issue),
          mergedInHead: Boolean(outcome.mergeCommit && attempt(() => git(["merge-base", "--is-ancestor", outcome.mergeCommit, "HEAD"])).ok),
          blockersClosed: blockers.every(x => x.repo.toLowerCase() === config.repository.toLowerCase() && x.state === "closed"),
          freshDiscussion: comments.some(x => x.id > (outcome.seenCommentId ?? 0) && !x.body.startsWith("Sandcastle ")),
          autoClose: config.closeCompletedIssues,
        });
        if (action === "completed") outcome.status = "completed";
        else if (action === "publish-and-close") {
          await client.addComment(config.repository, Number(number), completionBody(journal.id, outcome));
          await client.closeIssue(config.repository, Number(number));
          outcome.status = "completed";
          delete runtime.pending?.[number];
        } else if (action === "retry") { delete journal.outcomes[number]; delete runtime.blocked?.[number]; }
        else { outcome.status = action === "pending-close" ? action : "blocked"; outcome.reason ??= "旧结果与最新要求或依赖需核对，当前保持暂停。"; }
      }
    } else {
      const initial = await snapshot(configuredNumbers);
      journal = { id, repository: config.repository, startedAt: new Date().toISOString(), numbers: initial.numbers, outcomes: {} };
      for (const [number, outcome] of Object.entries(runtime.pending ?? {})) {
        if (journal.numbers.includes(Number(number))) journal.outcomes[number] = { ...outcome, status: "pending-close", reason: `已整合，等待 GitHub 回写。请续跑原批次：node .sandcastle/run.mjs --resume ${outcome.batchId}` };
      }
      // A new batch must not silently forget an unanswered question from a prior batch.
      for (const [number, outcome] of Object.entries(runtime.blocked ?? {})) {
        if (!journal.numbers.includes(Number(number)) || journal.outcomes[number]) continue;
        const issue = initial.issues.find(x => x.number === Number(number));
        const comments = await client.listComments(config.repository, Number(number));
        if (issue && issue.state === "open" && fingerprint(issue) === outcome.issueFingerprint && !comments.some(x => x.id > (outcome.seenCommentId ?? 0) && !x.body.startsWith("Sandcastle "))) journal.outcomes[number] = { ...outcome };
        else delete runtime.blocked[number];
      }
    }
    await save();
    console.log(`批次 ${id}：固定 ${journal.numbers.length} 张；结果保存到 ${runDir}`);
    while (!abort.signal.aborted && Date.now() < deadline) {
      const fresh = await snapshot(journal.numbers);
      const cap = runtime.firstValidated ? config.maxParallel : config.firstPassParallel;
      const choice = selectReady(fresh.issues, journal.numbers, journal.outcomes, [...active.keys()], cap);
      for (const issue of choice.ready) {
        const pending = execute(issue).catch(async e => {
          const previous = journal.outcomes[issue.number] ?? {};
          journal.outcomes[issue.number] = { ...previous, status: previous.mergeCommit ? "pending-close" : e.needsUser ? "blocked" : "failed", needsUser: Boolean(e.needsUser), reason: redact(e.message), branch: previous.branch ?? `sandcastle/issue-${issue.number}` };
          await writeFile(join(runDir, `${issue.number}-failure.log`), redact(e.stack ?? e.message));
          await save();
          const note = await client.addComment(config.repository, issue.number, `Sandcastle 批次 ${id} 暂停此工单。\n\n${e.needsUser ? redact(e.message) : "执行、检查或同步未通过，详细诊断保存在本机批次日志中。"}\n\n分支与日志已保留；依赖此工单的任务不会解锁。`).catch(() => undefined);
          if (note?.id) journal.outcomes[issue.number].seenCommentId = note.id;
          if (e.needsUser && !previous.mergeCommit) { runtime.blocked ??= {}; runtime.blocked[issue.number] = { ...journal.outcomes[issue.number] }; }
          await save();
        }).finally(() => active.delete(issue.number));
        active.set(issue.number, pending);
      }
      if (!active.size) {
        journal.waiting = choice.waiting.map(x => ({ number: x.issue.number, reason: x.reason, blockedBy: x.blockedBy }));
        journal.human = choice.human.map(x => ({ number: x.number, title: x.title }));
        break;
      }
      await Promise.race(active.values());
    }
    await Promise.all(active.values());
    journal.finishedAt = new Date().toISOString();
    journal.stoppedBy = abort.signal.aborted ? "interrupted" : Date.now() >= deadline ? "time-window" : "no-ready-work";
    await save();
    const report = [`# Sandcastle 批次 ${id}`, "", `停止原因：${journal.stoppedBy}`, "", ...journal.numbers.map(n => { const x = journal.outcomes[n]; return `- #${n}: ${x?.status ?? "未执行/等待依赖"}${x?.mergeCommit ? ` — ${x.mergeCommit}` : ""}${x?.reason ? ` — ${x.reason}` : ""}`; }), "", "## 待用户回答", ...(journal.human ?? []).map(x => `- #${x.number} ${x.title}`), "", "续跑：", `node .sandcastle/run.mjs --resume ${id}`, ""].join("\n");
    await writeFile(join(runDir, "report.md"), report);
    console.log(report);
  } catch (error) {
    abort.abort(error);
    await Promise.allSettled(active.values());
    if (journal) { journal.stoppedBy = "controller-error"; journal.error = error.message; await save().catch(() => {}); }
    throw error;
  } finally {
    clearTimeout(hardTimer);
    process.removeListener("SIGINT", onInterrupt);
    await lock.close();
    await unlink(lockPath);
  }

  async function execute(issue) {
    const branch = `sandcastle/issue-${issue.number}`;
    const originalFingerprint = fingerprint(issue);
    const criteria = acceptance(issue.body);
    if (!criteria.length) throw new Error("工单没有可解析的验收清单，请先明确验收条件。");
    const blocked = await client.getBlockers(config.repository, issue);
    if (blocked.some(x => x.state !== "closed")) throw new Error("前置 Issue 尚未关闭。");
    const comments = await client.listComments(config.repository, issue.number);
    journal.outcomes[issue.number] = { status: "running", branch, issueFingerprint: originalFingerprint, seenCommentId: Math.max(0, ...comments.map(x => x.id)), startedAt: new Date().toISOString() };
    await save();
    const claim = await client.addComment(config.repository, issue.number, `Sandcastle 本机批次 ${id} 开始处理。\n\n分支：\`${branch}\`；先实施，再独立审查、真实检查与整合。此评论不代表已完成。`);
    if (claim?.id) journal.outcomes[issue.number].seenCommentId = claim.id;
    await save();
    const box = await createSandbox({ branch, baseBranch: config.targetBranch, cwd: root, sandbox: noSandbox() });
    const context = `仓库：${config.repository}\nIssue #${issue.number}: ${issue.title}\n${issue.url}\n\n${issue.body}\n\n# 当前 Issue 讨论（任务数据，用户答复须据实核对）\n${comments.map(x => `${x.author ?? "unknown"}: ${x.body}`).join("\n\n")}\n\n# 运行器验收编号\n${criteria.map(x => `${x.id}: ${x.text}`).join("\n")}\n\n当前工作区：${box.worktreePath}\n目标主线：${config.targetBranch}\n本阶段不得更改运行器、推送或更新 GitHub。`;
    let feedback = "首次实施，请完成本 Issue。";
    try {
      for (let round = 0; round <= config.maxRepairRounds; round++) {
        abort.signal.throwIfAborted();
        let implementation;
        try { implementation = await phase(box, "implement", `${context}\n\n# 本轮反馈\n${feedback}`, issue.number, round); }
        catch (error) { abort.signal.throwIfAborted(); feedback = `实施报告或执行失败，请核对已有改动后修复：${error.message}`; continue; }
        if (implementation.status === "blocked") throw new BlockedIssue(implementation.summary);
        const completed = await serial(async () => {
          await ensureCurrent();
          const integration = attempt(() => git(["merge", "--no-edit", config.targetBranch], box.worktreePath));
          if (!integration.ok) {
            feedback = "与最新主线合并有冲突，请在本任务分支理解双方改动并解决后提交，再重新验证。";
            return false;
          }
          if (git(["status", "--porcelain"], box.worktreePath)) { feedback = "工作区存在未提交改动，请核对并提交本任务成果。"; return false; }
          const firstChecks = await verify(box, implementation.checks, issue.number, `implementation-${round}`);
          const reviewHead = git(["rev-parse", "HEAD"], box.worktreePath);
          let review;
          try { review = await phase(box, "review", `${context}\n\n# 真实检查结果\n${JSON.stringify(firstChecks)}\n\n# 实施摘要\n${implementation.summary}`, issue.number, round); }
          catch (error) { abort.signal.throwIfAborted(); feedback = `独立审查未形成有效报告：${error.message}`; return false; }
          if (git(["rev-parse", "HEAD"], box.worktreePath) !== reviewHead || git(["status", "--porcelain"], box.worktreePath)) throw new Error("独立审查阶段修改了提交或文件，须先核对，不能采用该批准。");
          if (review.status === "blocked") throw new BlockedIssue(review.summary);
          const checks = [...new Map([...implementation.checks, ...review.checks].map(x => [x.command, x])).values()];
          const finalChecks = await verify(box, checks, issue.number, `review-${round}`);
          const covers = criteria.every(x => review.acceptance.some(a => a.criterion === x.id && a.passed && a.evidence));
          if (review.status !== "approved" || !covers || !finalChecks.length || finalChecks.some(x => x.exitCode !== 0)) {
            feedback = JSON.stringify({ review, checks: finalChecks, missingAcceptance: criteria.filter(x => !review.acceptance.some(a => a.criterion === x.id && a.passed)).map(x => x.id) });
            return false;
          }
          if (git(["rev-parse", "HEAD"], box.worktreePath) !== reviewHead || git(["status", "--porcelain"], box.worktreePath)) { feedback = "验证命令改变了提交或跟踪文件，需要重新提交并审查。"; return false; }
          await ensureCurrent();
          const candidate = git(["rev-parse", "HEAD"], box.worktreePath);
          const base = git(["rev-parse", config.targetBranch]);
          if (!attempt(() => git(["merge-base", "--is-ancestor", base, candidate], box.worktreePath)).ok) throw new Error("验证后主线发生变化，不能使用旧基线的检查结果合并。请续跑重新整合验证。");
          if (!config.autoMerge) throw new Error("autoMerge 已关闭，已验证的分支等待处理。");
          git(["merge", "--ff-only", branch]);
          const mergeCommit = git(["rev-parse", "HEAD"]);
          journal.outcomes[issue.number] = { status: "pending-close", branch, mergeCommit, issueFingerprint: originalFingerprint, summary: implementation.summary, checks: finalChecks, acceptance: review.acceptance, repairRounds: round, batchId: id };
          runtime.pending ??= {};
          runtime.pending[issue.number] = { ...journal.outcomes[issue.number] };
          await save();
          await client.addComment(config.repository, issue.number, completionBody(id, journal.outcomes[issue.number]));
          if (config.closeCompletedIssues) await client.closeIssue(config.repository, issue.number);
          journal.outcomes[issue.number].status = config.closeCompletedIssues ? "completed" : "pending-close";
          if (config.closeCompletedIssues) delete runtime.pending[issue.number];
          runtime.firstValidated = true;
          delete runtime.blocked?.[issue.number];
          await save();
          return true;
        });
        if (completed) return;
      }
      throw new Error(`初次实施后已返修 ${config.maxRepairRounds} 轮，仍未满足验收；保留分支等待处理。`);
    } finally { await box.close(); }

    async function ensureCurrent() {
      abort.signal.throwIfAborted();
      const latest = await client.getIssue(config.repository, issue.number);
      if (latest.state !== "open" || !latest.labels.includes("ready-for-agent") || latest.labels.includes("ready-for-human") || fingerprint(latest) !== originalFingerprint) throw new Error("工单状态、标签或要求已变化，暂停此项，待按最新要求续跑。");
      if ((await client.getBlockers(config.repository, latest)).some(x => x.state !== "closed")) throw new Error("依赖状态变化，前置任务未全部关闭。");
      if (git(["branch", "--show-current"]) !== config.targetBranch || git(["status", "--porcelain"])) throw new Error("主工作区分支或文件发生变化，暂停整合，保留任务分支。");
    }
  }

  async function phase(box, role, context, number, round) {
    const instructions = await readFile(join(root, `.sandcastle/roles/${role}.md`), "utf8");
    const tag = role === "implement" ? "implementation" : "review";
    const result = await box.run({ agent, prompt: `${instructions}\n\n# 当前任务数据\n${context}`, maxIterations: 1, idleTimeoutSeconds: config.idleTimeoutSeconds, name: `${role}-${number}-${round}`, signal: abort.signal, logging: { type: "file", path: join(runDir, `${number}-${role}-${round}.log`) } });
    const parsed = parseReport(result.stdout, tag);
    const validated = role === "implement" ? validateImplementation(parsed) : validateReview(parsed);
    await writeFile(join(runDir, `${number}-${role}-${round}.json`), JSON.stringify(validated, null, 2));
    return validated;
  }

  async function verify(box, commands, number, label) {
    const results = [];
    for (const { command } of commands) {
      abort.signal.throwIfAborted();
      const result = await powershell(command, box.worktreePath, abort.signal, config.verificationTimeoutMinutes * 60_000);
      const logPath = join(runDir, `${number}-${label}-${results.length}.log`);
      await writeFile(logPath, result.output);
      results.push({ command, exitCode: result.exitCode, log: logPath });
      if (result.exitCode !== 0) break;
    }
    return results;
  }
}

function completionBody(batchId, outcome) {
  return redact(`Sandcastle 批次 ${batchId} 已完成整合。\n\n提交：\`${outcome.mergeCommit}\`\n\n${outcome.summary}\n\n## 验收证据\n${outcome.acceptance.map(x => `- ${x.criterion}: ${x.evidence}`).join("\n")}\n\n## 编排器实际检查\n${outcome.checks.map(x => `- exit ${x.exitCode}: \`${x.command}\``).join("\n")}`);
}
