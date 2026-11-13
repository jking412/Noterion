// Reproducible promotion screenshots: real Windows EXE + WebDriver UI input only.
// Uses synthetic knowledge, an isolated data/profile directory, and no AI key.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
const root = process.cwd();
const output = path.join(root, process.argv[2] || 'app/smoke-output/promotion-02');
assert.ok(output.startsWith(root + path.sep), 'Evidence must stay in this checkout');
await fs.mkdir(output); // Fresh evidence; never overwrite an earlier run.
const probe = net.createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const endpoint = `http://127.0.0.1:${port}`;
const driver = spawn(path.join(root, 'app/smoke-output/webdriver/msedgedriver.exe'), [`--port=${port}`, '--allowed-ips=127.0.0.1'], {
  windowsHide: true, stdio: 'ignore',
  env: { ...process.env, NOTERION_CONFIG_DIR: path.join(output, 'demo-config'), NOTERION_WEBVIEW_DIR: path.join(output, 'webview'), TAURI_WEBVIEW_AUTOMATION: 'true' },
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let session;
async function command(method, route, body) {
  const response = await fetch(endpoint + route, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const payload = await response.json();
  if (!response.ok || payload.value?.error) throw Error(JSON.stringify(payload.value));
  return payload.value;
}
const wd = (method, route, body) => command(method, `/session/${session}${route}`, body);
async function until(operation) {
  const end = Date.now() + 30000;
  let error;
  while (Date.now() < end) { try { const value = await operation(); if (value) return value; } catch (e) { error = e; } await delay(100); }
  throw error ?? Error('UI wait timed out');
}
const key = 'element-6066-11e4-a52e-4f735466cecf';
const find = async selector => (await wd('POST', '/element', { using: 'css selector', value: selector }))[key];
async function click(selector) { await wd('POST', `/element/${await find(selector)}/click`, {}); }
async function fill(selector, value) { const id = await find(selector); await wd('POST', `/element/${id}/clear`, {}); await wd('POST', `/element/${id}/value`, { text: value }); }
const read = script => wd('POST', '/execute/sync', { script, args: [] }); // Read-only inspection.
async function shot(filename, selector) {
  const route = selector ? `/element/${await find(selector)}/screenshot` : '/screenshot';
  await fs.writeFile(path.join(output, filename), Buffer.from(await wd('GET', route), 'base64'));
}
async function point(name, description, themes = [], isTheme = false) {
  await click('[data-testid="create-point"]');
  await fill('#knowledge-name', name); await fill('#knowledge-description', description);
  if (isTheme) await click('.editor-main input[type="checkbox"]');
  for (const theme of themes) await click(`input[aria-label="所属主题 ${theme}"]`);
  await click('[data-testid="save-point"]');
  await until(() => read('return !document.querySelector("#knowledge-name") && !!document.querySelector("[data-testid=knowledge-details]")'));
  console.log(`Saved via UI: ${name}`);
}
try {
  await until(() => command('GET', '/status').then(value => value.ready));
  const created = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'webview2', 'ms:edgeOptions': { binary: path.join(root, 'app/dist-desktop/noterion.exe') } } } });
  session = created.sessionId;
  await until(() => read('return document.querySelector("[data-testid=create-point]")?.disabled === false'));
  const environment = await read('return {url:location.href, title:document.title, agent:navigator.userAgent, icons:Array.from(document.querySelectorAll("link[rel=icon]"), x=>({href:x.href,type:x.type})), brandLoaded:document.querySelector(".brand-icon")?.naturalWidth}');
  assert.equal(environment.url, 'http://tauri.localhost/'); assert.equal(environment.brandLoaded, 128);
  await point('Docker', '容器学习入口：把环境、命令和踩过的坑连在一起。', [], true);
  await point('Linux 运维', '从命令行线索找回系统操作与排查方法。', [], true);
  await point('学习方法', '留下自己的理解，也留下重新找到原资料的路。', [], true);
  await point('进入容器终端', '## 描述\n在运行中的 demo 容器里打开交互终端，检查配置文件或验证环境。\n## 命令\ndocker exec -it demo /bin/sh\n## 个人理解\n-i 保持输入，-t 分配终端。退出这个 shell 不会停止容器；先用 docker ps 确认容器名称。', ['Docker', 'Linux 运维']);
  await point('查看容器日志', 'docker logs --tail 100 -f demo\n先看最近100行，再持续观察新的输出。', ['Docker']);
  await point('容器与镜像', '镜像是可复用的模板；容器是镜像运行后的实例。', ['Docker']);
  await point('目录挂载', '把容器外需要长期保留的内容映射到宿主目录。', ['Docker']);
  await point('查找占用端口的进程', 'ss -lntp\n查看监听中的 TCP 端口与进程。', ['Linux 运维']);
  await point('查看磁盘空间', 'df -h\n先确认文件系统剩余空间，再定位大的目录。', ['Linux 运维']);
  await point('留下可检索的线索', '记录问题发生时的情境、用过的命令和原资料，帮助未来的自己找回来。', ['学习方法']);
  await point('把知识用在下一次', '用自己的话写下适用条件；遇到类似问题时先检索，再核对来源。', ['学习方法']);
  await click('.main-nav button:nth-child(2)');
  await click('.library-heading button');
  await click('.resource-mode button:nth-child(2)');
  await fill('#resource-title', 'Docker 官方文档 · docker exec');
  await fill('#resource-url', 'https://docs.docker.com/reference/cli/docker/container/exec/');
  await click('input[aria-label="关联知识点 进入容器终端"]');
  await click('.resource-form-footer button[type="submit"]');
  await until(() => read('return !document.querySelector("#resource-title")'));
  await click('.main-nav button:nth-child(1)');
  await fill('[data-testid="search-input"]', '容器终端');
  await until(() => read('return document.querySelectorAll(".result-item").length === 1'));
  await click('.result-item'); await delay(4200);
  await shot('knowledge-search.png', '.canvas-workspace');
  await click('.results-caption .text-button');
  await click('.fit-control');
  await delay(1000); await shot('knowledge-graph.png', '.canvas-workspace');
  await shot('full-client.png');
  await fs.writeFile(path.join(output, 'session.json'), JSON.stringify({ endpoint, session, driverPid: driver.pid, environment, synthetic: true, points: 11, noAiCalls: true }, null, 2));
  console.log('READY: isolated real client left open for native icon/display inspection.');
  console.log(JSON.stringify({ endpoint, session, output }));
} catch (error) {
  if (session) { try { await shot('failure.png'); await command('DELETE', `/session/${session}`); } catch {} }
  driver.kill(); throw error;
}
// Keep the driver and owned client alive until the parent performs native checks.
await new Promise(resolve => driver.once('exit', resolve));
