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
assert.ok(Object.keys(options).every(key => ['run','scenario','exe','driver','fixtures-root','output','port','expect-created','offline'].includes(key)), 'Unknown option');
assert.ok(options.offline===undefined||['true','false'].includes(options.offline),'--offline must be true or false');
const offline=options.offline==='true';
const run = options.run;
assert.match(run ?? '', /^issue-21-[a-z0-9-]+$/);
const scenario = options.scenario ?? 'core';
assert.ok(['create','core','pdf','webm','graphfailure','media','reliability','storagefaults','all'].includes(scenario));
const repo = options['fixtures-root'] ?? path.resolve(app, '..');
const exe = path.resolve(options.exe ?? path.join(app, 'src-tauri/target/debug/noterion.exe'));
const driverExe = path.resolve(options.driver ?? path.join(repo, '.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe'));
const directory = path.resolve(options.output ?? path.join(app, 'validation/evidence'), run);
const local = path.join(directory, 'local');
const config = path.join(local, 'config');
const port = Number(options.port ?? 33221);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const endpoint = `http://127.0.0.1:${port}`;
let proxyPort;
if(offline){proxyPort=await new Promise((resolve,reject)=>{const probe=net.createServer();probe.once('error',reject);probe.listen(0,'127.0.0.1',()=>{const selected=probe.address().port;probe.close(()=>resolve(selected));});});}
const proxyArguments=offline?`--proxy-server=http://127.0.0.1:${proxyPort} --proxy-bypass-list="<-loopback>;tauri.localhost;ipc.localhost;127.0.0.1;[::1]"`:undefined;
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
let sampleDirectory;
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
  await until(()=>wd('GET',`/element/${id}/enabled`),`enabled action ${selector}`);
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
    windowsHide:true, stdio:['ignore','pipe','pipe'], env:{ ...process.env, ...(offline?{WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:proxyArguments}:{}), ...(scenario==='graphfailure'?{NOTERION_GRAPH_FAIL_ONCE:'1'}:{}), NOTERION_CONFIG_DIR:config, NOTERION_WEBVIEW_DIR:profile, NOTERION_MEDIA_AUDIT:path.join(directory,'rust-events.jsonl'), TAURI_WEBVIEW_AUTOMATION:'true', TEMP:temp, TMP:temp }
  });
  driver.stdout.pipe(createWriteStream(path.join(local,'driver-' + launches + '-stdout.txt')));
  driver.stderr.pipe(createWriteStream(path.join(local,'driver-' + launches + '-stderr.txt')));
  await until(async () => (await command('GET','/status')).ready, 'driver ready');
  const webviewOptions={userDataFolder:profile,...(offline?{additionalBrowserArguments:[`proxy-server=http://127.0.0.1:${proxyPort}`,'proxy-bypass-list=<-loopback>;tauri.localhost;ipc.localhost;127.0.0.1;[::1]']}: {})};
  const created = await command('POST','/session',{ capabilities:{ alwaysMatch:{ browserName:'webview2', 'ms:edgeOptions':{ binary:exe, webviewOptions } } } },60000);
  session = created.sessionId;
  assert.ok(session);
  await write('session-' + launches + '.json',created);
  const environment = await observe('return {url:location.href,userAgent:navigator.userAgent,visibility:document.visibilityState,invoke:typeof window.__TAURI__?.core?.invoke};');
  assert.equal(environment.url, 'http://tauri.localhost/'); assert.equal(environment.visibility, 'visible'); assert.equal(environment.invoke, 'function');
  await until(async () => (await findAll('[data-testid="create-point"]')).length, 'knowledge entry is rendered');
  await until(async () => await wd('GET',`/element/${await find('[data-testid="create-point"]')}/enabled`) || (await findAll('[data-testid="storage-error"]')).length>0,'storage loads or reports an explicit error');
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
  sampleDirectory=path.join(local,'observations-'+launches);await fs.mkdir(sampleDirectory);
  sampler=spawn('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(app,'validation/sample-resources.ps1'),'-RootPid',String(driver.pid),'-ClientPid',String(process.pid),'-RunDirectory',sampleDirectory,'-OutputFile',path.join(directory,'resources-'+launches+'.jsonl')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  sampler.stdout.pipe(createWriteStream(path.join(sampleDirectory,'stdout.txt')));sampler.stderr.pipe(createWriteStream(path.join(sampleDirectory,'stderr.txt')));
  await until(async()=>{assert.equal(sampler.exitCode,null,'resource sampler must remain alive');return(await fs.stat(path.join(directory,'resources-'+launches+'.jsonl'))).size>0;},'first actual Windows resource observation',15000);
  if(offline)await offlineProbe();
}
async function offlineProbe() {
  const probes=[];
  for(const url of ['http://example.com/','https://example.com/']){
    let navigationError;
    try{await wd('POST','/url',{url},20000);}catch(error){navigationError=error.message;}
    const rendered=await body();
    assert.ok((navigationError??'').includes('ERR_PROXY_CONNECTION_FAILED')||rendered.includes('ERR_PROXY_CONNECTION_FAILED'),'blocked remote navigation must specifically prove proxy failure');
    probes.push({url,navigationError,rendered});await capture('offline-'+launches+'-'+(url.startsWith('https')?'https':'http'));
  }
  const observed=spawnSync('powershell.exe',['-NoProfile','-Command',`$all=@(Get-CimInstance Win32_Process);$ids=[Collections.Generic.HashSet[int]]::new();[void]$ids.Add(${Number(hostPid)});do{$changed=$false;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)-and $ids.Add([int]$p.ProcessId)){$changed=$true}}}while($changed);$all|Where-Object{$ids.Contains([int]$_.ProcessId)-and $_.Name -eq 'msedgewebview2.exe'}|Select-Object ProcessId,ParentProcessId,CommandLine|ConvertTo-Json -Compress`],{windowsHide:true,encoding:'utf8'});
  assert.equal(observed.status,0,observed.stderr);const processes=JSON.parse(observed.stdout.trim()||'[]'),items=Array.isArray(processes)?processes:[processes];
  assert.ok(items.some(item=>item.CommandLine?.includes(`--proxy-server=http://127.0.0.1:${proxyPort}`)),'actual WebView2 process received proxy flag');
  await fs.writeFile(path.join(local,'offline-processes-'+launches+'.json'),JSON.stringify(items,null,2));
  await write('offline-'+launches+'.json',{mode:'WebView2 HTTP/HTTPS proxy isolation',verifiedUnusedProxyPort:proxyPort,arguments:proxyArguments,probes,limits:'Does not disable OS networking, native Rust sockets, UDP or externally opened applications.'});
  await wd('POST','/url',{url:'http://tauri.localhost/'},20000);
  await until(async()=>(await findAll('[data-testid="create-point"]')).length&&await wd('GET',`/element/${await find('[data-testid="create-point"]')}/enabled`)||(await findAll('[data-testid="storage-error"]')).length>0,'embedded app recovers after blocked remote probe');
}
async function stop({ crash = false } = {}) {
  // Inject the fault immediately while copying is observed, before sampler cleanup.
  if (crash && hostPid && alive(hostPid)) process.kill(hostPid, 'SIGKILL');
  if(sampler){await fs.writeFile(path.join(sampleDirectory,'stop-sampler'),'stop');await Promise.race([new Promise(resolve=>sampler.once('exit',resolve)),delay(3000)]);if(sampler.exitCode===null)sampler.kill();sampler=undefined;}
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
  await clickText('知识图谱');
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
    await select('Docker'); await click('[title="编辑知识点"]');
    assert.equal((await findAll('input[aria-label="所属主题 Docker"]')).length,0,'self-membership cannot be selected');
    await click('input[aria-label="所属主题 孙主题"]'); await click('[data-testid="save-point"]');
    await expectText('dialog [role="alert"]','循环'); assert.equal((await findAll('#knowledge-name')).length,1); await clickText('取消');
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
const resourceRow = title => `//article[@aria-label=${literal('学习资料：'+title)}]`;
async function associate(title,names) {
  await clickText('资料库');await click(resourceRow(title)+"//button[normalize-space(.)='关联知识点']",'xpath');
  for(const name of names)await click(`input[aria-label=${JSON.stringify('关联知识点 '+name)}]`);
  await click(containsButton('保存关联'),'xpath');await expectAbsent('dialog');
}
async function openResource(title) {
  await clickText('资料库');
  await click(`//article[@aria-label=${literal('学习资料：'+title)}]//button[normalize-space(.)='查看资料']`,'xpath');
}
async function closePreview() { await click('[aria-label="关闭弹窗"]');await expectAbsent('dialog'); }
async function settled() {await until(async()=>!(await text('.save-indicator')).includes('正在保存'),'current local operation has settled');}
async function pdfScenario() {
  const source=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/resource-checklist.pdf');
  await addFile(source,'独立PDF检查');await openResource('独立PDF检查');
  await until(async()=>(await findAll('iframe.pdf-frame')).length,'PDF frame appears');
  await delay(3000);await capture('pdf-after-3-seconds');
  const outer=await observe('const f=document.querySelector("iframe.pdf-frame");return {src:f?.src,title:f?.title,rect:f?{width:f.clientWidth,height:f.clientHeight}:null,pluginTypes:[...navigator.plugins].map(p=>p.name)};');
  let inner;
  try{
    await wd('POST','/frame',{id:{[elementKey]:await find('iframe.pdf-frame')}});
    inner=await observe('return {url:location.href,title:document.title,contentType:document.contentType,readyState:document.readyState,text:document.body?.innerText,html:document.documentElement?.outerHTML.slice(0,12000),embedded:[...document.querySelectorAll("embed,object,iframe")].map(e=>({tag:e.tagName,type:e.type,src:e.src,width:e.clientWidth,height:e.clientHeight}))};');
  }catch(error){inner={error:error.message};}
  finally{await wd('POST','/frame',{id:null});}
  await write('pdf-observation.json',{outer,inner,status:'REQUIRES_VISUAL_INSPECTION',screenshot:'pdf-after-3-seconds.png'});
  await capture('pdf-after-observation');
}
async function mediaMetrics() {
  return observe('const v=document.querySelector(".video-preview"); return v ? {currentTime:v.currentTime,duration:Number.isFinite(v.duration)?v.duration:null,paused:v.paused,readyState:v.readyState,videoWidth:v.videoWidth,videoHeight:v.videoHeight,decodedFrames:v.getVideoPlaybackQuality().totalVideoFrames,error:v.error?.code??null,jsHeapUsed:performance.memory?.usedJSHeapSize??null} : null;');
}
async function dragVideo(fraction) {
  const range=await find('[aria-label="视频播放位置"]');const rect=await wd('GET',`/element/${range}/rect`);
  await wd('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:0,origin:'viewport',x:Math.round(rect.x+9),y:Math.round(rect.y+rect.height/2)},{type:'pointerDown',button:0},{type:'pointerMove',duration:500,origin:'viewport',x:Math.round(rect.x+9+fraction*(rect.width-18)),y:Math.round(rect.y+rect.height/2)},{type:'pointerUp',button:0}]}]});await wd('DELETE','/actions');
}
async function webmScenario() {
  const source=path.join(repo,'.scratch/personal-knowledge-graph/validation/video-playback/.local/samples/issue-13-vp9-opus.webm');
  await addFile(source,'WebM VP9 Opus');await openResource('WebM VP9 Opus');
  await until(async()=>{const m=await mediaMetrics();return m?.duration>11&&m.duration<13;},'real WebM metadata');await click('[aria-label="播放视频"]');
  const start=await until(async()=>{const m=await mediaMetrics();return m.currentTime>0.5&&!m.paused&&m.videoWidth>0&&m.decodedFrames>0&&m;},'WebM actually decodes frames');
  await dragVideo(0.6);
  const seek=await until(async()=>{const m=await mediaMetrics();return m.currentTime>6&&m.currentTime<10&&!m.paused&&m.decodedFrames>start.decodedFrames&&m;},'WebM pointer seek');
  await delay(1800);const continued=await mediaMetrics();
  await check('actual WebM VP9/Opus decodes, pointer seeks and continues advancing',async()=>{assert.ok(continued.currentTime>seek.currentTime+1);return{start,seek,continued};});
  await capture('15-webm');await closePreview();
}
async function graphFailureScenario() {
  await expectText('.graph-boundary-message','图谱暂时无法显示');
  await savePoint({name:'图故障仍可保存',description:'图谱失败时正式数据仍可使用'});
  await check('real graph setup exception is contained while saving, searching and details remain usable',async()=>{
    await search('正式数据');assert.equal((await results()).length,1);await select('图故障仍可保存');assert.ok((await text('[data-testid="knowledge-details"]')).includes('图谱失败时正式数据仍可使用'));await expectText('.graph-boundary-message','图谱暂时无法显示');
  });
  await editPoint('图故障仍可保存',{name:'图恢复前的新名称',description:'恢复必须读取这份已提交新内容'});
  const source=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/container-resources.png');await addFile(source,'图故障资料');await associate('图故障资料',['图恢复前的新名称']);await select('图恢复前的新名称');
  await click("//section[@data-testid='knowledge-details']//button[contains(.,'图故障资料')]",'xpath');
  await check('knowledge resources remain readable while the real graph subtree has failed',async()=>{
    await until(()=>observe('const i=document.querySelector(".image-preview img");return i?.complete&&i.naturalWidth>0;'),'image remains decoded under graph failure');
  });await closePreview();await capture('16-graph-failed');
  await clickText('恢复图谱');await expectAbsent('.graph-boundary-message');
  await until(async()=>(await findAll('.graph-node')).length>0,'graph reconstructs current committed knowledge');
  await check('graph recovery rereads current facts rather than reviving a stale name or description',async()=>{
    await search('图故障仍可保存');assert.equal((await results()).length,0);await select('图恢复前的新名称');assert.ok((await text('[data-testid="knowledge-details"]')).includes('恢复必须读取这份已提交新内容'));
    assert.ok((await observe('return [...document.querySelectorAll(".graph-node")].map(n=>n.getAttribute("aria-label"));')).some(value=>value.includes('图恢复前的新名称')));
  });await capture('17-graph-recovered');
}
async function mediaScenario() {
  const samples=path.join(repo,'.scratch/personal-knowledge-graph/validation/video-playback/.local/samples');
  const pdf=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/resource-checklist.pdf');
  const png=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/container-resources.png');
  const fixture=path.join(local,'中文 空格来源'); await fs.mkdir(fixture);
  await savePoint({name:'资料复用甲'});await savePoint({name:'资料复用乙'});
  const imageSource=path.join(fixture,'同名.png'); await fs.copyFile(png,imageSource);
  await addFile(imageSource,'本地图片');
  await associate('本地图片',['资料复用甲','资料复用乙']);
  await check('one saved resource is reusable from two knowledge details and detaching one keeps the other',async()=>{
    for(const name of ['资料复用甲','资料复用乙']){await select(name);assert.ok((await text('[data-testid="knowledge-details"]')).includes('本地图片'));}
    await associate('本地图片',['资料复用甲']);await select('资料复用甲');assert.ok(!(await text('[data-testid="knowledge-details"]')).includes('本地图片'));
    await select('资料复用乙');assert.ok((await text('[data-testid="knowledge-details"]')).includes('本地图片'));
  });
  await fs.rename(imageSource,path.join(fixture,'已移动.png'));
  await stop(); await launch();
  await openResource('本地图片');
  await check('managed image survives moving the source and restarting',async()=>{
    const image=await until(()=>observe('const i=document.querySelector(".image-preview img"); return i?.complete&&i.naturalWidth>0 ? {width:i.naturalWidth,height:i.naturalHeight}:null;'),'decoded managed image');
    assert.ok(image.width>0&&image.height>0); return {width:image.width,height:image.height};
  });
  await capture('04-image'); await closePreview();
  const other=path.join(fixture,'另一个目录');await fs.mkdir(other);const otherSource=path.join(other,'同名.png');
  // The second same-named file is a different valid PNG with deterministic bytes.
  const differentPng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
  await fs.writeFile(otherSource,differentPng);await addFile(otherSource,'同名不同图片');await openResource('同名不同图片');
  await check('same filenames in different source directories do not overwrite or share the wrong copy',async()=>{
    const second=await until(()=>observe('const i=document.querySelector(".image-preview img");return i?.complete&&i.naturalWidth>0?{width:i.naturalWidth,height:i.naturalHeight}:null;'),'second same-named image decodes');assert.equal(second.width,1);assert.equal(second.height,1);
  });await closePreview();
  await clickText('资料库');await clickText('添加资料');await fill('[aria-label="资料文件路径"]',path.join(fixture,'不存在.png'));await fill('[aria-label="资料名称"]','缺失源文件');await clickText('保存资料');
  await check('missing source file reports failure and keeps the draft instead of ready resource',async()=>{
    await expectText('dialog [role="alert"]','无法读取源文件');
    assert.equal(await wd('GET',`/element/${await find('[aria-label="资料文件路径"]')}/property/value`),path.join(fixture,'不存在.png'));
    assert.equal(await wd('GET',`/element/${await find('[aria-label="资料名称"]')}/property/value`),'缺失源文件');
  });await clickText('取消');assert.equal((await findAll(resourceRow('缺失源文件'),'xpath')).length,0);
  await addFile(pdf,'本地PDF'); await openResource('本地PDF');
  await until(async()=>(await findAll('iframe')).length,'embedded PDF frame');
  await delay(3000); // Built-in PDF viewer initializes after the iframe element.
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
    await until(async()=>(await events()).some(event=>event.event==='file-read'&&event.range==='bytes=1000000000-1000000031'&&event.bytesWritten===32),'actual 32-byte Rust read audit');
  });
  await check('ordinary GET streams full video with independent hash, then cancellation stops a new read',async()=>{
    const response=await fetch(mediaUrl); assert.equal(response.status,200); assert.equal(Number(response.headers.get('content-length')),1_277_422_426);
    const digest=createHash('sha256');let bytes=0,peakRss=0;for await(const chunk of response.body){digest.update(chunk);bytes+=chunk.byteLength;peakRss=Math.max(peakRss,process.memoryUsage().rss);}
    assert.equal(bytes,1_277_422_426);assert.equal(digest.digest('hex'),'4c93ae3aba536be8a84d0498a2460dfab67fc309803eb2120613e0abd8ff00a7');
    const before=(await events()).length;
    const abort=new AbortController(), cancelled=await fetch(mediaUrl,{signal:abort.signal}), reader=cancelled.body.getReader();let received=0;
    while(received<8*1024*1024){const chunk=await reader.read();if(chunk.done)break;received+=chunk.value.byteLength;}abort.abort();await reader.cancel().catch(()=>{});await delay(500);
    const server=await until(async()=>(await events()).slice(before).find(event=>event.event==='file-read'&&event.cancelled&&!event.complete&&!event.range),'actual Rust cancellation audit');
    assert.ok(server.bytesRead<64*1024*1024,'cancellation stops bounded read ahead before 64 MiB');
    const full=(await events()).find(event=>event.event==='file-read'&&!event.range&&event.complete&&event.bytesWritten===1_277_422_426);assert.ok(full,'complete ordinary GET has actual full server byte audit');
    return {bytes,peakClientRss:peakRss,cancelledClientBytes:received,cancelledServer:server,fullServer:full};
  });
  await closePreview();
  await addFile(path.join(samples,'issue-13-ffv1-pcm.mkv'),'不支持视频');await openResource('不支持视频');
  await check('unsupported codec presents honest failure and system-app fallback',async()=>{
    await until(async()=>{const m=await mediaMetrics();return m?.error || (m?.duration>0&&m.videoWidth===0);},'unsupported video evidence');
    await until(async()=>/不支持|无法|未能/.test(await body()),'visible unsupported feedback');
    assert.ok((await findAll(containsButton('系统应用'),'xpath')).length>0);
    const before=(await events()).length;await clickText('使用系统应用打开');
    await until(async()=>(await events()).slice(before).some(event=>event.event==='external-open'),'actual system association invocation audit');
    await expectText('dialog','已请求系统应用打开');
  });
  await capture('08-unsupported'); await closePreview();
}

function owned(filename) {
  const plain=value=>path.resolve(value.replace(/^\\\\\?\\/,'' )).toLowerCase();
  assert.ok(plain(filename).startsWith(plain(local)+path.sep),'fault fixture must stay inside this run');
  return filename;
}
async function dataRoot() {
  await click('[aria-label="数据目录设置"]');
  const root=await wd('GET',`/element/${await find('[aria-label="数据目录"]')}/property/value`);
  owned(root);await closePreview();return root;
}
async function chooseRoot(root,create) {
  await click('[aria-label="数据目录设置"]');await fill('[aria-label="数据目录"]',root);
  await clickText(create?'创建新数据目录':'打开已有数据目录');
  await expectAbsent('[aria-label="数据目录"]');
}
async function beginCopy(source,title) {
  await clickText('资料库');await fill('[aria-label="搜索资料"]','');await clickText('添加资料');
  await fill('[aria-label="资料文件路径"]',source);await fill('[aria-label="资料名称"]',title);await clickText('保存资料');
  await until(async()=>(await findAll(button('取消复制'),'xpath')).length>0,'copy is active before fault',5000);
}
async function reliabilityScenario() {
  await savePoint({name:'可靠性知识甲'});await savePoint({name:'可靠性知识乙'});
  const original=await dataRoot();
  const nonempty=owned(path.join(local,'已有其他内容'));await fs.mkdir(nonempty);await fs.writeFile(path.join(nonempty,'保留.txt'),'不可覆盖的已有内容');
  await click('[aria-label="数据目录设置"]');await fill('[aria-label="数据目录"]',nonempty);await clickText('创建新数据目录');
  await check('creating a store refuses a nonempty unrelated directory without changing current facts',async()=>{
    await until(async()=>/非空|已有|不是空|内容/.test(await text('dialog [role="alert"]')),'nonempty create rejection');
    assert.equal(await fs.readFile(path.join(nonempty,'保留.txt'),'utf8'),'不可覆盖的已有内容');
  });await closePreview();await select('可靠性知识甲');
  const absent=owned(path.join(local,'未创建的目录'));
  await click('[aria-label="数据目录设置"]');await fill('[aria-label="数据目录"]',absent);await clickText('打开已有数据目录');
  await check('opening absent data reports a real error and does not create an empty store',async()=>{
    await until(async()=>/不存在|没有|无法|不可用/.test(await text('dialog [role="alert"]')),'absent open rejection');
    await assert.rejects(fs.access(absent),error=>error.code==='ENOENT');
  });await closePreview();
  const fresh=owned(path.join(local,'用户指定 中文数据'));await chooseRoot(fresh,true);
  await savePoint({name:'新目录知识',description:'只属于用户指定目录'});
  await chooseRoot(original,false);await select('可靠性知识甲');
  await chooseRoot(fresh,false);await select('新目录知识');await search('可靠性知识甲');assert.equal((await results()).length,0);
  await chooseRoot(original,false);
  await check('explicit new directory and opening an existing directory keep separate durable content',async()=>{
    await select('可靠性知识甲');await search('新目录知识');assert.equal((await results()).length,0);
  });
  await clickText('资料库');await clickText('添加资料');await clickText('网页链接');await fill('[aria-label="资料名称"]','复用网页资料');await fill('[aria-label="网页地址"]','https://example.com/knowledge?q=%E9%94%81');
  for(const name of ['可靠性知识甲','可靠性知识乙'])await click(`input[aria-label=${JSON.stringify('关联知识点 '+name)}]`);
  await clickText('保存资料');await expectAbsent('dialog');
  await check('link stores only address and supports multiple point associations with reusable lookup',async()=>{
    await fill('[aria-label="搜索资料"]','复用网页');assert.equal((await findAll('.library-row')).length,1);assert.ok((await text('.library-row')).includes('https://example.com/knowledge?q=%E9%94%81'));
    await fill('[aria-label="搜索资料"]','');for(const name of ['可靠性知识甲','可靠性知识乙']){await select(name);assert.ok((await text('[data-testid="knowledge-details"]')).includes('复用网页资料'));}
  });await associate('复用网页资料',['可靠性知识甲']);await select('可靠性知识甲');assert.ok(!(await text('[data-testid="knowledge-details"]')).includes('复用网页资料'));
  const sample=path.join(repo,'.scratch/personal-knowledge-graph/validation/video-playback/.local/samples/issue-13-h264-aac.mp4');
  await beginCopy(sample,'主动取消的资料');await clickText('取消复制');
  await check('copy cancellation never presents a ready resource or successful record',async()=>{
    await until(async()=>(await findAll(button('取消复制'),'xpath')).length===0,'cancel operation settles');
    await expectText('dialog [role="alert"]','取消');await clickText('取消');
    assert.equal((await findAll(resourceRow('主动取消的资料'),'xpath')).length,0);
    assert.ok((await events()).some(event=>event.event==='file-copy'&&event.success===false),'Rust cancellation failure audit');
  });
  await beginCopy(sample,'异常中断的资料');await stop({crash:true});await launch();await clickText('资料库');
  await check('killing the application during copy cannot leave a ready formal resource after restart',async()=>{
    assert.equal((await findAll(resourceRow('异常中断的资料'),'xpath')).length,0);await select('可靠性知识乙');assert.ok((await text('[data-testid="knowledge-details"]')).includes('复用网页资料'));
  });
  const files=path.join(original,'files'), beforeFiles=new Set(await fs.readdir(files));
  const png=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/container-resources.png');await addFile(png,'缺失副本测试');
  const additions=(await fs.readdir(files)).filter(file=>!beforeFiles.has(file));assert.equal(additions.length,1,'one imported file creates one managed asset');
  const managed=owned(path.join(files,additions[0])), moved=owned(managed+'.fault-moved');await fs.rename(managed,moved);
  try {
    await stop();await launch();await clickText('资料库');
    await check('a missing managed copy is marked missing and cannot be reported as ready or opened',async()=>{
      const id=await find(resourceRow('缺失副本测试'),'xpath');const row=await wd('GET',`/element/${id}/text`);assert.ok(row.includes('文件缺失'));assert.ok(!row.includes('就绪'));
      await openResource('缺失副本测试');await until(async()=>/缺失|不可读|无法/.test(await text('dialog [role="alert"]')),'managed missing-file error');assert.equal((await findAll('dialog img,dialog iframe,dialog video')).length,0);
    });await capture('11-missing-file');await closePreview();
  } finally {await fs.rename(moved,managed);}
  await stop();
  const movedRoot=owned(original+'.fault-moved');await fs.rename(original,movedRoot);
  try {
    await launch();
    await check('previously chosen directory going offline does not silently create an empty replacement',async()=>{
      await until(async()=>/不可用|失联|不存在|无法|没有/.test(await text('[data-testid="storage-error"]')),'lost directory storage error');
      assert.equal(await wd('GET',`/element/${await find('[data-testid="create-point"]')}/enabled`),false);
      await assert.rejects(fs.access(original),error=>error.code==='ENOENT');
    });await capture('12-directory-unavailable');
  } finally {await stop();await fs.rename(movedRoot,original);}
  await launch();await select('可靠性知识乙');
  await check('restoring the selected directory reloads current committed facts',async()=>assert.ok((await text('[data-testid="knowledge-details"]')).includes('复用网页资料')));
}

async function storageFaultsScenario() {
  await savePoint({name:'事务锁前知识',description:'原描述应当保留'});
  await savePoint({name:'事务锁前主题',theme:true});await savePoint({name:'事务锁前下属',topics:['事务锁前主题']});
  const root=await dataRoot(), sqliteFiles=(await fs.readdir(root)).filter(name=>name.endsWith('.sqlite3'));
  assert.equal(sqliteFiles.length,1,'one formal SQLite file for external environment lock injection');
  const lockReady=owned(path.join(local,'sqlite-lock-ready')),lockStop=owned(path.join(local,'sqlite-lock-stop'));
  const holder=spawn('python',['-u',path.join(app,'validation/hold-store-lock.py'),owned(path.join(root,sqliteFiles[0])),lockReady,lockStop],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  holder.stdout.pipe(createWriteStream(path.join(local,'sqlite-holder-stdout.txt')));holder.stderr.pipe(createWriteStream(path.join(local,'sqlite-holder-stderr.txt')));
  await until(async()=>{assert.equal(holder.exitCode,null,'independent SQLite lock holder remains alive');return(await fs.readFile(lockReady,'utf8'))==='LOCKED';},'real external SQLite write lock acquired');
  const source=path.join(repo,'.scratch/personal-knowledge-graph/prototypes/core-ui/test-data/resources/container-resources.png');
  const expectLocked=async()=>{await settled();return until(async()=>/locked|锁|无法开始保存/.test(await text('dialog [role="alert"]')),'actual store-lock error');};
  try {
    await select('事务锁前知识');await click('[title="编辑知识点"]');await fill('#knowledge-description','锁定期间不应提交');await click('[data-testid="save-point"]');
    await check('external SQLite write lock rejects editing while retaining the original fact and the user draft',async()=>{
      await expectLocked();assert.equal(await wd('GET',`/element/${await find('#knowledge-description')}/property/value`),'锁定期间不应提交');
      assert.ok(!(await text('.save-indicator')).includes('已保存到本机'));
    });await clickText('取消');await expectAbsent('dialog');await select('事务锁前知识');assert.ok((await text('[data-testid="knowledge-details"]')).includes('原描述应当保留'));
    await select('事务锁前主题');await click('[aria-label="知识点操作"]');await clickText('删除主题');await click(containsButton('确认删除 '),'xpath');
    await check('failed locked deletion preserves the complete preview and reports no success',async()=>{
      await settled();
      await until(async()=>/locked|锁|无法开始保存/.test(await text('[data-testid="storage-error"]')),'actual locked deletion feedback');
      assert.equal((await findAll('.impact-columns')).length,1);assert.ok((await text('.impact-columns')).includes('事务锁前下属'));assert.ok(!(await text('.save-indicator')).includes('已保存到本机'));
    });await clickText('取消');await expectAbsent('dialog');
    await clickText('资料库');await clickText('添加资料');await fill('[aria-label="资料文件路径"]',source);await fill('[aria-label="资料名称"]','文件完成但记录被锁');await clickText('保存资料');
    await check('complete file copy followed by locked record commit never reports a ready resource',async()=>{
      await expectLocked();assert.equal(await wd('GET',`/element/${await find('[aria-label="资料文件路径"]')}/property/value`),source);
      assert.ok((await events()).some(event=>event.event==='file-copy'&&event.success===false&&/locked|锁|保存/.test(event.error??'')));
    });await capture('13-locked-commit');await clickText('取消');await expectAbsent('dialog');assert.equal((await findAll(resourceRow('文件完成但记录被锁'),'xpath')).length,0);
  } finally {
    await fs.writeFile(lockStop,'stop');await Promise.race([new Promise(resolve=>holder.once('exit',resolve)),delay(3000)]);if(holder.exitCode===null)holder.kill();
  }
  await clickText('重新读取图谱');
  await check('unlock and reread recover original facts without partial edit, deletion or failed file record',async()=>{
    await select('事务锁前知识');const detail=await text('[data-testid="knowledge-details"]');assert.ok(detail.includes('原描述应当保留'));assert.ok(!detail.includes('锁定期间不应提交'));
    for(const name of ['事务锁前主题','事务锁前下属'])await select(name);
    await clickText('资料库');assert.equal((await findAll(resourceRow('文件完成但记录被锁'),'xpath')).length,0);
  });
  const files=owned(path.join(root,'files')),moved=owned(files+'.missing-fault');await fs.rename(files,moved);
  try {
    await clickText('添加资料');await fill('[aria-label="资料文件路径"]',source);await fill('[aria-label="资料名称"]','目录缺失不得成功');await clickText('保存资料');
    await check('missing managed file directory rejects copying without silently recreating it',async()=>{
      await expectText('dialog [role="alert"]','资料保存目录不可用');await assert.rejects(fs.access(files),error=>error.code==='ENOENT');assert.ok(!(await text('.save-indicator')).includes('已保存到本机'));
    });await clickText('取消');assert.equal((await findAll(resourceRow('目录缺失不得成功'),'xpath')).length,0);
    await savePoint({name:'资料目录故障时知识仍可保存',description:'结构化数据可用'});await search('结构化数据');assert.equal((await results()).length,1);
  } finally {await fs.rename(moved,files);}
  const sddl=owned(path.join(local,'files-original.sddl'));
  const permission=mode=>{const result=spawnSync('pwsh.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(app,'validation/directory-write-fault.ps1'),'-Directory',files,'-FixtureRoot',local,'-SddlFile',sddl,'-Mode',mode],{windowsHide:true,encoding:'utf8'});assert.equal(result.status,0,result.stderr);};
  permission('deny');
  try {
    const probe=owned(path.join(files,'acceptance-write-probe-'+run));let denied=false;
    try{await fs.writeFile(probe,'probe',{flag:'wx'});}catch(error){assert.ok(['EACCES','EPERM'].includes(error.code));denied=true;}
    if(!denied){await fs.unlink(probe);throw new Error('fixture ACL did not deny writes; cannot claim a permission failure test');}
    await clickText('资料库');await clickText('添加资料');await fill('[aria-label="资料文件路径"]',source);await fill('[aria-label="资料名称"]','不可写目录不得成功');await clickText('保存资料');
    await check('actual denied directory write reports copy failure and never presents ready data',async()=>{
      await expectText('dialog [role="alert"]','无法创建文件副本');assert.ok(!(await text('.save-indicator')).includes('已保存到本机'));await clickText('取消');assert.equal((await findAll(resourceRow('不可写目录不得成功'),'xpath')).length,0);
    });await capture('14-write-denied');
  } finally {permission('restore');}
  await addFile(source,'权限恢复后可保存');
  await check('restoring exact original directory permissions permits normal durable resource saving',async()=>{
    const id=await find(resourceRow('权限恢复后可保存'),'xpath');assert.ok((await wd('GET',`/element/${id}/text`)).includes('就绪'));
  });
}

try {
  await launch(); await capture('00-start');
  if (['create','core','all'].includes(scenario)) await createScenario();
  if (scenario === 'pdf') await pdfScenario();
  if (scenario === 'webm' || scenario === 'media' || scenario === 'all') await webmScenario();
  if (scenario === 'graphfailure') await graphFailureScenario();
  if (scenario === 'core' || scenario === 'all') await coreScenario();
  if (scenario === 'media' || scenario === 'all') await mediaScenario();
  if (scenario === 'reliability' || scenario === 'all') await reliabilityScenario();
  if (scenario === 'storagefaults' || scenario === 'all') await storageFaultsScenario();
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
  await write('result.json',{verdict:passed?'PASS':'FAIL',run,scenario,offline,assertions:assertions.length,exe,exeSha256,driverVersion,driverSha256,hostsExited,launches,at:new Date().toISOString(),limits:[...(scenario==='media'||scenario==='all'||scenario==='pdf'?['PDF screenshot requires explicit visual inspection']:[]),...(offline?['HTTP/HTTPS proxy isolation applies to WebView2; OS/native/external-app networking is unchanged']:[])]});
  console.log(`${passed?'PASS':'FAIL'} ${run}: ${assertions.length} assertions, ${launches} real desktop launches`);
}
