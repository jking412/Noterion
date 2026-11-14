// Real Tauri client; isolated data/profile. Mutations go through visible W3C controls.
// execute/sync observes DOM only. No injected application state or mocked IPC.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(app);
const options = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); assert.ok(i > 2); return [arg.slice(2, i), arg.slice(i + 1)]; }));
assert.ok(Object.keys(options).every(key => ['run', 'exe', 'driver', 'scale', 'hold', 'before', 'graph-fault'].includes(key)));
assert.match(options.run ?? '', /^issue-33-[a-z0-9-]+$/);
assert.equal(process.platform, 'win32');
const out = path.join(repo, '.scratch/desktop-workspace/runs', options.run);
const config = path.join(out, 'config'), profile = path.join(out, 'webview');
const exe = path.resolve(options.exe ?? path.join(app, 'dist-desktop/noterion.exe'));
const driverExe = path.resolve(options.driver ?? path.join(repo, '.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe'));
await fs.access(exe); await fs.access(driverExe);
await fs.mkdir(path.dirname(out), { recursive: true }); await fs.mkdir(out); await fs.mkdir(config);
const portServer = net.createServer();
await new Promise(resolve => portServer.listen(0, '127.0.0.1', resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const endpoint = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [], captures = [];
let driver, session;
const save = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const sha = async name => createHash('sha256').update(await fs.readFile(name)).digest('hex');
async function command(method, route, data) {
  const response = await fetch(endpoint + route, { method, headers: {'content-type':'application/json'}, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok || result.value?.error) throw new Error(`${method} ${route}: ${result.value?.error} ${result.value?.message ?? ''}`);
  return result.value;
}
const wd = (method, route, data) => command(method, `/session/${session}${route}`, data);
const observe = (script, args = []) => wd('POST', '/execute/sync', {script, args});
const key = 'element-6066-11e4-a52e-4f735466cecf';
const find = async (value, using = 'css selector') => (await wd('POST', '/element', {using, value}))[key];
const all = value => wd('POST', '/elements', {using:'css selector', value});
async function until(test, label, timeout = 20000) {
  const deadline = Date.now() + timeout; let last;
  do { try { const result = await test(); if (result) return result; } catch(error) {last = error.message;} await pause(100); } while(Date.now() < deadline);
  throw new Error(`Timeout ${label}: ${last ?? ''}`);
}
async function click(selector, using) {
  const id = await until(async () => { const id = await find(selector, using); return await wd('GET', `/element/${id}/displayed`) && await wd('GET', `/element/${id}/enabled`) && id; }, selector);
  await wd('POST', `/element/${id}/click`, {});
}
const clickText = label => click(`//button[normalize-space(.)='${label}' or @aria-label='${label}']`, 'xpath');
async function fill(selector, text) { const id = await find(selector); await wd('POST', `/element/${id}/clear`, {}); await wd('POST', `/element/${id}/value`, {text}); }
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
const expectText = (selector, value) => until(async () => (await text(selector)).includes(value), value);
async function capture(name) {
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(await wd('GET', '/screenshot'), 'base64'));
  const detail = await observe(`return {viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},page:{width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight},visibleText:document.body.innerText,
    panels:[...document.querySelectorAll('.desktop-sidebar,.search-floating,.details-floating,.library-layout,.library-list,.library-details,.model-settings-page,.modal-panel,.ai-import-layout')].filter(e=>e.getClientRects().length).map(e=>{const r=e.getBoundingClientRect();return {name:e.className,x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};})};`);
  assert.ok(detail.page.width <= detail.viewport.width + 1, `${name}: no horizontal page overflow`);
  captures.push({name,...detail}); await save('captures.json', captures);
}
async function check(name, action) { const detail = await action(); checks.push({name, verdict:'PASS', detail}); await save('checks.json', checks); console.log(`PASS ${name}`); }
async function launch() {
  const env = {...process.env, NOTERION_CONFIG_DIR:config, NOTERION_WEBVIEW_DIR:profile, TAURI_WEBVIEW_AUTOMATION:'true'};
  delete env.NOTERION_DEEPSEEK_KEY;
  if(options['graph-fault']==='true') env.NOTERION_GRAPH_FAIL_ONCE='1';
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1'], {windowsHide:true,stdio:'ignore',env});
  await until(async () => (await command('GET','/status')).ready, 'driver');
  const created = await command('POST','/session',{capabilities:{alwaysMatch:{browserName:'webview2','ms:edgeOptions':{binary:exe,webviewOptions:{userDataFolder:profile,...(options.scale?{additionalBrowserArguments:[`force-device-scale-factor=${options.scale}`]}:{})}}}}});
  session = created.sessionId;
  await until(() => observe('return location.origin === "http://tauri.localhost" && location.pathname === "/" && document.visibilityState === "visible" && typeof window.__TAURI__?.core?.invoke === "function";'), 'visible native client');
  await until(async () => wd('GET', `/element/${await find('[data-testid="create-point"]')}/enabled`), 'store loaded');
  await wd('POST','/window/rect',{width:1280,height:800});
}
async function stop() { if(session) {await command('DELETE',`/session/${session}`);session=undefined;} if(driver) {driver.kill();driver=undefined;await pause(300);} }
async function search(query) {
  await clickText('知识图谱');
  if(await observe('return document.querySelector("[aria-controls=knowledge-search]")?.getAttribute("aria-expanded") === "false";')) await click('[aria-controls="knowledge-search"]');
  await clickText('片段搜索'); await fill('[data-testid="search-input"]',query); await pause(200);
}
const longName = 'Docker 容器终端与本地知识工作区的长名称可读性检查 · 进入正在运行的容器';
let passed = false;
try {
  await launch();
  await save('environment.json',{exe,executableSha256:await sha(exe),driver:driverExe,driverVersion:spawnSync(driverExe,['--version'],{windowsHide:true,encoding:'utf8'}).stdout.trim(),url:await wd('GET','/url'),config,profile,scale:options.scale ?? 1,scaleMethod:options.scale?'WebView2 force-device-scale-factor (not global Windows DPI)':'default desktop scale'});
  if(options.before === 'true') {
    await capture('before-graph'); await clickText('资料库'); await capture('before-resources'); await clickText('知识导入'); await capture('before-import'); await click('[data-testid="ai-settings"]'); await pause(500); await capture('before-models');
  } else if(options['graph-fault']==='true') {
    await check('real graph boundary recovers after a debug-only render fault',async()=>{await expectText('.graph-boundary-message','图谱暂时无法显示');await capture('graph-failure');await clickText('重新读取图谱');await until(async()=>!(await all('.graph-boundary-message')).length,'graph restored');await capture('graph-recovered');});
  } else {
    await check('empty graph and shell',async()=>{await capture('01-empty-graph');assert.equal((await all('.desktop-navigation button')).length,3);assert.equal((await all('[data-testid="import-records"]')).length,0);});
    await check('resource empty, add form and validation',async()=>{
      await clickText('资料库');await capture('02-empty-resources');await clickText('添加资料');await capture('03-add-resource');await clickText('保存资料');await expectText('.resource-add-form','请选择');await capture('04-resource-validation');await clickText('取消');
    });
    await check('empty import and unconfigured models',async()=>{
      await clickText('知识导入');await capture('05-empty-import');await click('[data-testid="ai-settings"]');await until(async()=>(await all('[data-testid="model-base-url"]')).length,'models');
      for(const provider of ['deepseek','openai','anthropic']) {await click(`[data-testid="provider-${provider}"]`);await capture(`06-unconfigured-${provider}`);}
    });
    await check('new knowledge validation, long name and custom color',async()=>{
      await clickText('知识图谱');await click('[data-testid="create-point"]');await capture('07-editor-empty');await click('[data-testid="save-point"]');await expectText('.validation-message','名称');await capture('08-editor-validation');
      await fill('#knowledge-name',longName);await fill('#knowledge-description','## 命令\n\n`docker exec -it my-container /bin/sh`\n\n## 个人理解\n\n从保存的知识进入容器终端。');await fill('#knowledge-color-code','#bd485d');await capture('09-editor-filled');await click('[data-testid="save-point"]');
      await until(async()=>!(await all('#knowledge-name')).length,'created');await expectText('[data-testid="knowledge-details"]',longName);await capture('10-long-details');
      await click('[data-testid="edit-point"]');assert.equal(await observe('return document.querySelector("#knowledge-color-code").value;'),'#bd485d');await capture('11-editor-saved-color');await clickText('取消');
    });
    await check('search, focus, zoom and graph drag',async()=>{
      await search('容器');await expectText('.result-list',longName);await capture('12-search');await click('.result-list .result-item');await expectText('[data-testid="knowledge-details"]',longName);
      const before=await text('.zoom-value');await click('[aria-label="放大图谱"]');assert.notEqual(await text('.zoom-value'),before);await click('[aria-label="缩小图谱"]');await clickText('适应全图');
      const node=await find('.graph-node');await wd('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:0,origin:{[key]:node},x:0,y:0},{type:'pointerDown',button:0},{type:'pointerMove',duration:400,origin:'pointer',x:38,y:20},{type:'pointerUp',button:0}]}]});await wd('DELETE','/actions');await pause(500);await capture('13-graph-interaction');
    });
    await check('resource copy and text preview',async()=>{
      const file=path.join(out,'learning-material.md');await fs.writeFile(file,'# 容器终端\n\n资料库中的正文预览。');
      await clickText('资料库');await clickText('添加资料');await fill('[aria-label="资料文件路径"]',file);await fill('[aria-label="资料名称"]','容器终端的长名称学习资料 · 可预览的 Markdown 文档');await clickText('保存资料');await until(async()=>!(await all('.resource-add-form')).length,'resource saved');await capture('14-resource-saved');await clickText('查看资料');await expectText('.text-preview','资料库中的正文预览');await capture('15-resource-preview');await click('[aria-label="关闭弹窗"]');
    });
    await check('compact panels and settings at minimum window',async()=>{
      await wd('POST','/window/rect',{width:1000,height:700});await search('容器');await capture('16-min-search');await click('.result-list .result-item');await capture('17-min-details');
      assert.equal(await observe('return !!document.querySelector(".search-floating")?.getClientRects().length;'),false);
      await click('[data-testid="ai-settings"]');await capture('18-min-models');await clickText('数据位置');await capture('19-data-settings');await clickText('更换数据目录');await capture('20-directory-dialog');await click('[aria-label="关闭弹窗"]');
      await clickText('知识导入');await capture('21-min-import');await clickText('资料库');await capture('22-min-resources');
      if(await observe('return !!document.querySelector(".collapse-navigation")?.getClientRects().length;')) {await click('[aria-label="收起导航"]');await capture('23-collapsed-navigation');await click('[aria-label="展开导航"]');}
      else assert.equal(await observe('return document.querySelector(".desktop-sidebar").getBoundingClientRect().width;'),72);
    });
    await check('native maximize, restore and persistent knowledge',async()=>{
      const rect=await wd('GET','/window/rect');await wd('POST','/window/maximize',{});await capture('24-maximized');await wd('POST','/window/rect',{width:rect.width,height:rect.height});
      await stop();await launch();await search('容器');await expectText('.result-list',longName);await click('.result-list .result-item');await click('[data-testid="edit-point"]');assert.equal(await observe('return document.querySelector("#knowledge-color-code").value;'),'#bd485d');await clickText('取消');await capture('25-restarted');
    });
  }
  if(options.hold==='true') {console.log(`HOLD ${endpoint} ${session}`);const prompt=createInterface({input:process.stdin,output:process.stdout});await prompt.question('Press Enter after native window inspection.');prompt.close();}
  passed=true;
} catch(error) {await save('failure.json',{message:error.message,stack:error.stack});try{await capture('failure');}catch{}console.error(error);process.exitCode=1;}
finally {await stop();await save('result.json',{verdict:passed?'PASS':'FAIL',checks:checks.length});}
