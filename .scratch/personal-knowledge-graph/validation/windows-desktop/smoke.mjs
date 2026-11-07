// HISTORICAL ONLY: excluded from acceptance by the user's later instruction.
// Current acceptance entry point is webdriver-smoke.mjs.
// Run from the persistent node_repl with @oai/sky. Each action consumes one
// inspected observation; callers must inspect its returned tree before next input.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sky } from '@oai/sky';

const project = path.dirname(fileURLToPath(import.meta.url));

export async function select(runId) {
  assert.match(runId, /^issue3-[a-z0-9-]+$/);
  const launch = JSON.parse(await fs.readFile(path.join(project, 'evidence', runId, 'launch.json'), 'utf8'));
  const windows = (await sky.list_windows()).filter(window => window.title === 'Issue3 — Noterion Windows / Rust smoke');
  assert.equal(windows.length, 1, `Expected exactly one real Issue3 window, found ${windows.length}`);
  const session = { launch, window: windows[0], state: null, sequence: 0 };
  await sky.activate_window({ window: session.window });
  return session;
}

export async function observe(session) {
  session.state = await sky.get_window_state({ window: session.window, include_screenshot: true, include_text: true });
  session.window = session.state.window;
  return session.state;
}

async function action(session, operation) {
  assert.ok(session.state?.accessibility, 'Observe and inspect accessibility before an action');
  const observation = session.state;
  session.state = null; // Never reuse indexes if action or refresh fails.
  await operation(observation);
  return observe(session);
}

export async function setInput(session, elementIndex, value) {
  return action(session, observation => sky.set_value({ window: observation.window, element_index: elementIndex, value }));
}

export async function submit(session, elementIndex) {
  return action(session, observation => sky.click({ window: observation.window, element_index: elementIndex }));
}

export async function waitForResult(session, expected, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  do {
    session.state = await sky.get_window_state({ window: session.window, include_screenshot: false, include_text: true });
    session.window = session.state.window;
    if (visibleText(session).includes(expected)) return observe(session);
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  await observe(session);
  await save(session, 'result-timeout');
  assert.fail(`Timed out waiting for visible result: ${expected}`);
}

export async function save(session, label) {
  assert.match(label, /^[a-z0-9-]+$/);
  assert.ok(session.state, 'Cannot save an absent state');
  const stem = `${String(++session.sequence).padStart(2, '0')}-${label}`;
  const directory = session.launch.evidenceDir;
  await fs.writeFile(path.join(directory, stem + '.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), window: session.window,
    accessibility: session.state.accessibility,
    screenshots: session.state.screenshots.map(({ url, ...metadata }) => metadata)
  }, null, 2));
  // Archive for review. get_window_state already displays the screenshot;
  // this file is evidence, not a second inspection route.
  const screenshot = session.state.screenshots[0];
  if (screenshot) {
    const match = /^data:image\/(png|jpeg);base64,(.+)$/s.exec(screenshot.url);
    assert.ok(match, 'Expected screenshot data URL');
    await fs.writeFile(path.join(directory, stem + (match[1] === 'png' ? '.png' : '.jpg')), Buffer.from(match[2], 'base64'));
  }
}

function visibleText(session) {
  assert.ok(session.state?.accessibility, 'Observe the visible result first');
  return session.state.accessibility.tree + '\n' + (session.state.accessibility.document_text ?? '');
}

export async function expectSuccess(session, { uppercase, charCount, call }) {
  const expected = `Rust OK | ${uppercase} | chars=${charCount} | call=${call} | pid=${session.launch.pid}`;
  assert.ok(visibleText(session).includes(expected), `Visible UI must contain exact Rust result: ${expected}`);
  await save(session, `success-call-${call}`);
  await fs.appendFile(path.join(session.launch.evidenceDir, 'assertions.jsonl'), JSON.stringify({
    verdict: 'PASS', assertion: 'visible Rust response', expected, at: new Date().toISOString()
  }) + '\n');
  return expected;
}

export async function expectRejection(session, call) {
  const expected = `Rust ERROR | EMPTY_REQUEST | Rust 拒绝空白输入 | call=${call} | pid=${session.launch.pid}`;
  assert.ok(visibleText(session).includes(expected), `Visible UI must contain Rust rejection: ${expected}`);
  await save(session, `rejection-call-${call}`);
  await fs.appendFile(path.join(session.launch.evidenceDir, 'assertions.jsonl'), JSON.stringify({
    verdict: 'PASS', assertion: 'visible Rust rejection', expected, at: new Date().toISOString()
  }) + '\n');
  return expected;
}

export async function close(session) {
  assert.ok(session.state, 'Observe and inspect before closing the target window');
  const window = session.state.window;
  session.state = null;
  await sky.press_key({ window, key: 'Alt_L+F4' });
  const deadline = Date.now() + 5000;
  do {
    const remaining = (await sky.list_windows()).filter(item => item.id === window.id);
    if (remaining.length === 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.fail('Issue3 window did not close within 5 seconds');
}
