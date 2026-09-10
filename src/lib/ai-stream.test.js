const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createAiStream,
  resolveAiStreamTimeoutPolicy
} = require('./ai-stream');

function createHarness() {
  let now = 0;
  let nextTimerId = 0;
  const timers = new Map();
  const queuedReads = [];
  let pendingRead = null;
  let aborted = false;

  const flush = () => Promise.resolve().then(() => Promise.resolve());
  const deliver = value => {
    if (pendingRead) {
      const read = pendingRead;
      pendingRead = null;
      read.resolve({ done: false, value });
      return;
    }
    queuedReads.push(value);
  };

  class FakeAbortController {
    constructor() {
      const listeners = new Set();
      this.signal = {
        aborted: false,
        addEventListener: (_type, listener) => listeners.add(listener),
        removeEventListener: (_type, listener) => listeners.delete(listener)
      };
      this.abort = () => {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        aborted = true;
        for (const listener of listeners) listener();
        if (pendingRead) {
          const read = pendingRead;
          pendingRead = null;
          read.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
        }
      };
    }
  }

  const reader = {
    read() {
      if (queuedReads.length) return Promise.resolve({ done: false, value: queuedReads.shift() });
      return new Promise((resolve, reject) => { pendingRead = { resolve, reject }; });
    }
  };

  return {
    fetchImpl: async (_url, options) => {
      options.signal.addEventListener('abort', () => {});
      return { ok: true, body: { getReader: () => reader } };
    },
    AbortControllerImpl: FakeAbortController,
    setTimeoutImpl: (handler, delay) => {
      const id = ++nextTimerId;
      timers.set(id, { at: now + delay, handler });
      return id;
    },
    clearTimeoutImpl: id => timers.delete(id),
    deliver,
    async advance(ms) {
      now += ms;
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= now)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        if (!timers.has(id)) continue;
        timers.delete(id);
        timer.handler();
        await flush();
      }
    },
    flush,
    get aborted() { return aborted; }
  };
}

function sseDelta(content, field = 'content') {
  return new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { [field]: content } }] })}\n\n`);
}

test('流式输出持续超过旧的总时长时不应被固定计时器中断', async () => {
  const harness = createHarness();
  const stream = createAiStream(harness);
  const deltas = [];
  const completion = stream({
    endpoint: '/chat/completions',
    apiKey: 'test-key',
    connection: { baseUrl: 'https://example.test' },
    timeoutPolicy: {
      connectionTimeoutMs: 150,
      firstActivityTimeoutMs: 150,
      idleTimeoutMs: 90,
      hardTimeoutMs: 1000
    },
    onDelta: delta => deltas.push(delta)
  });

  await harness.flush();
  harness.deliver(sseDelta('第一段'));
  await harness.flush();
  await harness.advance(79);
  harness.deliver(sseDelta('第二段'));
  await harness.flush();
  await harness.advance(79);
  harness.deliver(new TextEncoder().encode('data: [DONE]\n\n'));

  const result = await completion;
  assert.equal(result.finishReason, 'stop');
  assert.deepEqual(deltas.map(delta => delta.content), ['第一段', '第二段']);
  assert.equal(harness.aborted, false);
});

test('思考内容持续输出时同样算作流式活跃，不会被固定总时长中断', async () => {
  const harness = createHarness();
  const stream = createAiStream(harness);
  const reasoning = [];
  const completion = stream({
    endpoint: '/chat/completions',
    apiKey: 'test-key',
    connection: { baseUrl: 'https://example.test' },
    timeoutPolicy: {
      connectionTimeoutMs: 150,
      firstActivityTimeoutMs: 150,
      idleTimeoutMs: 90,
      hardTimeoutMs: 1000
    },
    onDelta: delta => reasoning.push(delta.reasoning)
  });

  await harness.flush();
  harness.deliver(sseDelta('先核对记录', 'reasoning_content'));
  await harness.flush();
  await harness.advance(79);
  harness.deliver(sseDelta('再整理结论', 'reasoning_content'));
  await harness.flush();
  await harness.advance(79);
  harness.deliver(new TextEncoder().encode('data: [DONE]\n\n'));

  await completion;
  assert.deepEqual(reasoning, ['先核对记录', '再整理结论']);
  assert.equal(harness.aborted, false);
});

test('流式连接在首段长期没有任何有效输出时仍会超时', async () => {
  const harness = createHarness();
  const stream = createAiStream(harness);
  const completion = stream({
    endpoint: '/chat/completions',
    apiKey: 'test-key',
    connection: { baseUrl: 'https://example.test' },
    timeoutPolicy: {
      connectionTimeoutMs: 150,
      firstActivityTimeoutMs: 150,
      idleTimeoutMs: 90,
      hardTimeoutMs: 1000
    }
  });

  await harness.flush();
  await harness.advance(150);
  await assert.rejects(completion, error => {
    assert.equal(error.code, 'AI_STREAM_TIMEOUT');
    assert.equal(error.timeoutPhase, 'first-activity');
    assert.equal(error.hasActivity, false);
    return true;
  });
});

test('流式连接开始输出后长时间没有新内容会报告可恢复的部分结果', async () => {
  const harness = createHarness();
  const stream = createAiStream(harness);
  const completion = stream({
    endpoint: '/chat/completions',
    apiKey: 'test-key',
    connection: { baseUrl: 'https://example.test' },
    timeoutPolicy: {
      connectionTimeoutMs: 150,
      firstActivityTimeoutMs: 150,
      idleTimeoutMs: 90,
      hardTimeoutMs: 1000
    }
  });

  await harness.flush();
  harness.deliver(sseDelta('已生成正文'));
  await harness.flush();
  await harness.advance(91);
  await assert.rejects(completion, error => {
    assert.equal(error.code, 'AI_STREAM_TIMEOUT');
    assert.equal(error.timeoutPhase, 'idle');
    assert.equal(error.hasActivity, true);
    assert.equal(error.partial, true);
    return true;
  });
});

test('最高思考强度只放宽首段等待和兜底上限，不取消流式空闲保护', () => {
  const normal = resolveAiStreamTimeoutPolicy('high');
  const maximum = resolveAiStreamTimeoutPolicy('max');

  assert.equal(normal.firstActivityTimeoutMs, 150000);
  assert.equal(normal.idleTimeoutMs, 90000);
  assert.equal(maximum.firstActivityTimeoutMs, 300000);
  assert.equal(maximum.idleTimeoutMs, 120000);
  assert.equal(maximum.hardTimeoutMs, 900000);
});
