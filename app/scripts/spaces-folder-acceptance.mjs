// Real Windows Tauri UI acceptance. State changes use visible WebDriver controls.
// execute/sync observes rendered DOM only. Fixtures and credentials belong to this run.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startModelFixture, MODEL_FIXTURE_KEYS } from './model-fixture-server.mjs';
import { createLegacyFixture } from './space-legacy-fixture.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), repo = path.dirname(app);
const args = Object.fromEntries(process.argv.slice(2).map(argument => { const index = argument.indexOf('='); assert.ok(index > 2, 'Use --name=value'); return [argument.slice(2, index), argument.slice(index + 1)]; }));
assert.ok(Object.keys(args).every(key => ['run', 'exe', 'driver', 'port', 'scenario', 'scale'].includes(key)), 'Unknown acceptance option');
assert.match(args.run ?? '', /^issue-(32|33)-[a-z0-9-]+$/);
assert.equal(process.platform, 'win32', 'Requires the Windows desktop client');
const scenario = args.scenario ?? 'spaces'; assert.ok(['spaces', 'full'].includes(scenario));
const scale = args.scale === undefined ? undefined : Number(args.scale);
assert.ok(scale === undefined || [1, 1.5, 2].includes(scale), 'Scale must be 1, 1.5 or 2');
const out = path.join(repo, '.scratch/spaces-folder-import/runs', args.run), config = path.join(out, 'config');
const exe = path.resolve(args.exe ?? path.join(app, 'dist-desktop/noterion.exe'));
const driverExe = path.resolve(args.driver ?? 'D:/person/application/knowledgeGraph/.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe');
await fs.access(exe); await fs.access(driverExe);
await fs.mkdir(path.dirname(out), { recursive: true }); await fs.mkdir(out); await fs.mkdir(config);
const save = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const legacy = await createLegacyFixture(config);
const notes = path.join(out, 'folder-notes'), emptyFolder = path.join(out, 'empty-folder');
const learningText = 'Docker 与 Linux 学习笔记。进入容器终端：docker exec -it demo sh。';
await fs.mkdir(path.join(notes, 'nested'), { recursive: true }); await fs.mkdir(path.join(notes, 'other')); await fs.mkdir(emptyFolder);
await fs.writeFile(path.join(notes, 'root.md'), learningText + '\n第一份笔记。');
await fs.writeFile(path.join(notes, 'nested', 'notes.TXT'), learningText + '\n第二份笔记。');
await fs.writeFile(path.join(notes, 'other', 'notes.MD'), learningText + '\n第三份笔记。');
await fs.writeFile(path.join(notes, 'bad.md'), Buffer.from([0xff, 0xfe, 0x81]));
await fs.writeFile(path.join(notes, 'large.TXT'), 'a'.repeat(256 * 1024 + 1));
await fs.writeFile(path.join(notes, 'empty.txt'), ''); await fs.writeFile(path.join(notes, 'ignore.csv'), 'not a target');
const fileA = path.join(out, '甲空间资料.txt'), fileB = path.join(out, '乙空间资料.txt');
await fs.writeFile(fileA, '甲空间独有的参考正文'); await fs.writeFile(fileB, '乙空间独有的参考正文');
async function availablePort() { const server = net.createServer(); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); }); const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port; }
const port = args.port ? Number(args.port) : await availablePort(); assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const endpoint = `http://127.0.0.1:${port}`, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
let fixture, session, driver, launches = 0, passed = false;
const checks = [], credentialTargets = new Set();
const executableSha256 = createHash('sha256').update(await fs.readFile(exe)).digest('hex');
const driverSha256 = createHash('sha256').update(await fs.readFile(driverExe)).digest('hex');
async function command(method, route, body) {
  const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const result = await response.json(); if (!response.ok || result.value?.error) throw new Error(`WebDriver ${method} ${route}: ${result.value?.error ?? response.status}`); return result.value;
}
const wd = (method, route, body) => command(method, `/session/${session}${route}`, body);
async function until(action, description, timeout = 20000) { const deadline = Date.now() + timeout; let last; do { try { const value = await action(); if (value) return value; } catch (error) { last = error.message; } await pause(120); } while (Date.now() < deadline); throw new Error(`Timed out: ${description}${last ? ` (${last})` : ''}`); }
const observe = (script, values = []) => wd('POST', '/execute/sync', { script, args: values });
const find = async (selector, using = 'css selector') => (await wd('POST', '/element', { using, value: selector }))[elementKey];
const all = selector => wd('POST', '/elements', { using: 'css selector', value: selector });
async function click(selector, using) { const id = await until(async () => { const element = await find(selector, using); return await wd('GET', `/element/${element}/displayed`) && await wd('GET', `/element/${element}/enabled`) && element; }, `enabled ${selector}`); await wd('POST', `/element/${id}/click`, {}); }
const literal = text => `'${text.replaceAll("'", '')}'`;
const clickText = label => click(`//button[normalize-space(.)=${literal(label)} or @aria-label=${literal(label)}]`, 'xpath');
async function fill(selector, value) { const id = await find(selector); await wd('POST', `/element/${id}/clear`, {}); await wd('POST', `/element/${id}/value`, { text: value }); assert.equal(await wd('GET', `/element/${id}/property/value`), value); }
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
const expectText = (selector, expected, timeout) => until(async () => (await text(selector)).includes(expected), `visible ${expected}`, timeout);
async function capture(name) { await fs.writeFile(path.join(out, name + '.png'), Buffer.from(await wd('GET', '/screenshot'), 'base64')); }
async function check(name, action) { const detail = await action(); checks.push({ name, verdict: 'PASS', detail }); await save('checks.json', checks); console.log('PASS ' + name); }
async function launch() {
  const profile = path.join(out, `profile-${++launches}`);
  const environment = { ...process.env, NOTERION_CONFIG_DIR: config, NOTERION_WEBVIEW_DIR: profile, TAURI_WEBVIEW_AUTOMATION: 'true' };
  if (scale !== undefined) environment.WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = `--force-device-scale-factor=${scale}`;
  for (const key of ['NOTERION_TEST_KEY', 'NOTERION_TEST_PROVIDER', 'NOTERION_TEST_BASE_URL', 'NOTERION_DEEPSEEK_KEY']) delete environment[key];
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1'], { windowsHide: true, stdio: 'ignore', env: environment }); driver.once('error', () => {});
  await until(async () => (await command('GET', '/status')).ready, 'EdgeDriver ready');
  const value = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'webview2', 'ms:edgeOptions': { binary: exe, webviewOptions: { userDataFolder: profile } } } } }); session = value.sessionId;
  await until(() => observe('return location.origin === "http://tauri.localhost" && location.pathname === "/" && document.visibilityState === "visible";'), 'visible Tauri client');
  await until(async () => !!await selectedSpace(), 'spaces loaded');
  await save('viewport.json', await observe('return {width:innerWidth,height:innerHeight,dpr:devicePixelRatio};'));
}
async function stop() { try { if (session) await command('DELETE', `/session/${session}`); } finally { session = undefined; if (driver) { driver.kill(); driver = undefined; await pause(450); } } }
async function selectedSpace() { return observe('const menu = document.querySelector("[data-testid=space-menu]"); const s = document.querySelector("[data-testid=space-select]"); return menu?.dataset.currentSpace || s?.selectedOptions[0]?.textContent;'); }
async function openSpaceMenu() {
  if (!await observe('return !!document.querySelector("[data-testid=space-select]")?.getClientRects().length;')) await click('[data-testid="space-menu"]');
}
async function selectSpace(name, confirm = true) {
  await openSpaceMenu();
  await click(`[data-testid="space-select"]`); await click(`//select[@data-testid='space-select']/option[normalize-space(.)=${literal(name)}]`, 'xpath');
  if (!confirm) { await until(async () => (await all('[data-testid="space-confirm-switch"]')).length > 0, 'dirty switch confirmation'); return; }
  if (confirm) { await pause(180); if ((await all('[data-testid="space-confirm-switch"]')).length) await click('[data-testid="space-confirm-switch"]'); }
  await until(async () => await selectedSpace() === name, 'space ' + name);
}
async function createSpace(name) { await openSpaceMenu(); await click('[data-testid="space-create"]'); await fill('#space-name', name); await capture('space-create-dialog'); await click('[data-testid="space-save"]'); await pause(180); if ((await all('[data-testid="space-confirm-switch"]')).length) await click('[data-testid="space-confirm-switch"]'); await until(async () => await selectedSpace() === name, 'created space ' + name); }
async function renameSpace(name) { await openSpaceMenu(); await click('[data-testid="space-rename"]'); await fill('#space-name', name); await click('[data-testid="space-save"]'); await until(async () => await selectedSpace() === name, 'space renamed'); }
async function openSearch() {
  await clickText('知识图谱');
  if (!await observe('return !!document.querySelector(".search-floating")?.getClientRects().length;')) await clickText('查找知识');
}
async function localSearch(query) { await openSearch(); await clickText('片段搜索'); await fill('[data-testid="search-input"]', query); }
async function selectKnowledge(name) { await localSearch(name); await click(`//ul[contains(@class,'result-list')]//button[contains(@class,'result-item')][.//*[contains(@class,'result-name') and normalize-space(.)=${literal(name)}]]`, 'xpath'); await expectText('[data-testid="knowledge-details"]', name); }
async function createPoint(name, description, color) { await clickText('知识图谱'); await click('[data-testid="create-point"]'); await fill('#knowledge-name', name); await fill('#knowledge-description', description); await fill('#knowledge-color-code', color); await click('[data-testid="save-point"]'); await until(async () => !(await all('#knowledge-name')).length, 'point saved'); }
async function addFile(filename, title, content) { await clickText('资料库'); await clickText('添加资料'); await fill('#resource-path', filename); await fill('#resource-title', title); await clickText('保存资料'); await until(async () => !(await all('#resource-path')).length, 'resource saved'); await expectText('.library-list', title); await click(`//article[@aria-label=${literal('学习资料：' + title)}]//button[normalize-space(.)='查看资料']`, 'xpath'); await expectText('.text-preview', content); await capture(title + '-preview'); await clickText('关闭预览'); }
function targetFor(baseUrl) { const hash = createHash('sha256').update(config).update(Buffer.from([0])).update(baseUrl).digest('hex'); const target = `Noterion/OpenAI/${hash}`; credentialTargets.add(target); return target; }
async function configure(mode = 'good') { await click('[data-testid="ai-settings"]'); await click('[data-testid="provider-openai"]'); const baseUrl = fixture.baseUrl('openai', mode); targetFor(baseUrl); await fill('#model-base-url', baseUrl); await fill('#model-name', 'space-fixture'); await fill('#model-api-key', MODEL_FIXTURE_KEYS.openai); await click('[data-testid="model-activate"]'); await expectText('[data-testid="model-save-success"]', '配置已保存'); }
async function ask(marker, excluded) { await openSearch(); await click('[data-testid="ai-search-mode"]'); await clickText('回答问题'); await fill('[data-testid="ai-question"]', '怎么进入 Docker 容器终端？'); await click('[data-testid="ai-submit"]'); await expectText('[data-testid="ai-output"]', marker, 60000); assert.ok(!(await text('[data-testid="ai-output"]')).includes(excluded)); }
async function continueImport() {
  const current = await observe('return [...document.querySelectorAll("button")].some(b=>b.getClientRects().length && b.textContent.trim()==="继续导入");');
  await clickText(current ? '继续导入' : '整理新的文本');
}
async function extract(textValue = learningText) { await clickText('知识导入'); if ((await all('[data-testid="ai-adopted"]')).length) await continueImport(); await fill('[data-testid="ai-source"]', textValue); await click('[data-testid="ai-extract"]'); await until(async () => (await all('.ai-candidate-list button')).length || (await all('[data-testid="ai-duplicate"]')).length || (await all('[data-testid="ai-import-error"]')).length, 'candidates or explicit error', 60000); if ((await all('[data-testid="ai-import-error"]')).length) throw new Error(await text('[data-testid="ai-import-error"]')); }
async function reuseCandidate(name) { await click(`//nav[@aria-label='候选知识点']//button[.//span[starts-with(normalize-space(.),${literal(name)})]]`, 'xpath'); await click('select[aria-label="候选采用方式"]'); await click(`//select[@aria-label='候选采用方式']/option[@value='reuse']`, 'xpath'); await click('select[aria-label="选择已有知识点"]'); await click(`//select[@aria-label='选择已有知识点']/option[starts-with(normalize-space(.),${literal(name)}) or starts-with(normalize-space(.),${literal('建议核对：' + name)})]`, 'xpath'); }
async function adopt(reuseNames = []) { for (const name of reuseNames) await reuseCandidate(name); await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '知识已保存到本机'); }
async function fixtureFolderPicker(folder, label) {
  await save('native-picker.json', { status: 'waiting', folder, label, endpoint, session, instructions: 'Select this isolated fixture folder in the open native Windows picker.' });
  console.log(`NATIVE_PICKER ${label}: ${folder}`);
  // The real native picker is intentionally completed through computer use, not a fake DOM path.
  const clicking = click('[data-testid="folder-select"]');
  await until(() => observe(`return document.querySelector('[data-testid="folder-select"]')?.disabled === true;`), 'native folder selection entered waiting state');
  await until(() => observe(`const button = document.querySelector('[data-testid="folder-select"]'); return button && !button.disabled && !!document.querySelector('[data-testid="folder-count"], [data-testid="folder-empty"]');`), 'native selected folder inventory (computer use must finish the picker)', 180000);
  await clicking;
  await save('native-picker.json', { status: 'selected', folder, label });
}
const fileRow = relativePath => `//tr[@data-file-path=${literal(relativePath)}]`;
async function wheel(x, y, deltaY) {
  await wd('POST', '/actions', { actions: [{ type: 'wheel', id: 'acceptance-wheel', actions: [{ type: 'scroll', x: Math.round(x), y: Math.round(y), deltaX: 0, deltaY, duration: 300, origin: 'viewport' }] }] });
}
async function resetFolderScroll() {
  const viewport = await observe('return { width: innerWidth, height: innerHeight };');
  // Scroll inside the workspace's padding, outside its nested table and inputs.
  const workspace = await observe(`const box = document.querySelector('.ai-import-workspace').getBoundingClientRect(); return {left:box.left,top:box.top,bottom:box.bottom};`);
  await wheel(workspace.left + 5, (workspace.top + Math.min(viewport.height - 1, workspace.bottom)) / 2, -10000);
  await until(() => observe(`return document.querySelector('.ai-import-workspace').scrollTop === 0;`), 'workspace scrolled to top');
  const table = await observe(`const box = document.querySelector('.folder-files')?.getBoundingClientRect(); return box && { left: box.left, right: box.right, top: box.top, bottom: box.bottom };`);
  assert.ok(table && table.bottom > 0 && table.top < viewport.height, 'The folder file table is visible after scrolling the workspace');
  const x = (Math.max(0, table.left) + Math.min(viewport.width - 1, table.right)) / 2;
  const y = (Math.max(0, table.top) + Math.min(viewport.height - 1, table.bottom)) / 2;
  await wheel(x, y, -10000);
  await until(() => observe(`return document.querySelector('.folder-files').scrollTop === 0;`), 'file table scrolled to top');
}
async function processFolderFile(relativePath) {
  for (let attempt = 0; ; attempt++) {
    await resetFolderScroll();
    try { await click(`${fileRow(relativePath)}//button[normalize-space(.)='处理' or normalize-space(.)='重试']`, 'xpath'); break; }
    catch (error) { if (attempt >= 2 || !/element click intercepted/.test(error.message)) throw error; }
  }
  await until(async () => (await all('.ai-candidate-list button')).length || (await all('[data-testid="ai-duplicate"]')).length || (await text(`[data-file-path="${relativePath}"]`)).includes('失败'), 'file result: ' + relativePath, 60000);
}

try {
  fixture = await startModelFixture(); await launch();
  await check('legacy single graph migrates with identities, relationships, positions, colors and readable managed files', async () => {
    assert.equal(await selectedSpace(), '默认空间');
    const rendered = await observe(`return [...document.querySelectorAll('[data-node-id]')].map(e => ({id:e.getAttribute('data-node-id'),position:e.getAttribute('transform'),color:e.querySelector('.node-body')?.getAttribute('stroke')}));`);
    assert.equal(rendered.find(node => node.id === legacy.themeId)?.color, '#123456'); assert.equal(rendered.find(node => node.id === legacy.pointId)?.color, '#a14f32');
    assert.equal(rendered.find(node => node.id === legacy.themeId)?.position, 'translate(-160 40)'); assert.equal(rendered.find(node => node.id === legacy.pointId)?.position, 'translate(180 90)');
    await capture('00-integrated-shell');
    await selectKnowledge('共享知识'); await expectText('[data-testid="knowledge-details"]', 'Docker'); await capture('00-legacy-default');
    await clickText('资料库'); await expectText('.library-list', '旧版学习资料'); await clickText('查看资料'); await expectText('.text-preview', legacy.source); await capture('01-legacy-file'); await clickText('关闭预览'); return rendered;
  });
  await check('creates two independent spaces with the same knowledge name and different colors and files', async () => {
    await createSpace('研究甲'); await createPoint('进入容器终端', '甲空间独有说明', '#345678'); await addFile(fileA, '甲空间资料', '甲空间独有的参考正文');
    await createSpace('研究乙'); await createPoint('进入容器终端', '乙空间独有说明', '#875432'); await addFile(fileB, '乙空间资料', '乙空间独有的参考正文');
    await renameSpace('研究乙（重命名）');
    await selectKnowledge('进入容器终端'); await expectText('[data-testid="knowledge-details"]', '乙空间独有说明'); assert.ok(!(await text('[data-testid="knowledge-details"]')).includes('甲空间')); await capture('02-space-b');
    await selectSpace('研究甲'); await selectKnowledge('进入容器终端'); await expectText('[data-testid="knowledge-details"]', '甲空间独有说明'); await clickText('资料库'); assert.ok(!(await text('.library-list')).includes('乙空间')); await capture('03-space-a');
  });
  if ((await all('[data-testid="space-menu"]')).length) await check('long names, collapsed navigation and dirty switch decisions remain usable in the integrated shell', async () => {
    const originalRect = await wd('GET', '/window/rect');
    const longName = '研究甲：' + '容器与分布式系统的学习资料'.repeat(5);
    await renameSpace(longName);
    await wd('POST', '/window/rect', { width: 1000, height: 700 });
    await clickText('知识图谱'); await capture('03b-long-space-minimum');
    const bounds = await observe('const menu=document.querySelector("[data-testid=space-menu]"); const box=menu.getBoundingClientRect(); const label=menu.querySelector(".space-menu-name"); return {left:box.left,right:box.right,width:innerWidth,labelWidth:label.clientWidth,labelContentWidth:label.scrollWidth,bodyWidth:document.body.scrollWidth};');
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width, 'Space identity remains inside the sidebar');
    assert.ok(bounds.labelContentWidth > bounds.labelWidth, 'The long actual name is ellipsized in the sidebar');
    assert.ok(bounds.bodyWidth <= bounds.width + 1, 'The long name does not create a horizontal page scrollbar');
    await clickText('收起导航'); await openSpaceMenu(); await capture('03c-collapsed-space-dialog');
    const dialogBounds = await observe('const box=document.querySelector("dialog[open]").getBoundingClientRect(); return {left:box.left,right:box.right,width:innerWidth,selected:document.querySelector("[data-testid=space-select]").selectedOptions[0].textContent};');
    assert.equal(dialogBounds.selected, longName);
    assert.ok(dialogBounds.left >= 0 && dialogBounds.right <= dialogBounds.width, 'Space management remains visible from the collapsed sidebar');
    await clickText('关闭弹窗'); await renameSpace('研究甲'); await clickText('展开导航');
    await wd('POST', '/window/rect', originalRect);
    await clickText('知识导入'); const pendingText = '尚未保存的学习笔记：这段输入需要在取消切换后保留。';
    await fill('[data-testid="ai-source"]', pendingText);
    await selectSpace('研究乙（重命名）', false); await capture('03d-dirty-switch-confirm');
    await clickText('继续当前工作'); assert.equal(await selectedSpace(), '研究甲');
    assert.equal(await observe('return document.querySelector("[data-testid=ai-source]").value;'), pendingText);
    await selectSpace('研究乙（重命名）');
    assert.equal(await observe('return document.querySelector("[data-testid=ai-source]").value;'), '');
    await capture('03e-confirmed-switch-cleared'); await selectSpace('研究甲');
    return { longName, bounds, dialogBounds, cancelPreservedInput: true, confirmClearedInput: true };
  });
  await check('model configuration is application-wide while personal AI context remains in the selected space', async () => {
    await configure(); await ask('甲空间独有说明', '乙空间独有说明'); await capture('04-ai-space-a'); await selectSpace('研究乙（重命名）'); await ask('乙空间独有说明', '甲空间独有说明'); await capture('05-ai-space-b');
  });
  await check('the same input is adoptable once in each space and duplicate retries preserve saved knowledge', async () => {
    await extract(); await adopt(['进入容器终端']); await capture('06-paste-adopted-b');
    await extract(); await expectText('[data-testid="ai-duplicate"]', '已采用'); await capture('06b-duplicate-preview'); await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '这份输入已经采用');
    await selectSpace('研究甲'); await extract(); assert.equal((await all('[data-testid="ai-duplicate"]')).length, 0); await adopt(['进入容器终端']); await capture('07-paste-adopted-a');
  });
  await check('switching away from active extraction cancels it and clears drafts and pending input', async () => {
    await configure('slow'); await clickText('知识导入'); await continueImport(); await fill('[data-testid="ai-source"]', learningText + '\n未采用的任务。'); await click('[data-testid="ai-extract"]'); await until(async () => (await all('[data-testid="ai-import-cancel"]')).length, 'running extraction');
    await capture('08-active-extraction'); await selectSpace('研究乙（重命名）'); await pause(500); await clickText('知识导入'); assert.equal((await all('.ai-candidate-list button')).length, 0); assert.equal(await observe('return document.querySelector("[data-testid=ai-source]")?.value;'), ''); await capture('09-switch-cleared'); await configure();
  });
  if (scenario === 'full') {
    await check('native folder selection scans every nested Markdown/TXT path and keeps individual outcomes', async () => {
      await createSpace('文件夹导入'); await clickText('知识导入'); await fixtureFolderPicker(notes, 'nested-mixed-case'); await expectText('[data-testid="folder-count"]', '6 份文件');
      const paths = await observe('return [...document.querySelectorAll("[data-file-path]")].map(e=>e.getAttribute("data-file-path"));'); assert.deepEqual(paths.sort(), ['bad.md', 'empty.txt', 'large.TXT', 'nested/notes.TXT', 'other/notes.MD', 'root.md'].sort()); await capture('10-folder-inventory');
      await processFolderFile('root.md'); await until(async () => (await all('.ai-candidate-list button')).length === 3, 'folder candidate review', 60000);
      const editedDescription = '人工核对修正：在容器中打开终端前，先确认容器处于运行状态。';
      await click(`//nav[@aria-label='候选知识点']//button[.//span[starts-with(normalize-space(.),'进入容器终端')]]`, 'xpath');
      await fill('textarea[aria-label="候选知识点描述"]', editedDescription); await capture('11-folder-review-edited'); await adopt();
      await selectKnowledge('进入容器终端'); await expectText('[data-testid="knowledge-details"]', editedDescription); await capture('11b-folder-edited-details');
      await clickText('资料库'); await click(`//article[@aria-label='学习资料：root.md']//button[normalize-space(.)='查看资料']`, 'xpath');
      await expectText('.text-preview', learningText + '\n第一份笔记。'); assert.ok(!(await text('.text-preview')).includes(editedDescription), 'Candidate edits do not overwrite the source file'); await capture('11c-folder-original-source'); await clickText('关闭预览'); await clickText('知识导入');
      for (const relativePath of ['nested/notes.TXT', 'other/notes.MD']) { await processFolderFile(relativePath); await until(async () => (await all('.ai-candidate-list button')).length === 3, 'next folder review', 60000); await adopt(['Docker', 'Linux', '进入容器终端']); }
      for (const relativePath of ['bad.md', 'empty.txt', 'large.TXT']) { await processFolderFile(relativePath); await expectText(`[data-file-path="${relativePath}"]`, '失败'); }
      await expectText('[data-testid="folder-progress"]', '已保存 3'); await expectText('[data-testid="folder-progress"]', '失败 3');
      await capture('12-folder-results'); await clickText('资料库'); await expectText('.library-list', 'nested/notes.TXT'); await expectText('.library-list', 'other/notes.MD'); await expectText('.library-list', 'root.md');
      return { paths, editedKnowledgeDescription: editedDescription, originalSourceOpened: true };
    });
    await check('empty-folder and cancelled batch states stay actionable and retain saved work', async () => {
      await clickText('知识导入'); await fixtureFolderPicker(emptyFolder, 'empty'); await expectText('[data-testid="folder-empty"]', '未找到'); await capture('13-folder-empty');
      await fixtureFolderPicker(notes, 'cancel-retry'); await click('[data-testid="folder-cancel"]'); await expectText('[data-testid="folder-progress"]', '已取消'); await capture('14-folder-cancelled'); await processFolderFile('root.md'); await expectText('[data-testid="ai-duplicate"]', '已采用'); await capture('15-folder-retry');
    });
  }
  await check('recent space, all names, independent knowledge, colors and resources survive desktop restart', async () => {
    await selectSpace('研究乙（重命名）'); await stop(); await launch(); assert.equal(await selectedSpace(), '研究乙（重命名）'); await selectKnowledge('进入容器终端'); await expectText('[data-testid="knowledge-details"]', '乙空间独有说明');
    await clickText('资料库'); await expectText('.library-list', '乙空间资料'); assert.ok(!(await text('.library-list')).includes('甲空间')); await selectSpace('研究甲'); await selectKnowledge('进入容器终端'); await expectText('[data-testid="knowledge-details"]', '甲空间独有说明'); await capture('16-restarted-space-a');
    await selectSpace('默认空间'); await selectKnowledge('共享知识'); await expectText('[data-testid="knowledge-details"]', '默认空间的个人理解'); await capture('17-restarted-legacy');
  });
  assert.equal(fixture.requests.flatMap(request => request.violations).length, 0); passed = true;
} catch (error) { await save('failure.json', { message: error.message }); console.error(error.message); if (session) try { await capture('failure'); } catch {} }
finally {
  let desktopCleanup = true, credentialCleanup = true;
  try { await stop(); } catch { desktopCleanup = false; }
  if (fixture) {
    await save('fixture-requests.json', fixture.requests);
    const countBy = field => Object.fromEntries([...new Set(fixture.requests.map(request => String(request[field])))].sort().map(value => [value, fixture.requests.filter(request => String(request[field]) === value).length]));
    await save('fixture-summary.json', {
      requestCount: fixture.requests.length,
      byProvider: countBy('provider'), byMode: countBy('mode'), byStage: countBy('stage'), byStatus: countBy('status'),
      completed: fixture.requests.filter(request => request.finished).length,
      aborted: fixture.requests.filter(request => request.aborted).length,
      contractViolationCount: fixture.requests.reduce((sum, request) => sum + request.violations.length, 0),
      coverage: 'Local deterministic HTTP/SSE fixtures; no live model API calls.',
    });
    await fixture.close();
  }
  for (const target of credentialTargets) { const result = spawnSync('cmdkey.exe', ['/delete:' + target], { windowsHide: true, stdio: 'ignore' }); if (result.status !== 0) credentialCleanup = false; }
  await save('checks.json', checks);
  await save('result.json', { run: args.run, scenario, requestedScale: scale ?? null, passed: passed && desktopCleanup && credentialCleanup, assertionCount: checks.length, executable: exe, executableSha256, driverSha256, launches, desktopCleanup, credentialCleanup, folderUiCoverage: scenario === 'full', liveApiCoverage: false, providerTesting: 'Deterministic local HTTP/SSE fixture through actual Windows Tauri; no paid model key or live provider call.' });
  process.exitCode = passed && desktopCleanup && credentialCleanup ? 0 : 1;
}
