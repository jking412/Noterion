import test from "node:test";
import assert from "node:assert/strict";
import { selectReady, validateImplementation, validateReview, parseReport } from "../workflow.mjs";

const issue = (number, dependencies = [], overrides = {}) => ({
  number, title: `Task ${number}`, state: "open", labels: ["ready-for-agent"], dependencies, ...overrides,
});

test("a user question blocks its implementation without stopping independent work", () => {
  const result = selectReady([
    issue(2, [], { labels: [{ name: "ready-for-human" }] }),
    issue(3), issue(4, [2, 3]), issue(10),
  ], [2, 3, 4, 10], {}, [], 2);
  assert.deepEqual(result.ready.map((item) => item.number), [3, 10]);
  assert.deepEqual(result.human.map((item) => item.number), [2]);
  assert.deepEqual(result.waiting.find((item) => item.issue.number === 4).blockedBy, [2, 3]);
});

test("a new issue is not silently admitted to the fixed startup batch", () => {
  const result = selectReady([issue(1), issue(3), issue(10)], [1, 3], {}, [], 3);
  assert.deepEqual(result.ready.map((item) => item.number), [1, 3]);
});

test("dependencies missing from a fresh read do not count as completed", () => {
  const result = selectReady([issue(4, [2, 3])], [4]);
  assert.equal(result.ready.length, 0);
  assert.deepEqual(result.waiting[0].blockedBy, [2, 3]);
});

test("unverified dependency metadata cannot become an empty dependency list", () => {
  const result = selectReady([issue(1, [], { dependencies: undefined })], [1]);
  assert.equal(result.ready.length, 0);
  assert.match(result.waiting[0].reason, /not been verified/);
});

test("only GitHub closure unlocks dependent work, not an Agent done result", () => {
  const open = [issue(3), issue(4, [3])];
  const result = selectReady(open, [3, 4], { 3: { status: "pending-close" } });
  assert.equal(result.ready.length, 0);
  const closed = selectReady([issue(3, [], { state: "closed" }), issue(4, [3])], [3, 4]);
  assert.deepEqual(closed.ready.map((item) => item.number), [4]);
});

test("active work consumes capacity and is not claimed twice", () => {
  const result = selectReady([issue(1), issue(3), issue(10)], [1, 3, 10], {}, [1], 2);
  assert.deepEqual(result.ready.map((item) => item.number), [3]);
  assert.equal(result.waiting.find((item) => item.issue.number === 10).blockedBy.length, 0);
});

test("a blocked attempt is not relaunched during the same batch", () => {
  const result = selectReady([issue(1), issue(3)], [1, 3], new Map([[1, { status: "blocked" }]]));
  assert.deepEqual(result.ready.map((item) => item.number), [3]);
});

test("a dependency cycle stays blocked instead of selecting a weakest dependency", () => {
  const result = selectReady([issue(1, [3]), issue(3, [1])], [1, 3]);
  assert.equal(result.ready.length, 0);
  assert.equal(result.waiting.length, 2);
});

test("a human label wins even if a task also has the Agent label", () => {
  const result = selectReady([issue(2, [], { labels: ["ready-for-human", "ready-for-agent"] })], [2]);
  assert.equal(result.ready.length, 0);
  assert.equal(result.human[0].number, 2);
});

test("empty summary and malformed commands are not accepted as implementation results", () => {
  assert.throws(() => validateImplementation({ status: "ready", summary: " ", checks: [] }));
  assert.throws(() => validateImplementation({ status: "ready", summary: "Done", checks: [{ command: " " }] }));
  assert.equal(validateImplementation({ status: "blocked", summary: "Need user decision", checks: [] }).status, "blocked");
});

const approved = () => ({
  status: "approved", summary: "Acceptance checked", checks: [{ command: "node --test smoke.test.mjs" }],
  acceptance: [{ criterion: "Name search locates the knowledge point", passed: true, evidence: "Windows smoke log and capture" }],
});

test("an approval without observable acceptance evidence cannot allow a merge", () => {
  assert.throws(() => validateReview({ ...approved(), acceptance: [] }));
  assert.throws(() => validateReview({ ...approved(), acceptance: [{ criterion: "Search", passed: true, evidence: " " }] }));
  assert.throws(() => validateReview({ ...approved(), acceptance: [{ criterion: "Search", passed: false, evidence: "Search did not locate point" }] }));
  assert.equal(validateReview(approved()).status, "approved");
});

test("a completion slogan alone is not a report", () => {
  assert.throws(() => parseReport("<promise>COMPLETE</promise>", "review"), /Missing/);
});

test("the final review supersedes an earlier approval, including malformed final output", () => {
  const first = `<review>${JSON.stringify(approved())}</review>`;
  const revised = { ...approved(), status: "changes", summary: "A regression remains" };
  assert.equal(parseReport(`${first}\n<review>${JSON.stringify(revised)}</review>`, "review").status, "changes");
  assert.throws(() => parseReport(`${first}\n<review>invalid</review>`, "review"), /final/);
  assert.throws(() => parseReport(`${first}\n<review>{"status":"changes"`, "review"), /Incomplete final/);
});
