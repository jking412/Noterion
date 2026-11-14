// Real Windows Tauri/WebView2 acceptance. Mutations use visible WebDriver controls.
// execute/sync observes only; all data and exact synthetic credential targets are isolated.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRecoveryFixture, RECOVERY_KEYS, RECOVERY_TEXT as FILE_TEXT } from './import-recovery-fixture.mjs';

// HTML textarea values use LF even when keystrokes contain CRLF.
const RECOVERY_TEXT = FILE_TEXT.replaceAll('\r\n', '\n');

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), repo = path.dirname(app);
const args = Object.fromEntries(process.argv.slice(2).map(argument => { const index = argument.indexOf('='); assert.ok(index > 2, 'Use --name=value'); return [argument.slice(2, index), argument.slice(index + 1)]; }));
assert.ok(Object.keys(args).every(key => ['run', 'exe', 'driver', 'scenario'].includes(key)));
assert.match(args.run ?? '', /^issue-34-[a-z0-9-]+$/); assert.equal(process.platform, 'win32');
const scenario = args.scenario ?? 'recovery'; assert.ok(['recovery', 'source-invalidation', 'success-capture'].includes(scenario));
const out = path.join(repo, '.scratch/import-recovery/runs', args.run), config = path.join(out, 'config');
const exe = path.resolve(args.exe ?? path.join(app, 'src-tauri/target/x86_64-pc-windows-msvc/debug/noterion.exe'));
const driverExe = path.resolve(args.driver ?? path.join(repo, '.scratch/import-recovery/.tools/webdriver/msedgedriver.exe'));
await fs.access(exe); await fs.access(driverExe); await fs.mkdir(path.dirname(out), { recursive: true }); await fs.mkdir(out); await fs.mkdir(config);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const save = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const hash = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');
const executableSha256 = await hash(exe), driverSha256 = await hash(driverExe);
const probe = net.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const endpoint = `http://127.0.0.1:${port}`, elementKey = 'element-6066-11e4-a52e-4f735466cecf';
const providers = ['deepseek', 'openai', 'anthropic'], checks = [], credentialTargets = new Set();
let session, driver, fixture, launches = 0, fileSequence = 0, passed = false;

async function command(method, route, body) {
  const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const payload = await response.json(); if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${route}: ${payload.value?.error ?? response.status}`); return payload.value;
}
const wd = (method, route, body) => command(method, `/session/${session}${route}`, body);
async function until(operation, description, timeout = 30000) { const deadline = Date.now() + timeout; let last; do { try { const result = await operation(); if (result) return result; } catch (error) { last = error.message; } await pause(100); } while (Date.now() < deadline); throw new Error(`Timed out: ${description}${last ? ` (${last})` : ''}`); }
const observe = (script, values = []) => wd('POST', '/execute/sync', { script, args: values });
const find = async (selector, using = 'css selector') => (await wd('POST', '/element', { using, value: selector }))[elementKey];
const all = selector => wd('POST', '/elements', { using: 'css selector', value: selector });
const enabled = async selector => wd('GET', `/element/${await find(selector)}/enabled`);
const value = selector => observe('return document.querySelector(arguments[0])?.value;', [selector]);
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
async function click(selector, using) { const id = await until(async () => { const id = await find(selector, using); return await wd('GET', `/element/${id}/displayed`) && await wd('GET', `/element/${id}/enabled`) && id; }, `enabled ${selector}`); await wd('POST', `/element/${id}/click`, {}); }
const literal = value => `'${value.replaceAll("'", '')}'`;
const clickText = label => click(`//button[normalize-space(.)=${literal(label)} or @aria-label=${literal(label)}]`, 'xpath');
async function fill(selector, expected) {
  // EdgeDriver 136 rejects non-BMP keystrokes. Use the real file input to load
  // Unicode notes, without injecting DOM values or invoking business commands.
  if (selector === '[data-testid="ai-source"]' && (/[^\u0000-\uFFFF]/u.test(expected) || expected.includes('\t'))) {
    const filename = path.join(out, `source-${++fileSequence}.md`); await fs.writeFile(filename, expected, { flag: 'wx' });
    const id = await find('[aria-label="选择学习文本"]'); await wd('POST', `/element/${id}/value`, { text: filename }); await until(async () => await value(selector) === expected, 'Unicode file input read'); return;
  }
  const id = await find(selector); await wd('POST', `/element/${id}/clear`, {}); await wd('POST', `/element/${id}/value`, { text: expected }); assert.equal(await value(selector), expected);
}
const expectText = (selector, expected) => until(async () => (await text(selector)).includes(expected), `visible ${expected}`);
async function capture(name) { const source = await wd('GET', '/source'); for (const secret of Object.values(RECOVERY_KEYS)) assert.ok(!source.includes(secret)); await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(await wd('GET', '/screenshot'), 'base64')); }
async function scrollWorkspaceTop() {
  const origin = await observe('return { x: Math.floor(innerWidth * .75), y: Math.floor(innerHeight * .5) };');
  await wd('POST', '/actions', { actions: [{ type: 'wheel', id: 'workspace-scroll', actions: [{ type: 'scroll', origin: 'viewport', ...origin, deltaX: 0, deltaY: -10000, duration: 300 }] }] });
  await pause(350);
}
async function check(name, action) { const detail = await action(); checks.push({ name, verdict: 'PASS', detail }); await save('checks.json', checks); console.log(`PASS ${name}`); }
async function cleanCopy() { const source = await text('[aria-label="AI 知识整理"]'); assert.ok(!/evidence|warnings|sourceRepair|JSON|UTF-16|校验|测试覆盖|验收|实网|开发者/.test(source), 'Import UI has no internal diagnostics or validation commentary'); }
async function launch() {
  const profile = path.join(out, `profile-${++launches}`), environment = { ...process.env, NOTERION_CONFIG_DIR: config, NOTERION_WEBVIEW_DIR: profile, TAURI_WEBVIEW_AUTOMATION: 'true' };
  for (const name of ['NOTERION_TEST_KEY', 'NOTERION_TEST_PROVIDER', 'NOTERION_TEST_BASE_URL', 'NOTERION_DEEPSEEK_KEY']) delete environment[name];
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1'], { windowsHide: true, stdio: 'ignore', env: environment }); driver.once('error', () => {});
  await until(async () => (await command('GET', '/status')).ready, 'EdgeDriver ready');
  const result = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'webview2', 'ms:edgeOptions': { binary: exe, webviewOptions: { userDataFolder: profile } } } } }); session = result.sessionId;
  await until(() => observe('return location.href === "http://tauri.localhost/" && document.visibilityState === "visible";'), 'visible real Windows desktop'); await until(() => enabled('[data-testid="create-point"]'), 'local storage ready');
}
async function stop() { try { if (session) await command('DELETE', `/session/${session}`); } finally { session = undefined; if (driver) { driver.kill(); await pause(500); driver = undefined; } } }
async function configure(provider) {
  if (!(await all('[data-testid="model-settings-page"]')).length) await click('[data-testid="ai-settings"]');
  await until(async () => (await all('#model-base-url')).length, 'settings loaded'); await click(`[data-testid="provider-${provider}"]`);
  const url = fixture.baseUrl(provider), digest = createHash('sha256').update(config).update(Buffer.from([0])).update(url).digest('hex');
  credentialTargets.add(`Noterion/${{ deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic' }[provider]}/${digest}`);
  await fill('#model-base-url', url); await fill('#model-name', `${provider}/recovery:v34`); await fill('#model-api-key', RECOVERY_KEYS[provider]); await click('[data-testid="model-activate"]'); await expectText('[data-testid="model-save-success"]', '配置已保存');
}
async function openImport() { await clickText('知识导入'); if ((await all('[data-testid="ai-adopted"]')).length) await clickText('整理新的文本'); }
async function extract(source) { await openImport(); await fill('[data-testid="ai-source"]', source); await click('[data-testid="ai-extract"]'); }
async function candidates(expected = 3) { await until(async () => (await all('.ai-candidate-list button')).length || (await all('[data-testid="ai-import-error"]')).length, 'candidates or real failure', 60000); if ((await all('[data-testid="ai-import-error"]')).length) throw new Error(await text('[data-testid="ai-import-error"]')); if (expected !== null) assert.equal((await all('.ai-candidate-list button')).length, expected); }
async function verifyEvidence(source) {
  const buttons = await all('.ai-candidate-list button'), names = [];
  for (const item of buttons) { await wd('POST', `/element/${item[elementKey]}/click`, {}); names.push(await value('[aria-label="候选知识点名称"]')); const quotes = await observe('return [...document.querySelectorAll(".ai-evidence blockquote p")].map(element => element.textContent);'); assert.ok(quotes.length); for (const quote of quotes) assert.ok(source.includes(quote), 'Every displayed quote is exact original source'); }
  return names;
}
async function noPartialDraft(source) {
  assert.equal((await all('.ai-candidate-list button')).length, 0, 'Declared omissions must not publish a partial candidate preview');
  assert.equal((await all('[data-testid="ai-adopt"]')).length, 0, 'Declared omissions must not expose adoption');
  assert.equal(await value('[data-testid="ai-source"]'), source);
  assert.ok(!(await text('[aria-label="AI 知识整理"]')).includes('Docker 部分尚未处理。'), 'Model omission warnings stay out of product UI');
}
async function selectKnowledge(name) { await clickText('知识图谱'); await clickText('片段搜索'); await fill('[data-testid="search-input"]', name); await click(`//ul[contains(@class,'result-list')]//button[contains(@class,'result-item')][.//*[contains(@class,'result-name') and normalize-space(.)=${literal(name)}]]`, 'xpath'); await expectText('[data-testid="knowledge-details"]', name); }
async function addResource() { const filename = path.join(out, 'learning.md'); await fs.writeFile(filename, RECOVERY_TEXT, { flag: 'wx' }); await clickText('资料库'); await clickText('添加资料'); await fill('[aria-label="资料文件路径"]', filename); await fill('[aria-label="资料名称"]', '恢复来源资料'); await clickText('保存资料'); await until(async () => !(await all('.resource-add-form')).length, 'source resource saved'); }

const credentialHelper = path.join(out, 'delete-synthetic-credential.ps1');
await fs.writeFile(credentialHelper, `param([string]$Target)\n$ErrorActionPreference='Stop'\nAdd-Type -TypeDefinition @'\nusing System;using System.Runtime.InteropServices;public static class SyntheticCredential34 { [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)]public static extern bool Delete(string target,uint type,uint flags); }\n'@\nif(-not [SyntheticCredential34]::Delete($Target,1,0)){if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168){throw 'Synthetic credential deletion failed'}}\n`);

try {
  fixture = await startRecoveryFixture(); await launch(); await addResource();
  if (scenario === 'success-capture') {
    await configure('openai'); fixture.mode('mixed');
    await check('recovered candidates show the saved knowledge card after explicit adoption', async () => {
      await extract(`${RECOVERY_TEXT}\n保存确认`); await candidates(); await verifyEvidence(RECOVERY_TEXT + '\n保存确认');
      await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '知识已保存到本机'); await scrollWorkspaceTop();
      await until(() => observe('const box = document.querySelector("[data-testid=ai-adopted]")?.getBoundingClientRect(); return box && box.top >= 0 && box.top < innerHeight && box.bottom > 0;'), 'saved card in viewport');
      await cleanCopy(); await capture('saved-card'); return { savedCardInViewport: true, explicitAdoption: true };
    });
  } else if (scenario === 'source-invalidation') {
    await configure('openai'); fixture.mode('good');
    await check('editing then restoring original source keeps the old draft invalid', async () => { const source = `${RECOVERY_TEXT.replace('😀', '').replace('\t', ' ')}\n修改后恢复检查`; await extract(source); await candidates(); await fill('[data-testid="ai-source"]', source + '\n编辑'); assert.equal(await enabled('[data-testid="ai-adopt"]'), false); await fill('[data-testid="ai-source"]', source); await capture('source-restored'); assert.equal(await enabled('[data-testid="ai-adopt"]'), false, 'An edited source must not reactivate an old draft by reverting to the same text'); });
  } else {
  for (const provider of providers) {
    await configure(provider);
    await check(`${provider}: missing, excess and normalized evidence recover into preview and explicit adoption`, async () => {
      fixture.mode('mixed'); const source = `${RECOVERY_TEXT}\n连接 ${provider}`, before = fixture.requests.length;
      await openImport(); await capture(`01-empty-${provider}`); await fill('[data-testid="ai-source"]', source);
      await click('.ai-source-picker summary'); await click('.ai-source-picker label'); await click('[data-testid="ai-extract"]');
      await candidates(); await verifyEvidence(source); await cleanCopy(); assert.ok(fixture.requests.slice(before).some(item => item.sourceIdRepair)); assert.ok(fixture.requests.length - before <= 3);
      await capture(`02-preview-${provider}`); await fill('[aria-label="候选知识点描述"]', `已核对 ${provider}`); await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '知识已保存到本机'); await cleanCopy(); await capture(`03-adopted-${provider}`);
      return { candidates: 3, exactQuotes: true, targetedSourceRepair: true, programSourceIds: true, explicitAdoption: true, sourceAssociated: true, calls: fixture.requests.length - before };
    });
  }
  for (const provider of providers) {
    await configure(provider);
    await check(`${provider}: declared omissions retry the complete source before preview and adoption`, async () => {
      fixture.mode('warning-recoverable'); const source = `${RECOVERY_TEXT}\n补全 ${provider}`, before = fixture.requests.length;
      await openImport(); await fill('[data-testid="ai-source"]', source);
      if (!await wd('GET', `/element/${await find('.ai-source-picker input[type="checkbox"]')}/selected`)) {
        if (!await observe('return document.querySelector(".ai-source-picker").open;')) await click('.ai-source-picker summary');
        await click('.ai-source-picker label');
      }
      await click('[data-testid="ai-extract"]'); await until(() => fixture.requests.slice(before).some(item => item.warningAttempt === 2 && item.waitingForRelease), 'complete retry after declared omission');
      await noPartialDraft(source); await expectText('[aria-label="AI 知识整理"]', '正在整理知识'); await cleanCopy(); await capture(`12-warning-loading-${provider}`);
      fixture.releaseWarningRetry(); await candidates(); assert.deepEqual((await verifyEvidence(source)).sort(), ['Docker', 'Linux', '进入容器终端'].sort());
      const calls = fixture.requests.slice(before); assert.equal(calls.length, 2); assert.equal(calls[0].warningResponse, true); assert.equal(calls[0].returnedCandidates, 1); assert.equal(calls[1].warningResponse, false); assert.equal(calls[1].fullInputRetry, true); assert.ok(calls.every(item => !item.repair));
      await cleanCopy(); await capture(`13-warning-preview-${provider}`); await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '知识已保存到本机'); await scrollWorkspaceTop(); await cleanCopy(); await capture(`14-warning-saved-${provider}`);
      return { partialPreviewAbsentDuringRetry: true, completeOriginalRetried: true, candidates: 3, exactQuotes: true, explicitAdoption: true, calls: 2 };
    });
    await check(`${provider}: persistent omissions fail without preview or completed cache and same-input retry requests again`, async () => {
      fixture.mode('warning-persistent'); const source = `${RECOVERY_TEXT}\n补全重试 ${provider}`, before = fixture.requests.length;
      await extract(source); await until(() => fixture.requests.slice(before).some(item => item.warningAttempt === 2 && item.waitingForRelease), 'bounded retry before repeated omission'); await noPartialDraft(source);
      fixture.releaseWarningRetry(); await expectText('[data-testid="ai-import-error"]', '暂时无法整理这段内容，请重试。'); await noPartialDraft(source); await cleanCopy(); await capture(`15-warning-failed-${provider}`);
      const calls = fixture.requests.slice(before); assert.equal(calls.length, 2); assert.ok(calls.every(item => item.warningResponse && !item.repair)); assert.equal(calls[1].fullInputRetry, true);
      fixture.mode('good'); const retryBefore = fixture.requests.length; await click('[data-testid="ai-extract"]'); await candidates(); assert.equal(fixture.requests.length - retryBefore, 1, 'A failed omission cannot be reused as a completed cached segment'); assert.deepEqual((await verifyEvidence(source)).sort(), ['Docker', 'Linux', '进入容器终端'].sort()); await cleanCopy();
      return { callsBeforeFailure: 2, partialPreviewAbsent: true, adoptionAbsent: true, inputRetained: true, sameInputRetryCalls: 1, retryCandidates: 3 };
    });
  }
  await check('multiple source chunks retain all candidates after local source recovery', async () => { fixture.mode('mixed'); const source = Array.from({ length: 180 }, () => RECOVERY_TEXT).join('\n') + '\n多段检查', before = fixture.requests.length; await extract(source); await candidates(null); const calls = fixture.requests.slice(before), segments = calls.filter(item => !item.repair).length, count = (await all('.ai-candidate-list button')).length; assert.ok(segments > 1); assert.equal(count, segments * 3); assert.ok(calls.length <= segments * 3); await verifyEvidence(source); await cleanCopy(); await capture('04-multiple-chunks'); return { segments, candidates: count, exactQuotes: true }; });
  await check('adopted knowledge and source associations remain readable after restart', async () => { await stop(); await launch(); await selectKnowledge('Linux'); await expectText('[data-testid="knowledge-details"]', '恢复来源资料'); await clickText('资料库'); await expectText('.library-list', '恢复来源资料'); await capture('04-restarted'); return { restarted: true, associatedSource: true }; });
  await configure('openai');
  await check('editing then restoring original source prevents stale adoption', async () => { fixture.mode('good'); const source = `${RECOVERY_TEXT.replace('😀', '').replace('\t', ' ')}\n修改检查`; await extract(source); await candidates(); await fill('[data-testid="ai-source"]', '已修改的原文'); assert.equal(await enabled('[data-testid="ai-adopt"]'), false); await fill('[data-testid="ai-source"]', source); assert.equal(await enabled('[data-testid="ai-adopt"]'), false); await expectText('[aria-label="AI 知识整理"]', '原文已修改'); await capture('05-edited-source'); });
  for (const provider of ['openai', 'anthropic']) {
    await configure(provider);
    await check(`${provider}: unrecoverable evidence stays bounded, retains input and can retry`, async () => { fixture.mode('unrecoverable'); const source = `${RECOVERY_TEXT}\n失败 ${provider}`, before = fixture.requests.length; await extract(source); await until(async () => (await all('[data-testid="ai-import-error"]')).length, 'unrecoverable actionable message', 60000); await cleanCopy(); assert.equal(await value('[data-testid="ai-source"]'), source); assert.ok(fixture.requests.length - before <= 3); assert.equal((await all('.ai-candidate-list button')).length, 0); await capture(`06-failed-${provider}`); fixture.mode('good'); await click('[data-testid="ai-extract"]'); await candidates(); return { bounded: true, inputRetained: true, retrySucceeded: true }; });
    await check(`${provider}: authentication errors are not retried as content repair`, async () => { fixture.mode('unauthorized'); const source = `${RECOVERY_TEXT}\n鉴权 ${provider}`, before = fixture.requests.length; await extract(source); await expectText('[data-testid="ai-import-error"]', '鉴权'); assert.equal(fixture.requests.length - before, 1); assert.equal(await value('[data-testid="ai-source"]'), source); await cleanCopy(); });
    await check(`${provider}: cancel aborts native slow stream and same-input retry succeeds`, async () => { fixture.mode('slow'); const source = `${RECOVERY_TEXT}\n取消 ${provider}`, before = fixture.requests.length; await extract(source); await until(() => fixture.requests.length > before, 'slow native request'); await cleanCopy(); await capture(`07-loading-${provider}`); await click('[data-testid="ai-import-cancel"]'); await expectText('[aria-label="AI 知识整理"]', '已取消'); assert.equal(await value('[data-testid="ai-source"]'), source); await until(() => fixture.requests.slice(before).some(item => item.aborted), 'native connection aborted'); await capture(`08-cancelled-${provider}`); fixture.mode('good'); await click('[data-testid="ai-extract"]'); await candidates(); return { nativeStreamAborted: true, inputRetained: true, retrySucceeded: true }; });
  }
  await check('structure repair and source repair have separate bounded purposes', async () => { fixture.mode('structure'); const before = fixture.requests.length; await extract(`${RECOVERY_TEXT}\n结构修正`); await candidates(); assert.ok(fixture.requests.slice(before).some(item => item.structureRepair)); assert.ok(fixture.requests.slice(before).some(item => item.sourceIdRepair)); assert.equal(fixture.requests.length - before, 3); await cleanCopy(); return { initialMalformed: true, structureRepairThenSourceRepair: true, calls: 3 }; });
  await check('directory switch cancels pending work and prevents stale adoption after switching back', async () => {
    fixture.mode('slow'); const before = fixture.requests.length;
    await extract(`${RECOVERY_TEXT}\n切换目录检查`); await until(() => fixture.requests.length > before, 'request before context switch');
    await click('[aria-label="数据目录设置"]'); const original = await value('#data-directory');
    const isolated = path.join(out, 'switched-data'); await fs.mkdir(isolated);
    await fill('#data-directory', isolated); await capture('09-directory-dialog'); await clickText('创建新数据目录');
    await until(async () => !(await all('#data-directory')).length, 'new isolated directory opened');
    await until(() => fixture.requests.slice(before).some(item => item.aborted), 'switch aborted native request');
    assert.equal(await value('[data-testid="ai-source"]'), ''); assert.equal((await all('.ai-candidate-list button')).length, 0); assert.equal((await all('[data-testid="ai-adopt"]')).length, 0);
    await cleanCopy(); await capture('10-new-directory');
    await click('[aria-label="数据目录设置"]'); await fill('#data-directory', original); await clickText('打开已有数据目录');
    await until(async () => !(await all('#data-directory')).length, 'original directory reopened');
    assert.equal(await value('[data-testid="ai-source"]'), ''); assert.equal((await all('[data-testid="ai-adopt"]')).length, 0);
    await cleanCopy(); await capture('11-returned-directory'); await selectKnowledge('Linux'); await expectText('[data-testid="knowledge-details"]', '恢复来源资料');
    return { switched: true, cancelledNativeRequest: true, staleAdoptionAbsent: true, existingKnowledgePreserved: true };
  });
  }
  assert.equal(fixture.requests.flatMap(item => item.violations).length, 0); passed = true;
} catch (error) { await save('failure.json', { message: error.message }); console.error(error.message); if (session) try { await capture('failure'); } catch {} }
finally {
  let desktopCleanup = true, credentialCleanup = true;
  try { await stop(); } catch { desktopCleanup = false; }
  if (fixture) { await save('fixture-requests.json', fixture.requests); await fixture.close(); }
  for (const target of credentialTargets) { const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', credentialHelper, '-Target', target], { windowsHide: true, stdio: 'ignore' }); if (result.status !== 0) credentialCleanup = false; }
  await save('checks.json', checks); await save('result.json', { run: args.run, scenario, passed: passed && desktopCleanup && credentialCleanup, assertionCount: checks.length, executableSha256, driverSha256, launches, desktopCleanup, credentialCleanup, fixtureRequests: fixture?.requests.length ?? 0, liveApiCoverage: { deepseek: false, openai: false, anthropic: false }, providerTesting: 'Deterministic loopback HTTP/SSE fixtures through actual Windows Tauri client. No official live API calls.' });
  process.exitCode = passed && desktopCleanup && credentialCleanup ? 0 : 1;
}
