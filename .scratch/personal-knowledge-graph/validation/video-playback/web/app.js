const $ = selector => document.querySelector(selector);
const video = $('#video');
const status = $('#status');
const invoke = window.__TAURI__.core.invoke;
let openedAt = 0;
let firstPlayingMs = null;
let seekingAt = 0;
let seekCompletedMs = null;
const noVideoTrack = () => video.readyState >= 1 && video.duration > 0 && video.videoWidth === 0;
function update() {
  $('#metrics').textContent = JSON.stringify({ currentTime: video.currentTime, duration: Number.isFinite(video.duration) ? video.duration : null, paused: video.paused, readyState: video.readyState, networkState: video.networkState, videoWidth: video.videoWidth, videoHeight: video.videoHeight, decodedFrames: video.getVideoPlaybackQuality().totalVideoFrames, droppedFrames: video.getVideoPlaybackQuality().droppedVideoFrames, buffered: Array.from({ length: video.buffered.length }, (_, i) => [video.buffered.start(i), video.buffered.end(i)]), seekable: Array.from({ length: video.seekable.length }, (_, i) => [video.seekable.start(i), video.seekable.end(i)]), sourceScheme: video.currentSrc.split(':')[0], firstPlayingMs, seekCompletedMs, errorCode: video.error?.code ?? null, jsHeapUsed: performance.memory?.usedJSHeapSize ?? null, jsHeapTotal: performance.memory?.totalJSHeapSize ?? null });
  if (!$('#seek').matches(':active')) $('#seek').value = video.currentTime;
}
async function open() {
  video.pause(); video.removeAttribute('src'); video.load();
  status.textContent = 'LOADING'; firstPlayingMs = null; seekCompletedMs = null; openedAt = performance.now();
  try {
    const reply = await invoke('media_open', { sample: $('#sample').value, mode: $('#mode').value });
    // URL is a transient source capability, never rendered, logged, or persisted.
    $('#source-info').textContent = JSON.stringify({ sample: reply.sample, mode: reply.mode, size: reply.size, mime: reply.mime });
    video.src = reply.url; video.load();
  } catch { status.textContent = 'ERROR | 对象读取入口不可用'; }
}
$('#open').addEventListener('click', open);
$('#play').addEventListener('click', async () => { try { await video.play(); } catch { status.textContent = 'ERROR | 无法播放，请外部打开'; } });
$('#pause').addEventListener('click', () => video.pause());
$('#unload').addEventListener('click', () => { video.pause(); video.removeAttribute('src'); video.load(); status.textContent = 'CLOSED'; update(); });
$('#seek').addEventListener('input', event => { seekingAt = performance.now(); video.currentTime = Number(event.target.value); });
for (const event of ['timeupdate', 'progress', 'loadeddata', 'durationchange', 'seeked', 'pause', 'playing', 'error', 'loadedmetadata']) video.addEventListener(event, () => {
  if (event === 'loadedmetadata') { $('#seek').max = video.duration; status.textContent = 'READY TO PLAY'; }
  if (event === 'playing') { status.textContent = 'PLAYING'; if (firstPlayingMs === null) firstPlayingMs = Math.round(performance.now() - openedAt); }
  if (event === 'pause' && video.currentSrc && !noVideoTrack()) status.textContent = 'PAUSED';
  if (event === 'seeked') seekCompletedMs = Math.round(performance.now() - seekingAt);
  if (event === 'error') status.textContent = `UNSUPPORTED | code=${video.error?.code} | 请外部打开`;
  if (noVideoTrack()) status.textContent = 'UNSUPPORTED | NO_VIDEO_TRACK | 请外部打开';
  update();
});
$('#external').addEventListener('click', async () => {
  $('#external-status').textContent = '正在流式准备查看缓存';
  try { const result = await invoke('external_open', { sample: $('#sample').value }); $('#external-status').textContent = JSON.stringify({ status: 'EXTERNAL OPENED', ...result }); }
  catch { $('#external-status').textContent = 'ERROR | 外部打开失败'; }
});
// Only tiny explicit protocol probes use fetch. Video bytes use HTML media.
$('#signature').addEventListener('click', async () => {
  $('#signature-status').textContent = 'RUNNING';
  const probe = async (url, range) => {
    const response = await fetch(url, { mode: 'cors', cache: 'no-store', headers: { Range: range } });
    if (!response.ok) { await response.body?.cancel(); return { status: response.status }; }
    if (response.status !== 206 || Number(response.headers.get('Content-Length')) !== 32) { await response.body?.cancel(); throw new Error('Probe requires a 32-byte partial response'); }
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 64) throw new Error('Probe exceeded 64 bytes');
    return { status: response.status, bytes: bytes.byteLength, contentRange: response.headers.get('Content-Range'), allowOrigin: response.headers.get('Access-Control-Allow-Origin') };
  };
  try {
    const old = await invoke('media_open', { sample: 'h264', mode: 'direct' });
    const first = await probe(old.url, 'bytes=0-31');
    await new Promise(resolve => setTimeout(resolve, 6500));
    const expired = await probe(old.url, 'bytes=1000000-1000031');
    const fresh = await invoke('media_open', { sample: 'h264', mode: 'direct' });
    const renewed = await probe(fresh.url, 'bytes=1000000-1000031');
    $('#signature-status').textContent = JSON.stringify({ first, expired, renewed });
  } catch { $('#signature-status').textContent = 'ERROR | CORS 或签名探针未完成'; }
});
setInterval(update, 250); update();
