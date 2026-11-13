// Exercise a packaged Windows client through its visible WebView2 interface.
// WebDriver executes user actions; execute/sync is used only to observe the page.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';

const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const separator = argument.indexOf('=');
  assert.ok(argument.startsWith('--') && separator > 2, 'Use --exe=... --driver=... --output=...');
  return [argument.slice(2, separator), argument.slice(separator + 1)];
}));
assert.ok(Object.keys(options).every(key => ['exe', 'driver', 'output'].includes(key)), 'Unknown smoke option');
for (const key of ['exe', 'driver', 'output']) assert.ok(options[key], `--${key} is required`);
const exe = path.resolve(options.exe);
const driverExe = path.resolve(options.driver);
const output = path.resolve(options.output);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output); // Never reuse old evidence, data, or browser state.
const config = path.join(output, 'isolated-config');
const assertions = [];
const startedAt = new Date().toISOString();
const pointName = 'Release smoke: 保存后重启';
const description = '由真实 Windows 客户端保存的知识点；无需开发服务器。';
let driver, session, hostPid, endpoint, launches = 0, failure;
const observations = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const append = (name, value) => fs.appendFile(path.join(output, name), JSON.stringify(value) + '\n');
const alive = pid => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
async function hash(filename) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}
async function until(operation, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try { const value = await operation(); if (value) return value; }
    catch (error) { lastError = error; }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}`, { cause: lastError });
}
async function command(method, route, body, timeoutMs = 20000) {
  const response = await fetch(endpoint + route, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  await append('webdriver.jsonl', { at: new Date().toISOString(), method, route, request: body,
    status: response.status, response: /\/(screenshot|source)$/.test(route) ? { length: payload.value?.length } : payload });
  if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${route}: ${JSON.stringify(payload.value)}`);
  return payload.value;
}
const wd = (method, route, body) => command(method, `/session/${session}${route}`, body);
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const find = async selector => (await wd('POST', '/element', { using: 'css selector', value: selector }))[elementKey];
const findAll = selector => wd('POST', '/elements', { using: 'css selector', value: selector });
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
async function click(selector) {
  const id = await until(async () => {
    const candidate = await find(selector);
    return await wd('GET', `/element/${candidate}/displayed`) && await wd('GET', `/element/${candidate}/enabled`) && candidate;
  }, `visible enabled ${selector}`);
  await wd('POST', `/element/${id}/click`, {});
}
async function fill(selector, value) {
  const id = await find(selector);
  await wd('POST', `/element/${id}/clear`, {});
  await wd('POST', `/element/${id}/value`, { text: value });
  assert.equal(await wd('GET', `/element/${id}/property/value`), value);
}
async function capture(label) {
  await fs.writeFile(path.join(output, `${label}.png`), Buffer.from(await wd('GET', '/screenshot'), 'base64'));
  await fs.writeFile(path.join(output, `${label}.html`), await wd('GET', '/source'));
}
async function check(label, operation) {
  const detail = await operation();
  assertions.push({ label, verdict: 'PASS', at: new Date().toISOString(), detail });
  await write('assertions.json', assertions);
  console.log(`PASS: ${label}`);
}
async function launch() {
  launches++;
  const profile = path.join(output, `webview-${launches}`);
  const temp = path.join(output, `temp-${launches}`);
  await fs.mkdir(temp);
  const port = await new Promise((resolve, reject) => {
    const probe = net.createServer(); probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => { const selected = probe.address().port; probe.close(() => resolve(selected)); });
  });
  endpoint = `http://127.0.0.1:${port}`;
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1', `--log-path=${path.join(output, `driver-${launches}.log`)}`], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NOTERION_CONFIG_DIR: config, NOTERION_WEBVIEW_DIR: profile,
      TAURI_WEBVIEW_AUTOMATION: 'true', TEMP: temp, TMP: temp },
  });
  let spawnError;
  driver.once('error', error => { spawnError = error; });
  driver.stdout.pipe(createWriteStream(path.join(output, `driver-${launches}-stdout.txt`)));
  driver.stderr.pipe(createWriteStream(path.join(output, `driver-${launches}-stderr.txt`)));
  await until(async () => {
    if (spawnError) throw spawnError;
    assert.equal(driver.exitCode, null, 'EdgeDriver must stay alive');
    return (await command('GET', '/status')).ready;
  }, 'EdgeDriver starts');
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'webview2', 'ms:edgeOptions': { binary: exe, webviewOptions: { userDataFolder: profile } },
  } } }, 60000);
  session = created.sessionId;
  assert.ok(session, 'WebDriver session exists');
  await write(`session-${launches}.json`, created);
  // Query only the specified binary's PID, never unrelated processes or user data.
  const observed = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:NOTERION_SMOKE_EXE } | Select-Object -ExpandProperty ProcessId | ConvertTo-Json -Compress'], {
    windowsHide: true, encoding: 'utf8', timeout: 20000, env: { ...process.env, NOTERION_SMOKE_EXE: exe },
  });
  assert.equal(observed.status, 0, observed.stderr);
  const pids = JSON.parse(observed.stdout.trim() || '[]');
  const candidates = Array.isArray(pids) ? pids : [pids];
  assert.equal(candidates.length, 1, 'Exactly one isolated client process owns this executable');
  hostPid = candidates[0];
  const environment = await until(async () => {
    const value = await wd('POST', '/execute/sync', { script:
      'return {url:location.href,visibility:document.visibilityState,invoke:typeof window.__TAURI__?.core?.invoke,userAgent:navigator.userAgent,scripts:Array.from(document.scripts,s=>s.src).filter(Boolean)};', args: [] });
    return value.url === 'http://tauri.localhost/' && value.visibility === 'visible' && value.invoke === 'function' && value;
  }, 'visible embedded Tauri page');
  assert.ok(environment.scripts.length > 0, 'Production interface has embedded JavaScript');
  assert.ok(environment.scripts.every(url => new URL(url).origin === 'http://tauri.localhost'), 'All interface scripts are embedded in the exe');
  await until(async () => {
    assert.equal((await findAll('[data-testid="storage-error"]')).length, 0, 'Isolated storage must load without errors');
    return await wd('GET', `/element/${await find('[data-testid="create-point"]')}/enabled`);
  }, 'Rust opens isolated data directory');
  const storageLocation = await text('.storage-location');
  assert.ok(storageLocation.includes(path.join(config, 'data')), 'Visible data directory points inside this smoke run');
  observations.push({ launch: launches, hostPid, driverPid: driver.pid, environment, storageLocation });
  await write('launches.json', observations);
}
function terminateTree(pid) {
  if (!alive(pid)) return;
  const killed = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  if (killed.status !== 0 && alive(pid)) throw new Error(`Unable to terminate owned process ${pid}: ${killed.stderr}`);
}
async function stop(strict = false) {
  const errors = [];
  if (session) {
    try { await command('DELETE', `/session/${session}`); } catch (error) { errors.push(error); }
    session = undefined;
  }
  if (hostPid) {
    try { await until(() => !alive(hostPid), 'client exits before restart', 10000); }
    catch (error) { errors.push(error); terminateTree(hostPid); }
    hostPid = undefined;
  }
  if (driver?.pid) terminateTree(driver.pid);
  driver = undefined;
  if (strict && errors.length) throw new AggregateError(errors, 'Client failed to exit cleanly');
}
try {
  assert.equal(process.platform, 'win32', 'Release smoke requires Windows x64 with WebView2 Runtime');
  assert.equal(process.arch, 'x64', 'Release smoke requires an x64 Node process');
  await fs.access(exe); await fs.access(driverExe);
  await fs.mkdir(config);
  const version = spawnSync(driverExe, ['--version'], { windowsHide: true, encoding: 'utf8', timeout: 20000 });
  assert.equal(version.status, 0, 'EdgeDriver --version succeeds');
  await write('inputs.json', { exe, exeSha256: await hash(exe), driverExe, driverSha256: await hash(driverExe),
    driverVersion: version.stdout.trim(), node: process.version, platform: process.platform, architecture: process.arch });
  await launch();
  await check('packaged client opens embedded interface and isolated Rust storage', async () => observations[0]);
  await capture('01-embedded-interface');
  await click('[data-testid="create-point"]');
  await fill('#knowledge-name', pointName);
  await fill('#knowledge-description', description);
  await click('[data-testid="save-point"]');
  await check('visible save commits a knowledge point through the real Rust core', async () => {
    await until(async () => (await findAll('#knowledge-name')).length === 0, 'save dialog closes after commit');
    await until(async () => (await text('[data-testid="knowledge-details"] h1')) === pointName, 'saved knowledge detail appears');
    assert.ok((await text('[data-testid="knowledge-details"]')).includes(description));
    assert.equal((await findAll('[data-testid="storage-error"]')).length, 0);
    return { pointName, description };
  });
  await capture('02-saved');
  await stop(true);
  await launch();
  await fill('[data-testid="search-input"]', pointName);
  await check('fresh client process reads the committed knowledge from disk', async () => {
    await until(async () => (await findAll('.result-item')).length === 1, 'exactly one persisted search result');
    await click('.result-item');
    assert.equal(await text('[data-testid="knowledge-details"] h1'), pointName);
    assert.ok((await text('[data-testid="knowledge-details"]')).includes(description));
    assert.notEqual(observations[0].hostPid, observations[1].hostPid, 'Persistence is observed from a new application process');
    assert.equal((await findAll('[data-testid="storage-error"]')).length, 0);
    return { pointName, firstPid: observations[0].hostPid, restartedPid: observations[1].hostPid };
  });
  await capture('03-restarted-persistence');
  await stop(true);
} catch (error) {
  failure = error;
  console.error(error.stack);
  if (session) { try { await capture('failure'); } catch (captureError) { console.error(`Failure capture: ${captureError.message}`); } }
} finally {
  try { await stop(); } catch (error) { failure ??= error; console.error(`Cleanup: ${error.stack}`); }
  await write('result.json', { passed: !failure, startedAt, completedAt: new Date().toISOString(), launches, assertions,
    error: failure ? { message: failure.message, stack: failure.stack, cause: failure.cause?.message } : undefined,
    scope: 'Windows x64 packaged exe; embedded UI; real Rust save; persistence after full process restart.',
    limitations: 'No full desktop/media/large-video or live AI-service acceptance. This run uses only synthetic knowledge and isolated data.' });
  if (failure) process.exitCode = 1;
}
