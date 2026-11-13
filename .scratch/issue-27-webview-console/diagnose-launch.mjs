// Temporary Issue #27 feedback harness. All business actions use W3C UI controls.
// Native top-level windows/focus are observed separately by the parent run.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const at = argument.indexOf('=');
  assert.ok(argument.startsWith('--') && at > 2, 'Arguments use --name=value');
  return [argument.slice(2, at), argument.slice(at + 1)];
}));
assert.ok(Object.keys(options).every(key => ['exe', 'driver', 'output', 'mode', 'hold', 'steps', 'scenario', 'browser-args', 'exclude-switches', 'open-link', 'open-file'].includes(key)), 'Unknown option');
for (const key of ['exe', 'driver', 'output']) assert.ok(options[key], `--${key} is required`);
const mode = options.mode ?? 'launch';
const steps = options.steps ?? 'all';
const scenario = options.scenario ?? 'ui';
assert.ok(['launch', 'attach'].includes(mode));
assert.ok(['core', 'all'].includes(steps));
assert.ok(['ui', 'launch-only'].includes(scenario));
function listOption(value) {
  if (value === undefined) return undefined;
  const result = value.startsWith('[') ? JSON.parse(value) : value.split(',').filter(Boolean);
  assert.ok(Array.isArray(result) && result.every(item => typeof item === 'string'), 'Switch lists use JSON string arrays or comma-separated strings');
  return result;
}
const browserArguments = listOption(options['browser-args']);
const excludeSwitches = listOption(options['exclude-switches']);
assert.ok(mode === 'launch' || browserArguments === undefined, '--browser-args currently applies to launch mode only');
for (const key of ['open-link', 'open-file']) assert.ok(options[key] === undefined || ['true', 'false'].includes(options[key]), `--${key} must be true or false`);
const holdSeconds = Number(options.hold ?? 10);
assert.ok(Number.isFinite(holdSeconds) && holdSeconds >= 0 && holdSeconds <= 600);
assert.equal(process.platform, 'win32');
const exe = path.resolve(options.exe);
const driverExe = path.resolve(options.driver);
const output = path.resolve(options.output);
const config = path.join(output, 'config');
const profile = path.join(output, 'profile');
const temp = path.join(output, 'temp');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (name, value) => fs.writeFile(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const append = (name, value) => fs.appendFile(path.join(output, name), JSON.stringify(value) + '\n');
const checks = [];
let driver, host, hostPid, session, endpoint, failure, closedNormally = false;
let driverSpawnError, hostSpawnError;
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
async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const selected = probe.address().port;
      probe.close(() => resolve(selected));
    });
  });
}
async function until(action, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  do {
    try { const value = await action(); if (value) return value; }
    catch (error) { last = error.message; }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${label}${last ? ` (${last})` : ''}`);
}
async function command(method, route, body, timeoutMs = 20000) {
  const response = await fetch(endpoint + route, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = await response.json();
  // No environment values or entered text are logged through this boundary.
  await append('webdriver.jsonl', { at: new Date().toISOString(), method, route, status: response.status,
    error: payload.value?.error, message: payload.value?.error ? payload.value?.message : undefined });
  if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${route}: ${payload.value?.error ?? response.status} ${payload.value?.message ?? ''}`);
  return payload.value;
}
const wd = (method, route, body, timeoutMs) => command(method, `/session/${session}${route}`, body, timeoutMs);
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const find = async (value, using = 'css selector') => (await wd('POST', '/element', { using, value }))[elementKey];
const all = value => wd('POST', '/elements', { using: 'css selector', value });
const text = async value => wd('GET', `/element/${await find(value)}/text`);
const observe = script => wd('POST', '/execute/sync', { script, args: [] });
async function click(value, using) {
  const id = await until(async () => {
    const candidate = await find(value, using);
    return await wd('GET', `/element/${candidate}/displayed`) && await wd('GET', `/element/${candidate}/enabled`) && candidate;
  }, `visible action ${value}`);
  await append('actions.jsonl', { at: new Date().toISOString(), action: 'click', selector: value, using: using ?? 'css selector' });
  await wd('POST', `/element/${id}/click`, {});
}
const clickText = label => click(`//button[normalize-space(.)='${label}']`, 'xpath');
async function fill(selector, value) {
  const id = await find(selector);
  await append('actions.jsonl', { at: new Date().toISOString(), action: 'fill', selector, length: value.length });
  await wd('POST', `/element/${id}/clear`, {});
  await wd('POST', `/element/${id}/value`, { text: value });
  assert.equal(await wd('GET', `/element/${id}/property/value`), value, `Visible field accepts ${selector}`);
}
async function capture(label) {
  await fs.writeFile(path.join(output, label + '.png'), Buffer.from(await wd('GET', '/screenshot'), 'base64'));
  await fs.writeFile(path.join(output, label + '.html'), await wd('GET', '/source'));
}
async function check(label, action) {
  const detail = await action();
  checks.push({ at: new Date().toISOString(), label, verdict: 'PASS', detail });
  await write('checks.json', checks);
  console.log(`PASS ${label}`);
}
function matchingHosts() {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command',
    'Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:NOTERION_DIAG_EXE } | Select-Object ProcessId,ParentProcessId,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress'],
  { windowsHide: true, encoding: 'utf8', timeout: 20000, env: { ...process.env, NOTERION_DIAG_EXE: exe } });
  assert.equal(result.status, 0, result.stderr);
  const values = JSON.parse(result.stdout.trim() || '[]');
  return Array.isArray(values) ? values : [values];
}
function terminateOwnedTree(pid) {
  if (!alive(pid)) return;
  const result = spawnSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, encoding: 'utf8', timeout: 15000 });
  if (result.status !== 0 && alive(pid)) throw new Error(`Unable to clean owned PID ${pid}`);
}
async function addResource({ filename, title, url }) {
  await clickText('资料库');
  await clickText('添加资料');
  if (url) {
    await clickText('网页链接');
    await fill('[aria-label="网页地址"]', url);
  } else await fill('[aria-label="资料文件路径"]', filename);
  await fill('[aria-label="资料名称"]', title);
  await clickText('保存资料');
  await until(async () => !(await all('.resource-add-form')).length, 'resource copy and save finish');
  await until(async () => (await text('.library-list')).includes(title), 'saved resource appears in library');
}
async function openResource(title, link = false) {
  await click(`//article[@aria-label='学习资料：${title}']//button[normalize-space(.)='${link ? '查看链接' : '查看资料'}']`, 'xpath');
  await until(async () => (await text('dialog h2')) === title, 'resource preview title');
}

await fs.access(exe);
await fs.access(driverExe);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(output); // A run must never reuse another run's evidence/data/profile.
await fs.mkdir(config);
await fs.mkdir(temp);
const startedAt = new Date().toISOString();
const preexisting = new Set(matchingHosts().map(item => item.ProcessId));
const childEnv = { ...process.env, NOTERION_CONFIG_DIR: config, NOTERION_WEBVIEW_DIR: profile, TEMP: temp, TMP: temp };
delete childEnv.NOTERION_DEEPSEEK_KEY;
// Keep test conditions explicit. Do not inherit browser switches from the parent.
delete childEnv.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS;
delete childEnv.TAURI_WEBVIEW_AUTOMATION;
delete childEnv.TAURI_AUTOMATION;
delete childEnv.NOTERION_GRAPH_FAIL_ONCE;
const port = await freePort();
endpoint = `http://127.0.0.1:${port}`;
const debugPort = mode === 'attach' ? await freePort() : undefined;
const metadata = {
  startedAt, mode, steps, scenario, browserArguments, excludeSwitches, holdSeconds, exe, exeSha256: await hash(exe), driverExe, driverSha256: await hash(driverExe),
  sourceHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, windowsHide: true, encoding: 'utf8' }).stdout.trim(),
  config, profile, temp, port, debugPort, switches: mode === 'attach' ? [`--remote-debugging-port=${debugPort}`] : 'EdgeDriver defaults',
  credentialEnvironmentRemoved: true, inheritedWebViewSwitchesRemoved: true,
  automationFlag: mode === 'launch', hostSpawn: mode === 'attach' ? { windowsHide: false, stdio: 'ignore' } : 'EdgeDriver launch',
  limits: ['Diagnostic launch/attach conditions differ from ordinary Explorer launch.', 'Window/focus verdict comes from the independent native observer.'],
};
await write('inputs.json', metadata);
try {
  if (mode === 'attach') {
    host = spawn(exe, [], { env: { ...childEnv, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}` },
      windowsHide: false, stdio: 'ignore', cwd: path.dirname(exe) });
    host.once('error', error => { hostSpawnError = error; });
    hostPid = host.pid;
    await write('host-spawn.json', { at: new Date().toISOString(), hostPid });
    await until(async () => {
      if (hostSpawnError) throw hostSpawnError;
      assert.equal(host.exitCode, null, 'direct host stays alive');
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`, { signal: AbortSignal.timeout(1000) });
      return response.ok;
    }, 'direct host remote debugging endpoint');
  }
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1', `--log-path=${path.join(output, 'driver.log')}`], {
    env: { ...childEnv, ...(mode === 'launch' ? { TAURI_WEBVIEW_AUTOMATION: 'true' } : {}) },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  driver.once('error', error => { driverSpawnError = error; });
  driver.stdout.pipe(createWriteStream(path.join(output, 'driver-stdout.txt')));
  driver.stderr.pipe(createWriteStream(path.join(output, 'driver-stderr.txt')));
  await write('driver-spawn.json', { at: new Date().toISOString(), driverPid: driver.pid });
  await until(async () => {
    if (driverSpawnError) throw driverSpawnError;
    assert.equal(driver.exitCode, null, 'driver stays alive');
    return (await command('GET', '/status')).ready;
  }, 'driver ready');
  const edgeOptions = mode === 'launch' ? { binary: exe, webviewOptions: { userDataFolder: profile,
    ...(browserArguments === undefined ? {} : { additionalBrowserArguments: browserArguments }) } }
    : { debuggerAddress: `127.0.0.1:${debugPort}` };
  if (excludeSwitches !== undefined) edgeOptions.excludeSwitches = excludeSwitches;
  await write('requested-capabilities.json', { browserName: 'webview2', 'ms:edgeOptions': edgeOptions });
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'webview2', 'ms:edgeOptions': edgeOptions } } }, 60000);
  session = created.sessionId;
  assert.ok(session);
  await write('session.json', created);
  const hosts = matchingHosts().filter(item => !preexisting.has(item.ProcessId));
  if (mode === 'launch') {
    const owned = hosts.filter(item => item.ParentProcessId === driver.pid);
    assert.equal(owned.length, 1, 'Exactly one newly launched host is parented by this driver');
    hostPid = owned[0].ProcessId;
  }
  await write('launch.json', { at: new Date().toISOString(), hostPid, driverPid: driver.pid, hosts });
  const environment = await until(async () => {
    const result = await observe('return {url:location.href,visibility:document.visibilityState,invoke:typeof window.__TAURI__?.core?.invoke,userAgent:navigator.userAgent};');
    return result.url === 'http://tauri.localhost/' && result.visibility === 'visible' && result.invoke === 'function' && result;
  }, 'visible embedded interface');
  await until(async () => await wd('GET', `/element/${await find('[data-testid="create-point"]')}/enabled`), 'isolated core loads');
  await check('real visible client opens its isolated data directory', async () => {
    const location = await text('.storage-location');
    assert.ok(location.includes(path.join(config, 'data')));
    return { environment, hostPid, driverPid: driver.pid, location };
  });
  await capture('01-start');
  if (scenario !== 'launch-only') {
  const pointName = 'Issue 27 窗口回归知识点';
  const description = '通过真实 Windows 客户端控件保存，搜索后重新读取。';
  await click('[data-testid="create-point"]');
  await fill('#knowledge-name', pointName);
  await fill('#knowledge-description', description);
  await click('[data-testid="save-point"]');
  await until(async () => !(await all('#knowledge-name')).length, 'save completes');
  await check('knowledge saves and can be searched and opened', async () => {
    await fill('[data-testid="search-input"]', pointName);
    await until(async () => (await all('.result-item')).length === 1, 'one saved result');
    await click('.result-item');
    assert.equal(await text('[data-testid="knowledge-details"] h1'), pointName);
    assert.ok((await text('[data-testid="knowledge-details"]')).includes(description));
  });
  await capture('02-saved-searched');
  if (steps === 'all') {
    await check('unconfigured AI reports the failure and keeps entered source text', async () => {
      await clickText('知识导入');
      const source = '使用 docker exec -it demo /bin/sh 进入容器终端。';
      await fill('[data-testid="ai-source"]', source);
      await click('[data-testid="ai-extract"]');
      await until(async () => (await text('[data-testid="ai-import-error"]')).includes('尚未配置'), 'explicit missing AI configuration');
      assert.equal(await wd('GET', `/element/${await find('[data-testid="ai-source"]')}/property/value`), source);
    });
    await capture('03-ai-unconfigured');
    const image = path.join(output, 'issue27-image.png');
    await fs.writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64'), { flag: 'wx' });
    const imageTitle = 'Issue 27 图片预览';
    await addResource({ filename: image, title: imageTitle });
    await openResource(imageTitle);
    await check('managed local image is actually decoded in the preview', async () => {
      const dimensions = await until(async () => observe('const image=document.querySelector(".image-preview img");return image?.complete&&image.naturalWidth>0?{width:image.naturalWidth,height:image.naturalHeight}:null;'), 'decoded image');
      assert.deepEqual(dimensions, { width: 1, height: 1 });
      return dimensions;
    });
    await capture('04-image-preview');
    if (options['open-file'] === 'true') {
      await clickText('使用系统应用打开');
      await until(async () => (await text('dialog')).includes('已请求系统应用打开'), 'explicit external file request accepted');
      await append('actions.jsonl', { at: new Date().toISOString(), action: 'explicit-external-file', filename: image, title: imageTitle });
      await delay(2000);
    }
    await clickText('关闭预览');
    const linkTitle = 'Issue 27 主动打开链接';
    await addResource({ title: linkTitle, url: 'https://example.com/' });
    await openResource(linkTitle, true);
    await check('saved link is visible without automatically opening it', async () => {
      assert.ok((await text('dialog')).includes('https://example.com/'));
    });
    if (options['open-link'] === 'true') {
      // The footer is unique; the preview body also contains the same label.
      await click('.preview-footer button:first-child');
      await until(async () => (await text('dialog')).includes('已请求系统应用打开'), 'explicit external link request accepted');
      await append('actions.jsonl', { at: new Date().toISOString(), action: 'explicit-external-link', url: 'https://example.com/' });
      await delay(2000);
    }
    await capture('05-link-preview');
    await clickText('关闭预览');
  }
  }
  await append('actions.jsonl', { at: new Date().toISOString(), action: 'hold-start', seconds: holdSeconds });
  await delay(holdSeconds * 1000);
  await capture('06-after-hold');
  await append('actions.jsonl', { at: new Date().toISOString(), action: 'close-window' });
  await wd('DELETE', '/window');
  await until(() => !alive(hostPid), 'owned host exits after closing its window', 10000);
  closedNormally = true;
  await check('owned host exits after its actual WebView window closes', async () => ({ hostPid }));
} catch (error) {
  failure = { message: error.message, at: new Date().toISOString() };
  await write('failure.json', failure);
  if (session) { try { await capture('failure'); } catch {} }
  console.error(error.message);
} finally {
  const cleanupErrors = [];
  if (session) {
    try { await command('DELETE', `/session/${session}`); }
    catch (error) { await write('delete-session-note.json', { message: error.message }); }
  }
  // The only kill targets are PIDs directly spawned here or a newly parented host.
  if (!hostPid && driver?.pid) {
    try { hostPid = matchingHosts().filter(item => !preexisting.has(item.ProcessId) && item.ParentProcessId === driver.pid)[0]?.ProcessId; }
    catch (error) { cleanupErrors.push(error.message); }
  }
  for (const pid of [hostPid, driver?.pid]) {
    try { if (pid) terminateOwnedTree(pid); }
    catch (error) { cleanupErrors.push(error.message); }
  }
  if (cleanupErrors.length) failure ??= { message: 'Owned process cleanup failed', cleanupErrors };
  await write('result.json', { startedAt, finishedAt: new Date().toISOString(), mode, steps, scenario, browserArguments, excludeSwitches,
    verdict: failure ? 'FAIL' : 'PASS', checks: checks.length, closedNormally, hostPid, driverPid: driver?.pid,
    hostExited: !alive(hostPid), driverExited: !alive(driver?.pid), cleanupErrors, failure,
    windowsVerdict: 'Use independent observe-webview-windows output; this harness alone does not assert native windows.' });
  process.exitCode = failure ? 1 : 0;
}
