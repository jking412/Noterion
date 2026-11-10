// Standard WebDriver drives the real Tauri executable; scripts only observe.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const options = Object.fromEntries(process.argv.slice(2).map(a => { const i = a.indexOf('='); assert.ok(i > 2); return [a.slice(2, i), a.slice(i + 1)]; }));
const runId = options.run ?? 'issue-13-start-01';
assert.match(runId, /^issue-13-[a-z0-9-]+$/);
const scenario = options.scenario ?? 'start';
assert.ok(['start', 'playback', 'seek', 'codec', 'all'].includes(scenario), 'Choose an explicit supported scenario');
assert.ok(Object.keys(options).every(key => ['run', 'scenario', 'port', 'expect-playing'].includes(key)), 'Unknown command line option');
const evidence = path.join(root, 'evidence', runId);
await fs.mkdir(evidence); // Every run is immutable.
const save = (name, data) => fs.writeFile(path.join(evidence, name), JSON.stringify(data, null, 2) + '\n');
const assertions = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let driver, session, sampler, hostPid, passed = false;
const local = path.join(root, '.local', 'runs', runId);
const exe = path.join(root, 'target', 'debug', 'issue-13-video.exe');
const driverExe = path.resolve(root, '../windows-desktop/.tools/issue3-webdriver/msedgedriver.exe');
const port = Number(options.port ?? 33130);
const endpoint = `http://127.0.0.1:${port}`;
async function command(method, route, body, timeout = 25000) {
  const response = await fetch(endpoint + (session ? `/session/${session}` : '') + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  const data = await response.json();
  if (!response.ok || data.value?.error) throw new Error(`WebDriver ${method} ${route}: ${data.value?.error ?? response.status}`);
  return data.value;
}
async function until(fn, label, timeout = 30000) {
  const end = Date.now() + timeout;
  let last;
  do { try { const result = await fn(); if (result) return result; } catch (error) { last = error.message; } await delay(150); } while (Date.now() < end);
  throw new Error(`Timed out: ${label}${last ? ' (' + last + ')' : ''}`);
}
async function element(selector) { return (await command('POST', '/element', { using: 'css selector', value: selector }))['element-6066-11e4-a52e-4f735466cecf']; }
async function text(selector) { return command('GET', `/element/${await element(selector)}/text`); }
async function click(selector) { const id = await element(selector); assert.equal(await command('GET', `/element/${id}/displayed`), true); await command('POST', `/element/${id}/click`, {}); }
async function capture(label) { await fs.writeFile(path.join(evidence, label + '.png'), Buffer.from(await command('GET', '/screenshot'), 'base64')); }
async function expect(label, fn) { await fn(); assertions.push({ label, verdict: 'PASS', at: new Date().toISOString() }); await save('assertions.json', assertions); }
async function metrics() { return JSON.parse(await text('#metrics')); }
async function select(selector, value) {
  const id = await element(`${selector} option[value="${value}"]`);
  await command('POST', `/element/${id}/click`, {});
  assert.equal(await command('GET', `/element/${await element(selector)}/property/value`), value);
}
async function source() { return command('GET', `/element/${await element('#video')}/property/currentSrc`); }
async function dragTimeline(fraction) {
  const rect = await command('GET', `/element/${await element('#seek')}/rect`);
  const y = Math.round(rect.y + rect.height / 2);
  await command('POST', '/actions', { actions: [{ type: 'pointer', id: 'mouse', parameters: { pointerType: 'mouse' }, actions: [
    { type: 'pointerMove', duration: 0, origin: 'viewport', x: Math.round(rect.x + 9), y }, { type: 'pointerDown', button: 0 },
    { type: 'pointerMove', duration: 500, origin: 'viewport', x: Math.round(rect.x + 9 + fraction * (rect.width - 18)), y }, { type: 'pointerUp', button: 0 }
  ] }] });
  await command('DELETE', '/actions');
}
async function mediaEvents() { return (await fs.readFile(path.join(evidence, 'rust-events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse).filter(e => e.event === 'media-request'); }
async function fullGet(url, expected) {
  const start = Date.now();
  const response = await fetch(url, { headers: { Origin: 'http://tauri.localhost' }, signal: AbortSignal.timeout(120000) });
  assert.equal(response.status, 200); assert.equal(Number(response.headers.get('Content-Length')), expected.bytes); assert.equal(response.headers.get('Content-Range'), null);
  const digest = createHash('sha256'); let bytes = 0, peakRss = 0, peakHeap = 0;
  for await (const chunk of response.body) { digest.update(chunk); bytes += chunk.byteLength; const memory = process.memoryUsage(); peakRss = Math.max(peakRss, memory.rss); peakHeap = Math.max(peakHeap, memory.heapUsed); }
  const sha256 = digest.digest('hex'); assert.equal(bytes, expected.bytes); assert.equal(sha256, expected.sha256);
  return { status: response.status, requestRange: null, bytes, sha256, elapsedMs: Date.now() - start, peakClientRss: peakRss, peakClientHeap: peakHeap };
}

try {
  await fs.access(exe);
  await new Promise((resolve, reject) => { const server = net.createServer(); server.on('error', reject); server.listen(port, '127.0.0.1', () => server.close(resolve)); });
  await fs.mkdir(local, { recursive: true });
  const driverTemp = path.join(local, 'driver-temp'); await fs.mkdir(driverTemp);
  const env = { ...process.env, ISSUE13_ROOT: root, ISSUE13_RUN_ID: runId, ISSUE13_EVIDENCE_DIR: evidence, ISSUE13_DATA_DIR: path.join(local, 'profile'), TAURI_WEBVIEW_AUTOMATION: 'true', TEMP: driverTemp, TMP: driverTemp };
  for (const line of (await fs.readFile(path.join(root, '.local/service.env'), 'utf8')).split(/\r?\n/)) { const i = line.indexOf('='); if (line.startsWith('RUSTFS_ACCESS_KEY=')) env.ISSUE13_ACCESS_KEY = line.slice(i + 1); if (line.startsWith('RUSTFS_SECRET_KEY=')) env.ISSUE13_SECRET_KEY = line.slice(i + 1); }
  const ffplay = spawnSync('powershell.exe', ['-NoProfile', '-Command', '(Get-Command ffplay.exe).Source'], { encoding: 'utf8', windowsHide: true });
  assert.equal(ffplay.status, 0); env.ISSUE13_FFPLAY = ffplay.stdout.trim();
  const driverVersion = spawnSync(driverExe, ['--version'], { encoding: 'utf8', windowsHide: true }).stdout.trim();
  assert.match(driverVersion, /136\.0\.3240\.76/);
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1', `--log-path=${path.join(local, 'driver.log')}`], { env, windowsHide: true, stdio: 'ignore' });
  await until(async () => (await command('GET', '/status')).ready, 'driver ready');
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'webview2', 'ms:edgeOptions': { binary: exe, webviewOptions: { userDataFolder: env.ISSUE13_DATA_DIR } } } } }, 60000);
  session = created.sessionId;
  await until(async () => await text('#status') === 'READY', 'visible READY');
  const environment = await command('POST', '/execute/sync', { script: 'return {url:location.href,userAgent:navigator.userAgent,visibility:document.visibilityState,invoke:typeof window.__TAURI__?.core?.invoke};', args: [] });
  assert.equal(environment.url, 'http://tauri.localhost/'); assert.equal(environment.visibility, 'visible'); assert.equal(environment.invoke, 'function');
  await save('environment.json', { ...environment, driverVersion, exeSha256: createHash('sha256').update(await fs.readFile(exe)).digest('hex'), runId, scenario });
  const events = (await fs.readFile(path.join(evidence, 'rust-events.jsonl'), 'utf8')).trim().split(/\r?\n/).map(JSON.parse);
  hostPid = events.find(e => e.event === 'process-started')?.pid;
  assert.ok(hostPid, 'real Rust host pid');
  sampler = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'sample-resources.ps1'), '-RootPid', String(driver.pid), '-ClientPid', String(process.pid), '-RunDirectory', local, '-OutputFile', path.join(evidence, 'resources.jsonl')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  sampler.stdout.pipe(createWriteStream(path.join(local, 'sampler-stdout.txt')));
  sampler.stderr.pipe(createWriteStream(path.join(local, 'sampler-stderr.txt')));
  await until(async () => { assert.equal(sampler.exitCode, null, 'Windows resource sampler must remain alive'); return (await fs.stat(path.join(evidence, 'resources.jsonl'))).size > 0; }, 'Windows resource sampler writes its first actual observation', 10000);
  await capture('01-ready');
  await expect('real WebView starts with no media bytes in frontend', async () => assert.equal((await metrics()).currentTime, 0));
  await delay(1500); // Resource baseline before the first object read.
  if (scenario !== 'start') {
    await click('#open');
    await until(async () => (await metrics()).duration > 600, 'large video metadata');
    await expect('the opened source is a real 1–2 GB MP4', async () => { const info = JSON.parse(await text('#source-info')); assert.ok(info.size >= 1_000_000_000 && info.size <= 2_147_483_648); assert.equal(info.sample, 'h264'); });
    await click('#play');
    const initial = await until(async () => { const m = await metrics(); return !m.paused && m.currentTime > 1 && m.videoWidth > 0 && m.readyState >= 2 && m; }, 'video plays decoded frames');
    assert.equal(await text('#status'), options['expect-playing'] ?? 'PLAYING');
    await save('start.json', initial); await capture('02-playing');
    await expect('supported large video actually plays decoded frames', async () => assert.ok(initial.currentTime > 1));
    if (scenario === 'all' || scenario === 'seek') {
      const rangeSource = await source();
      await dragTimeline(0.75);
      const seek = await until(async () => { const m = await metrics(); return m.currentTime > 500 && m.currentTime < 580 && !m.paused && m.readyState >= 2 && m.decodedFrames > initial.decodedFrames && m; }, 'real pointer drag seeks near 540 seconds');
      await save('seek.json', seek); await capture('03-seek');
      await expect('dragging the timeline seeks and resumes a remote decoded interval', async () => assert.ok(seek.currentTime > 500 && seek.currentTime < 580));
      await delay(8000);
      const continued = await metrics(); assert.ok(continued.currentTime > seek.currentTime + 4); await save('continued.json', continued);
      await click('#pause'); await delay(1500); await capture('04-paused');
      await click('#unload'); await delay(1000);
      await expect('remote seek caused a nonzero Range and an actual partial response', async () => { const requests = await mediaEvents(); assert.ok(requests.some(e => e.sample === 'h264' && e.mode === 'range' && e.status === 206 && Number((e.range ?? '').match(/^bytes=(\d+)-/)?.[1]) > 800_000_000 && e.bytesWritten > 0)); });
      // A literal 32-byte remote interval is compared with the independent source.
      const partial = await fetch(rangeSource, { headers: { Range: 'bytes=1000000000-1000000031', Origin: 'http://tauri.localhost' } });
      assert.equal(partial.status, 206); assert.equal(partial.headers.get('Content-Range'), 'bytes 1000000000-1000000031/1277422426'); assert.equal(Number(partial.headers.get('Content-Length')), 32);
      const expectedBytes = Buffer.alloc(32); const file = await fs.open(path.join(root, '.local/samples/issue-13-h264-aac.mp4')); try { await file.read(expectedBytes, 0, 32, 1_000_000_000); } finally { await file.close(); }
      assert.deepEqual(Buffer.from(await partial.arrayBuffer()), expectedBytes);
      const invalid = await fetch(rangeSource, { headers: { Range: 'bytes=2000000000-', Origin: 'http://tauri.localhost' } }); assert.equal(invalid.status, 416); await invalid.body?.cancel();
      await expect('remote Range returns exact source bytes and out-of-bounds returns 416', async () => {});
    }
    if (scenario === 'all') {
      await select('#mode', 'no-range'); await select('#sample', 'h264'); await click('#open');
      await until(async () => (await metrics()).duration === 720, 'ordinary GET video metadata');
      await click('#play'); await until(async () => (await metrics()).currentTime > 1, 'ordinary GET video starts');
      const ordinarySource = await source(); await save('no-range-video.json', await metrics()); await capture('05-no-range');
      await click('#unload'); await delay(1000);
      await expect('WebView ordinary GET plays without frontend full-file aggregation', async () => { const requests = await mediaEvents(); assert.ok(requests.some(e => e.mode === 'no-range' && e.status === 200 && e.upstreamRange === null && e.declaredLength === 1_277_422_426 && e.bytesWritten > 0)); });
      const abort = new AbortController(); const response = await fetch(ordinarySource, { signal: abort.signal }); assert.equal(response.status, 200);
      let received = 0; const reader = response.body.getReader(); while (received < 8 * 1024 * 1024) { const next = await reader.read(); if (next.done) break; received += next.value.byteLength; }
      abort.abort(); await reader.cancel().catch(() => {}); await delay(1500);
      const cancelled = (await mediaEvents()).filter(e => e.mode === 'no-range' && e.range === null && e.disconnected).at(-1);
      assert.ok(cancelled && cancelled.bytesWritten < 64 * 1024 * 1024, 'cancellation stops upstream before 64 MiB rather than reading the complete object');
      await save('no-range-cancel.json', { clientBytes: received, server: cancelled, upperBoundBytes: 64 * 1024 * 1024 });
      await expect('early ordinary-GET cancellation stops upstream with bounded read-ahead', async () => {});
      const samples = JSON.parse((await fs.readFile(path.join(root, 'evidence/samples.json'), 'utf8')).replace(/^\uFEFF/, ''));
      const expected = samples.samples.find(s => s.file.endsWith('issue-13-h264-aac.mp4'));
      await save('no-range-full.json', await fullGet(ordinarySource, expected));
      await expect('ordinary GET streams the entire 1.28 GB with an independent SHA256 match', async () => {});
    }
    if (scenario === 'all' || scenario === 'codec') {
      await select('#mode', 'range'); await select('#sample', 'webm'); await click('#open');
      await until(async () => (await metrics()).duration > 10 && (await metrics()).duration < 15, 'WebM metadata'); await click('#play');
      await until(async () => (await metrics()).currentTime > 1 && (await metrics()).videoWidth > 0, 'VP9/Opus plays'); await dragTimeline(0.6);
      const webm = await until(async () => { const m = await metrics(); return m.currentTime > 6 && m.currentTime < 11 && !m.paused && m.decodedFrames > 1 && m; }, 'WebM pointer seek');
      await save('webm.json', webm); await capture('06-webm'); await click('#unload');
      await expect('WebM VP9 and Opus actually play and seek', async () => {});
      await select('#sample', 'ffv1'); await click('#open'); await until(async () => { const m = await metrics(); return m.errorCode !== null || (m.readyState >= 1 && m.duration > 0 && m.videoWidth === 0); }, 'unsupported FFV1 reports an error or has no decodable video track');
      const unsupported = await metrics(); assert.ok(unsupported.errorCode > 0 || unsupported.videoWidth === 0); assert.match(await text('#status'), /^UNSUPPORTED/, 'audio-only demux must expose the video incompatibility and external opening'); await save('unsupported.json', unsupported); await capture('07-unsupported');
      await expect('unsupported FFV1 exposes the actual missing video track or playback error', async () => {});
      await click('#external');
      const external = await until(async () => { const value = await text('#external-status'); return value.startsWith('{') && JSON.parse(value); }, 'external cache is verified and external player launches');
      assert.equal(external.status, 'EXTERNAL OPENED'); assert.equal(external.size, 10_937_767);
      const window = await until(async () => { const value = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-Process -Id ${Number(external.pid)} -ErrorAction SilentlyContinue | Select-Object Id,ProcessName,MainWindowHandle,MainWindowTitle | ConvertTo-Json -Compress`], { encoding: 'utf8', windowsHide: true }); if (!value.stdout.trim()) return false; const p = JSON.parse(value.stdout); return Number(p.MainWindowHandle) !== 0 && p; }, 'external player has a visible native window', 5000);
      await save('external-window.json', { ...external, window }); await delay(7500);
      const log = await fs.readFile(path.join(evidence, 'external-ffv1.txt'), 'utf8');
      const clocks = [...log.matchAll(/\b(\d+\.\d+)\s+[AM]-V:/g)].map(m => Number(m[1]));
      assert.match(log, /Video: ffv1/); assert.ok(Math.max(...clocks) > 2, 'external player must actually present advancing media');
      await save('external-playback.json', { pid: external.pid, sha256: external.sha256, bytes: external.size, maxPlaybackSeconds: Math.max(...clocks), visibleWindowHandle: window.MainWindowHandle });
      await expect('external player opens the verified cache and presents unsupported media', async () => {});
      await click('#signature');
      const signing = await until(async () => { const value = await text('#signature-status'); if (value.startsWith('ERROR')) throw new Error(value); return value.startsWith('{') && JSON.parse(value); }, 'CORS, expiry and refreshed capability', 20000);
      assert.equal(signing.first.status, 206); assert.equal(signing.first.bytes, 32); assert.equal(signing.expired.status, 403); assert.equal(signing.renewed.status, 206); assert.equal(signing.renewed.bytes, 32);
      await save('signature.json', signing); await capture('08-signature');
      await expect('real WebView CORS allows bounded reads, expiry rejects new reads, renewal restores access', async () => {});
    }
  }
  assert.equal(sampler.exitCode, null, 'resource sampler remains alive through the scenario');
  const resourceSamples = (await fs.readFile(path.join(evidence, 'resources.jsonl'), 'utf8')).replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(JSON.parse);
  assert.ok(Date.now() - Date.parse(resourceSamples.at(-1).at) < 5000, 'resource observations cover the end of the scenario');
  if (scenario === 'all') assert.ok(resourceSamples.length >= 20, 'full scenario retains a time series rather than one memory snapshot');
  passed = true;
} catch (error) { if (session) { try { await capture('failure'); await save('failure-media.json', await metrics()); } catch {} } await save('failure.json', { verdict: 'FAIL', message: error.message, at: new Date().toISOString() }); console.error(`FAIL ${runId}: ${error.message}`); process.exitCode = 1; }
finally {
  if (sampler) { await fs.writeFile(path.join(local, 'stop-sampler'), 'stop'); await Promise.race([new Promise(resolve => sampler.once('exit', resolve)), delay(5000)]); if (sampler.exitCode === null) sampler.kill(); }
  let closed = false;
  if (session) { try { await command('DELETE', ''); closed = true; } catch {} }
  if (driver) { driver.kill(); await Promise.race([new Promise(resolve => driver.once('exit', resolve)), delay(3000)]); }
  const alive = () => { if (!hostPid) return false; try { process.kill(hostPid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
  for (let i = 0; hostPid && alive() && i < 30; i++) await delay(100);
  const hostExited = Boolean(hostPid) && !alive();
  const verdict = passed && closed && hostExited ? 'PASS' : 'FAIL';
  await save('result.json', { verdict, runId, scenario, hostPid, sessionClosed: closed, hostExited, assertions: assertions.length, at: new Date().toISOString() });
  if (verdict === 'FAIL') process.exitCode = 1;
  console.log(`${verdict} ${runId}: ${assertions.length} assertions`);
}
