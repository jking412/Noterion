import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubClient, parseDependencies } from "../github.mjs";

const repo = "jking412/Noterion";
const rawIssue = (number, overrides = {}) => ({
  number,
  title: `Task ${number}`,
  body: "## Blocked by\n\nNone (can start immediately).\n\n## Context\nSee #99.",
  state: "open",
  labels: [{ name: "ready-for-agent" }],
  html_url: `https://github.com/${repo}/issues/${number}`,
  updated_at: "2026-11-07T00:00:00Z",
  ...overrides,
});
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const fixtureClient = fetchImpl => createGitHubClient({ fetchImpl, token: "test-token", credentialProvider: async () => undefined });

test("parse current issue dependency links without treating Context references as blockers", () => {
  const body = "## Acceptance criteria\n- [ ] Related to #100\n\n## Blocked by\n\n- [#2 [询问] 布局](https://github.com/jking412/Noterion/issues/2)\n- [#3 [技术验证] Windows](https://github.com/jking412/Noterion/issues/3)\n\n## Context\nSee #99";
  assert.deepEqual(parseDependencies(body, repo), [{ repo, number: 2 }, { repo, number: 3 }]);
});

test("explicit no-dependency markers in published issue format are accepted", () => {
  assert.deepEqual(parseDependencies(rawIssue(1).body, repo), []);
  assert.deepEqual(parseDependencies("**Blocked by：** 无。", repo), []);
});

test("deduplicate local references and preserve cross-repository link destinations", () => {
  const body = "## Blocked by\n- #2, #2\n- other/project#3\n- [#4 dependency](https://github.com/another/repository/issues/4)\n";
  assert.deepEqual(parseDependencies(body, repo), [
    { repo, number: 2 },
    { repo: "other/project", number: 3 },
    { repo: "another/repository", number: 4 },
  ]);
});

test("missing, ambiguous or contradictory dependency declarations fail closed", () => {
  for (const body of [
    "Task refers to #2 but has no dependency declaration.",
    "## Blocked by\n\n## Context\nSee #2",
    "## Blocked by\nWaiting for design approval.",
    "## Blocked by\nNone\n- #2",
    "## Blocked by\nNone (except #2).",
  ]) assert.throws(() => parseDependencies(body, repo), { code: "DEPENDENCIES_UNCLEAR" });
});

test("module construction has no network or credential side effects", () => {
  const client = createGitHubClient({
    fetchImpl() { assert.fail("unexpected network"); },
    credentialProvider() { assert.fail("unexpected credential read"); },
  });
  assert.equal(typeof client.getIssue, "function");
});

test("issue listing paginates, filters pull requests, and normalizes labels", async () => {
  const requests = [];
  const page = Array.from({ length: 99 }, (_, index) => rawIssue(index + 1));
  page.push({ ...rawIssue(100), pull_request: { url: "https://api.github.com/..." } });
  const client = fixtureClient(async url => {
    requests.push(url);
    return response(new URL(url).searchParams.get("page") === "1" ? page : [rawIssue(101, { state: "closed" })]);
  });
  const issues = await client.listIssues(repo);
  assert.equal(requests.length, 2);
  assert.equal(issues.length, 100);
  assert.deepEqual(issues[0].labels, ["ready-for-agent"]);
  assert.equal(issues.at(-1).state, "closed");
  assert.equal(issues[0].updatedAt, "2026-11-07T00:00:00Z");
});

test("body and native blockers are unioned, with latest state fetched for each", async () => {
  const source = rawIssue(4, { body: "## Blocked by\n- #2\n- #3\n\n## Context\nSee #99" });
  const client = fixtureClient(async url => {
    const path = new URL(url).pathname;
    if (path.endsWith("/dependencies/blocked_by")) return response([rawIssue(3), rawIssue(5)]);
    const number = Number(path.split("/").at(-1));
    if (number === 4) return response(source);
    return response(rawIssue(number, { state: number === 2 ? "closed" : "open" }));
  });
  const blockers = await client.getBlockers(repo, 4);
  assert.deepEqual(blockers.map(issue => issue.number), [2, 3, 5]);
  assert.equal(blockers[0].state, "closed");
});

test("comment listing uses paginated GETs and returns discussion bodies and identities", async () => {
  const calls = [];
  const rawComment = id => ({
    id,
    body: `Reply ${id}`,
    user: { login: "jking412" },
    created_at: "2026-11-07T13:00:00Z",
  });
  const client = fixtureClient(async (url, options) => {
    calls.push({ url, method: options.method });
    const firstPage = new URL(url).searchParams.get("page") === "1";
    return response(firstPage ? Array.from({ length: 100 }, (_, index) => rawComment(index + 1)) : [rawComment(101)]);
  });
  const comments = await client.listComments(repo, 2);
  assert.equal(comments.length, 101);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.method === "GET" && new URL(call.url).pathname === `/repos/${repo}/issues/2/comments`));
  assert.deepEqual(comments.at(-1), {
    id: 101,
    body: "Reply 101",
    author: "jking412",
    createdAt: "2026-11-07T13:00:00Z",
  });
});

test("comment listing handles a deleted author and fails closed on malformed history", async () => {
  const client = fixtureClient(async () => response([{ id: 1, body: null, user: null, created_at: "2026-11-07T13:00:00Z" }]));
  assert.deepEqual(await client.listComments(repo, 2), [{ id: 1, body: "", author: null, createdAt: "2026-11-07T13:00:00Z" }]);
  const malformed = fixtureClient(async () => response([{ body: "Missing ID" }]));
  await assert.rejects(malformed.listComments(repo, 2), /invalid issue comment/);
});

test("an empty native list cannot erase body dependencies", async () => {
  const issue = { number: 4, body: "## Blocked by\n- #2" };
  const client = fixtureClient(async url => response(url.includes("/dependencies/") ? [] : rawIssue(2)));
  assert.deepEqual((await client.getBlockers(repo, issue)).map(item => item.number), [2]);
});

test("native dependency read errors never become an empty dependency set", async () => {
  const client = fixtureClient(async () => response({ message: "Forbidden" }, 403));
  await assert.rejects(client.getBlockers(repo, { number: 1, body: "## Blocked by\nNone" }), { status: 403 });
});

test("network errors and invalid collection shapes fail closed", async () => {
  const disconnected = fixtureClient(async () => { throw new Error("private implementation detail"); });
  await assert.rejects(disconnected.listIssues(repo), { code: "GITHUB_UNAVAILABLE" });
  const malformed = fixtureClient(async () => response({ items: [] }));
  await assert.rejects(malformed.listIssues(repo), /invalid collection/);
});

test("missing authentication blocks writes before issuing a request", async () => {
  const client = createGitHubClient({
    credentialProvider: async () => undefined,
    fetchImpl() { assert.fail("must not try a write"); },
  });
  await assert.rejects(client.addComment(repo, 1, "result"), { code: "GITHUB_AUTH_REQUIRED" });
  assert.equal(await client.checkWriteAuth(repo), false);
});

test("write permission preflight is a GET and does not equate a token with permission", async () => {
  const calls = [];
  const client = fixtureClient(async (url, options) => {
    calls.push({ url, options });
    return response({ permissions: { pull: true, push: false } });
  });
  assert.equal(await client.checkWriteAuth(repo), false);
  assert.equal(calls[0].options.method, "GET");
});

test("comment and close operations use JSON data rather than interpolating issue text into commands", async () => {
  const calls = [];
  const client = fixtureClient(async (url, options) => {
    calls.push({ url, options });
    return response(options.method === "PATCH" ? rawIssue(1, { state: "closed" }) : { id: 5 });
  });
  const comment = "Actual newlines\n`literal` $(text) \\\"text\\\"";
  await client.addComment(repo, 1, comment);
  const closed = await client.closeIssue(repo, 1);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), { body: comment });
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-token");
  assert.deepEqual(JSON.parse(calls[1].options.body), { state: "closed", state_reason: "completed" });
  assert.equal(closed.state, "closed");
});

test("repository and issue identifiers cannot inject API paths or helper input", async () => {
  const client = fixtureClient(() => assert.fail("must not fetch"));
  await assert.rejects(client.getIssue("owner/repo\npassword=bad", 1), /owner\/repository/);
  await assert.rejects(client.getIssue(repo, "1/comments"), /positive GitHub issue/);
});
