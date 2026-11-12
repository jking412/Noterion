// Real Windows Tauri acceptance. WebDriver performs all user actions.
// executeScript is read-only: environment, rendered layout and media metrics.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const separator = argument.indexOf('=');
  assert.ok(separator > 2, 'Use --run=issue-21-name and --scenario=create|core|media|all');
  return [argument.slice(2, separator), argument.slice(separator + 1)];
}));
assert.ok(Object.keys(options).every(key => ['run','scenario','exe','driver','fixtures-root','output','port','expect-created'].includes(key)), 'Unknown option');
const run = options.run;
assert.match(run ?? '', /^issue-21-[a-z0-9-]+$/);
const scenario = options.scenario ?? 'core';
assert.ok(['create','core','media','all'].includes(scenario));
const repo = options['fixtures-root'] ?? path.resolve(app, '..');
const exe = path.resolve(options.exe ?? path.join(app, 'src-tauri/target/debug/noterion.exe'));
const driverExe = path.resolve(options.driver ?? path.join(repo, '.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe'));
const directory = path.resolve(options.output ?? path.join(app, 'validation/evidence'), run);
const local = path.join(directory, 'local');
const config = path.join(local, 'config');
const port = Number(options.port ?? 33221);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const endpoint = `http://127.0.0.1:${port}`;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const write = (name, value) => fs.writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + '\n');
const append = (name, value) => fs.appendFile(path.join(directory, name), JSON.stringify(value) + '\n');
const hash = async filename => {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
};
await fs.access(exe); await fs.access(driverExe);
await fs.mkdir(path.dirname(directory), { recursive: true });
await fs.mkdir(directory); // Never overwrite another run's immutable evidence.
await fs.mkdir(local); await fs.mkdir(config);
await new Promise((resolve, reject) => {
  const probe = net.createServer(); probe.once('error', reject);
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const exeSha256 = await hash(exe), driverSha256 = await hash(driverExe);
const driverVersionResult = spawnSync(driverExe, ['--version'], { windowsHide: true, encoding: 'utf8' });
assert.equal(driverVersionResult.status, 0);
const driverVersion = driverVersionResult.stdout.trim();
const assertions = [];
let driver, session, hostPid, sampler, passed = false, launches = 0;
const ownedPids = new Set();

async function command(method, route, body, timeoutMs = 20000) {
  const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const payload = await response.json();
  await append('webdriver-events.jsonl', { at: new Date().toISOString(), method, route, request: body, status: response.status,
    response: /\/(screenshot|source)$/.test(route) ? { length: payload.value?.length } : payload });
  if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${route}: ${JSON.stringify(payload.value)}`);
  return payload.value;
}
const wd = (method, route, body, timeoutMs) => command(method, `/session/${session}${route}`, body, timeoutMs);
async function until(operation, description, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs; let last;
  do {
    try { const result = await operation(); if (result) return result; } catch (error) { last = error; }
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}`, { cause: last });
}
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
async function find(selector, using = 'css selector') { return (await wd('POST', '/element', { using, value: selector }))[elementKey]; }
async function findAll(selector, using = 'css selector') { return (await wd('POST', '/elements', { using, value: selector })).map(item => item[elementKey]); }
const literal = value => !value.includes("'") ? `'${value}'` : !value.includes('"') ? `"${value}"` : `concat(${value.split("'").map(part=>`'${part}'`).join(',"\'",')})`;
const button = label => `//button[normalize-space(.)=${literal(label)} or @aria-label=${literal(label)}]`;
const containsButton = label => `//button[contains(normalize-space(.),${literal(label)})]`;
async function click(selector, using) {
  const id = await find(selector, using);
  assert.equal(await wd('GET', `/element/${id}/displayed`), true, `Visible action ${selector}`);
  await wd('POST', `/element/${id}/click`, {});
}
const clickText = label => click(button(label), 'xpath');
async function fill(selector, value) {
  const id = await find(selector);
  await wd('POST', `/element/${id}/clear`, {});
  await wd('POST', `/element/${id}/value`, { text: value });
  assert.equal(await wd('GET', `/element/${id}/property/value`), value);
}
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
const body = () => text('body');
async function expectText(selector, expected) { await until(async () => (await text(selector)).includes(expected), `visible ${expected}`); }
async function expectAbsent(selector) { await until(async () => (await findAll(selector)).length === 0, `absence of ${selector}`); }
async function capture(label) {
  await fs.writeFile(path.join(directory, label + '.png'), Buffer.from(await wd('GET','/screenshot'), 'base64'));
  await fs.writeFile(path.join(directory, label + '.html'), await wd('GET','/source'));
}
async function check(label, operation) {
  const detail = await operation();
  assertions.push({ label, verdict:'PASS', at:new Date().toISOString(), detail });
  await write('assertions.json', assertions);
  console.log(`PASS ${run}: ${label}`);
}
const observe = (script, args = []) => wd('POST','/execute/sync',{ script, args });
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function events() {
  try { return (await fs.readFile(path.join(directory,'rust-events.jsonl'),'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean).map(JSON.parse); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
async function launch() {
  launches++;
  const profile = path.join(local, 'profile-' + launches), temp = path.join(local,'temp-' + launches);
  await fs.mkdir(temp);
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1', `--log-path=${path.join(local,'driver-' + launches + '.log')}`], {
    windowsHide:true, stdio:['ignore','pipe','pipe'], env:{ ...process.env, NOTERION_CONFIG_DIR:config, NOTERION_MEDIA_AUDIT:path.join(directory,'rust-events.jsonl'), TAURI_WEBVIEW_AUTOMATION:'true', TEMP:temp, TMP:temp }
  });
  driver.stdout.pipe(createWriteStream(path.join(local,'driver-' + launches + '-stdout.txt')));
  driver.stderr.pipe(createWriteStream(path.join(local,'driver-' + launches + '-stderr.txt')));
  await until(async () => (await command('GET','/status')).ready, 'driver ready');
  const created = await command('POST','/session',{ capabilities:{ alwaysMatch:{ browserName:'webview2', 'ms:edgeOptions':{ binary:exe, webviewOptions:{ userDataFolder:profile } } } } },60000);
  session = created.sessionId;
  assert.ok(session);
  await write('session-' + launches + '.json',created);
  const environment = await observe('return {url:location.href,userAgent:navigator.userAgent,visibility:document.visibilityState,invoke:typeof window.__TAURI__?.core?.invoke};');
  assert.equal(environment.url, 'http://tauri.localhost/'); assert.equal(environment.visibility, 'visible'); assert.equal(environment.invoke, 'function');
  await until(async () => (await findAll('[data-testid="create-point"]')).length, 'knowledge entry is rendered');
  // Process observation is independent of UI actions and cannot create facts.
  hostPid = (await events()).filter(event => event.event === 'process-started').at(-1)?.pid;
  if (!hostPid) {
    const processResult = spawnSync('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${exe.replaceAll("'","''")}' } | Select-Object ProcessId,ParentProcessId | ConvertTo-Json -Compress`],{encoding:'utf8',windowsHide:true});
    const observed = JSON.parse(processResult.stdout.trim() || '[]');
    const candidates = Array.isArray(observed) ? observed : [observed];
    assert.equal(candidates.length,1,'one isolated formal application process'); hostPid = candidates[0].ProcessId;
  }
  ownedPids.add(hostPid);
  await write('launch-' + launches + '.json',{ environment,hostPid,driverPid:driver.pid,driverVersion,exe,exeSha256,driverSha256,config,profile });
}
async function stop({ crash = false } = {}) {
  if (crash && hostPid && alive(hostPid)) process.kill(hostPid, 'SIGKILL');
  if (session) { try { await command('DELETE',`/session/${session}`); } catch (error) { if (!crash) throw error; } session = undefined; }
  if (driver) {
    driver.kill();
    await Promise.race([new Promise(resolve=>driver.once('exit',resolve)),delay(3000)]);
    driver = undefined;
  }
  await until(() => !alive(hostPid),'owned Tauri host exits',5000);
}
async function search(query, mode='all') {
  await clickText('知识图谱');
  if ((await findAll(button('清空搜索'),'xpath')).length) await clickText('清空搜索');
  await fill('[data-testid="search-input"]',query);
  await clickText(mode === 'all' ? '全部匹配' : '任意匹配');
  await delay(180);
}
async function results() {
  const ids=await findAll('.result-item'); return Promise.all(ids.map(id=>wd('GET',`/element/${id}/text`)));
}
async function select(name, qualifier) {
  await search(name);
  const selector=`//button[contains(concat(' ',normalize-space(@class),' '),' result-item ')][.//*[contains(@class,'result-name') and normalize-space(.)=${literal(name)}]]${qualifier ? `[contains(.,${literal(qualifier)})]` : ''}`;
  await click(selector,'xpath');
  await expectText('[data-testid="knowledge-details"] h1',name);
}
async function savePoint({ name, description='', theme=false, topics=[] }) {
  await click('[data-testid="create-point"]');
  await fill('#knowledge-name',name); await fill('#knowledge-description',description);
  if (theme) await click("//label[contains(.,'可作为主题')]/input",'xpath');
  for (const topic of topics) await click(`input[aria-label=${JSON.stringify('所属主题 '+topic)}]`);
  await click('[data-testid="save-point"]');
  await expectAbsent('#knowledge-name');
  await expectText('[data-testid="knowledge-details"] h1',name);
}
async function editPoint(name, changes) {
  await select(name); await click('[title="编辑知识点"]');
  if (changes.name !== undefined) await fill('#knowledge-name',changes.name);
  if (changes.description !== undefined) await fill('#knowledge-description',changes.description);
  for (const topic of changes.toggleTopics ?? []) await click(`input[aria-label=${JSON.stringify('所属主题 '+topic)}]`);
  await click('[data-testid="save-point"]'); await expectAbsent('#knowledge-name');
}
async function createScenario() {
  await savePoint({name:'进入容器终端',description:'使用 docker exec -it；百分号 % 下划线 _ 方括号 [x]'});
  await check('manual create returns committed knowledge and full description',async()=>{
    assert.equal(await text('[data-testid="knowledge-details"] h1'),options['expect-created'] ?? '进入容器终端');
    assert.ok((await text('[data-testid="knowledge-details"]')).includes('使用 docker exec -it；百分号 % 下划线 _ 方括号 [x]'));
  });
  await capture('01-created');
}
async function coreScenario() {
  await savePoint({name:'Docker',theme:true}); await savePoint({name:'Linux',theme:true});
  await editPoint('进入容器终端',{toggleTopics:['Docker','Linux']});
  await savePoint({name:'锁',description:'MySQL 行锁说明',topics:['Docker']});
  await savePoint({name:'锁',description:'并发互斥说明',topics:['Linux']});
  await check('same names preserve separate knowledge; optional description can be empty',async()=>{
    await search('锁'); assert.equal((await results()).length,2);
    await select('Docker'); assert.ok((await text('[data-testid="knowledge-details"]')).includes('还没有描述'));
  });
  await check('name, description, short Chinese and special fragments search literally',async()=>{
    for (const term of ['进','容器','docker exec','%','_','[x]']) { await search(term); assert.deepEqual((await results()).map(value=>value.split('\n')[0]),['进入容器终端']); }
    await search('互斥'); assert.equal((await results()).length,1); assert.ok((await results())[0].includes('锁'));
    await search('容器'); await clickText('添加关键词'); await fill('[data-testid="search-input"]','互斥');
    await clickText('全部匹配'); assert.equal((await results()).length,0);
    await clickText('任意匹配'); assert.equal((await results()).length,2);
  });
  await check('shared point opens from either theme and edited content is shared',async()=>{
    await editPoint('进入容器终端',{description:'共享的个人理解：进入终端后运行 shell。'});
    await select('进入容器终端');
    const detail=await text('[data-testid="knowledge-details"]'); assert.ok(detail.includes('Docker') && detail.includes('Linux') && detail.includes('共享的个人理解'));
  });
  // A three-node chain provides an actual arbitrary-length cycle attempt.
  await savePoint({name:'子主题',theme:true,topics:['Docker']});
  await savePoint({name:'孙主题',theme:true,topics:['子主题']});
  await check('arbitrary-length topic cycle is rejected without closing the draft',async()=>{
    await select('Docker'); await click('[title="编辑知识点"]'); await click('input[aria-label="所属主题 孙主题"]'); await click('[data-testid="save-point"]');
    await expectText('[role="alert"]','循环'); assert.equal((await findAll('#knowledge-name')).length,1); await clickText('取消');
  });
  await editPoint('进入容器终端',{toggleTopics:['Docker','Linux']});
  await stop(); await launch();
  await check('normal restart retains edited content and complete topic detachment as independent knowledge',async()=>{
    await select('进入容器终端'); const detail=await text('[data-testid="knowledge-details"]'); assert.ok(detail.includes('共享的个人理解'));
    assert.equal((await findAll('[data-testid="knowledge-details"] .detail-topics button')).length,0);
  });
  await savePoint({name:'异常退出已提交',description:'确认保存后强制终止仍保留'});
  await stop({crash:true}); await launch();
  await check('abnormal process exit preserves acknowledged durable commit',async()=>{
    await select('异常退出已提交'); assert.ok((await text('[data-testid="knowledge-details"]')).includes('确认保存后强制终止仍保留'));
  });
  await savePoint({name:'共享保留',topics:['Docker','Linux']});
  await savePoint({name:'级联下属',topics:['孙主题']});
  await select('Docker'); await click('[aria-label="知识点操作"]'); await clickText('删除主题');
  await check('delete preview lists cascade, retained shared point and irreversible file retention',async()=>{
    const columns=await findAll('.impact-section'); assert.equal(columns.length,2);
    const deleted=await wd('GET',`/element/${columns[0]}/text`), retained=await wd('GET',`/element/${columns[1]}/text`);
    for (const name of ['Docker','子主题','孙主题','级联下属']) assert.ok(deleted.includes(name));
    assert.ok(retained.includes('共享保留') && retained.includes('Linux'));
    assert.ok((await text('.delete-note')).includes('保留') && (await text('.delete-note')).includes('无法撤销'));
  });
  await capture('02-delete-preview');
  await click(containsButton('确认删除 '),'xpath'); await expectAbsent('.impact-columns');
  await stop(); await launch();
  await check('deleted cascade never reappears after restart; shared and independent knowledge remain',async()=>{
    for (const name of ['Docker','子主题','孙主题','级联下属']) { await search(name); assert.equal((await results()).length,0); }
    for (const name of ['共享保留','进入容器终端','异常退出已提交']) { await select(name); assert.equal(await text('[data-testid="knowledge-details"] h1'),name); }
  });
  await capture('03-core-restarted');
}
async function addFile(source,title) {
  await clickText('资料库'); await clickText('添加资料');
  await fill('[aria-label="资料文件路径"]',source); await fill('[aria-label="资料名称"]',title);
  await clickText('保存资料');
  await until(async()=>!(await findAll('[aria-label="资料文件路径"]')).length, 'file copy completes',120000);
  await expectText('body',title);
}
async function openResource(title) {
  await clickText('资料库');
  await click(`//*[contains(concat(' ',normalize-space(@class),' '),' resource-library-row ') or contains(concat(' ',normalize-space(@class),' '),' resource-card ')][.//*[normalize-space(.)=${literal(title)}]]//button[contains(.,'预览')]`,'xpath');
}
async function closePreview() { await click('[aria-label="关闭弹窗"]'); }
async function mediaMetrics() {
  return observe('const v=document.querySelector(".video-preview"); return v ? {currentTime:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,readyState:v.readyState,videoWidth:v.videoWidth,videoHeight:v.videoHeight,decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames,error:v.error?.code??null,jsHeapUsed:performance.memory?.usedJSHeapSize??null} : null;');
}
async function mediaScenario() {
  const samples=path.join(repo,'.scratch/personal-knowledge-graph/validation/video-playback/.local/samples');
  const pdf=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/resource-checklist.pdf');
  const png=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/container-resources.png');
  const fixture=path.join(local,'中文 空格来源'); await fs.mkdir(fixture);
  const imageSource=path.join(fixture,'同名.png'); await fs.copyFile(png,imageSource);
  await addFile(imageSource,'本地图片');
  await fs.rename(imageSource,path.join(fixture,'已移动.png'));
  await stop(); await launch();
  await openResource('本地图片');
  await check('managed image survives moving the source and restarting',async()=>{
    const image=await until(()=>observe('const i=document.querySelector(".resource-preview img, .preview-image"); return i?.complete&&i.naturalWidth>0 ? {width:i.naturalWidth,height:i.naturalHeight,src:i.currentSrc}:null;'),'decoded managed image');
    assert.ok(image.width>0&&image.height>0); return {width:image.width,height:image.height};
  });
  await capture('04-image'); await closePreview();
  await addFile(pdf,'本地PDF'); await openResource('本地PDF');
  await until(async()=>(await findAll('iframe')).length,'embedded PDF frame');
  await capture('05-pdf-inspect-required');
  await write('pdf-manual-inspection.json',{status:'REQUIRES_VISUAL_INSPECTION',reason:'iframe load alone does not establish rendered PDF; inspect real screenshot and WebView viewer frame',screenshot:'05-pdf-inspect-required.png'});
  await closePreview();
  const videoFile=path.join(samples,'issue-13-h264-aac.mp4'); await addFile(videoFile,'本地大视频');
  await openResource('本地大视频');
  await until(async()=>(await mediaMetrics())?.duration===720,'large video metadata');
  await click('[aria-label="播放视频"]');
  const initial=await until(async()=>{ const m=await mediaMetrics(); return m.currentTime>1&&!m.paused&&m.videoWidth>0&&m.decodedFrames>0&&m; },'actual decoded video advances');
  await check('real 1.28 GB local video starts with decoded frames',async()=>initial);
  await capture('06-video-start');
  const range=await find('[aria-label="视频播放位置"]'); const rect=await wd('GET',`/element/${range}/rect`);
  await wd('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:0,origin:'viewport',x:Math.round(rect.x+9),y:Math.round(rect.y+rect.height/2)},{type:'pointerDown',button:0},{type:'pointerMove',duration:500,origin:'viewport',x:Math.round(rect.x+9+0.75*(rect.width-18)),y:Math.round(rect.y+rect.height/2)},{type:'pointerUp',button:0}]}]}); await wd('DELETE','/actions');
  const seek=await until(async()=>{const m=await mediaMetrics(); return m.currentTime>500&&m.currentTime<580&&!m.paused&&m.decodedFrames>initial.decodedFrames&&m;},'timeline drag seeks to distant decoded region');
  await delay(5000); const continued=await mediaMetrics();
  await check('distant pointer seek continues playing',async()=>{assert.ok(continued.currentTime>seek.currentTime+3);return {seek,continued};});
  await capture('07-video-seek');
  const mediaUrl=await observe('return document.querySelector(".video-preview").currentSrc;');
  await check('local range protocol returns independent distant bytes and 416 for overflow',async()=>{
    const response=await fetch(mediaUrl,{headers:{Range:'bytes=1000000000-1000000031',Origin:'http://tauri.localhost'}});
    assert.equal(response.status,206); assert.equal(response.headers.get('content-range'),'bytes 1000000000-1000000031/1277422426');
    const expected=Buffer.alloc(32), source=await fs.open(videoFile);try{await source.read(expected,0,32,1_000_000_000);}finally{await source.close();}
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),expected);
    const overflow=await fetch(mediaUrl,{headers:{Range:'bytes=2000000000-',Origin:'http://tauri.localhost'}}); assert.equal(overflow.status,416); await overflow.body?.cancel();
  });
  await check('ordinary GET streams full video with independent hash, then cancellation stops a new read',async()=>{
    const response=await fetch(mediaUrl); assert.equal(response.status,200); assert.equal(Number(response.headers.get('content-length')),1_277_422_426);
    const digest=createHash('sha256');let bytes=0,peakRss=0;for await(const chunk of response.body){digest.update(chunk);bytes+=chunk.byteLength;peakRss=Math.max(peakRss,process.memoryUsage().rss);}
    assert.equal(bytes,1_277_422_426);assert.equal(digest.digest('hex'),'4c93ae3aba536be8a84d0498a2460dfab67fc309803eb2120613e0abd8ff00a7');
    const abort=new AbortController(), cancelled=await fetch(mediaUrl,{signal:abort.signal}), reader=cancelled.body.getReader();let received=0;
    while(received<8*1024*1024){const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.byteLength;}abort.abort();await reader.cancel().catch(()=>{});await delay(500);
    return {bytes,peakClientRss:peakRss,cancelledClientBytes:received};
  });
  await closePreview();
  await addFile(path.join(samples,'issue-13-ffv1-pcm.mkv'),'不支持视频');await openResource('不支持视频');
  await check('unsupported codec presents honest failure and system-app fallback',async()=>{
    await until(async()=>{const m=await mediaMetrics();return m?.error || (m?.duration>0&&m.videoWidth===0);},'unsupported video evidence');
    await until(async()=>/不支持|无法|未能/.test(await body()),'visible unsupported feedback');
    assert.ok((await findAll(containsButton('系统应用'),'xpath')).length>0);
  });
  await capture('08-unsupported'); await closePreview();
}

try {
  await launch(); await capture('00-start');
  if (scenario !== 'media') await createScenario();
  if (scenario === 'core' || scenario === 'all') await coreScenario();
  if (scenario === 'media' || scenario === 'all') await mediaScenario();
  const visible=await body();assert.ok(!/知识点 ID|资料 ID|knowledge-id|重置演示/.test(visible),'visible app has no prototype ID/reset workflow');
  await wd('POST','/window/rect',{width:1280,height:800}); await capture('09-layout-1280');
  await wd('POST','/window/rect',{width:1600,height:1000}); await capture('10-layout-1600');
  passed=true;
} catch(error) {
  if(session){try{await capture('failure');}catch{}}
  await write('failure.json',{verdict:'FAIL',message:error.message,cause:error.cause?.message,stack:error.stack,at:new Date().toISOString()});
  console.error(`FAIL ${run}: ${error.message}${error.cause?' / '+error.cause.message:''}`);process.exitCode=1;
} finally {
  try{await stop();}catch(error){passed=false;process.exitCode=1;await write('cleanup-error.json',{message:error.message});}
  const hostsExited=[...ownedPids].every(pid=>!alive(pid));
  if(!hostsExited){passed=false;process.exitCode=1;}
  await write('result.json',{verdict:passed?'PASS':'FAIL',run,scenario,assertions:assertions.length,exe,exeSha256,driverVersion,driverSha256,hostsExited,launches,at:new Date().toISOString(),limits:scenario==='media'||scenario==='all'?['PDF screenshot requires explicit visual inspection','full/cancel actual server byte and process resource audit still required']:[]});
  console.log(`${passed?'PASS':'FAIL'} ${run}: ${assertions.length} assertions, ${launches} real desktop launches`);
}
