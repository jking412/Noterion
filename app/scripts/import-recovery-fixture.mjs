// Deterministic local HTTP/SSE responses for the actual desktop recovery path.
// This fixture never contacts an official API or retains prompts/credentials.
import http from 'node:http';
import assert from 'node:assert/strict';

export const RECOVERY_KEYS = Object.freeze({ deepseek: 'synthetic-deepseek-34', openai: 'synthetic-openai-34', anthropic: 'synthetic-anthropic-34' });
export const RECOVERY_TEXT = '😀 Docker 学习笔记。\r\n进入容器终端：docker\t exec -it demo sh。\r\nLinux 记录。';
const modes = new Set(['mixed', 'missing', 'excess', 'normalized', 'good', 'unrecoverable', 'unauthorized', 'slow', 'structure']);
const parse = value => { try { return JSON.parse(value); } catch { return undefined; } };

export async function startRecoveryFixture() {
  const requests = [], sockets = new Set(), timers = new Set();
  let mode = 'mixed';
  const server = http.createServer(async (request, response) => {
    const route = /^\/(deepseek|openai|anthropic)\/v1\/(chat\/completions|messages)$/.exec(request.url ?? '');
    const provider = route?.[1], anthropic = provider === 'anthropic';
    const summary = { sequence: requests.length + 1, provider: provider ?? 'unknown', mode, repair: false, structureRepair: false, sourceIdRepair: false, status: 0, violations: [], finished: false, aborted: false };
    requests.push(summary);
    response.once('finish', () => { summary.finished = true; });
    response.once('close', () => { if (!response.writableFinished) summary.aborted = true; });
    const fail = (status, type) => { summary.status = status; response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: { type, message: 'Deterministic local fixture failure.' } })); };
    if (!route || request.method !== 'POST') { request.resume(); fail(404, 'endpoint'); return; }
    let body;
    try {
      const parts = []; let size = 0;
      for await (const part of request) { size += part.length; if (size > 2_000_000) { fail(413, 'size'); return; } parts.push(part); }
      body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    } catch { fail(400, 'json'); return; }
    const violation = rule => summary.violations.push(rule);
    if (route[2] !== (anthropic ? 'messages' : 'chat/completions')) violation('native protocol endpoint');
    if (anthropic) {
      if (request.headers['x-api-key'] !== RECOVERY_KEYS[provider] || request.headers.authorization) violation('isolated Messages authentication');
      if (!request.headers['anthropic-version']) violation('Messages version header');
    } else {
      if (request.headers.authorization !== `Bearer ${RECOVERY_KEYS[provider]}` || request.headers['x-api-key']) violation('isolated Chat authentication');
      if (provider === 'openai' && ('thinking' in body || 'reasoning_effort' in body)) violation('no DeepSeek-only parameters');
    }
    if (body.stream !== true || !Array.isArray(body.messages) || !body.model) violation('stream model messages');
    if (summary.violations.length) { fail(422, 'contract'); return; }
    if (mode === 'unauthorized') { fail(401, 'authentication_error'); return; }
    summary.status = 200;
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' }); response.flushHeaders();
    if (mode === 'slow') {
      response.write(': waiting for desktop cancellation\n\n');
      const timer = setInterval(() => { if (!response.destroyed) response.write(': keepalive\n\n'); }, 100);
      timers.add(timer); response.once('close', () => { clearInterval(timer); timers.delete(timer); }); return;
    }
    // Messages appends the JSON-only instruction as a second text block;
    // Chat Completions appends a separate user message. Preserve each text
    // block while inspecting the actual business request in either protocol.
    const messages = body.messages.flatMap(message => typeof message.content === 'string'
      ? [{ ...message, content: message.content }]
      : (message.content ?? []).filter(block => block.type === 'text').map(block => ({ role: message.role, content: block.text })));
    const input = messages.map(message => parse(message.content)).find(value => typeof value?.text === 'string') ?? {};
    const latest = messages.map(message => parse(message.content)).findLast(value => value?.sourceRepair === true);
    const repair = !!latest;
    summary.repair = repair;
    summary.structureRepair = !repair && messages.some(message => message.role === 'assistant');
    let content;
    if (repair) {
      const previous = messages.filter(message => message.role === 'assistant').map(message => parse(message.content)).find(value => value?.points);
      const candidates = latest.candidates ?? previous?.points?.map(item => ({ id: item.point.id, name: item.point.name })) ?? [];
      const original = input.text ?? RECOVERY_TEXT;
      content = JSON.stringify({ repairs: candidates.map(candidate => {
        const id = candidate.id ?? candidate.point?.id;
        if (mode === 'unrecoverable') return { id, evidence: [] };
        const name = candidate.name ?? candidate.point?.name;
        const passage = (latest.sourcePassages ?? []).find(passage => passage.text.includes(name));
        if (passage && mode !== 'missing') {
          summary.sourceIdRepair = true;
          return { id, sourceIds: [passage.id] };
        }
        // Keep the older quote-response contract covered without inventing a
        // source: a missing relevant span yields an unresolved repair.
        return { id, evidence: original.includes(name) ? [{ quote: name, inferred: false }] : [] };
      }) });
    } else if (mode === 'structure' && !summary.structureRepair) content = '{"points":';
    else {
      const original = input.text ?? RECOVERY_TEXT;
      const resourceIds = (input.allowedResources ?? []).map(resource => resource.id);
      const candidate = (id, name, description, topicIds, isTheme, color) => ({ point: { id, name, description, topicIds, resourceIds, isTheme, color }, evidence: [{ quote: name, inferred: false }] });
      const points = [candidate('n1', 'Docker', '', [], true, 'docker'), candidate('n2', '进入容器终端', 'docker exec -it demo sh', ['n1'], false, 'neutral'), candidate('n3', 'Linux', '', [], true, 'linux')].filter(item => original.includes(item.point.name));
      if (mode === 'missing' || mode === 'mixed' || mode === 'unrecoverable' || mode === 'structure') { const item = points.find(item => item.point.id === 'n1'); if (item) item.evidence = []; }
      if (mode === 'excess' || mode === 'mixed') { const item = points.find(item => item.point.id === 'n3'); if (item) item.evidence = Array.from({ length: 9 }, () => ({ quote: 'Linux', inferred: false })); }
      if (mode === 'normalized' || mode === 'mixed') { const item = points.find(item => item.point.id === 'n2'); if (item) item.evidence = [{ quote: '进入容器终端：docker exec -it demo sh。', inferred: false }]; }
      content = JSON.stringify({ points, warnings: [] });
    }
    const frames = anthropic ? messageFrames(content, summary.sequence) : chatFrames(content, summary.sequence);
    for (const frame of frames) { const bytes = Buffer.from(frame); const midpoint = Math.floor(bytes.length / 2); response.write(bytes.subarray(0, midpoint)); response.write(bytes.subarray(midpoint)); }
    response.end();
  });
  server.on('connection', socket => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    requests,
    mode(next) { assert.ok(modes.has(next)); mode = next; },
    baseUrl(provider) { assert.ok(provider in RECOVERY_KEYS); return `http://127.0.0.1:${server.address().port}/${provider}/v1`; },
    close() { return new Promise(resolve => { for (const timer of timers) clearInterval(timer); server.close(resolve); for (const socket of sockets) socket.destroy(); }); },
  };
}

function chatFrames(content, sequence) {
  const event = (delta, finish = null) => `data: ${JSON.stringify({ id: `recovery-${sequence}`, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  return [event({ role: 'assistant' }), ...pieces(content).map(text => event({ content: text })), event({}, 'stop'), 'data: [DONE]\n\n'];
}
function messageFrames(content, sequence) {
  const event = value => `event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`;
  return [event({ type: 'message_start', message: { id: `msg-recovery-${sequence}`, role: 'assistant', content: [], stop_reason: null } }), event({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }), ...pieces(content).map(text => event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })), event({ type: 'content_block_stop', index: 0 }), event({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } }), event({ type: 'message_stop' })];
}
function pieces(value) { const chars = Array.from(value), parts = []; for (let index = 0; index < chars.length; index += 23) parts.push(chars.slice(index, index + 23).join('')); return parts; }
