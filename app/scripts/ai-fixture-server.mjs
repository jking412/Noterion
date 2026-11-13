// Deterministic provider adapter for the real Windows application acceptance.
// This module supplies HTTP/SSE responses only; user actions and business
// assertions belong in ai-acceptance.mjs. Never retain headers or prompt text.
import http from 'node:http';

export const AI_FIXTURE_TEXT = '【本机模拟服务验收：非真实 DeepSeek；故障场景预期失败】\nDocker 与 Linux 学习笔记。进入容器终端：docker exec -it demo sh。';

const MODES = new Set([
  'good', 'blank', 'truncated', 'bad-color', 'bad-theme', 'repair-theme', 'unknown-reference', 'cycle',
  'empty', 'unauthorized', 'rate-limit', 'server-error', 'slow',
  'bad-citation', 'bad-tool', 'bad-quote', 'extra-field', 'duplicate-id',
  'self-reference', 'network-drop', 'good-wide',
]);
const MAX_REQUEST_BYTES = 1024 * 1024;

/** @returns {Promise<{baseUrl(mode?: string): string, requests: object[], close(): Promise<void>}>} */
export async function startAiFixture() {
  const requests = [];
  const sockets = new Set();
  const timers = new Set();
  let sequence = 0;
  let closed;
  const server = http.createServer(async (request, response) => {
    const mode = /^\/([a-z-]+)\/chat\/completions\/?$/.exec(request.url ?? '')?.[1];
    const summary = {
      sequence: ++sequence,
      mode: MODES.has(mode) ? mode : 'unsupported',
      stage: 'unknown',
      status: 0,
      requestBytes: 0,
      messageCount: 0,
      toolNames: [],
      responseKind: 'none',
      responseChunks: 0,
      finished: false,
      aborted: false,
    };
    requests.push(summary);
    const responseTimers = new Set();
    const forgetTimers = () => {
      for (const timer of responseTimers) {
        clearTimeout(timer);
        clearInterval(timer);
        timers.delete(timer);
      }
      responseTimers.clear();
    };
    response.once('finish', () => { summary.finished = true; forgetTimers(); });
    response.once('close', () => {
      if (!response.writableFinished) summary.aborted = true;
      forgetTimers();
    });
    request.once('aborted', () => { summary.aborted = true; forgetTimers(); });

    const sendError = (status, message) => {
      summary.status = status;
      summary.responseKind = 'http-error';
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: { message, type: 'fixture_error', code: `fixture_${status}` } }));
    };
    if (request.method !== 'POST' || !MODES.has(mode)) {
      sendError(404, 'Unknown fixture endpoint.');
      request.resume();
      return;
    }
    if (mode === 'network-drop') {
      summary.responseKind = 'network-drop';
      summary.aborted = true;
      request.socket.destroy();
      return;
    }

    // Request data is ephemeral and never attached to summaries, errors or logs.
    let body;
    try {
      const chunks = [];
      for await (const chunk of request) {
        summary.requestBytes += chunk.length;
        if (summary.requestBytes > MAX_REQUEST_BYTES) {
          sendError(413, 'Fixture request is too large.');
          return;
        }
        chunks.push(chunk);
      }
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      if (!response.destroyed && !response.headersSent) sendError(400, 'Invalid fixture request.');
      return;
    }
    if (!body || typeof body !== 'object' || !Array.isArray(body.messages)) {
      sendError(400, 'Fixture expects a messages array.');
      return;
    }
    summary.messageCount = body.messages.length;
    summary.toolNames = Array.isArray(body.tools)
      ? body.tools.map(tool => tool?.function?.name).filter(name => typeof name === 'string').map(name => name.slice(0, 80))
      : [];
    summary.stage = requestStage(body);

    const failureStatus = { unauthorized: 401, 'rate-limit': 429, 'server-error': 503 }[mode];
    if (failureStatus) {
      sendError(failureStatus, 'Deterministic provider failure.');
      return;
    }

    summary.status = 200;
    const stream = body.stream !== false;
    const sseEvent = (delta, finish = null) => {
      return `data: ${JSON.stringify({
        id: `fixture-${summary.sequence}`,
        object: 'chat.completion.chunk',
        created: 1700000000,
        model: 'deepseek-fixture',
        choices: [{ index: 0, delta, finish_reason: finish }],
      })}\n\n`;
    };
    const startSse = () => {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      response.flushHeaders();
    };
    if (mode === 'slow') {
      summary.responseKind = 'slow';
      startSse();
      summary.responseChunks += 1;
      response.write(sseEvent({ role: 'assistant', content: '' }));
      // Regular network chunks allow the real client to observe cancellation.
      // No finish or DONE is sent; close() always clears this interval.
      const timer = setInterval(() => {
        if (!response.destroyed) {
          summary.responseChunks += 1;
          response.write(': fixture heartbeat\n\n');
        }
      }, 100);
      responseTimers.add(timer);
      timers.add(timer);
      return;
    }

    const completion = fixtureCompletion(mode, body, summary.sequence);
    summary.responseKind = completion.tool ? 'tool' : 'content';
    if (!stream) {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({
        id: `fixture-${summary.sequence}`,
        object: 'chat.completion',
        created: 1700000000,
        model: 'deepseek-fixture',
        choices: [{
          index: 0,
          message: completion.tool
            ? { role: 'assistant', content: null, tool_calls: [completion.tool] }
            : { role: 'assistant', content: completion.content },
          finish_reason: completion.finish,
        }],
      }));
      return;
    }
    startSse();
    const events = [sseEvent({ role: 'assistant', content: '' })];
    if (completion.tool) {
      const { id, function: call } = completion.tool;
      const middle = Math.max(1, Math.floor(call.name.length / 2));
      events.push(sseEvent({ tool_calls: [{ index: 0, id, type: 'function', function: { name: call.name.slice(0, middle), arguments: '' } }] }));
      events.push(sseEvent({ tool_calls: [{ index: 0, function: { name: call.name.slice(middle), arguments: '' } }] }));
      for (const fragment of fragments(call.arguments, 13)) {
        events.push(sseEvent({ tool_calls: [{ index: 0, function: { arguments: fragment } }] }));
      }
    } else {
      for (const fragment of fragments(completion.content, 53)) {
        events.push(sseEvent({ content: fragment }));
      }
    }
    events.push(sseEvent({}, completion.finish), 'data: [DONE]\n\n');
    let index = 0;
    const sendNext = () => {
      if (response.destroyed) return;
      if (index === events.length) { response.end(); return; }
      summary.responseChunks += 1;
      response.write(events[index++]);
      const timer = setTimeout(() => {
        responseTimers.delete(timer);
        timers.delete(timer);
        sendNext();
      }, 2);
      responseTimers.add(timer);
      timers.add(timer);
    };
    sendNext();
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const port = server.address().port;
  return {
    baseUrl(mode = 'good') {
      if (!MODES.has(mode)) throw new Error('Unknown AI fixture mode.');
      return `http://127.0.0.1:${port}/${mode}`;
    },
    requests,
    close() {
      if (!closed) closed = new Promise(resolve => {
        for (const timer of timers) { clearTimeout(timer); clearInterval(timer); }
        timers.clear();
        server.close(resolve);
        for (const socket of sockets) socket.destroy();
      });
      return closed;
    },
  };
}

function requestStage(body) {
  if (body.messages.some(message => typeof message?.content === 'string' && message.content.includes('个人知识图谱整理器'))) return 'extract';
  if (Array.isArray(body.tools) && body.tools.length) return 'retrieve';
  const latestContract = [...body.messages].reverse().find(message => message?.role === 'user' && typeof message.content === 'string' && (message.content.includes('"blocks"') || message.content.includes('"hits"')))?.content ?? '';
  if (latestContract.includes('"blocks"')) return 'answer';
  if (latestContract.includes('"hits"')) return 'search';
  return 'connection';
}

function fixtureCompletion(mode, body, sequence) {
  if (mode === 'blank') return { content: '   ', finish: 'stop' };
  if (mode === 'truncated') return { content: '{"points":[', finish: 'length' };
  const stage = requestStage(body);
  if (stage === 'extract') {
    const input = body.messages.map(message => parseObject(message?.content)).find(value => typeof value?.text === 'string') ?? {};
    const text = input.text ?? AI_FIXTURE_TEXT;
    const sourceIds = Array.isArray(input.allowedResources)
      ? input.allowedResources.filter(resource => typeof resource?.id === 'string').map(resource => resource.id)
      : [];
    const quote = term => text.includes(term) ? term : (text.trim().slice(0, 80) || 'fixture input');
    const candidate = (id, name, description, topicIds, isTheme, color) => ({
      point: { id, name, description, topicIds, resourceIds: [...sourceIds], isTheme, color },
      evidence: [{ quote: quote(name), inferred: false }],
    });
    const points = [
      candidate('n1', 'Docker', '', [], true, 'docker'),
      candidate('n2', 'Linux', '', [], true, 'linux'),
      candidate('n3', '进入容器终端', '使用 `docker exec -it demo sh` 进入容器终端。', ['n1', 'n2'], false, 'neutral'),
    ];
    if (mode === 'bad-color') points[2].point.color = 'cyan';
    if (mode === 'bad-theme' || (mode === 'repair-theme' && body.messages.length < 4)) points[0].point.isTheme = false;
    if (mode === 'bad-quote') points[2].evidence[0].quote = '__NOT_IN_INPUT_FIXTURE_QUOTE_4ce9b12a__';
    if (mode === 'extra-field') points[2].point.forbiddenField = true;
    if (mode === 'duplicate-id') points[1].point.id = 'n1';
    if (mode === 'self-reference') points[2].point.topicIds.push('n3');
    if (mode === 'unknown-reference') points[2].point.topicIds.push('not-allowed');
    if (mode === 'cycle') {
      points[0].point.topicIds = ['n2'];
      points[1].point.topicIds = ['n1'];
    }
    return { content: JSON.stringify({ points: mode === 'empty' ? [] : points, warnings: [] }), finish: 'stop' };
  }
  if (stage === 'retrieve') {
    if (mode === 'bad-tool') return {
      tool: { id: `fixture-call-${sequence}`, type: 'function', function: { name: 'delete_knowledge', arguments: '{"handle":"p1"}' } },
      finish: 'tool_calls',
    };
    if (!body.messages.some(message => message?.role === 'tool')) return {
      tool: {
        id: `fixture-call-${sequence}`,
        type: 'function',
        function: { name: 'search_knowledge', arguments: JSON.stringify({ terms: ['Docker', '容器', '终端', 'exec'], mode: 'any' }) },
      },
      finish: 'tool_calls',
    };
    return { content: '已核对本机返回的知识，准备按契约输出。', finish: 'stop' };
  }
  const results = body.messages
    .filter(message => message?.role === 'tool')
    .flatMap(message => {
      const value = parseObject(message.content);
      return Array.isArray(value?.results) ? value.results : [];
    });
  // Only map the fixed fixture point to the opaque handles in this request.
  // This is provider response assembly, never a pass/fail business assertion.
  const point = results.find(item => item?.name === '进入容器终端');
  if (stage === 'answer') {
    const blocks = point ? [{
      markdown: `你保存的操作说明是：\n\n${point.description}`,
      basis: 'personal',
      sourceHandles: [mode === 'bad-citation' ? 's999999' : point.sourceHandle],
    }] : [];
    if (mode === 'bad-citation' && !blocks.length) blocks.push({ markdown: '夹具故意返回无来源回答。', basis: 'personal', sourceHandles: ['s999999'] });
    return { content: JSON.stringify({ blocks, note: blocks.length ? '' : '本机个人知识不足，未找到对应操作说明。' }), finish: 'stop' };
  }
  if (stage === 'search') {
    const hits = mode === 'bad-citation'
      ? [{ handle: 'p999999', reason: '夹具故意返回未检索身份。' }]
      : point ? [{ handle: point.handle, reason: '本机已保存进入容器终端的操作和 docker exec 命令。' }] : [];
    return { content: JSON.stringify({ hits, note: hits.length ? '' : '本机未找到相关知识。' }), finish: 'stop' };
  }
  return { content: '{"ok":true}', finish: 'stop' };
}

function parseObject(value) {
  if (typeof value !== 'string') return null;
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : null; }
  catch { return null; }
}

function fragments(value, size) {
  const characters = Array.from(value ?? '');
  const chunks = [];
  for (let i = 0; i < characters.length; i += size) chunks.push(characters.slice(i, i + size).join(''));
  return chunks;
}
