import test from "node:test";
import assert from "node:assert/strict";
import { acceptance, inheritModel, powershell, resumeDecision } from "../execution.mjs";

test("all checkbox criteria are verified, including later lines and no final heading", () => {
  assert.deepEqual(acceptance("## Acceptance criteria\n\n- [ ] Search works\n- [ ] Restart preserves data\n\n## Context\n- [ ] Not an acceptance item"), [
    { id: "A1", text: "Search works" }, { id: "A2", text: "Restart preserves data" },
  ]);
  assert.equal(acceptance("## Acceptance criteria\r\n- [x] One\r\n- [ ] Two").length, 2);
  assert.deepEqual(acceptance("## Context\n- [ ] Some note"), []);
});

test("inheriting local model removes only the explicit override and preserves task stdin and permissions", () => {
  const base = { buildPrintCommand: ({ prompt }) => ({ command: "codex exec --json --dangerously-bypass-approvals-and-sandbox -m 'noterion-inherit-local-model'", stdin: prompt }) };
  const result = inheritModel(base, true).buildPrintCommand({ prompt: "A task with quotes ' and $" });
  assert.equal(result.command, "codex exec --json --dangerously-bypass-approvals-and-sandbox");
  assert.equal(result.stdin, "A task with quotes ' and $");
  assert.equal(inheritModel(base, false), base);
  assert.throws(() => inheritModel({ buildPrintCommand: () => ({ command: "changed provider command" }) }, true).buildPrintCommand({}), /模型参数/);
});

test("the verifier observes real PowerShell success and native process failure", { skip: process.platform !== "win32" }, async () => {
  const signal = new AbortController().signal;
  const success = await powershell("Write-Output 'verified'", process.cwd(), signal, 10000);
  assert.equal(success.exitCode, 0);
  assert.match(success.output, /verified/);
  const failed = await powershell("cmd.exe /c exit 7", process.cwd(), signal, 10000);
  assert.equal(failed.exitCode, 7);
  const thrown = await powershell("throw 'expected failure'", process.cwd(), signal, 10000);
  assert.notEqual(thrown.exitCode, 0);
});

test("resume never closes changed requirements or ignores the disabled close setting", () => {
  const issue = { state: "open", labels: ["ready-for-agent"] };
  const merged = { mergeCommit: "verified-commit" };
  const proof = { sameRequirements: true, mergedInHead: true, blockersClosed: true };
  assert.equal(resumeDecision(merged, issue, proof), "publish-and-close");
  assert.equal(resumeDecision(merged, issue, { ...proof, sameRequirements: false }), "hold");
  assert.equal(resumeDecision(merged, issue, { ...proof, blockersClosed: false }), "hold");
  assert.equal(resumeDecision(merged, issue, { ...proof, autoClose: false }), "pending-close");
  assert.equal(resumeDecision({ needsUser: true }, issue, { sameRequirements: true }), "hold");
  assert.equal(resumeDecision({ needsUser: true }, issue, { sameRequirements: true, freshDiscussion: true }), "retry");
});
