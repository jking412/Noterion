import { spawn } from "node:child_process";

const API = "https://api.github.com";
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function repository(value) {
  if (typeof value !== "string" || !REPO.test(value)) throw new Error("Expected a GitHub owner/repository.");
  return value;
}

function issueNumber(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error("Expected a positive GitHub issue number.");
  return number;
}

function unclearDependencies() {
  const error = new Error("Cannot determine all dependencies: provide an explicit Blocked by section with issue references or None.");
  error.code = "DEPENDENCIES_UNCLEAR";
  return error;
}

/** Parse references only inside the explicitly named dependency section. */
export function parseDependencies(body, repo) {
  repository(repo);
  if (typeof body !== "string") throw unclearDependencies();
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const sections = [];
  let active = false;
  for (const line of lines) {
    const plain = line.trim().replace(/\*\*/g, "");
    const heading = plain.match(/^(?:#{1,6}\s*)?(?:Blocked\s+by|Depends\s+on|前置依赖|阻塞项)\s*[:：]?\s*(.*)$/i);
    if (heading) {
      active = true;
      if (heading[1]) sections.push(heading[1]);
      continue;
    }
    if (active && /^#{1,6}\s+/.test(plain)) active = false;
    if (active && plain) sections.push(plain);
  }
  if (!sections.length) throw unclearDependencies();

  const found = new Map();
  let hasNone = false;
  const add = (ownerRepo, number) => {
    repository(ownerRepo);
    const reference = { repo: ownerRepo, number: issueNumber(number) };
    found.set(`${ownerRepo.toLowerCase()}#${reference.number}`, reference);
  };
  const issueUrl = /https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/issues\/([1-9]\d*)(?:[/?#][^\s<)]*)?/g;
  for (const raw of sections) {
    const line = raw.replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/, "").trim();
    if (/^(?:none|no\s+dependencies|无(?:依赖|阻塞(?:项)?)?|没有(?:依赖|阻塞项))(?:\s*[（(][^\r\n]*[)）])?[.。]?$/i.test(line)) {
      if (/#\d|https?:\/\//i.test(line)) throw unclearDependencies();
      hasNone = true;
      continue;
    }
    let count = 0;
    // Remove link labels before parsing bare #N so a cross-repository link
    // labelled #N does not accidentally also add this repository's #N.
    let rest = line.replace(/\[[^\n]*?\]\((https?:\/\/[^\s)]+)\)/g, (_match, url) => {
      const matches = [...url.matchAll(issueUrl)];
      for (const match of matches) { add(match[1], match[2]); count++; }
      return " ";
    });
    rest = rest.replace(issueUrl, (_match, ownerRepo, number) => {
      add(ownerRepo, number); count++; return " ";
    });
    rest = rest.replace(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#([1-9]\d*)\b/g, (_match, ownerRepo, number) => {
      add(ownerRepo, number); count++; return " ";
    });
    for (const match of rest.matchAll(/(?<![\w/])#([1-9]\d*)\b/g)) {
      add(repo, match[1]); count++;
    }
    if (!count) throw unclearDependencies();
  }
  if (hasNone && found.size) throw unclearDependencies();
  return [...found.values()];
}

function normalizeIssue(raw, repo) {
  if (!raw || !["open", "closed"].includes(raw.state) || typeof raw.title !== "string") {
    throw new Error("GitHub returned an invalid issue response.");
  }
  return {
    repo,
    number: issueNumber(raw.number),
    title: raw.title,
    body: raw.body ?? "",
    state: raw.state,
    labels: (raw.labels ?? []).map(label => typeof label === "string" ? label : label.name),
    url: raw.html_url ?? `https://github.com/${repo}/issues/${raw.number}`,
    updatedAt: raw.updated_at,
  };
}

function capture(executable, args, { input = "", timeoutMs = 15000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stdout = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Credential helper timed out.")); }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) { child.kill(); finish(new Error("Credential helper output exceeded its limit.")); }
    });
    // Credential helpers may mention credentials in diagnostics. Never retain
    // or forward stderr; only consume it so their pipe cannot block.
    child.stderr.resume();
    child.once("error", () => finish(new Error("Credential helper unavailable.")));
    child.once("close", code => finish(code === 0 ? null : new Error("Credential helper failed."), stdout));
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

async function localCredential(repo) {
  const environment = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (environment?.trim()) return environment.trim();
  try {
    const token = (await capture(process.platform === "win32" ? "gh.exe" : "gh", ["auth", "token", "--hostname", "github.com"])).trim();
    if (token) return token;
  } catch { /* The Git helper is the final non-interactive fallback. */ }
  try {
    const response = await capture("git", ["-c", "credential.interactive=false", "credential", "fill"], {
      input: `protocol=https\nhost=github.com\npath=${repository(repo)}.git\n\n`,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never", GIT_ASKPASS: "", SSH_ASKPASS: "" },
    });
    return response.split(/\r?\n/).find(line => line.startsWith("password="))?.slice("password=".length) || undefined;
  } catch { return undefined; }
}

/** No network, credential read, or mutation happens until a method is called. */
export function createGitHubClient({ fetchImpl = globalThis.fetch, token, credentialProvider = localCredential, timeoutMs = 30000 } = {}) {
  const credentials = new Map();
  async function getCredential(repo) {
    repository(repo);
    if (token?.trim()) return token.trim();
    const key = repo.toLowerCase();
    if (!credentials.has(key)) credentials.set(key, Promise.resolve().then(() => credentialProvider(repo)));
    return credentials.get(key);
  }
  async function request(repo, endpoint, { method = "GET", body, authenticate = false } = {}) {
    repository(repo);
    let credential = token || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
    if (!credential && credentials.has(repo.toLowerCase())) credential = await credentials.get(repo.toLowerCase());
    if (authenticate) credential = await getCredential(repo);
    if (authenticate && !credential) {
      const error = new Error("GitHub write authentication is unavailable. Configure existing GitHub credentials before starting this batch.");
      error.code = "GITHUB_AUTH_REQUIRED";
      throw error;
    }
    const perform = async auth => {
      const response = await fetchImpl(`${API}${endpoint}`, {
        method,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return response;
    };
    let response;
    try {
      response = await perform(credential);
      if (!credential && [401, 403, 404].includes(response.status)) {
        credential = await getCredential(repo);
        if (credential) response = await perform(credential);
      }
    } catch {
      const error = new Error("GitHub request could not complete; tasks remain blocked until connectivity is restored.");
      error.code = "GITHUB_UNAVAILABLE";
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`GitHub request failed (HTTP ${response.status}); no dependency or write result is assumed.`);
      error.status = response.status;
      error.code = "GITHUB_HTTP_ERROR";
      throw error;
    }
    if (response.status === 204) return null;
    try { return await response.json(); }
    catch { throw new Error("GitHub returned invalid JSON; tasks remain blocked."); }
  }
  async function collection(repo, endpoint) {
    const results = [];
    for (let page = 1; page <= 100; page++) {
      const values = await request(repo, `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      if (!Array.isArray(values)) throw new Error("GitHub returned an invalid collection; tasks remain blocked.");
      results.push(...values);
      if (values.length < 100) return results;
    }
    throw new Error("GitHub collection exceeded its page limit; refusing an incomplete task list.");
  }
  async function getIssue(repo, number) {
    return normalizeIssue(await request(repo, `/repos/${repository(repo)}/issues/${issueNumber(number)}`), repo);
  }
  return {
    async listIssues(repo) {
      const values = await collection(repo, `/repos/${repository(repo)}/issues?state=all`);
      return values.filter(value => !value.pull_request).map(value => normalizeIssue(value, repo));
    },
    getIssue,
    async listComments(repo, number) {
      const values = await collection(repo, `/repos/${repository(repo)}/issues/${issueNumber(number)}/comments`);
      return values.map(comment => {
        if (!comment || !Number.isSafeInteger(comment.id) || comment.id < 1 || (comment.body != null && typeof comment.body !== "string")) {
          throw new Error("GitHub returned an invalid issue comment; refusing an incomplete discussion history.");
        }
        return {
          id: comment.id,
          body: comment.body ?? "",
          author: comment.user?.login ?? null,
          createdAt: comment.created_at,
        };
      });
    },
    async getBlockers(repo, issueOrNumber) {
      const issue = typeof issueOrNumber === "object" ? issueOrNumber : await getIssue(repo, issueOrNumber);
      const references = parseDependencies(issue.body, repo);
      const native = await collection(repo, `/repos/${repository(repo)}/issues/${issueNumber(issue.number)}/dependencies/blocked_by`);
      for (const blocker of native) {
        const match = blocker.html_url?.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/([1-9]\d*)/);
        references.push({ repo: match?.[1] ?? repo, number: issueNumber(blocker.number) });
      }
      const unique = new Map(references.map(ref => [`${ref.repo.toLowerCase()}#${ref.number}`, ref]));
      return Promise.all([...unique.values()].map(ref => getIssue(ref.repo, ref.number)));
    },
    async hasAuth(repo) { return Boolean(await getCredential(repo)); },
    async checkWriteAuth(repo) {
      if (!await getCredential(repo)) return false;
      const data = await request(repo, `/repos/${repository(repo)}`, { authenticate: true });
      return Boolean(data.permissions?.push || data.permissions?.triage || data.permissions?.maintain || data.permissions?.admin);
    },
    async addComment(repo, number, body) {
      if (typeof body !== "string" || !body.trim()) throw new Error("An issue comment must not be empty.");
      return request(repo, `/repos/${repository(repo)}/issues/${issueNumber(number)}/comments`, { method: "POST", body: { body }, authenticate: true });
    },
    async closeIssue(repo, number) {
      return normalizeIssue(await request(repo, `/repos/${repository(repo)}/issues/${issueNumber(number)}`, {
        method: "PATCH", body: { state: "closed", state_reason: "completed" }, authenticate: true,
      }), repo);
    },
  };
}

const client = createGitHubClient();
export const listIssues = (...args) => client.listIssues(...args);
export const getIssue = (...args) => client.getIssue(...args);
export const listComments = (...args) => client.listComments(...args);
export const getBlockers = (...args) => client.getBlockers(...args);
export const hasAuth = (...args) => client.hasAuth(...args);
export const checkWriteAuth = (...args) => client.checkWriteAuth(...args);
export const addComment = (...args) => client.addComment(...args);
export const closeIssue = (...args) => client.closeIssue(...args);
