// Drives the real Windows Tauri exe through Microsoft WebView2 WebDriver.
// No Computer Use, ordinary browser launch, injected clicks, or mocked IPC.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.dirname(fileURLToPath(import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const separator = argument.indexOf('=');
  assert.ok(separator > 2, 'Use --run-id=issue3-wd-name, --port=33030, or --expect-first=TEXT');
  return [argument.slice(2, separator), argument.slice(separator + 1)];
}));
for (const key of Object.keys(options)) assert.ok(['run-id', 'port', 'expect-first'].includes(key), `Unknown option: ${key}`);
const runId = options['run-id'];
assert.match(runId ?? '', /^issue3-wd-[a-z0-9-]+$/);
const port = Number(options.port ?? 33030);
assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
const directory = path.join(project, 'evidence', runId);
const exe = path.join(project, 'target', 'debug', 'issue3-windows-smoke.exe');
const driverExe = path.join(project, '.tools', 'issue3-webdriver', 'msedgedriver.exe');
const sha256 = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex').toUpperCase();
const exeHash = await sha256(exe);
const driverHash = await sha256(driverExe);
const versionResult = spawnSync(driverExe, ['--version'], { windowsHide: true, encoding: 'utf8' });
assert.equal(versionResult.status, 0, 'WebDriver --version must succeed');
const driverVersion = versionResult.stdout.trim();
assert.match(driverVersion, /136\.0\.3240\.76/);
// Reserve-check a loopback port without touching another task's service.
await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
await fs.mkdir(directory); // Refuse to overwrite an existing run.
const temp = path.join(directory, 'driver-temp');
await fs.mkdir(temp);
const webviewData = path.join(directory, 'webview-data');
const writeJson = (name, value) => fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const appendJson = (name, value) => fs.appendFile(path.join(directory, name), JSON.stringify(value) + '\n');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1', '--verbose', `--log-path=${path.join(directory, 'driver.txt')}`], {
  cwd: project,
  windowsHide: true,
  env: {
    ...process.env,
    ISSUE3_RUN_ID: runId,
    ISSUE3_EVIDENCE_DIR: directory,
    ISSUE3_DATA_DIR: webviewData,
    TAURI_WEBVIEW_AUTOMATION: 'true',
    TEMP: temp,
    TMP: temp
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
const stdout = createWriteStream(path.join(directory, 'driver-stdout.txt'));
const stderr = createWriteStream(path.join(directory, 'driver-stderr.txt'));
driver.stdout.pipe(stdout);
driver.stderr.pipe(stderr);
let driverError;
driver.once('error', error => { driverError = error; });
let sessionId;
let hostPid;
let passed = false;
const endpoint = `http://127.0.0.1:${port}`;

async function command(method, route, body, timeoutMs = 20000) {
  const startedAt = new Date().toISOString();
  const response = await fetch(endpoint + route, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const payload = await response.json();
  await appendJson('webdriver-events.jsonl', {
    at: startedAt, method, route, request: body, status: response.status,
    response: route.endsWith('/screenshot') || route.endsWith('/source')
      ? { artifactContentLength: payload.value?.length } : payload
  });
  if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${route}: ${JSON.stringify(payload.value)}`);
  return payload.value;
}

async function waitUntil(operation, description, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    if (driverError) throw driverError;
    if (driver.exitCode !== null) throw new Error(`WebDriver exited with ${driver.exitCode}`);
    try { if (await operation()) return; } catch (error) { lastError = error; }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`, { cause: lastError });
}

const sessionCommand = (method, route, body) => command(method, `/session/${sessionId}${route}`, body);
async function element(selector) {
  const result = await sessionCommand('POST', '/element', { using: 'css selector', value: selector });
  return result['element-6066-11e4-a52e-4f735466cecf'];
}
const text = id => sessionCommand('GET', `/element/${id}/text`);

async function capture(label) {
  const image = await sessionCommand('GET', '/screenshot');
  await fs.writeFile(path.join(directory, label + '.png'), Buffer.from(image, 'base64'));
  const source = await sessionCommand('GET', '/source');
  await fs.writeFile(path.join(directory, label + '.html'), source);
}

async function submitAndAssert({ request, expected, detail, label }) {
  const input = await element('#request');
  await sessionCommand('POST', `/element/${input}/clear`, {});
  await sessionCommand('POST', `/element/${input}/value`, { text: request });
  assert.equal(await sessionCommand('GET', `/element/${input}/property/value`), request, 'WebDriver must enter the actual input');
  const button = await element('button[type="submit"]');
  assert.equal(await sessionCommand('GET', `/element/${button}/displayed`), true);
  await sessionCommand('POST', `/element/${button}/click`, {});
  const status = await element('#status');
  await waitUntil(async () => {
    const rendered = await text(status);
    return /^(Rust OK|Rust ERROR) \|/.test(rendered) && rendered.includes(`| call=${detail.call} | pid=${hostPid}`);
  }, 'rendered Rust response for this invocation');
  const actual = await text(status);
  await capture(label);
  assert.equal(await sessionCommand('GET', `/element/${status}/displayed`), true, 'Result must be rendered and displayed');
  assert.equal(actual, expected, 'Visible result must match the independent expected literal');
  const details = JSON.parse(await text(await element('#details')));
  for (const [key, value] of Object.entries(detail)) assert.equal(details[key], value, `Visible details field ${key}`);
  await appendJson('assertions.jsonl', { verdict: 'PASS', boundary: 'real WebView2 UI → Rust command → rendered text', request, expected, actual, details, at: new Date().toISOString() });
  console.log(`PASS ${runId}: ${actual}`);
}

try {
  await waitUntil(async () => (await command('GET', '/status')).ready, 'WebDriver ready');
  const created = await command('POST', '/session', {
    capabilities: { alwaysMatch: {
      browserName: 'webview2',
      'ms:edgeOptions': { binary: exe, webviewOptions: { userDataFolder: webviewData } }
    } }
  }, 60000);
  sessionId = created.sessionId;
  assert.ok(sessionId, 'WebDriver must return a real session id');
  await writeJson('session.json', created);
  const rustEvents = () => fs.readFile(path.join(directory, 'rust-events.jsonl'), 'utf8');
  await waitUntil(async () => (await rustEvents()).includes('process-started'), 'real Tauri process startup');
  const startup = JSON.parse((await rustEvents()).trim().split(/\r?\n/)[0]);
  hostPid = startup.pid;
  assert.equal(startup.exe.toLowerCase(), exe.toLowerCase());
  assert.equal(startup.runId, runId);
  await writeJson('launch.json', { runId, pid: hostPid, executable: exe, sha256: exeHash, driverPid: driver.pid, driverVersion, driverSha256: driverHash, port, webviewData, sessionId, launchedAt: new Date().toISOString(), transport: 'W3C WebDriver / Microsoft WebView2' });
  await waitUntil(async () => await text(await element('#status')) === 'READY · 等待界面操作', 'initial visible READY');
  const environment = await sessionCommand('POST', '/execute/sync', {
    script: 'return {url:location.href,userAgent:navigator.userAgent,visibility:document.visibilityState,tauriInvokeType:typeof window.__TAURI__?.core?.invoke};', args: []
  });
  assert.equal(environment.url, 'http://tauri.localhost/');
  assert.equal(environment.visibility, 'visible');
  assert.equal(environment.tauriInvokeType, 'function');
  await writeJson('webview.json', environment);
  await capture('01-ready');
  await submitAndAssert({ request: 'issue3-桌面-001', expected: options['expect-first'] ?? `Rust OK | ISSUE3-桌面-001 | chars=13 | call=1 | pid=${hostPid}`, detail: { original: 'issue3-桌面-001', uppercase: 'ISSUE3-桌面-001', charCount: 13, call: 1, pid: hostPid, runId }, label: '02-success-call-1' });
  await submitAndAssert({ request: 'docker-知识-002', expected: `Rust OK | DOCKER-知识-002 | chars=13 | call=2 | pid=${hostPid}`, detail: { original: 'docker-知识-002', uppercase: 'DOCKER-知识-002', charCount: 13, call: 2, pid: hostPid, runId }, label: '03-success-call-2' });
  await submitAndAssert({ request: '   ', expected: `Rust ERROR | EMPTY_REQUEST | Rust 拒绝空白输入 | call=3 | pid=${hostPid}`, detail: { code: 'EMPTY_REQUEST', message: 'Rust 拒绝空白输入', call: 3, pid: hostPid }, label: '04-rejection-call-3' });
  passed = true;
} catch (error) {
  await writeJson('failure.json', { verdict: 'FAIL', message: error.message, stack: error.stack, cause: error.cause?.message, at: new Date().toISOString() });
  console.error(`FAIL ${runId}: ${error.message}`);
  process.exitCode = 1;
} finally {
  let sessionClosed = false;
  if (sessionId) {
    try { await command('DELETE', `/session/${sessionId}`); sessionClosed = true; }
    catch (error) { await writeJson('cleanup-error.json', { message: error.message }); }
  }
  // Only terminate the driver created by this invocation. Session deletion owns
  // cleanup of the native application that this driver launched.
  driver.kill();
  await new Promise(resolve => { if (!driver.pid || driver.exitCode !== null || driver.signalCode !== null) resolve(); else driver.once('exit', resolve); });
  const hostAlive = () => {
    if (!hostPid) return false;
    try { process.kill(hostPid, 0); return true; }
    catch (error) { if (error.code === 'ESRCH') return false; throw error; }
  };
  const exitDeadline = Date.now() + 5000;
  while (hostAlive() && Date.now() < exitDeadline) await delay(100);
  const hostExited = Boolean(hostPid) && !hostAlive();
  const verdict = passed && sessionClosed && hostExited ? 'PASS' : 'FAIL';
  await writeJson('result.json', { verdict, runId, hostPid, exeSha256: exeHash, driverVersion, driverSha256: driverHash, sessionClosed, hostExited, driverStopped: true, at: new Date().toISOString() });
  if (!sessionClosed || !hostExited) process.exitCode = 1;
  console.log(`${verdict} ${runId}: session closed=${sessionClosed}; host exited=${hostExited}; driver stopped; exe=${exeHash}`);
}
