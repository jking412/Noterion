// 单任务上手示例，使用已安装的全局 Sandcastle。
// 查看配置：node .sandcastle/one-task.example.mjs --check
// 配好任务并准备 Git 基线、本机 Codex 登录后执行：node .sandcastle/one-task.example.mjs --run
// 按用户明确选择在本机全权限执行，不使用 Docker，也不要求另配 API Key。
// 这不是 main.mts 的整批规划、审查和合并控制器。
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// 这里就是示例的配置；model 沿用官方生成模板的值，不是模型选型结论。
const config = {
  model: "gpt-5.4",
  taskFile: join(repoDir, ".sandcastle", "one-task.example.md"),
  maxIterations: 1,
};

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && !["--check", "--run"].includes(args[0]))) {
  throw new Error("用法：node .sandcastle/one-task.example.mjs [--check|--run]");
}

// npm.cmd 仅查询全局包目录；没有安装或更新依赖。
const globalRoot = execSync("npm.cmd root --global", { encoding: "utf8" }).trim();
const packageRoot = join(globalRoot, "@ai-hero", "sandcastle");
const { run, codex } = await import(pathToFileURL(join(packageRoot, "dist", "index.js")).href);
const { noSandbox } = await import(pathToFileURL(join(packageRoot, "dist", "sandboxes", "no-sandbox.js")).href);
const task = await readFile(config.taskFile, "utf8");

if (args[0] !== "--run") {
  console.log(JSON.stringify({
    mode: "check-only",
    repoDir,
    globalPackage: packageRoot,
    libraryLoaded: typeof run === "function" && typeof codex === "function" && typeof noSandbox === "function",
    execution: "local-codex-cli",
    permissions: "full-access-explicitly-selected-by-user",
    ...config,
    taskNeedsEditing: task.includes("[在此填写已确认的单个任务]"),
    nextStep: "填写任务、准备 Git 基线并确认本机 Codex 登录后，显式使用 --run；不需要 Docker 镜像或另配 API Key。",
  }, null, 2));
} else {
  if (task.includes("[在此填写已确认的单个任务]")) {
    throw new Error("请先编辑 .sandcastle/one-task.example.md，填写已确认的任务。当前不会启动 Agent。");
  }

  const result = await run({
    cwd: repoDir,
    agent: codex(config.model),
    sandbox: noSandbox(),
    branchStrategy: { type: "merge-to-head" },
    promptFile: config.taskFile,
    maxIterations: config.maxIterations,
    name: "one-task-example",
  });

  console.log(JSON.stringify({
    branch: result.branch,
    commits: result.commits,
    logFilePath: result.logFilePath,
  }, null, 2));
}
