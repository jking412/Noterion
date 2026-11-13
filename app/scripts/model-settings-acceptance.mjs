// Real Windows Tauri/WebView2 UI acceptance against explicitly local protocol fixtures.
// All mutations use visible controls. execute/sync only observes DOM/layout state.
// No paid credentials, prompt capture, credential enumeration, or external API calls.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startModelFixture, MODEL_FIXTURE_KEYS, MODEL_FIXTURE_TEXT } from './model-fixture-server.mjs';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), repo = path.dirname(app);
const args = Object.fromEntries(process.argv.slice(2).map(argument => { const index = argument.indexOf('='); assert.ok(index > 2, 'Use --name=value'); return [argument.slice(2, index), argument.slice(index + 1)]; }));
assert.ok(Object.keys(args).every(key => ['run', 'exe', 'driver', 'port', 'scenario'].includes(key)), 'Unknown acceptance option');
assert.match(args.run ?? '', /^issue-31-[a-z0-9-]+$/);
const scenario = args.scenario ?? 'contracts';
assert.ok(['contracts', 'release-smoke'].includes(scenario));
assert.equal(process.platform, 'win32', 'Desktop acceptance requires Windows');
const out = path.join(repo, '.scratch/model-settings/runs', args.run), config = path.join(out, 'config');
const exe = path.resolve(args.exe ?? path.join(app, 'dist-desktop/noterion.exe'));
const driverExe = path.resolve(args.driver ?? path.join(repo, '.scratch/personal-knowledge-graph/validation/windows-desktop/.tools/issue3-webdriver/msedgedriver.exe'));
async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
const port = args.port ? Number(args.port) : await availablePort(); assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const endpoint = `http://127.0.0.1:${port}`, pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const providers = ['deepseek', 'openai', 'anthropic'], labels = { deepseek: 'DeepSeek', openai: 'OpenAI 兼容', anthropic: 'Anthropic 兼容' };
let session, driver, launches = 0, passed = false, fixture;
const checks = [], credentialTargets = new Set();
await fs.access(exe); await fs.access(driverExe);
await fs.mkdir(path.dirname(out), { recursive: true }); await fs.mkdir(out); await fs.mkdir(config);
const save = (name, value) => fs.writeFile(path.join(out, name), JSON.stringify(value, null, 2) + '\n');
const sha = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');
const executableSha256 = await sha(exe), driverSha256 = await sha(driverExe);
const elementKey = 'element-6066-11e4-a52e-4f735466cecf';
async function command(method, route, body) {
  const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) throw new Error(`WebDriver ${method} ${route}: ${payload.value?.error ?? response.status}`);
  return payload.value;
}
const wd = (method, route, body) => command(method, `/session/${session}${route}`, body);
async function until(operation, description, timeout = 20000) {
  const deadline = Date.now() + timeout; let last;
  do { try { const value = await operation(); if (value) return value; } catch (error) { last = error.message; } await pause(120); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${description}${last ? ` (${last})` : ''}`);
}
const observe = (script, values = []) => wd('POST', '/execute/sync', { script, args: values });
const find = async (selector, using = 'css selector') => (await wd('POST', '/element', { using, value: selector }))[elementKey];
const all = selector => wd('POST', '/elements', { using: 'css selector', value: selector });
async function click(selector, using) {
  const id = await until(async () => { const found = await find(selector, using); return await wd('GET', `/element/${found}/displayed`) && await wd('GET', `/element/${found}/enabled`) && found; }, `visible enabled ${selector}`);
  await wd('POST', `/element/${id}/click`, {});
}
const literal = value => `'${value.replaceAll("'", '')}'`;
const clickText = label => click(`//button[normalize-space(.)=${literal(label)} or @aria-label=${literal(label)}]`, 'xpath');
async function fill(selector, value) {
  const id = await find(selector); await wd('POST', `/element/${id}/clear`, {}); await wd('POST', `/element/${id}/value`, { text: value });
  assert.ok(await wd('GET', `/element/${id}/property/value`) === value, `Input accepted expected value: ${selector}`);
}
const text = async selector => wd('GET', `/element/${await find(selector)}/text`);
const value = selector => observe('return document.querySelector(arguments[0])?.value;', [selector]);
const enabled = async selector => wd('GET', `/element/${await find(selector)}/enabled`);
const expectText = (selector, expected, timeout) => until(async () => (await text(selector)).includes(expected), `visible ${expected}`, timeout);
async function capture(name) {
  const source = await wd('GET', '/source');
  for (const secret of Object.values(MODEL_FIXTURE_KEYS)) assert.ok(!source.includes(secret), 'Synthetic credential must not appear in captured markup');
  await fs.writeFile(path.join(out, `${name}.png`), Buffer.from(await wd('GET', '/screenshot'), 'base64'));
  // Screenshots and sanitized metadata suffice; do not persist the full DOM.
}
async function check(name, action) { const detail = await action(); checks.push({ name, verdict: 'PASS', detail }); await save('checks.json', checks); console.log(`PASS ${name}`); }
async function launch() {
  const profile = path.join(out, `profile-${++launches}`);
  const environment = { ...process.env, NOTERION_CONFIG_DIR: config, NOTERION_WEBVIEW_DIR: profile, TAURI_WEBVIEW_AUTOMATION: 'true' };
  for (const name of ['NOTERION_TEST_KEY', 'NOTERION_TEST_PROVIDER', 'NOTERION_TEST_BASE_URL', 'NOTERION_DEEPSEEK_KEY']) delete environment[name];
  driver = spawn(driverExe, [`--port=${port}`, '--allowed-ips=127.0.0.1'], { windowsHide: true, stdio: 'ignore', env: environment });
  driver.once('error', () => {});
  await until(async () => (await command('GET', '/status')).ready, 'EdgeDriver ready');
  const result = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'webview2', 'ms:edgeOptions': { binary: exe, webviewOptions: { userDataFolder: profile } } } } });
  session = result.sessionId;
  await until(() => observe('return location.href === "http://tauri.localhost/" && document.visibilityState === "visible";'), 'visible embedded desktop');
  await until(() => enabled('[data-testid="create-point"]'), 'formal local data loaded');
}
async function stop() {
  try {
    if (session) await command('DELETE', `/session/${session}`);
  } finally {
    session = undefined;
    if (driver) { driver.kill(); await pause(500); driver = undefined; }
  }
}
async function openSettings(provider) {
  if (!(await all('[data-testid="model-settings-page"]')).length) await click('[data-testid="ai-settings"]');
  await until(async () => (await all('[data-testid="model-base-url"]')).length > 0, 'model settings loaded');
  if (provider) await click(`[data-testid="provider-${provider}"]`);
}
const configPath = path.join(config, 'model-connections.json');
const readConfig = async () => JSON.parse(await fs.readFile(configPath, 'utf8'));
function credentialTarget(provider, baseUrl) {
  const digest = createHash('sha256').update(config).update(Buffer.from([0])).update(baseUrl).digest('hex');
  const name = `Noterion/${{ deepseek: 'DeepSeek', openai: 'OpenAI', anthropic: 'Anthropic' }[provider]}/${digest}`;
  credentialTargets.add(name); return name;
}
async function configure(provider, baseUrl, model, secret = MODEL_FIXTURE_KEYS[provider], activate = true) {
  await openSettings(provider); await fill('#model-base-url', baseUrl); await fill('#model-name', model);
  if (secret !== undefined && secret !== null) await fill('#model-api-key', secret);
  credentialTarget(provider, baseUrl);
  await click(`[data-testid="${activate ? 'model-activate' : 'ai-settings-save'}"]`);
  await expectText('[data-testid="model-save-success"]', '配置已保存');
  assert.equal(await value('#model-api-key'), '', 'Key clears after saving');
  if (activate) await expectText('[data-testid="active-model"]', labels[provider]);
}
async function localSearch(query) { await clickText('知识图谱'); await clickText('片段搜索'); await fill('[data-testid="search-input"]', query); await pause(150); }
async function selectKnowledge(name) {
  await localSearch(name);
  await click(`//ul[contains(@class,'result-list')]//button[contains(@class,'result-item')][.//*[contains(@class,'result-name') and normalize-space(.)=${literal(name)}]]`, 'xpath');
  await expectText('[data-testid="knowledge-details"]', name);
}
async function extract(source) {
  await clickText('知识导入');
  if ((await all('[data-testid="ai-adopted"]')).length) await clickText('整理新的文本');
  await fill('[data-testid="ai-source"]', source); await click('[data-testid="ai-extract"]');
}
async function candidates() {
  await until(async () => (await all('.ai-candidate-list button')).length || (await all('[data-testid="ai-import-error"]')).length, 'review candidates or explicit error', 60000);
  if ((await all('[data-testid="ai-import-error"]')).length) throw new Error(await text('[data-testid="ai-import-error"]'));
  assert.equal((await all('.ai-candidate-list button')).length, 3);
}
const selectCandidate = name => click(`//nav[@aria-label='候选知识点']//button[.//span[starts-with(normalize-space(.),${literal(name)})]]`, 'xpath');
async function startQuestion(question, answer) {
  await clickText('知识图谱'); await click('[data-testid="ai-search-mode"]'); await clickText(answer ? '回答问题' : '查找知识');
  await fill('[data-testid="ai-question"]', question); await click('[data-testid="ai-submit"]');
}
async function answerResult() {
  await until(async () => (await all('[data-testid="ai-output"]')).length || (await all('[data-testid="ai-error"]')).length, 'AI output or explicit error', 60000);
  if ((await all('[data-testid="ai-error"]')).length) throw new Error(await text('[data-testid="ai-error"]'));
}
async function seedKnowledgeAndResource() {
  await click('[data-testid="create-point"]'); await fill('#knowledge-name', '迁移前的知识'); await fill('#knowledge-description', '模型配置升级必须保留本机知识与资料。'); await click('[data-testid="save-point"]');
  await until(async () => !(await all('#knowledge-name')).length, 'pre-migration knowledge saved');
  const resource = path.join(out, 'migration-learning.md'); await fs.writeFile(resource, '迁移前资料正文：本机资料必须保留。', { flag: 'wx' });
  await clickText('资料库'); await clickText('添加资料'); await fill('[aria-label="资料文件路径"]', resource); await fill('[aria-label="资料名称"]', '迁移前的资料'); await clickText('保存资料');
  await until(async () => !(await all('.resource-add-form')).length, 'pre-migration resource copied'); await expectText('.library-list', '迁移前的资料');
}

// Only exact, newly synthesized targets for this isolated run can be written/deleted.
// Never enumerate or read another profile's credentials.
const credentialHelper = path.join(out, 'synthetic-credential.ps1');
await fs.writeFile(credentialHelper, `param([ValidateSet('write','delete')][string]$Action,[string]$Target)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class SyntheticCredential31 {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct CREDENTIAL {
  public uint Flags,Type; public string TargetName,Comment; public long LastWritten; public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist,AttributeCount; public IntPtr Attributes; public string TargetAlias,UserName;
 }
 [DllImport("advapi32.dll",EntryPoint="CredWriteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Write(ref CREDENTIAL c,uint flags);
 [DllImport("advapi32.dll",EntryPoint="CredDeleteW",CharSet=CharSet.Unicode,SetLastError=true)] public static extern bool Delete(string target,uint type,uint flags);
 public static void Save(string target,string value) { var bytes=System.Text.Encoding.UTF8.GetBytes(value); var memory=Marshal.AllocHGlobal(bytes.Length); try { Marshal.Copy(bytes,0,memory,bytes.Length); var c=new CREDENTIAL { Type=1,TargetName=target,CredentialBlobSize=(uint)bytes.Length,CredentialBlob=memory,Persist=2,UserName="Noterion synthetic acceptance" }; if(!Write(ref c,0))throw new Exception("Synthetic credential write failed"); } finally { Marshal.FreeHGlobal(memory); } }
}
'@
if($Action -eq 'write'){
 [SyntheticCredential31]::Save($Target,$env:NOTERION_SYNTHETIC_CREDENTIAL)
}elseif(-not [SyntheticCredential31]::Delete($Target,1,0)){
 if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168){throw 'Synthetic credential deletion failed'}
}
`);
function credential(action, target, secret) {
  assert.ok(credentialTargets.has(target), 'Only this run credential targets are allowed');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', credentialHelper, '-Action', action, '-Target', target], { windowsHide: true, encoding: 'utf8', env: { ...process.env, NOTERION_SYNTHETIC_CREDENTIAL: secret ?? '' } });
  assert.equal(result.status, 0, `Synthetic credential ${action} succeeds`);
}

async function migration() {
  await seedKnowledgeAndResource(); await stop();
  const legacyUrl = scenario === 'contracts' ? fixture.baseUrl('deepseek') : 'https://api.deepseek.com';
  const legacy = { model: 'deepseek-flash', baseUrl: legacyUrl };
  await fs.writeFile(path.join(config, 'deepseek.json'), JSON.stringify(legacy));
  credential('write', credentialTarget('deepseek', legacyUrl), MODEL_FIXTURE_KEYS.deepseek);
  // Remove only the initialized configuration created by this run, to reproduce
  // an old installation which has deepseek.json but no new configuration yet.
  assert.equal(path.dirname(configPath), config); await fs.unlink(configPath);
  await launch();
  await check('old DeepSeek config and actual Windows credential migrate without losing local knowledge or resources', async () => {
    await openSettings('deepseek');
    assert.equal(await value('#model-base-url'), legacyUrl); assert.equal(await value('#model-name'), 'deepseek-flash');
    await expectText('[data-testid="model-key-state"]', '已保存密钥');
    const migrated = await readConfig(); assert.equal(migrated.activeProvider, 'deepseek'); assert.equal(migrated.connections.length, 3);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(config, 'deepseek.json'), 'utf8')), legacy, 'Old configuration retained');
    await selectKnowledge('迁移前的知识'); await expectText('[data-testid="knowledge-details"]', '升级必须保留');
    await clickText('资料库'); await click("//article[@aria-label='学习资料：迁移前的资料']//button[normalize-space(.)='查看资料']", 'xpath');
    await expectText('.text-preview', '迁移前资料正文'); await clickText('关闭预览');
    return { legacyJsonRetained: true, actualCredentialMigration: true, existingKnowledgeAndResourceReadable: true };
  });
}

async function settingsContracts() {
  for (const provider of providers) await check(`${provider}: current form is checked, editing invalidates success, and the independent connection saves and activates`, async () => {
    await openSettings(provider);
    const url = fixture.baseUrl(provider), model = `${provider}/fixture:v31`;
    await fill('#model-base-url', url); await fill('#model-name', model); await fill('#model-api-key', MODEL_FIXTURE_KEYS[provider]); credentialTarget(provider, url);
    const before = fixture.requests.length; await click('[data-testid="ai-check"]'); await expectText('[data-testid="model-check-success"]', '检查通过', 30000);
    const checked = fixture.requests.slice(before); assert.ok(checked.length >= 2 && checked.every(request => request.provider === provider && request.model === model && request.stage === 'connection'));
    assert.ok(checked.some(request => request.toolResults > 0), 'Connection check verifies an actual tool result');
    await fill('#model-name', `${model}-edited`); assert.equal((await all('[data-testid="model-check-success"]')).length, 0, 'Old check success cleared immediately');
    await click('[data-testid="model-activate"]'); await expectText('[data-testid="model-save-success"]', '配置已保存');
    assert.equal(await value('#model-api-key'), ''); await expectText('[data-testid="active-model"]', labels[provider]);
    await capture(`01-settings-${provider}`);
    return { checkedUnsavedModel: model, savedModel: `${model}-edited`, nativeToolRoundTrip: true };
  });
  await check('three independent connections and active choice survive desktop restart', async () => {
    await stop(); await launch(); await openSettings(); await expectText('[data-testid="active-model"]', 'Anthropic 兼容');
    for (const provider of providers) { await openSettings(provider); assert.equal(await value('#model-base-url'), fixture.baseUrl(provider)); assert.equal(await value('#model-name'), `${provider}/fixture:v31-edited`); await expectText('[data-testid="model-key-state"]', '已保存密钥'); }
    return { savedProviders: providers, activeProvider: 'anthropic', restarted: true };
  });
  await check('editing target does not reuse the saved credential, while a newly supplied credential can check that unsaved target', async () => {
    await openSettings('openai'); const target = fixture.baseUrl('openai', 'model-missing'); const before = fixture.requests.length;
    await fill('#model-base-url', target); await expectText('[data-testid="model-key-state"]', '不会沿用');
    assert.equal(await enabled('[data-testid="ai-check"]'), false); assert.equal(await enabled('[data-testid="model-activate"]'), false);
    await click('[data-testid="ai-settings-save"]'); await expectText('[data-testid="model-save-success"]', '配置已保存');
    await expectText('[data-testid="model-key-state"]', '尚未保存密钥'); assert.equal(fixture.requests.length, before);
    await fill('#model-api-key', MODEL_FIXTURE_KEYS.openai); await click('[data-testid="ai-check"]'); await expectText('[data-testid="model-check-error"]', '模型', 15000);
    assert.ok(fixture.requests.slice(before).every(request => request.provider === 'openai' && request.mode === 'model-missing'));
    await configure('openai', fixture.baseUrl('openai'), 'openai/fixture:v31-edited');
    return { oldKeyNotSent: true, newTargetCheckedWithExplicitInput: true };
  });
  await check('replacing and removing a Windows credential reports accurate state and restores independent usability', async () => {
    await openSettings('anthropic'); await click('[data-testid="model-remove-key"]'); await expectText('[data-testid="model-save-success"]', '已移除'); await expectText('[data-testid="model-key-state"]', '尚未保存密钥');
    assert.equal(await enabled('[data-testid="ai-check"]'), false);
    await configure('anthropic', fixture.baseUrl('anthropic'), 'anthropic/fixture:v31-edited'); await click('[data-testid="ai-check"]'); await expectText('[data-testid="model-check-success"]', '检查通过');
    return { removedFromCredentialManager: true, replacementUsable: true };
  });
  await check('an edited form ignores an older in-flight connection check result', async () => {
    await openSettings('anthropic'); await fill('#model-base-url', fixture.baseUrl('anthropic', 'gated-check')); await fill('#model-name', 'anthropic/checked-old:v31'); await fill('#model-api-key', MODEL_FIXTURE_KEYS.anthropic);
    const before = fixture.requests.length; await click('[data-testid="ai-check"]'); await until(() => fixture.requests.slice(before).some(request => request.mode === 'gated-check'), 'old connection check is waiting');
    await fill('#model-name', 'anthropic/edited-after-check:v31'); fixture.release();
    await until(async () => !(await all('.model-checking')).length, 'old connection check finishes');
    assert.equal((await all('[data-testid="model-check-success"]')).length, 0); assert.equal((await all('[data-testid="model-check-error"]')).length, 0);
    assert.ok(fixture.requests.slice(before).every(request => request.model === 'anthropic/checked-old:v31'));
    await configure('anthropic', fixture.baseUrl('anthropic'), 'anthropic/fixture:v31-edited');
    return { oldResponseIgnored: true, editedModelRetained: true };
  });
  await check('failed atomic configuration replacement preserves the previous JSON and Windows credential', async () => {
    await configure('openai', fixture.baseUrl('openai'), 'openai/fixture:v31-edited');
    const original = await fs.readFile(configPath, 'utf8');
    const lockScript = path.join(out, 'lock-model-config.ps1'), ready = path.join(out, 'config-lock-ready'), finish = path.join(out, 'config-lock-finish');
    await fs.writeFile(lockScript, `param([string]$Config,[string]$Ready,[string]$Finish)\n$ErrorActionPreference='Stop'\n$stream=[IO.File]::Open($Config,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::Read)\ntry{[IO.File]::WriteAllText($Ready,'ready');while(!(Test-Path -LiteralPath $Finish)){Start-Sleep -Milliseconds 100}}finally{$stream.Dispose()}\n`);
    const locker = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', lockScript, '-Config', configPath, '-Ready', ready, '-Finish', finish], { windowsHide: true, stdio: 'ignore' });
    try {
      await until(() => fs.access(ready).then(() => true).catch(() => false), 'config replacement locked');
      await fill('#model-api-key', 'synthetic-replacement-must-rollback-31'); await click('[data-testid="ai-settings-save"]'); await expectText('[data-testid="model-save-error"]', '原配置与凭据已保留');
      assert.equal(await value('#model-api-key'), ''); assert.equal(await fs.readFile(configPath, 'utf8'), original);
    } finally { await fs.writeFile(finish, 'finish'); await until(() => locker.exitCode !== null, 'config file lock released'); }
    await click('[data-testid="ai-check"]'); await expectText('[data-testid="model-check-success"]', '检查通过');
    return { atomicSaveFailedHonestly: true, originalJsonRetained: true, originalCredentialUsable: true };
  });
}

async function businessContracts() {
  for (const provider of providers) {
    await configure(provider, fixture.baseUrl(provider), `${provider}/fixture:v31-edited`);
    await check(`${provider}: extraction preview can be edited and formally adopted`, async () => {
      const before = fixture.requests.length; await extract(`${MODEL_FIXTURE_TEXT}\n独立连接验收：${provider}`); await candidates(); await selectCandidate('进入容器终端');
      await expectText('.ai-evidence', '来自原文'); await fill('[aria-label="候选知识点描述"]', `使用 docker exec -it demo sh。用户核对后的说明（${provider}）。`);
      await capture(`02-preview-${provider}`); await click('[data-testid="ai-adopt"]'); await expectText('[data-testid="ai-adopted"]', '知识已保存到本机');
      assert.ok(fixture.requests.slice(before).some(request => request.provider === provider && request.stage === 'extract'));
      return { candidates: 3, edited: true, adopted: true };
    });
    await check(`${provider}: local retrieval tools, answer sources, and follow-up remain connected`, async () => {
      const before = fixture.requests.length; await startQuestion('我想进入 Docker 容器终端，但是忘了命令', false); await answerResult(); await expectText('[data-testid="ai-output"]', '进入容器终端');
      await click("//div[@data-testid='ai-output']//button[contains(@class,'result-item')][contains(.,'进入容器终端')]", 'xpath'); await expectText('[data-testid="knowledge-details"]', 'docker exec');
      await startQuestion('怎样进入运行中的容器？只使用我保存的知识', true); await answerResult(); await expectText('[data-testid="ai-output"]', 'docker exec');
      assert.ok((await all('[data-testid="ai-output"] .ai-source')).length); await click('[data-testid="ai-output"] .ai-source'); await expectText('[data-testid="knowledge-details"]', 'docker exec');
      await startQuestion('请继续说明刚才的容器命令', true); await answerResult(); await expectText('[data-testid="ai-output"]', 'docker exec');
      const calls = fixture.requests.slice(before); assert.ok(calls.every(request => request.provider === provider)); assert.ok(calls.some(request => request.toolResults > 0)); assert.ok(calls.some(request => request.stage === 'search')); assert.ok(calls.filter(request => request.stage === 'answer').length >= 2);
      await capture(`03-answer-${provider}`); return { realLocalTools: true, citationNavigable: true, followUp: true };
    });
  }
}

async function failureContracts() {
  for (const provider of ['openai', 'anthropic']) {
    for (const [mode, expected] of [['unauthorized', '鉴权'], ['rate-limit', '受限'], ['model-missing', '模型'], ['blank', '空结果'], ['truncated', '截断'], ['interrupt', '中断']]) {
      await configure(provider, fixture.baseUrl(provider, mode), `${provider}/fixture:v31`);
      await check(`${provider}: ${mode} is recoverable and preserves the extraction input`, async () => {
        const source = `${MODEL_FIXTURE_TEXT}\n错误验收：${provider}/${mode}`; await extract(source); await expectText('[data-testid="ai-import-error"]', expected, 30000);
        assert.equal(await value('[data-testid="ai-source"]'), source); assert.equal((await all('.ai-candidate-list button')).length, 0); assert.equal((await all('[data-testid="storage-error"]')).length, 0);
      });
    }
    await configure(provider, fixture.baseUrl(provider, 'slow'), `${provider}/fixture:v31`);
    await check(`${provider}: cancelling an in-flight HTTP stream preserves the input and aborts the native request`, async () => {
      const source = `${MODEL_FIXTURE_TEXT}\n取消验收：${provider}`, before = fixture.requests.length; await extract(source); await until(() => fixture.requests.slice(before).some(request => request.mode === 'slow'), 'native request reaches slow fixture');
      await click('[data-testid="ai-import-cancel"]'); await expectText('[aria-label="AI 知识整理"]', '解析已取消'); assert.equal(await value('[data-testid="ai-source"]'), source);
      await until(() => fixture.requests.slice(before).some(request => request.aborted), 'cancel closes native stream');
    });
    await configure(provider, fixture.baseUrl(provider), `${provider}/fixture:v31`);
    await check(`${provider}: a normal task succeeds after errors and cancellation`, async () => { await startQuestion('查找进入容器终端', false); await answerResult(); await expectText('[data-testid="ai-output"]', '进入容器终端'); });
  }
  await check('switching the active connection during a tool task keeps that task on its original protocol and credential', async () => {
    await configure('openai', fixture.baseUrl('openai', 'gated'), 'openai/original-task:v31');
    const before = fixture.requests.length; await startQuestion('运行中切换设置时怎样进入容器终端', true);
    await until(() => fixture.requests.slice(before).some(request => request.mode === 'gated' && request.stage === 'retrieve'), 'old task waits at native tool stage');
    await configure('anthropic', fixture.baseUrl('anthropic'), 'anthropic/next-task:v31');
    await expectText('[data-testid="model-settings-page"]', '启动时的连接'); fixture.release();
    await clickText('知识图谱'); await answerResult(); await expectText('[data-testid="ai-output"]', 'docker exec');
    const ongoing = fixture.requests.slice(before); assert.ok(ongoing.length >= 3 && ongoing.every(request => request.provider === 'openai' && request.mode === 'gated' && request.model === 'openai/original-task:v31'));
    const next = fixture.requests.length; await startQuestion('新的任务用当前连接查找容器终端', false); await answerResult();
    assert.ok(fixture.requests.slice(next).length && fixture.requests.slice(next).every(request => request.provider === 'anthropic' && request.model === 'anthropic/next-task:v31'));
    return { oldTaskPinned: true, newTaskUsesCurrentConnection: true };
  });
}

async function releaseSmoke() {
  await check('release setting page contains exactly three types and rejects an insecure endpoint without saving it', async () => {
    await openSettings('openai'); assert.equal((await all('.provider-list button')).length, 3);
    await fill('#model-base-url', 'http://127.0.0.1:1/release-rejected'); await fill('#model-name', 'release/synthetic:v31'); await fill('#model-api-key', MODEL_FIXTURE_KEYS.openai);
    await click('[data-testid="ai-settings-save"]'); await expectText('[data-testid="model-save-error"]', 'HTTPS');
    const saved = await readConfig(); assert.ok(saved.connections.every(connection => !connection.baseUrl.startsWith('http:')));
  });
  for (const provider of providers) await configure(provider, { deepseek: 'https://api.deepseek.com', openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com/v1' }[provider], `${provider}/release-synthetic:v31`);
  await capture('04-release-settings');
  await check('model settings remains usable at the minimum desktop window size', async () => {
    const original = await wd('GET', '/window/rect');
    await wd('POST', '/window/rect', { width: 1000, height: 700 });
    await pause(250);
    const layout = await observe(`return {
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      fields: [...document.querySelectorAll('.connection-form input')].map(element => {
        const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width };
      }),
      navigation: document.querySelector('[data-testid="ai-settings"]').getBoundingClientRect().right
    };`);
    assert.ok(layout.document <= layout.viewport + 1, 'No horizontal document overflow');
    assert.ok(layout.navigation <= layout.viewport + 1, 'Model navigation remains inside the viewport');
    assert.ok(layout.fields.every(box => box.left >= 0 && box.right <= layout.viewport + 1 && box.width >= 200), 'All connection fields fit');
    await capture('05-release-settings-minimum');
    await wd('POST', '/window/rect', { width: original.width, height: original.height });
    return layout;
  });
  await stop(); await launch(); await openSettings(); await expectText('[data-testid="active-model"]', 'Anthropic 兼容');
  for (const provider of providers) { await openSettings(provider); await expectText('[data-testid="model-key-state"]', '已保存密钥'); }
  await selectKnowledge('迁移前的知识'); await expectText('[data-testid="knowledge-details"]', '升级必须保留');
  checks.push({ name: 'release connection selection and credentials persist without paid network calls', verdict: 'PASS' });
}

try {
  if (scenario === 'contracts') fixture = await startModelFixture();
  await launch(); await migration();
  if (scenario === 'contracts') { await settingsContracts(); await businessContracts(); await failureContracts(); assert.ok(fixture.requests.length > 25); assert.equal(fixture.requests.flatMap(request => request.violations).length, 0, 'All native requests satisfy protocol contracts'); }
  else await releaseSmoke();
  await check('pre-existing knowledge and managed resources remain available after all settings operations', async () => { await selectKnowledge('迁移前的知识'); await expectText('[data-testid="knowledge-details"]', '升级必须保留'); await clickText('资料库'); await expectText('.library-list', '迁移前的资料'); });
  passed = true;
} catch (error) {
  // Errors contain only our assertions or already-sanitized app/WebDriver messages.
  await save('failure.json', { message: error.message }); console.error(error.message); if (session) try { await capture('failure'); } catch {}
} finally {
  let desktopCleanup = true;
  try { await stop(); } catch { desktopCleanup = false; }
  if (fixture) { await save('fixture-requests.json', fixture.requests); await fixture.close(); }
  let credentialCleanup = true;
  for (const target of credentialTargets) try { credential('delete', target); } catch { credentialCleanup = false; }
  await save('checks.json', checks);
  await save('result.json', { run: args.run, scenario, passed: passed && credentialCleanup && desktopCleanup, assertionCount: checks.length, executable: exe, executableSha256, driverSha256, launches, credentialCleanup, desktopCleanup, providerTesting: scenario === 'contracts' ? 'Local deterministic HTTP/SSE fixtures through the actual Windows desktop; not live official API tests.' : 'Release UI/storage/HTTPS policy only; no external API calls.', liveApiCoverage: { deepseek: false, openai: false, anthropic: false } });
  process.exitCode = passed && credentialCleanup && desktopCleanup ? 0 : 1;
}
