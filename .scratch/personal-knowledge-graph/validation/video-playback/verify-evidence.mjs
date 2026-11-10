// Verifies published external observations, never private implementation state.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
const evidence = path.join(root, 'evidence');
const json = async filename => JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
const jsonl = async filename => (await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, '').trim().split(/\r?\n/).map(JSON.parse);
const runs = [];
const expectedSize = 1_277_422_426;
const expectedHash = '4c93ae3aba536be8a84d0498a2460dfab67fc309803eb2120613e0abd8ff00a7';
const mib = n => Math.round(n / 1048576 * 100) / 100;
for (const runId of ['issue-13-all-04', 'issue-13-all-05']) {
  const directory = path.join(evidence, runId);
  const read = name => json(path.join(directory, name + '.json'));
  const result = await read('result'); assert.equal(result.verdict, 'PASS'); assert.equal(result.assertions, 13); assert.equal(result.hostExited, true); assert.equal(result.sessionClosed, true);
  const environment = await read('environment'); assert.equal(environment.url, 'http://tauri.localhost/'); assert.equal(environment.invoke, 'function');
  const start = await read('start'), seek = await read('seek'), continued = await read('continued');
  assert.equal(start.duration, 720); assert.equal(start.videoWidth, 1280); assert.ok(start.decodedFrames > 0 && start.currentTime > 1);
  assert.ok(seek.currentTime > 500 && seek.currentTime < 580 && continued.currentTime > seek.currentTime + 4);
  const requests = (await jsonl(path.join(directory, 'rust-events.jsonl'))).filter(e => e.event === 'media-request');
  const remote = requests.find(e => e.status === 206 && e.upstreamStatus === 206 && /^bytes=\d+-/.test(e.range ?? '') && Number(e.range.match(/\d+/)[0]) > 800_000_000 && e.bytesWritten > 0);
  assert.ok(remote, 'recorded true upstream remote 206 after pointer seek');
  assert.ok(requests.some(e => e.upstreamStatus === 416), 'real upstream invalid Range');
  const cancel = await read('no-range-cancel'); assert.ok(cancel.server.bytesRead < cancel.upperBoundBytes); assert.equal(cancel.server.upstreamRange, null); assert.equal(cancel.server.upstreamStatus, 200);
  const full = await read('no-range-full'); assert.equal(full.bytes, expectedSize); assert.equal(full.sha256, expectedHash); assert.equal(full.status, 200);
  assert.ok(requests.some(e => e.mode === 'no-range' && e.upstreamStatus === 200 && e.bytesRead === expectedSize && e.bytesWritten === expectedSize && !e.disconnected), 'complete upstream and downstream ordinary GET');
  const webm = await read('webm'); assert.ok(webm.videoWidth > 0 && webm.decodedFrames > 0 && webm.currentTime > 6);
  const unsupported = await read('unsupported'); assert.ok(unsupported.errorCode > 0 || unsupported.videoWidth === 0);
  const external = await read('external-playback'); assert.equal(external.bytes, 10_937_767); assert.ok(external.maxPlaybackSeconds > 2 && external.visibleWindowHandle > 0);
  const signature = await read('signature'); assert.equal(signature.first.status, 206); assert.equal(signature.expired.status, 403); assert.equal(signature.renewed.status, 206);
  const resources = await jsonl(path.join(directory, 'resources.jsonl'));
  const sum = (sample, name, key) => sample.processes.filter(p => p.Name === name).reduce((n, p) => n + Number(p[key]), 0);
  const maximum = (name, key) => Math.max(...resources.map(s => sum(s, name, key)));
  const minimum = (name, key) => Math.min(...resources.map(s => sum(s, name, key)).filter(n => n > 0));
  const media = [start, seek, continued, await read('no-range-video'), webm, unsupported];
  runs.push({ runId, exeSha256: environment.exeSha256, assertions: result.assertions, hostPid: result.hostPid,
    firstPlayingMs: start.firstPlayingMs, seekCompletedMs: seek.seekCompletedMs, seekSeconds: seek.currentTime, remoteRange: remote.range,
    ordinaryGet: full, cancelledUpstreamBytes: cancel.server.bytesRead,
    resources: { method: 'Win32_Process about every 0.5 s plus collection latency; sums are per process group and include shared pages in RSS; sampled values, not allocation proofs', samples: resources.length,
      rustRssMinMiB: mib(minimum('issue-13-video.exe', 'WorkingSetSize')), rustRssMaxMiB: mib(maximum('issue-13-video.exe', 'WorkingSetSize')), rustPrivateMaxMiB: mib(maximum('issue-13-video.exe', 'PrivatePageCount')),
      webviewRssMinMiB: mib(minimum('msedgewebview2.exe', 'WorkingSetSize')), webviewRssMaxMiB: mib(maximum('msedgewebview2.exe', 'WorkingSetSize')), webviewPrivateMaxMiB: mib(maximum('msedgewebview2.exe', 'PrivatePageCount')),
      recordedJsHeapMaxMiB: mib(Math.max(...media.map(m => m.jsHeapUsed ?? 0))), profileDiskMaxBytes: Math.max(...resources.map(s => s.runDiskBytes ?? 0)), externalCacheBytes: external.bytes },
    external, signature });
}
assert.equal(runs[0].exeSha256, runs[1].exeSha256, 'independent full runs use the same executable');
const negative = await json(path.join(evidence, 'issue-13-negative-visible/result.json'));
assert.equal(negative.verdict, 'FAIL'); assert.equal(negative.hostExited, true);
assert.match((await json(path.join(evidence, 'issue-13-negative-visible/failure.json'))).message, /PLAYING|INTENTIONAL/);
const samples = await json(path.join(evidence, 'samples.json'));
const sample = samples.samples.find(s => s.bytes === expectedSize); assert.equal(sample.sha256, expectedHash); assert.ok(sample.encodedPacketBytes > expectedSize * 0.99);
const summary = { verdict: 'PASS', issue: 13, sampleBytes: expectedSize, sampleSha256: expectedHash, fullRuns: runs, negativeVisibleExpectation: 'FAIL as required; native host exited', generatedAt: new Date().toISOString() };
await fs.writeFile(path.join(evidence, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
