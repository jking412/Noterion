// Issue #26: real Windows Tauri/WebView2 UI acceptance.
// All product mutations use visible W3C WebDriver controls. JavaScript only reads.
// The loopback fixture replaces the HTTP provider, never the desktop IPC or store.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startAiFixture, AI_FIXTURE_TEXT } from './ai-fixture-server.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const options = Object.fromEntries(process.argv.slice(2).map(argument => {
  const at = argument.indexOf('=');
  assert.ok(at > 2, 'Use --name=value arguments');
  return [argument.slice(2, at), argument.slice(at + 1)];
}));
assert.ok(Object.keys(options).every(key => ['run', 'phase', 'exe', 'driver', 'port', 'scenario', 'scale', 'baseline-dpr'].includes(key)), 'Unknown option');
assert.ok(!options.scenario || ['task-navigation', 'scaled'].includes(options.scenario), '--scenario=task-navigation|scaled');
assert.ok(!options.scale || (Number(options.scale) >= 1 && Number(options.scale) <= 4), '--scale is a runtime DPR from 1 to 4');
assert.match(options.run ?? '', /^issue-26-[a-z0-9-]+$/);
assert.ok(['before', 'after'].includes(options.phase), '--phase=before|after is required');
const after = options.phase === 'after';
const exe = path.resolve(options.exe ?? path.join(app, 'dist-desktop/noterion.exe'));
const driverExe = path.resolve(options.driver ?? path.join(app, '../.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe'));
const out = path.join(app, 'validation/issue-26-runs', options.run);
const local = path.join(out, 'local');
const config = path.join(local, 'config');
const profile = path.join(local, 'profile');
const endpoint = `http://127.0.0.1:${Number(options.port ?? 33261)}`;
const secret = 'fixture-only-key';
const learningText = AI_FIXTURE_TEXT + '\n本轮界面验收，核对后保存知识。';
const title = 'Docker 与 Linux 的容器操作学习笔记及来源核对说明';
const checks = [];
const snapshots = [];
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let driver, session, fixture, passed = false;
await fs.access(exe); await fs.access(driverExe);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out); // Evidence runs are immutable, including failed runs.
await fs.mkdir(local); await fs.mkdir(config);
const write = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const hash = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');

async function command(method, route, body) {
  const response = await fetch(endpoint + route, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json();
  // Do not log request bodies, which can contain the test credential.
  if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${route}: ${payload.value?.error ?? response.status}`);
  return payload.value;
}
const wd = (method, route, body) => command(method, `/session/${session}${route}`, body);
const observe = (script, args = []) => wd('POST', '/execute/sync', { script, args });
async function until(operation, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { const value = await operation(); if (value) return value; } catch (error) { last = error.message; }
    await pause(100);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}${last ? ` (${last})` : ''}`);
}
async function all(selector, using = 'css selector') { return wd('POST', '/elements', { using, value: selector }); }
async function find(selector, using = 'css selector') { return (await wd('POST', '/element', { using, value: selector }))[elementKey]; }
async function click(selector, using = 'css selector') {
  const id = await until(async () => {
    for (const element of await all(selector, using)) {
      const candidate = element[elementKey];
      if (await wd('GET', `/element/${candidate}/displayed`) && await wd('GET', `/element/${candidate}/enabled`)) return candidate;
    }
    return false;
  }, `visible enabled action ${selector}`);
  await wd('POST', `/element/${id}/click`, {});
}
const button = label => `//button[normalize-space(.)='${label}' or @aria-label='${label}']`;
const clickText = label => click(button(label), 'xpath');
async function fill(selector, value) {
  const id = await find(selector);
  await wd('POST', `/element/${id}/clear`, {});
  await wd('POST', `/element/${id}/value`, { text: value });
  assert.equal(await wd('GET', `/element/${id}/property/value`), value, `Input accepted: ${selector}`);
}
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
const value = selector => observe('return document.querySelector(arguments[0])?.value;', [selector]);
const expectText = (selector, expected) => until(async () => (await text(selector)).includes(expected), `visible ${expected}`);
const absent = selector => until(async () => !(await all(selector)).length, `absence of ${selector}`);
async function check(name, action) {
  const detail = await action();
  checks.push({ name, verdict: 'PASS', detail });
  await write('checks.json', checks);
  console.log(`PASS ${name}`);
}
async function capture(name) {
  const source = await wd('GET', '/source');
  assert.ok(!source.includes(secret), 'Credential is not captured');
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(await wd('GET', '/screenshot'), 'base64'));
  await fs.writeFile(path.join(out, name + '.html'), source);
  const detail = await observe(`return {
    viewport: {width: innerWidth, height: innerHeight, dpr: devicePixelRatio},
    page: {width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight},
    visibleText: document.body.innerText,
    controls: [...document.querySelectorAll('button,input,textarea,select')].filter(e=>e.getClientRects().length && getComputedStyle(e).visibility!=='hidden').map(e=>{
      const r=e.getBoundingClientRect();const s=getComputedStyle(e);
      return {name:e.getAttribute('aria-label')||e.innerText||e.id, tag:e.tagName, font:s.fontSize, x:r.x,y:r.y,width:r.width,height:r.height,disabled:e.disabled};
    }),
    content: [...document.querySelectorAll('[data-testid="knowledge-details"] h1,.prose-text,.modal-body,.ai-input-section,.ai-candidate-editor,.modal-header')].filter(e=>e.getClientRects().length).map(e=>{
      const r=e.getBoundingClientRect();return {role:e.className||e.tagName,x:r.x,y:r.y,width:r.width,height:r.height,scrollWidth:e.scrollWidth,clientWidth:e.clientWidth};
    })
  };`);
  snapshots.push({ name, ...detail });
  await write('snapshots.json', snapshots);
  return detail;
}
async function launch() {
  const environment = { ...process.env, NOTERION_CONFIG_DIR: config, NOTERION_WEBVIEW_DIR: profile, TAURI_WEBVIEW_AUTOMATION: 'true' };
  delete environment.NOTERION_DEEPSEEK_KEY;
  driver = spawn(driverExe, [`--port=${Number(options.port ?? 33261)}`, '--allowed-ips=127.0.0.1'], { windowsHide: true, stdio: 'ignore', env: environment });
  await until(async () => (await command('GET', '/status')).ready, 'driver ready');
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'webview2', 'ms:edgeOptions': { binary: exe, webviewOptions: { userDataFolder: profile,
      ...(options.scale ? { additionalBrowserArguments: [`force-device-scale-factor=${options.scale}`] } : {}) } },
  } } });
  session = created.sessionId;
  const actual = await until(async () => {
    const state = await observe('return {url:location.href,visible:document.visibilityState,ipc:typeof window.__TAURI__?.core?.invoke,userAgent:navigator.userAgent};');
    return state.url === 'http://tauri.localhost/' && state.visible === 'visible' && state.ipc === 'function' && state;
  }, 'visible embedded Tauri client');
  await until(async () => wd('GET', `/element/${await find('[data-testid="create-point"]')}/enabled`), 'native store loaded');
  await wd('POST', '/window/rect', { width: 1280, height: 800 });
  await write('environment.json', { ...actual, exe, sha256: await hash(exe), driver: driverExe, driverVersion: spawnSync(driverExe, ['--version'], { windowsHide: true, encoding: 'utf8' }).stdout.trim(), provider: 'local HTTP/SSE fixture; no mock IPC; not official DeepSeek', config, profile, ...(options.scale ? { scaleMethod: 'WebView2 force-device-scale-factor startup argument', requestedScale: Number(options.scale) } : {}) });
}
async function stop() {
  if (session) { await command('DELETE', `/session/${session}`); session = undefined; }
  if (driver) { driver.kill(); driver = undefined; await pause(500); }
}
async function settings(mode) {
  await click('[data-testid="ai-settings"]');
  await until(async () => (await all('.ai-config-status')).length, 'settings loaded');
  const next = fixture.baseUrl(mode);
  if (await value('#deepseek-url') !== next) {
    const remove = await find(button('移除密钥'), 'xpath');
    if (await wd('GET', `/element/${remove}/enabled`)) {
      await wd('POST', `/element/${remove}/click`, {});
      await expectText('dialog', '已移除密钥');
    }
  }
  await fill('#deepseek-url', next); await fill('#deepseek-key', secret);
  await click('[data-testid="ai-settings-save"]');
  await expectText('dialog', '配置已保存');
  assert.equal(await value('#deepseek-key'), '');
  await click('[aria-label="关闭弹窗"]');
}
async function search(name) {
  await clickText('知识图谱'); await clickText('片段搜索');
  await fill('[data-testid="search-input"]', name);
  await pause(150);
}
async function select(name) {
  await search(name);
  await click(`//ul[contains(@class,'result-list')]//button[.//*[contains(@class,'result-name') and normalize-space(.)='${name}']]`, 'xpath');
  await expectText('[data-testid="knowledge-details"] h1', name);
}
async function begin(action, input) {
  if (action === 'extract') {
    await clickText('知识导入'); await fill('[data-testid="ai-source"]', input); await click('[data-testid="ai-extract"]');
  } else {
    await clickText('知识图谱'); await click('[data-testid="ai-search-mode"]');
    await clickText(action === 'search' ? '查找知识' : '回答问题');
    await fill('[data-testid="ai-question"]', input); await click('[data-testid="ai-submit"]');
  }
}
const taskInput = action => action === 'extract' ? '[data-testid="ai-source"]' : '[data-testid="ai-question"]';
const taskError = action => action === 'extract' ? '[data-testid="ai-import-error"]' : '[data-testid="ai-error"]';
const taskCancel = action => action === 'extract' ? '[data-testid="ai-import-cancel"]' : '[data-testid="ai-cancel"]';
async function taskResult(action) {
  const success = action === 'extract' ? '.ai-candidate-list button' : '[data-testid="ai-output"]';
  const submit = action === 'extract' ? '[data-testid="ai-extract"]' : '[data-testid="ai-submit"]';
  await until(async () => await wd('GET', `/element/${await find(submit)}/enabled`)
    && ((await all(success)).length || (await all(taskError(action))).length), `${action} final result`);
  assert.equal((await all(taskError(action))).length, 0, `${action} succeeds`);
  assert.ok((await all(success)).length, `${action} has a result`);
  if (after) assert.equal((await observe('return [...document.querySelectorAll(".ai-task-status")].filter(e=>e.getClientRects().length).length;')), 0);
}
async function visibleStatus() {
  return observe('return [...document.querySelectorAll(".ai-task-status")].filter(e=>e.getClientRects().length).map(e=>e.innerText);');
}
async function retainedAnswer(question) {
  await expectText('.ai-conversation-history', question);
  const summary = `//div[contains(@class,'ai-conversation-history')]/details[summary[normalize-space(.)='${question}']][last()]/summary`;
  await click(summary, 'xpath');
  await expectText('.ai-conversation-history', 'docker exec');
  await click(summary, 'xpath');
  assert.equal((await all('[data-testid="ai-output"]')).length, 0, 'No old answer is presented as the current result');
}
async function coreScreens() {
  await capture('00-graph-empty');
  await click('[data-testid="ai-settings"]'); await expectText('dialog', 'DeepSeek'); await capture('01-settings'); await click('[aria-label="关闭弹窗"]');
  await clickText('知识导入'); await fill('[data-testid="ai-source"]', learningText); await capture('02-import-input');
  await settings('slow'); await begin('extract', learningText);
  await until(() => fixture.requests.some(r => r.mode === 'slow'), 'native extraction reached provider');
  await capture('03-import-waiting');
  await clickText('知识图谱'); await click('[data-testid="ai-search-mode"]');
  const shared = await observe(`const p=document.querySelector('.ai-knowledge-panel');return {
    statuses:[...p.querySelectorAll('.ai-task-status')].filter(e=>e.getClientRects().length).map(e=>e.innerText),
    cancel:[...p.querySelectorAll('[data-testid="ai-cancel"]')].filter(e=>e.getClientRects().length).length,
    text:p.innerText
  };`);
  await capture('03b-shared-task-state');
  if (after) {
    assert.equal(shared.statuses.length, 0, 'Extraction progress is not presented as a question task');
    assert.equal(shared.cancel, 0, 'Question panel does not offer its own cancellation for extraction');
    await click('[data-testid="ai-view-task"]');
  } else {
    let red;
    try { assert.equal(shared.statuses.length, 0, 'Question panel must not present extraction as its current question task'); }
    catch (error) { red = error.message; }
    await write('shared-task-reproduction.json', { expected: 'No question task status/cancel during extraction; a separate task-navigation notice', actual: shared, verdict: red ? 'RED: reproduced' : 'Not reproduced', assertion: red });
    console.log(red ? 'RED reproduced cross-surface AI task status mismatch' : 'Cross-surface mismatch was not reproduced');
    await clickText('知识导入');
  }
  await click(taskCancel('extract')); await expectText('[aria-label="AI 知识整理"]', '取消');
  await settings('good'); await begin('extract', learningText); await taskResult('extract');
  await click("//nav[@aria-label='候选知识点']//button[.//span[starts-with(normalize-space(.),'进入容器终端')]]", 'xpath');
  await capture('04-candidates');
  await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '保存');
  await check('reviewed candidates save through the native store and survive restart', async () => {
    await stop(); await launch(); await select('进入容器终端');
    assert.ok((await text('[data-testid="knowledge-details"]')).includes('docker exec'));
  });
  await capture('05-graph-details');
  await click('[data-testid="edit-point"]'); await capture('06-editor'); await click('[aria-label="关闭弹窗"]');
  await click('[data-testid="point-menu"]'); await click('[data-testid="delete-point"]');
  await expectText('dialog', '无法撤销'); await capture('07-delete-confirmation'); await click('[aria-label="关闭弹窗"]');
  await clickText('资料库'); await clickText('添加资料');
  const file = path.join(local, 'learning-source.md'); await fs.writeFile(file, learningText, { flag: 'wx' });
  await fill('#resource-path', file); await fill('#resource-title', title); await clickText('保存资料'); await absent('#resource-path');
  await expectText('.library-list', title); await capture('08-library');
  await click(`//article[@aria-label='学习资料：${title}']//button[normalize-space(.)='查看资料']`, 'xpath');
  await expectText('.text-preview', 'Docker'); await capture('09-resource-preview'); await clickText('关闭预览');
  await clickText('导入记录'); await expectText('.ai-record-details', 'Docker'); await capture('10-records');
  await click('[aria-label="数据目录设置"]'); await capture('11-data-directory');
  const displayPath = await value('#data-directory');
  if (after) assert.ok(!displayPath.startsWith('\\\\?\\'), 'Directory is displayed as a readable Windows path');
  assert.ok(displayPath.includes('issue-26-'), 'Run uses its own data directory');
  await click('[aria-label="关闭弹窗"]');
  await settings('good'); await begin('search', '查找进入容器终端的命令'); await taskResult('search'); await capture('12-ai-search');
  await begin('answer', '怎么进入容器终端？'); await taskResult('answer'); await capture('13-ai-answer');
  await click('.ai-output .ai-source'); await expectText('[data-testid="knowledge-details"]', 'docker exec');
}

async function afterChecks() {
  await check('daily surfaces omit internal paths, transaction commentary and character counters', async () => {
    const forbidden = /当前数据：|模型接收\s*\d|\d[\d,]*\s*字符|只有文件副本完整保存|本次发送：|发送范围：|整批校验|任一引用或关系校验失败/;
    for (const snapshot of snapshots) {
      if (snapshot.name === '11-data-directory') continue;
      assert.ok(!forbidden.test(snapshot.visibleText), `${snapshot.name}: no product noise`);
      assert.ok(!snapshot.visibleText.includes('\\\\?\\'), `${snapshot.name}: no Windows internal path prefix`);
    }
  });
  await check('a missing managed file reports a recoverable error and restores after the file returns', async () => {
    const files = path.join(config, 'data/files');
    const copies = await fs.readdir(files);
    assert.equal(copies.length, 1, 'Only this run owns the single managed test copy');
    const managed = path.join(files, copies[0]);
    const held = path.join(local, 'held-managed-copy');
    const realLocal = await fs.realpath(local);
    assert.ok((await fs.realpath(managed)).startsWith(realLocal + path.sep), 'Fault stays inside this run');
    await fs.rename(managed, held);
    try {
      await clickText('资料库');
      await click(`//article[@aria-label='学习资料：${title}']//button[normalize-space(.)='查看资料']`, 'xpath');
      await until(async () => (await all('.preview-error')).length, 'Missing file becomes an explicit preview failure');
      assert.ok(/缺失|不存在|无法|不可用|失败/.test(await text('.preview-error')));
      await capture('13b-missing-file');
      assert.ok((await all(button('使用系统应用打开'), 'xpath')).length, 'Alternative action is retained');
      await clickText('关闭预览');
    } finally { await fs.rename(held, managed); }
    await click(`//article[@aria-label='学习资料：${title}']//button[normalize-space(.)='查看资料']`, 'xpath');
    await expectText('.text-preview', 'Docker'); await clickText('关闭预览');
  });
  for (const action of ['extract', 'search', 'answer']) {
    const input = action === 'extract' ? learningText + '\n取消与恢复 ' + action : `容器终端 ${action} 取消与恢复`;
    let previousAnswer;
    if (action === 'answer') {
      await settings('good'); await begin('answer', '保存的容器终端操作说明'); await taskResult('answer');
      previousAnswer = await text('.ai-output-question');
    }
    await settings('slow'); const first = fixture.requests.length;
    await begin(action, input);
    await until(() => fixture.requests.length > first, `${action} native HTTP starts`);
    await check(`${action}: slow response has one honest status; cancel aborts HTTP and preserves input`, async () => {
      await pause(800);
      const status = await visibleStatus(); assert.equal(status.length, 1);
      assert.ok(!/模型接收|字符|\{|\}|正在校验|接收模型/.test(status[0]));
      if (previousAnswer) {
        await retainedAnswer(previousAnswer);
        const input = await find('[data-testid="ai-question"]');
        assert.equal(await wd('GET', `/element/${input}/property/readOnly`), true, 'Question is frozen while remaining selectable and copyable');
        const frozen = await observe('return [...document.querySelectorAll(".ai-mode-row button,.ai-text-context input")].every(e=>e.disabled);');
        assert.equal(frozen, true, 'Task mode and text-reading selections freeze during a question task');
      }
      const pending = action === 'extract' ? '[data-testid="ai-extract"]' : '[data-testid="ai-submit"]';
      assert.equal(await wd('GET', `/element/${await find(pending)}/enabled`), false);
      await capture(`14-${action}-slow`);
      await click(taskCancel(action));
      await until(async () => (await visibleStatus()).length === 0, `${action} busy ends`);
      assert.equal(await value(taskInput(action)), input);
      if (previousAnswer) await retainedAnswer(previousAnswer);
      await until(() => fixture.requests.slice(first).some(r => r.aborted), `${action} native HTTP cancellation`);
    });
    await settings('good'); await begin(action, input); await taskResult(action);
    await check(`${action}: resubmission succeeds after cancellation with no stale response`, async () => {
      assert.equal((await all(taskError(action))).length, 0);
      if (action !== 'extract') await expectText('.ai-output-question', input);
    });
    const prior = action === 'answer' ? await text('.ai-output-question') : undefined;
    for (const [mode, expected] of [['unauthorized', '鉴权'], ['rate-limit', '受限'], ['network-drop', '连接']]) {
      await settings(mode); await begin(action, input + ' ' + mode);
      await check(`${action}: ${mode} ends waiting and exposes an actionable error with preserved input`, async () => {
        await expectText(taskError(action), expected);
        assert.equal((await visibleStatus()).length, 0);
        assert.equal(await value(taskInput(action)), input + ' ' + mode);
        if (prior) await retainedAnswer(prior);
        const submit = action === 'extract' ? '[data-testid="ai-extract"]' : '[data-testid="ai-submit"]';
        assert.equal(await wd('GET', `/element/${await find(submit)}/enabled`), true);
        if (mode === 'unauthorized') await capture(`15-${action}-error`);
      });
    }
    await settings('good'); await begin(action, input + ' 再次提交'); await taskResult(action);
    await check(`${action}: corrected configuration permits successful retry`, async () => assert.equal((await all(taskError(action))).length, 0));
  }
  await layoutChecks();
}
async function layoutChecks() {
  await check('long content and native window sizes keep page navigation and actions reachable', async () => {
    await clickText('知识图谱'); await click('[data-testid="create-point"]');
    const longName = '容器网络与部署时的配置检查和排错方法：包含中文、英文 Docker Compose 以及较长的学习主题名称';
    await fill('#knowledge-name', longName); await fill('#knowledge-description', '长内容验收。\n'.repeat(15));
    await click('[data-testid="save-point"]'); await absent('#knowledge-name');
    for (const [width, height] of [[1280, 800], [1600, 1000]]) {
      await wd('POST', '/window/rect', { width, height }); await select(longName);
      const snapshot = await capture(`16-layout-${width}`);
      assert.ok(snapshot.page.width <= snapshot.viewport.width + 1, 'No document horizontal overflow');
      assert.ok(snapshot.controls.filter(c => c.name === '新建知识点' || c.name === '数据目录设置').every(c => c.x >= 0 && c.x + c.width <= snapshot.viewport.width + 1));
    }
    return { sizes: snapshots.filter(snapshot => snapshot.name.startsWith('16-layout-')).map(snapshot => snapshot.viewport) };
  });
}

async function taskNavigation() {
  await settings('good'); await begin('extract', learningText); await taskResult('extract');
  await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '保存');
  await settings('slow'); const first = fixture.requests.length;
  await begin('answer', '容器终端任务导航验收');
  await until(() => fixture.requests.length > first, 'Native answer request is pending');
  await clickText('片段搜索'); await clickText('知识导入');
  await click('[data-testid="ai-view-task"]');
  await inspectTaskNavigation('19-task-navigation', first);
}
async function inspectTaskNavigation(name, first, expectDetailsClosed = false) {
  const actual = await observe(`return {
    hash:location.hash,
    questionVisible:!!document.querySelector('[data-testid="ai-question"]')?.getClientRects().length,
    cancelVisible:!!document.querySelector('[data-testid="ai-cancel"]')?.getClientRects().length,
    detailsVisible:!!document.querySelector('.details-floating')?.getClientRects().length,
    panelText:document.querySelector('.search-panel')?.innerText
  };`);
  await write(name + '-observation.json', actual);
  await capture(name);
  await check(`${name}: view task returns to the active AI mode and exposes actual cancellation`, async () => {
    assert.equal(actual.questionVisible, true, 'View task must reveal the active AI question panel after switching to local search');
    assert.equal(actual.cancelVisible, true, 'View task must expose the pending answer cancellation');
    if (expectDetailsClosed) assert.equal(actual.detailsVisible, false, 'Task navigation releases the detail overlay at high zoom');
    await click('[data-testid="ai-cancel"]');
    await until(() => fixture.requests.slice(first).some(r => r.aborted), 'Task navigation cancellation aborts native HTTP');
  });
}
async function selectedTaskNavigation() {
  await settings('slow'); const first = fixture.requests.length;
  await begin('answer', '选中知识与高缩放时的任务导航验收');
  await until(() => fixture.requests.length > first, 'Native answer request is pending');
  await clickText('片段搜索');
  await fill('[data-testid="search-input"]', '进入容器终端');
  await click("//ul[contains(@class,'result-list')]//button[.//*[contains(@class,'result-name') and normalize-space(.)='进入容器终端']]", 'xpath');
  await clickText('知识导入'); await click('[data-testid="ai-view-task"]');
  await inspectTaskNavigation('20-task-navigation-zoomed', first, true);
}
async function scaledScenario() {
  assert.ok(options.scale, 'Runtime scale scenario requires --scale');
  const baselineDpr = Number(options['baseline-dpr']);
  assert.ok(baselineDpr > 0, 'Supply the measured unscaled runtime --baseline-dpr');
  const ratio = Number(options.scale) / baselineDpr;
  assert.ok(Math.abs(ratio - 1.5) < .01 || Math.abs(ratio - 2) < .01, 'Supplement covers 150% or 200% relative to the observed baseline DPR');
  await wd('POST', '/window/rect', { width: Math.round(1600 / ratio), height: Math.round(1000 / ratio) });
  await taskNavigation();
  await check(`real WebView2 runtime at ${ratio * 100}% relative scale keeps long content and decisions usable`, async () => {
    await clickText('知识图谱'); await click('[data-testid="create-point"]');
    await fill('#knowledge-name', '容器网络与部署时的配置检查和排错方法：包含中文、英文 Docker Compose 以及较长的学习主题名称');
    await fill('#knowledge-description', '高缩放长内容验收。\n'.repeat(15)); await click('[data-testid="save-point"]'); await absent('#knowledge-name');
    const graph = await capture('21-scaled-graph-details');
    assert.ok(Math.abs(graph.viewport.dpr - Number(options.scale)) < .05, 'Observed runtime DPR matches requested scale');
    assert.ok(Math.abs(graph.viewport.dpr / baselineDpr - ratio) < .05, 'Observed runtime enlargement matches the requested baseline-relative scale');
    assert.ok(graph.page.width <= graph.viewport.width + 1, 'No horizontal document overflow');
    assert.ok(graph.controls.filter(c => c.name === '新建知识点' || c.name === '数据目录设置').every(c => c.x >= 0 && c.x + c.width <= graph.viewport.width + 1), 'Header actions stay inside the actual viewport');
    await click('[data-testid="edit-point"]'); await capture('22-scaled-editor'); await click('[aria-label="关闭弹窗"]');
    await clickText('知识导入'); await capture('23-scaled-import');
    await click('[aria-label="数据目录设置"]'); await capture('24-scaled-directory'); await click('[aria-label="关闭弹窗"]');
    for (const snapshot of snapshots) {
      assert.ok(snapshot.page.width <= snapshot.viewport.width + 1, `${snapshot.name}: no horizontal page overflow`);
      assert.ok(snapshot.content.every(c => c.x >= -1 && c.x + c.width <= snapshot.viewport.width + 1 && c.scrollWidth <= c.clientWidth + 1), `${snapshot.name}: headings, prose and form content remain within horizontal bounds`);
    }
    return { baselineDpr, requestedRatio: ratio, observedRatio: graph.viewport.dpr / baselineDpr, viewport: graph.viewport, method: 'Real WebView2 force-device-scale-factor startup argument; no CSS injection; not a global Windows DPI change' };
  });
  if (Math.abs(ratio - 2) < .01) await selectedTaskNavigation();
}

try {
  fixture = await startAiFixture();
  await launch();
  if (options.scenario === 'scaled') {
    await scaledScenario();
  } else if (options.scenario === 'task-navigation') {
    await taskNavigation();
  } else {
    await coreScreens();
    if (after) await afterChecks();
  }
  passed = true;
} catch (error) {
  await write('failure.json', { message: error.message });
  if (session) { try { await capture('failure'); } catch {} }
  console.error(error.message);
} finally {
  if (session) {
    try {
      if ((await all('dialog')).length) await click('[aria-label="关闭弹窗"]');
      await click('[data-testid="ai-settings"]'); await expectText('dialog', 'DeepSeek');
      const remove = await find(button('移除密钥'), 'xpath');
      if (await wd('GET', `/element/${remove}/enabled`)) await wd('POST', `/element/${remove}/click`, {});
    } catch {}
  }
  try { await stop(); } catch {}
  if (fixture) { await write('provider-metadata.json', fixture.requests); await fixture.close(); }
  await write('result.json', { run: options.run, phase: options.phase, scenario: options.scenario ?? 'full', passed, assertions: checks.length, screenshots: snapshots.map(s=>s.name), exe, boundary: 'Real debug Windows Tauri/WebView2 UI and native Rust store/HTTP; deterministic local provider, not official DeepSeek.' });
  process.exitCode = passed ? 0 : 1;
}
