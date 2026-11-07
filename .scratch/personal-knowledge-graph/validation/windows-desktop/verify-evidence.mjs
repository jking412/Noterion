// Verifies archived WebDriver evidence; this does not replay the native app.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const project = path.dirname(fileURLToPath(import.meta.url));
const runs = process.argv.slice(2);
assert.ok(runs.length >= 2, 'Supply at least two completed WebDriver run ids');
const read = async filename => JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
const lines = async filename => (await fs.readFile(filename, 'utf8')).trim().split(/\r?\n/).map(line => JSON.parse(line));
const fixtures = [
  { original: 'issue3-桌面-001', uppercase: 'ISSUE3-桌面-001', charCount: 13, call: 1 },
  { original: 'docker-知识-002', uppercase: 'DOCKER-知识-002', charCount: 13, call: 2 }
];
const pids = new Set();
const hashes = new Set();
const driverHashes = new Set();
for (const runId of runs) {
  assert.match(runId, /^issue3-wd-[a-z0-9-]+$/);
  const directory = path.join(project, 'evidence', runId);
  const launch = await read(path.join(directory, 'launch.json'));
  const result = await read(path.join(directory, 'result.json'));
  const events = await lines(path.join(directory, 'rust-events.jsonl'));
  const assertions = await lines(path.join(directory, 'assertions.jsonl'));
  const protocol = await lines(path.join(directory, 'webdriver-events.jsonl'));
  const session = await read(path.join(directory, 'session.json'));
  const webview = await read(path.join(directory, 'webview.json'));
  assert.equal(result.verdict, 'PASS');
  assert.equal(result.sessionClosed, true);
  assert.equal(result.hostExited, true);
  assert.equal(result.driverStopped, true);
  assert.equal(result.exeSha256, launch.sha256);
  assert.equal(result.hostPid, launch.pid);
  assert.equal(session.capabilities.browserName, 'webview2');
  assert.equal(session.capabilities.browserVersion, '136.0.3240.76');
  assert.equal(session.sessionId, launch.sessionId);
  assert.equal(webview.url, 'http://tauri.localhost/');
  assert.equal(webview.visibility, 'visible');
  const newSession = protocol.find(event => event.method === 'POST' && event.route === '/session');
  assert.equal(newSession.request.capabilities.alwaysMatch.browserName, 'webview2');
  assert.equal(newSession.request.capabilities.alwaysMatch['ms:edgeOptions'].binary, launch.executable);
  assert.equal(protocol.filter(event => event.method === 'POST' && event.route.endsWith('/value')).length, 3);
  assert.equal(protocol.filter(event => event.method === 'POST' && event.route.endsWith('/click')).length, 3);
  assert.equal(events.length, 4);
  assert.equal(events[0].event, 'process-started');
  assert.equal(events[0].pid, launch.pid);
  assert.equal(events[0].runId, runId);
  assert.equal(assertions.length, 3);
  assert.ok((await fs.readFile(path.join(directory, '01-ready.html'), 'utf8')).includes('READY · 等待界面操作'));
  for (const fixture of fixtures) {
    const event = events[fixture.call];
    assert.equal(event.event, 'rust-command-returned');
    assert.equal(event.command, 'issue3_roundtrip');
    for (const [key, value] of Object.entries(fixture)) assert.equal(event.reply[key], value);
    assert.equal(event.reply.pid, launch.pid);
    assert.equal(event.reply.runId, runId);
    const expected = `Rust OK | ${fixture.uppercase} | chars=13 | call=${fixture.call} | pid=${launch.pid}`;
    assert.equal(assertions[fixture.call - 1].verdict, 'PASS');
    assert.equal(assertions[fixture.call - 1].actual, expected);
    assert.equal(assertions[fixture.call - 1].expected, expected);
    const stem = `0${fixture.call + 1}-success-call-${fixture.call}`;
    assert.ok((await fs.readFile(path.join(directory, stem + '.html'), 'utf8')).includes(expected));
    assert.ok((await fs.stat(path.join(directory, stem + '.png'))).size > 0);
  }
  assert.equal(events[3].event, 'rust-command-rejected');
  assert.equal(events[3].request, '   ');
  assert.equal(events[3].error.code, 'EMPTY_REQUEST');
  assert.equal(events[3].error.call, 3);
  assert.equal(events[3].error.pid, launch.pid);
  const expected = `Rust ERROR | EMPTY_REQUEST | Rust 拒绝空白输入 | call=3 | pid=${launch.pid}`;
  assert.equal(assertions[2].verdict, 'PASS');
  assert.equal(assertions[2].actual, expected);
  assert.equal(assertions[2].expected, expected);
  assert.ok((await fs.readFile(path.join(directory, '04-rejection-call-3.html'), 'utf8')).includes(expected));
  hashes.add(launch.sha256);
  driverHashes.add(launch.driverSha256);
  pids.add(launch.pid);
  console.log(`PASS ${runId}: native WebView2 pid=${launch.pid}; 2 rendered successes + 1 Rust rejection; host exited`);
}
assert.equal(pids.size, runs.length, 'Repeated runs must launch separate native processes');
assert.equal(hashes.size, 1, 'Repeated runs must use the same Tauri exe');
assert.equal(driverHashes.size, 1, 'Repeated runs must use the same WebDriver');
console.log(`PASS ${runs.length} WebDriver runs; native exe SHA256=${[...hashes][0]}`);
