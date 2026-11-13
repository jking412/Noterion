// Local protocol contract fixture. This is not an official provider or a live API test.
// Only sanitized shape/counter metadata is retained; credentials and prompts stay ephemeral.
import http from 'node:http';

export const MODEL_FIXTURE_TEXT = '【本机协议夹具，非官方模型实测】Docker 与 Linux 学习笔记。进入容器终端：docker exec -it demo sh。';
export const MODEL_FIXTURE_KEYS = Object.freeze({ deepseek: 'synthetic-deepseek-only-31', openai: 'synthetic-openai-only-31', anthropic: 'synthetic-anthropic-only-31' });
const providers = new Set(Object.keys(MODEL_FIXTURE_KEYS));
const modes = new Set(['good', 'unauthorized', 'rate-limit', 'model-missing', 'blank', 'truncated', 'interrupt', 'slow', 'gated', 'gated-check']);
const split = (value, size = 29) => Array.from(value).reduce((parts, char, index) => { if (index % size === 0) parts.push(''); parts[parts.length - 1] += char; return parts; }, []);
const object = value => { try { return JSON.parse(value); } catch { return null; } };

export async function startModelFixture() {
  const requests = [], sockets = new Set(), timers = new Set(), gates = new Set();
  let sequence = 0, closing;
  const server = http.createServer(async (request, response) => {
    const route = /^\/(deepseek|openai|anthropic)\/([a-z-]+)\/v1\/(chat\/completions|messages)$/.exec(request.url ?? '');
    const provider = route?.[1], mode = route?.[2], anthropic = provider === 'anthropic';
    const summary = { sequence: ++sequence, provider: provider ?? 'unknown', mode: mode ?? 'unknown', stage: 'unknown', model: '', status: 0, violations: [], toolNames: [], toolResults: 0, messageCount: 0, chunks: 0, finished: false, aborted: false };
    requests.push(summary);
    const localTimers = new Set();
    const clean = () => { for (const timer of localTimers) { clearTimeout(timer); clearInterval(timer); timers.delete(timer); } localTimers.clear(); };
    response.once('finish', () => { summary.finished = true; clean(); });
    response.once('close', () => { if (!response.writableFinished) summary.aborted = true; clean(); });
    const error = (status, type) => { summary.status = status; response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { type, message: 'Local deterministic fixture failure.' } })); };
    if (!route || !providers.has(provider) || !modes.has(mode) || request.method !== 'POST') { request.resume(); error(404, 'unknown_endpoint'); return; }
    let body;
    try {
      const chunks = []; let length = 0;
      for await (const chunk of request) { length += chunk.length; if (length > 1024 * 1024) { error(413, 'request_too_large'); return; } chunks.push(chunk); }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch { if (!response.destroyed) error(400, 'invalid_request'); return; }
    const invalid = rule => summary.violations.push(rule);
    if (route[3] !== (anthropic ? 'messages' : 'chat/completions')) invalid('protocol endpoint');
    if (anthropic) {
      if (request.headers['x-api-key'] !== MODEL_FIXTURE_KEYS[provider]) invalid('isolated Anthropic credential');
      if (request.headers['anthropic-version'] !== '2026-10-21') invalid('current Anthropic version');
      if (request.headers.authorization) invalid('no Chat authentication on Messages');
      if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) invalid('Messages max_tokens');
      for (const field of ['temperature', 'top_p', 'top_k', 'response_format', 'reasoning_effort']) if (field in body) invalid(`unsupported Messages field ${field}`);
      if (body.tools?.some(tool => !tool.name || !tool.input_schema || tool.function)) invalid('Messages native tool schema');
    } else {
      if (request.headers.authorization !== `Bearer ${MODEL_FIXTURE_KEYS[provider]}`) invalid('isolated Chat credential');
      if (request.headers['x-api-key'] || request.headers['anthropic-version']) invalid('no Messages headers on Chat');
      if (provider === 'openai' && ('thinking' in body || 'reasoning_effort' in body)) invalid('no DeepSeek parameters on OpenAI');
      if (body.tools?.some(tool => tool.type !== 'function' || !tool.function?.name || !tool.function.parameters)) invalid('Chat native function schema');
    }
    if (!Array.isArray(body.messages) || typeof body.model !== 'string' || !body.model || body.stream !== true) invalid('model messages and SSE request');
    const canonical = canonicalMessages(body, anthropic, invalid);
    summary.model = typeof body.model === 'string' && /^[\w/.:+-]{1,120}$/.test(body.model) ? body.model : 'unrecognized';
    summary.messageCount = canonical.length;
    summary.toolNames = (body.tools ?? []).map(tool => anthropic ? tool.name : tool.function?.name).filter(Boolean);
    summary.toolChoiceDisabled = body.tool_choice === 'none' || body.tool_choice?.type === 'none';
    const callableTools = summary.toolChoiceDisabled ? [] : summary.toolNames;
    const results = canonical.filter(message => message.role === 'tool');
    summary.toolResults = results.length;
    summary.stage = stage(canonical, callableTools);
    if (summary.violations.length) { error(422, 'contract_violation'); return; }
    const failed = { unauthorized: 401, 'rate-limit': 429, 'model-missing': 404 }[mode];
    if (failed) { error(failed, mode); return; }
    summary.status = 200;
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' });
    response.flushHeaders();
    if (mode === 'slow') {
      response.write(': waiting for explicit desktop cancellation\n\n');
      const timer = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 100);
      localTimers.add(timer); timers.add(timer); return;
    }
    if ((mode === 'gated' && summary.stage === 'retrieve' || mode === 'gated-check' && summary.stage === 'connection') && results.length === 0) await new Promise(resolve => { const gate = () => { gates.delete(gate); resolve(); }; gates.add(gate); response.once('close', gate); });
    if (response.destroyed) return;
    const completion = complete(canonical, callableTools, summary.stage, summary.sequence);
    if (mode === 'blank') { completion.content = '  '; delete completion.tool; }
    if (mode === 'truncated') { completion.content = '{"points":['; delete completion.tool; completion.truncated = true; }
    const frames = anthropic ? anthropicFrames(completion, sequence) : chatFrames(completion, sequence);
    if (mode === 'interrupt') frames.splice(Math.max(1, frames.length - 2));
    for (const frame of frames) {
      if (response.destroyed) return;
      // Exercise arbitrary UTF-8 network segmentation, independently of SSE frames.
      const bytes = Buffer.from(frame);
      const boundary = Math.max(1, Math.floor(bytes.length / 2));
      response.write(bytes.subarray(0, boundary)); response.write(bytes.subarray(boundary)); summary.chunks += 2;
    }
    response.end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  return {
    requests,
    baseUrl(provider, mode = 'good') { if (!providers.has(provider) || !modes.has(mode)) throw new Error('Unknown fixture configuration'); return `http://127.0.0.1:${port}/${provider}/${mode}/v1`; },
    release() { for (const gate of [...gates]) gate(); },
    close() { return closing ??= new Promise(resolve => { for (const timer of timers) { clearInterval(timer); clearTimeout(timer); } for (const gate of [...gates]) gate(); server.close(resolve); for (const socket of sockets) socket.destroy(); }); },
  };
}

function canonicalMessages(body, anthropic, invalid) {
  if (!Array.isArray(body.messages)) return [];
  if (!anthropic) {
    const calls = new Set(body.messages.flatMap(message => message.tool_calls ?? []).map(call => call.id));
    for (const message of body.messages.filter(message => message.role === 'tool')) if (!calls.has(message.tool_call_id)) invalid('Chat result references actual call');
    return body.messages;
  }
  const output = body.system ? [{ role: 'system', content: typeof body.system === 'string' ? body.system : body.system.map(block => block.text ?? '').join('\n') }] : [];
  let previousCalls = new Set();
  for (const message of body.messages) {
    if (!['user', 'assistant'].includes(message.role)) invalid('Messages roles');
    if (typeof message.content === 'string') { output.push(message); previousCalls = new Set(); continue; }
    if (!Array.isArray(message.content)) { invalid('Messages content blocks'); continue; }
    const calls = message.content.filter(block => block.type === 'tool_use');
    const results = message.content.filter(block => block.type === 'tool_result');
    if (calls.length) {
      if (message.role !== 'assistant' || calls.some(call => typeof call.id !== 'string' || typeof call.input !== 'object')) invalid('Messages tool_use shape');
      const thinking = message.content.find(block => block.type === 'thinking');
      if (!thinking || thinking.signature !== 'fixture-preserve-signature' || thinking.thinking !== 'Fixture internal thought.') invalid('Messages thinking signature preserved');
      output.push({ role: 'assistant', content: message.content.filter(block => block.type === 'text').map(block => block.text).join(''), tool_calls: calls.map(call => ({ id: call.id, function: { name: call.name, arguments: JSON.stringify(call.input) } })) });
    }
    if (results.length) {
      if (message.role !== 'user' || results.some((result, index) => message.content[index] !== result || !previousCalls.has(result.tool_use_id))) invalid('Messages tool_result ordering and identity');
      for (const result of results) output.push({ role: 'tool', tool_call_id: result.tool_use_id, content: typeof result.content === 'string' ? result.content : result.content?.map(block => block.text ?? '').join('') });
    }
    const text = message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n');
    if (text && !calls.length) output.push({ role: message.role, content: text });
    previousCalls = new Set(calls.map(call => call.id));
  }
  return output;
}

function stage(messages, tools) {
  const text = messages.map(message => message.content ?? '').join('\n');
  if (text.includes('个人知识图谱整理器')) return 'extract';
  if (tools.includes('check_connection') || messages.some(message => message.tool_calls?.some(call => call.function.name === 'check_connection'))) return 'connection';
  if (tools.length) return 'retrieve';
  const format = [...messages].reverse().find(message => message.role === 'user' && /"blocks"|"hits"/.test(message.content ?? ''))?.content ?? '';
  return format.includes('"blocks"') ? 'answer' : format.includes('"hits"') ? 'search' : 'unknown';
}

function complete(messages, tools, currentStage, sequence) {
  const tool = (name, input) => ({ tool: { id: `call_fixture_${sequence}`, name, input } });
  const results = messages.filter(message => message.role === 'tool');
  if (currentStage === 'connection') return tools.includes('check_connection') ? tool('check_connection', { value: 1 }) : { content: '{"ok":true}' };
  if (currentStage === 'retrieve') {
    if (!results.length) return tool('search_knowledge', { terms: ['Docker', '容器', '终端', 'exec'], mode: 'any' });
    const searchResult = results.map(result => object(result.content)).find(result => result?.results?.length);
    const lastCall = messages.flatMap(message => message.tool_calls ?? []).at(-1);
    if (tools.includes('read_point') && lastCall?.function.name === 'search_knowledge' && searchResult?.results[0]?.handle) return tool('read_point', { handle: searchResult.results[0].handle });
    return { content: '已核对实际本机检索结果。' };
  }
  if (currentStage === 'extract') {
    const input = messages.map(message => object(message.content)).find(value => typeof value?.text === 'string') ?? {};
    const text = input.text ?? MODEL_FIXTURE_TEXT;
    const resourceIds = (input.allowedResources ?? []).map(resource => resource.id);
    const candidate = (id, name, description, topicIds, isTheme, color) => ({ point: { id, name, description, topicIds, resourceIds, isTheme, color }, evidence: [{ quote: text.includes(name) ? name : text.trim().slice(0, 50), inferred: false }] });
    return { content: JSON.stringify({ points: [candidate('n1', 'Docker', '', [], true, 'docker'), candidate('n2', 'Linux', '', [], true, 'linux'), candidate('n3', '进入容器终端', '使用 docker exec -it demo sh。', ['n1', 'n2'], false, 'neutral')], warnings: [] }) };
  }
  const points = results.flatMap(message => object(message.content)?.results ?? []);
  const point = points.find(item => item.name === '进入容器终端');
  if (currentStage === 'search') return { content: JSON.stringify({ hits: point ? [{ handle: point.handle, reason: '实际检索到容器终端操作。' }] : [], note: point ? '' : '未找到本机知识。' }) };
  if (currentStage === 'answer') return { content: JSON.stringify({ blocks: point ? [{ markdown: `本机保存的说明：${point.description}`, basis: 'personal', sourceHandles: [point.sourceHandle] }] : [], note: point ? '' : '本机知识不足。' }) };
  return { content: '{"ok":true}' };
}

function chatFrames(completion, sequence) {
  const event = (delta, finish = null) => `data: ${JSON.stringify({ id: `fixture-${sequence}`, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const output = [event({ role: 'assistant' })];
  if (completion.tool) {
    output.push(event({ tool_calls: [{ index: 0, id: completion.tool.id, type: 'function', function: { name: completion.tool.name, arguments: '' } }] }));
    for (const partial of split(JSON.stringify(completion.tool.input), 9)) output.push(event({ tool_calls: [{ index: 0, function: { arguments: partial } }] }));
  } else for (const text of split(completion.content ?? '')) output.push(event({ content: text }));
  output.push(event({}, completion.truncated ? 'length' : completion.tool ? 'tool_calls' : 'stop'), 'data: [DONE]\n\n');
  return output;
}

function anthropicFrames(completion, sequence) {
  const event = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
  const output = [event({ type: 'message_start', message: { id: `msg-fixture-${sequence}`, role: 'assistant', content: [], stop_reason: null } }), event({ type: 'ping' })];
  if (completion.tool) {
    output.push(event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }), event({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Fixture internal thought.' } }), event({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'fixture-preserve-signature' } }), event({ type: 'content_block_stop', index: 0 }));
    output.push(event({ type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: completion.tool.id, name: completion.tool.name, input: {} } }));
    for (const partial of split(JSON.stringify(completion.tool.input), 7)) output.push(event({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: partial } }));
    output.push(event({ type: 'content_block_stop', index: 1 }));
  } else {
    output.push(event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
    for (const text of split(completion.content ?? '')) output.push(event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }));
    output.push(event({ type: 'content_block_stop', index: 0 }));
  }
  output.push(event({ type: 'message_delta', delta: { stop_reason: completion.truncated ? 'max_tokens' : completion.tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 12 } }), event({ type: 'message_stop' }));
  return output;
}
