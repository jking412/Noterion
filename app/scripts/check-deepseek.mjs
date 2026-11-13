// Connection and fixed synthetic extraction diagnostics only.
// Full business acceptance uses ai-acceptance.mjs; this is not an acceptance substitute.
// Supply the test key on stdin; never persist it or log provider response bodies.
import { readTestCredential } from './test-credential.mjs';
import fs from 'node:fs/promises';
const options = Object.fromEntries(process.argv.slice(2).map(value => {
  const at = value.indexOf('='); return [value.slice(2, at), value.slice(at + 1)];
}));
let credential = await readTestCredential(options);
if (!credential) throw new Error('Provide an authorized test credential through an isolated pipe or environment');
try {
  if (options.extract === 'true') {
    const rust = await fs.readFile(new URL('../src-tauri/src/ai/extract.rs', import.meta.url), 'utf8');
    const system = /const SYSTEM: &str = r#"([\s\S]*?)"#;/.exec(rust)?.[1];
    if (!system) throw new Error('Extraction prompt could not be read');
    const text = 'Docker 是一个学习主题。Linux 运维也是一个学习主题。进入容器终端这个操作同时属于 Docker 和 Linux 运维。进入容器终端时，使用 docker exec -it demo /bin/sh 进入运行中的容器。这里 -i 保持标准输入开启，-t 分配伪终端。';
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer ' + credential, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-flash', thinking: { type: 'disabled' }, stream: false, max_tokens: 8192, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify({ existingThemes: [], allowedResources: [], text }) }] }),
      signal: AbortSignal.timeout(120000),
    });
    const envelope = await response.json();
    const choice = envelope.choices?.[0];
    const parsed = JSON.parse(choice?.message?.content || '{}');
    console.log(JSON.stringify({ status: response.status, finish: choice?.finish_reason, points: parsed.points?.map(item => ({ id: item.point?.id, name: item.point?.name, isTheme: item.point?.isTheme, topicIds: item.point?.topicIds })) }, null, 2));
  } else {
  const response = await fetch('https://api.deepseek.com/models', {
    headers: { Authorization: 'Bearer ' + credential },
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json();
  console.log(JSON.stringify({ status: response.status,
    models: body.data?.map(item => item.id), errorCode: body.error?.code }));
  process.exitCode = response.ok ? 0 : 1;
  }
} catch (error) {
  console.error(JSON.stringify({ error: error.name, cause: error.cause?.code }));
  process.exitCode = 1;
} finally { credential = ''; }
