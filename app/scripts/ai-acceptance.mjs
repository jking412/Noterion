// Real Windows Tauri/WebView2 acceptance. Business changes use visible controls.
// Credentials are read from stdin/environment and never included in evidence.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTestCredential } from './test-credential.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.dirname(app);
const args = Object.fromEntries(process.argv.slice(2).map(item => {
  const at = item.indexOf('=');
  assert.ok(at > 2, 'Arguments use --name=value');
  return [item.slice(2, at), item.slice(at + 1)];
}));
const run = args.run;
assert.match(run ?? '', /^issue-22-[a-z0-9-]+$/);
const scenario = args.scenario ?? 'smoke';
const out = path.join(app, 'validation/runs', run);
const config = path.join(out, 'config');
const exe = path.resolve(args.exe ?? path.join(app, 'dist-desktop/noterion.exe'));
let activeExe = exe;
const driverExe = path.join(repo, '.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe');
const port = Number(args.port ?? 33231);
const endpoint = `http://127.0.0.1:${port}`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
let driver, session, passed = false;
let key = await readTestCredential(args);
await fs.mkdir(path.dirname(out), { recursive: true });
await fs.mkdir(out); // A run never overwrites earlier evidence.
await fs.mkdir(config);
const save = (name, data) => fs.writeFile(path.join(out, name), JSON.stringify(data, null, 2));
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
async function command(method, route, body) {
  const response = await fetch(endpoint + route, {
    method, headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const payload = await response.json();
  // Never record command bodies: input events may contain an API credential.
  if (!response.ok || payload.value?.error) {
    throw new Error(`WebDriver ${method} ${route}: ${payload.value?.error ?? response.status}`);
  }
  return payload.value;
}
const wd = (method, route, body) => command(method, `/session/${session}${route}`, body);
async function until(operation, description, timeout = 20000) {
  const deadline = Date.now() + timeout;
  let last;
  do {
    try { const result = await operation(); if (result) return result; }
    catch (error) { last = error.message; }
    await pause(150);
  } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}${last ? ` (${last})` : ''}`);
}
async function find(selector, using = 'css selector') {
  return (await wd('POST', '/element', { using, value: selector }))[elementKey];
}
async function all(selector) {
  return wd('POST', '/elements', { using: 'css selector', value: selector });
}
async function click(selector, using) {
  const id = await until(async () => {
    const found = await find(selector, using);
    return await wd('GET', `/element/${found}/displayed`)
      && await wd('GET', `/element/${found}/enabled`) && found;
  }, `visible action ${selector}`);
  await wd('POST', `/element/${id}/click`, {});
}
const literal = value => `'${value.replaceAll("'", '')}'`;
const clickText = label => click(`//button[normalize-space(.)=${literal(label)} or @aria-label=${literal(label)}]`, 'xpath');
async function fill(selector, value) {
  const id = await find(selector);
  await wd('POST', `/element/${id}/clear`, {});
  await wd('POST', `/element/${id}/value`, { text: value });
  const accepted = await wd('GET', `/element/${id}/property/value`);
  assert.ok(accepted === value, `Visible control did not accept the expected input: ${selector}`);
}
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
const observe = (script, args = []) => wd('POST', '/execute/sync', { script, args });
async function expectText(selector, value, timeout) {
  await until(async () => (await text(selector)).includes(value), `visible ${value}`, timeout);
}
async function capture(name) {
  const png = await wd('GET', '/screenshot');
  await fs.writeFile(path.join(out, name + '.png'), Buffer.from(png, 'base64'));
  const source = await wd('GET', '/source');
  assert.ok(!key || !source.includes(key), 'Credential must not appear in captured markup');
  await fs.writeFile(path.join(out, name + '.html'), source);
}
async function check(name, action) {
  const detail = await action();
  checks.push({ name, verdict: 'PASS', detail });
  await save('checks.json', checks);
  console.log(`PASS ${name}`);
}
async function launch() {
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1'], {
    windowsHide: true, stdio: 'ignore',
    env: { ...process.env, NOTERION_CONFIG_DIR: config,
      NOTERION_WEBVIEW_DIR: path.join(out, 'profile'), TAURI_WEBVIEW_AUTOMATION: 'true' },
  });
  await until(async () => (await command('GET', '/status')).ready, 'driver ready');
  const result = await command('POST', '/session', { capabilities: { alwaysMatch: {
    browserName: 'webview2', 'ms:edgeOptions': { binary: activeExe,
      webviewOptions: { userDataFolder: path.join(out, 'profile') } },
  } } });
  session = result.sessionId;
  await until(async () => await observe('return location.href === "http://tauri.localhost/" && document.visibilityState === "visible";'), 'visible embedded app');
  await until(async () => {
    const id = await find('[data-testid="create-point"]');
    return wd('GET', `/element/${id}/enabled`);
  }, 'formal data loaded');
}
async function stop() {
  if (session) { await command('DELETE', `/session/${session}`); session = undefined; }
  if (driver) { driver.kill(); await pause(500); driver = undefined; }
}
async function settings(url, credential, validate = false) {
  await click('[data-testid="ai-settings"]');
  await until(async () => (await all('.ai-config-status')).length > 0, 'native connection settings finish loading');
  if (url && await observe('return document.querySelector("#deepseek-url").value;') !== url) {
    const remove = await find("//button[normalize-space(.)='移除密钥']", 'xpath');
    if (await wd('GET', `/element/${remove}/enabled`)) {
      await wd('POST', `/element/${remove}/click`, {});
      await expectText('dialog', '已移除密钥');
    }
  }
  if (url) await fill('#deepseek-url', url);
  if (credential) await fill('#deepseek-key', credential);
  await click('[data-testid="ai-settings-save"]');
  await expectText('dialog', '配置已保存');
  assert.equal(await observe('return document.querySelector("#deepseek-key").value;'), '', 'Key input clears after save');
  if (validate) {
    await click('[data-testid="ai-check"]');
    await expectText('dialog', '结构化输出可用', 90000);
  }
  await click('[aria-label="关闭弹窗"]');
}
async function extract(source) {
  await clickText('知识导入');
  await fill('[data-testid="ai-source"]', source);
  await click('[data-testid="ai-extract"]');
}
async function candidates() {
  await until(async () => (await all('.ai-candidate-list button')).length || (await all('[data-testid="ai-duplicate"]')).length || (await all('[data-testid="ai-import-error"]')).length, 'AI parsing returns candidates, a known duplicate, or an explicit error', 150000);
  if ((await all('[data-testid="ai-import-error"]')).length) throw new Error(await text('[data-testid="ai-import-error"]'));
  return (await all('.ai-candidate-list button')).length;
}
async function selectCandidate(name) {
  await click(`//nav[@aria-label='候选知识点']//button[.//span[starts-with(normalize-space(.),${literal(name)})]]`, 'xpath');
}
async function selectOption(selector, labelPrefix) {
  await click(`${selector}/option[starts-with(normalize-space(.),${literal(labelPrefix)})]`, 'xpath');
}
async function localSearch(query) {
  await clickText('知识图谱');
  await clickText('片段搜索');
  await fill('[data-testid="search-input"]', query);
  await pause(180);
}
async function selectKnowledge(name) {
  await localSearch(name);
  await click(`//ul[contains(@class,'result-list')]//button[contains(@class,'result-item')][.//*[contains(@class,'result-name') and normalize-space(.)=${literal(name)}]]`, 'xpath');
  await expectText('[data-testid="knowledge-details"] h1', name);
}
async function ask(question, answer = false) {
  await clickText('知识图谱');
  await click('[data-testid="ai-search-mode"]');
  await clickText(answer ? '回答问题' : '查找知识');
  await fill('[data-testid="ai-question"]', question);
  await click('[data-testid="ai-submit"]');
  await until(async () => (await all('[data-testid="ai-output"]')).length || (await all('[data-testid="ai-error"]')).length, 'AI knowledge result or explicit failure', 150000);
  if ((await all('[data-testid="ai-error"]')).length) throw new Error(await text('[data-testid="ai-error"]'));
}
async function manualPoint(name) {
  await clickText('知识图谱');
  await click('[data-testid="create-point"]');
  await fill('#knowledge-name', name);
  await fill('#knowledge-description', '网络请求期间本地保存仍然可用。');
  await click('[data-testid="save-point"]');
  await until(async () => !(await all('#knowledge-name')).length, 'manual save completes');
}
const liveText = 'Docker 是一个学习主题。Linux 运维也是一个学习主题。进入容器终端这个操作同时属于 Docker 和 Linux 运维。进入容器终端时，使用 docker exec -it demo /bin/sh 进入运行中的容器。这里 -i 保持标准输入开启，-t 分配伪终端。';
async function liveScenario() {
  assert.ok(key, 'A live test requires an authorized credential');
  await settings('https://api.deepseek.com', key, true);
  await check('real DeepSeek parses ordinary text into reviewable Point candidates', async () => {
    await extract(liveText);
    assert.ok(await candidates() >= 3);
    await expectText('.ai-candidate-list', '进入容器终端');
    await selectCandidate('进入容器终端');
    await expectText('.ai-evidence', '来自原文');
    await capture('02-real-candidates');
  });
  await check('reviewed batch commits with both topics and survives desktop restart', async () => {
    await click('[data-testid="ai-adopt"]');
    await expectText('[data-testid="ai-adopted"]', '知识已保存到本机');
    await stop(); await launch();
    await selectKnowledge('进入容器终端');
    const detail = await text('[data-testid="knowledge-details"]');
    assert.ok(detail.includes('docker exec') && detail.includes('Docker') && detail.includes('Linux'));
  });
  await check('natural language search locates real saved knowledge without supplying the command', async () => {
    await ask('我想进入 Docker 容器的终端，但是忘了命令');
    await expectText('[data-testid="ai-output"]', '进入容器终端');
    await click("//div[@data-testid='ai-output']//button[contains(@class,'result-item')][contains(.,'进入容器终端')]", 'xpath');
    await expectText('[data-testid="knowledge-details"]', 'docker exec');
    await capture('03-real-search');
  });
  await check('grounded answer and contextual follow-up expose valid source navigation', async () => {
    await ask('我应该怎么进入一个运行中的容器？只使用我保存的知识', true);
    await expectText('[data-testid="ai-output"]', 'docker exec');
    assert.ok((await all('.ai-source')).length > 0);
    await click('.ai-source');
    await expectText('[data-testid="knowledge-details"]', 'docker exec');
    await ask('刚才那个命令里的 -it 有什么作用？', true);
    await expectText('[data-testid="ai-output"]', '标准输入');
    assert.ok((await all('.ai-source')).length > 0);
    await capture('04-real-answer');
  });
  await check('exact repeat input reports existing adoption without duplicating saved knowledge', async () => {
    await extract(liveText); await candidates();
    await click('[data-testid="ai-adopt"]');
    await expectText('[data-testid="ai-adopted"]', '这份输入已经采用');
    await localSearch('进入容器终端');
    const names = await observe('return [...document.querySelectorAll(".result-list .result-name")].map(e=>e.textContent.trim());');
    assert.equal(names.filter(name => name === '进入容器终端').length, 1);
  });
}
async function faultScenario() {
  const { startAiFixture, AI_FIXTURE_TEXT } = await import('./ai-fixture-server.mjs');
  const fixture = await startAiFixture();
  try {
    await check('missing configuration reports unavailable AI and preserves the ordinary text', async () => {
      await extract(AI_FIXTURE_TEXT);
      await expectText('[data-testid="ai-import-error"]', '尚未配置');
      assert.equal(await observe('return document.querySelector("[data-testid=ai-source]").value;'), AI_FIXTURE_TEXT);
    });
    for (const [mode, expected] of [['blank','空白'], ['truncated','截断'], ['bad-color','颜色'], ['bad-theme','主题'], ['extra-field','结构'], ['bad-quote','依据'], ['duplicate-id','身份'], ['self-reference','自己'], ['unknown-reference','主题'], ['cycle','循环'], ['empty','没有'], ['unauthorized','鉴权'], ['rate-limit','受限'], ['server-error','服务'], ['network-drop','连接']]) {
      await settings(fixture.baseUrl(mode), 'fixture-only-key');
      await extract(AI_FIXTURE_TEXT);
      await check(`${mode} fails honestly and preserves input without creating a partial batch`, async () => {
        await expectText('[data-testid="ai-import-error"]', expected, 30000);
        assert.equal(await observe('return document.querySelector("[data-testid=ai-source]").value;'), AI_FIXTURE_TEXT);
        assert.equal((await all('.ai-candidate-list button')).length, 0);
        await localSearch('进入容器终端');
        assert.equal((await all('.result-list .result-item')).length, 0);
        assert.equal((await all('[data-testid="storage-error"]')).length, 0);
      });
    }
    await settings(fixture.baseUrl('repair-theme'), 'fixture-only-key');
    await check('one bounded correction can repair invalid topic types before candidate adoption', async () => {
      await extract(AI_FIXTURE_TEXT);
      assert.equal(await candidates(), 3);
      assert.equal(fixture.requests.filter(request => request.mode === 'repair-theme').length, 2);
      await localSearch('Docker');
      assert.equal((await all('.result-list .result-item')).length, 0);
    });
    await settings(fixture.baseUrl('slow'), 'fixture-only-key');
    await extract(AI_FIXTURE_TEXT);
    await check('pending native AI request leaves local browsing and saving available; cancel preserves input', async () => {
      await until(async () => fixture.requests.some(r => r.mode === 'slow'), 'native Rust request reached fixture');
      await manualPoint('网络等待期间保存的知识');
      await clickText('知识导入');
      await click('[data-testid="ai-import-cancel"]');
      await expectText('[aria-label="AI 知识整理"]', '解析已取消');
      assert.equal(await observe('return document.querySelector("[data-testid=ai-source]").value;'), AI_FIXTURE_TEXT);
      await until(async () => fixture.requests.some(r => r.mode === 'slow' && r.aborted), 'cancel aborts the native HTTP request');
    });
    await settings(fixture.baseUrl('good'), 'fixture-only-key');
    await check('failed configuration replacement restores the original system credential', async () => {
      const locker = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(app, 'validation/hold-ai-config.ps1'), '-RunDirectory', out], { windowsHide: true, stdio: 'ignore' });
      try {
        await until(async () => fs.access(path.join(out, 'config-lock-ready')).then(() => true).catch(() => false), 'configuration replacement lock');
        await click('[data-testid="ai-settings"]');
        await fill('#deepseek-key', 'changed-test-key-DIFF');
        await click('[data-testid="ai-settings-save"]');
        await expectText('dialog [role="alert"]', '原系统凭据已恢复');
        await click('[aria-label="关闭弹窗"]');
        await click('[data-testid="ai-settings"]');
        await expectText('.ai-config-status', '••••-key');
        await click('[aria-label="关闭弹窗"]');
      } finally {
        await fs.writeFile(path.join(out, 'config-lock-stop'), 'stop');
        await until(() => locker.exitCode !== null, 'configuration lock releases');
      }
    });
    await extract(AI_FIXTURE_TEXT); await candidates();
    await check('invalid edited cycle rejects the whole batch and permits correction', async () => {
      await selectCandidate('Docker');
      await click("//fieldset[contains(@class,'ai-candidate-topics')][legend='所属主题']//label[normalize-space(.)='Linux']/input", 'xpath');
      await selectCandidate('Linux');
      await click("//fieldset[contains(@class,'ai-candidate-topics')][legend='所属主题']//label[normalize-space(.)='Docker']/input", 'xpath');
      await click('[data-testid="ai-adopt"]');
      await expectText('[data-testid="ai-import-error"]', '循环');
      await localSearch('Docker');
      assert.equal((await all('.result-list .result-item')).length, 0);
      await clickText('知识导入');
      await selectCandidate('Docker');
      await click("//fieldset[contains(@class,'ai-candidate-topics')][legend='所属主题']//label[normalize-space(.)='Linux']/input", 'xpath');
      await selectCandidate('Linux');
      await click("//fieldset[contains(@class,'ai-candidate-topics')][legend='所属主题']//label[normalize-space(.)='Docker']/input", 'xpath');
    });
    await check('legal candidate batch supports shared topics and commits once', async () => {
      await selectCandidate('进入容器终端');
      await selectOption("//select[@aria-label='候选采用方式']", '复用已有');
      await selectOption("//select[@aria-label='选择已有知识点']", '网络等待期间');
      await selectOption("//select[@aria-label='候选采用方式']", '新建独立');
      await fill('[aria-label="候选知识点描述"]', '使用 docker exec -it demo sh。用户核对后的说明。');
      await click('[data-testid="ai-adopt"]');
      await expectText('[data-testid="ai-adopted"]', '知识已保存到本机');
      await selectKnowledge('进入容器终端');
      const detail = await text('[data-testid="knowledge-details"]');
      assert.ok(detail.includes('Docker') && detail.includes('Linux') && detail.includes('用户核对后的说明'));
    });
    await check('explicit original-record update preserves identity and updates the same record', async () => {
      await clickText('导入记录');
      await expectText('.ai-record-details', '粘贴的学习笔记');
      assert.equal((await all('.ai-record-list button')).length, 1);
      await click('[data-testid="ai-record-update"]');
      await fill('[data-testid="ai-source"]', AI_FIXTURE_TEXT + '\n这是对原记录的明确修改。');
      await click('[data-testid="ai-extract"]'); await candidates();
      for (const name of ['Docker', 'Linux', '进入容器终端']) {
        await selectCandidate(name);
        await selectOption("//select[@aria-label='候选采用方式']", '明确更新');
        await click(`//select[@aria-label='选择已有知识点']/option[contains(normalize-space(.),${literal('建议核对：' + name)})]`, 'xpath');
      }
      await fill('[aria-label="候选知识点描述"]', 'docker exec -it demo sh。原记录更新后的说明。');
      await click('[data-testid="ai-adopt"]');
      await expectText('[data-testid="ai-adopted"]', '更新 3 个');
      await selectKnowledge('进入容器终端');
      await expectText('[data-testid="knowledge-details"]', '原记录更新后的说明');
      assert.equal((await all('.result-list .result-item')).length, 1);
      await clickText('导入记录');
      assert.equal((await all('.ai-record-list button')).length, 1);
    });
    await check('starting new text after an update draft cannot silently update the old record', async () => {
      await click('[data-testid="ai-record-update"]');
      await fill('[data-testid="ai-source"]', AI_FIXTURE_TEXT + '\n尚未采用的原记录修改。');
      await click('[data-testid="ai-extract"]'); await candidates();
      await clickText('导入记录'); await clickText('整理新文本');
      assert.equal((await all('.ai-candidate-list button')).length, 0);
      assert.equal(await observe('return document.querySelector("[data-testid=ai-source]").value;'), '');
      assert.ok(!(await text('[aria-label="AI 知识整理"]')).includes('正在更新“'));
    });
    await check('same-name knowledge stays separate until an explicit reuse decision', async () => {
      await extract(AI_FIXTURE_TEXT + '\n这是一条独立学习记录。'); await candidates();
      await click('[data-testid="ai-adopt"]');
      await expectText('[data-testid="ai-adopted"]', '新增 3 个');
      await localSearch('进入容器终端');
      assert.equal((await all('.result-list .result-item')).length, 2);
    });
    await check('controlled tool retrieval and grounded answer navigate back to formal knowledge', async () => {
      await ask('我想进入容器终端');
      await expectText('[data-testid="ai-output"]', '进入容器终端');
      await ask('如何进入容器终端？', true);
      await expectText('[data-testid="ai-output"]', 'docker exec');
      await click('.ai-source');
      await expectText('[data-testid="knowledge-details"]', 'docker exec');
    });
    for (const mode of ['bad-citation', 'bad-tool']) {
      await settings(fixture.baseUrl(mode), 'fixture-only-key');
      await clickText('知识图谱'); await click('[data-testid="ai-search-mode"]'); await clickText('回答问题');
      await fill('[data-testid="ai-question"]', '如何进入容器终端？'); await click('[data-testid="ai-submit"]');
      await check(`${mode} cannot be displayed as a completed grounded answer`, async () => {
        await until(async () => (await all('[data-testid="ai-error"]')).length, 'invalid tool/source produces explicit failure', 30000);
        assert.equal((await all('[data-testid="ai-output"]')).length, 0);
      });
    }
    await settings(fixture.baseUrl('good-wide'), 'fixture-only-key');
    await check('long text is processed in multiple parts without partial persistence', async () => {
      const longText = Array(Math.ceil(14000 / Buffer.byteLength(AI_FIXTURE_TEXT))).fill(AI_FIXTURE_TEXT).join('\n');
      assert.ok(Buffer.byteLength(longText) > 12000, 'Fixture must exceed the native chunk size');
      await extract(longText);
      assert.ok(await candidates() > 3);
      await expectText('[aria-label="AI 候选预览"]', '长文已分段');
      await localSearch('进入容器终端');
      assert.equal((await all('.result-list .result-item')).length, 2);
    });
    await save('fixture-requests.json', fixture.requests);
    await capture('05-fault-handling');
  } finally { await fixture.close(); }
}
async function migrationScenario() {
  assert.ok(args['legacy-exe'], 'Migration acceptance needs the original distributed executable');
  await manualPoint('升级前保存的知识');
  await stop(); activeExe = exe; await launch();
  await check('v1 data opens in the AI client with existing knowledge intact', async () => {
    await selectKnowledge('升级前保存的知识');
    await expectText('[data-testid="knowledge-details"]', '网络请求期间本地保存仍然可用');
    await clickText('导入记录');
    await expectText('[aria-label="导入记录"]', '还没有已采用的知识');
    await capture('06-migrated-data');
  });
}
async function feedbackScenario() {
  const { startAiFixture, AI_FIXTURE_TEXT } = await import('./ai-fixture-server.mjs');
  const fixture = await startAiFixture();
  try {
    await settings(fixture.baseUrl('good'), 'fixture-only-key');
    await extract(AI_FIXTURE_TEXT); await candidates();
    await selectCandidate('Docker');
    await click("//fieldset[contains(@class,'ai-candidate-topics')][legend='所属主题']//label[normalize-space(.)='Linux']/input", 'xpath');
    await selectCandidate('Linux');
    await click("//fieldset[contains(@class,'ai-candidate-topics')][legend='所属主题']//label[normalize-space(.)='Docker']/input", 'xpath');
    await manualPoint('本次采用之前保存的点');
    await clickText('知识导入');
    await click('[data-testid="ai-adopt"]');
    await check('failed adoption clears an earlier local-save success message', async () => {
      await expectText('[data-testid="ai-import-error"]', '循环');
      await pause(250);
      assert.equal((await all('.toast-message')).length, 0);
    });
  } finally { await fixture.close(); }
}
try {
  if (scenario === 'migration') activeExe = path.resolve(args['legacy-exe']);
  await launch();
  if (scenario === 'migration') await migrationScenario();
  else {
    await check('AI configuration is available in the real desktop client', async () => {
      await click('[data-testid="ai-settings"]');
      await expectText('dialog', 'DeepSeek');
    });
    await capture('01-ai-settings');
    await click('[aria-label="关闭弹窗"]');
    if (scenario === 'live') await liveScenario();
    else if (scenario === 'faults') await faultScenario();
    else if (scenario === 'feedback') await feedbackScenario();
    else if (scenario === 'resources') {
      const { runResourceScenario } = await import('./ai-resource-scenarios.mjs');
      await runResourceScenario({ app, repo, out, assert, fs, click, clickText, fill, text, observe, all, until, expectText, capture, check, settings, extract, candidates, selectKnowledge, localSearch, selectCandidate });
    }
    else assert.equal(scenario, 'smoke');
  }
  passed = true;
} catch (error) {
  // Only our own sanitized messages are recorded, never HTTP payloads or inputs.
  await save('failure.json', { message: error.message });
  if (session) { try { await capture('failure'); } catch {} }
  console.error(error.message);
} finally {
  if (session && scenario !== 'migration') {
    try {
      // Every run uses a new config scope, so only this test's credential is removed.
      if ((await all('dialog')).length) await click('[aria-label="关闭弹窗"]');
      await click('[data-testid="ai-settings"]');
      const remove = await find("//button[normalize-space(.)='移除密钥']", 'xpath');
      if (await wd('GET', `/element/${remove}/enabled`)) {
        await wd('POST', `/element/${remove}/click`, {});
        await expectText('dialog', '已移除密钥');
      }
    } catch {}
  }
  if (session) { try { await command('DELETE', `/session/${session}`); } catch {} }
  if (driver) driver.kill();
  await save('result.json', { run, scenario, passed, assertions: checks.length, exe });
  key = '';
  process.exitCode = passed ? 0 : 1;
}
