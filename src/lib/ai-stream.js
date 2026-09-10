const DEFAULT_AI_STREAM_TIMEOUT_POLICY = Object.freeze({
  connectionTimeoutMs: 150000,
  firstActivityTimeoutMs: 150000,
  idleTimeoutMs: 90000,
  hardTimeoutMs: 600000,
  maxFirstActivityTimeoutMs: 300000,
  maxIdleTimeoutMs: 120000,
  maxHardTimeoutMs: 900000
});

function positiveTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function resolveAiStreamTimeoutPolicy(reasoningEffort = 'auto', overrides = {}) {
  const isMax = String(reasoningEffort || '').trim().toLowerCase() === 'max';
  const defaults = isMax
    ? {
        connectionTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.connectionTimeoutMs,
        firstActivityTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.maxFirstActivityTimeoutMs,
        idleTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.maxIdleTimeoutMs,
        hardTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.maxHardTimeoutMs
      }
    : {
        connectionTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.connectionTimeoutMs,
        firstActivityTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.firstActivityTimeoutMs,
        idleTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.idleTimeoutMs,
        hardTimeoutMs: DEFAULT_AI_STREAM_TIMEOUT_POLICY.hardTimeoutMs
      };
  const source = overrides && typeof overrides === 'object' ? overrides : {};
  return {
    connectionTimeoutMs: positiveTimeout(source.connectionTimeoutMs, defaults.connectionTimeoutMs),
    firstActivityTimeoutMs: positiveTimeout(source.firstActivityTimeoutMs, defaults.firstActivityTimeoutMs),
    idleTimeoutMs: positiveTimeout(source.idleTimeoutMs, defaults.idleTimeoutMs),
    hardTimeoutMs: positiveTimeout(source.hardTimeoutMs, defaults.hardTimeoutMs)
  };
}

function createTimeoutError(phase, hasActivity) {
  const error = new Error('请求超时，请检查网络或稍后重试');
  error.code = 'AI_STREAM_TIMEOUT';
  error.timeoutPhase = phase;
  error.hasActivity = hasActivity;
  error.partial = hasActivity;
  return error;
}

function createAiStream({
  fetchImpl = (...args) => globalThis.fetch(...args),
  AbortControllerImpl = globalThis.AbortController,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  return async function aiStream({
    endpoint,
    apiKey,
    init = {},
    onDelta = () => {},
    connection = null,
    reasoningEffort = 'auto',
    timeoutPolicy = {}
  }) {
    if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');
    if (typeof AbortControllerImpl !== 'function') throw new Error('当前运行环境不支持请求取消');
    const policy = resolveAiStreamTimeoutPolicy(reasoningEffort, timeoutPolicy);
    const target = connection || {};
    const base = target.baseUrl || '';
    const controller = new AbortControllerImpl();
    let phaseTimer = null;
    let hardTimer = null;
    let timeoutPhase = '';
    let activitySeen = false;

    const clearPhaseTimer = () => {
      if (phaseTimer !== null) clearTimeoutImpl(phaseTimer);
      phaseTimer = null;
    };
    const abortForTimeout = phase => {
      if (timeoutPhase) return;
      timeoutPhase = phase;
      controller.abort();
    };
    const armActivityTimer = () => {
      clearPhaseTimer();
      const phase = activitySeen ? 'idle' : 'first-activity';
      const delay = activitySeen ? policy.idleTimeoutMs : policy.firstActivityTimeoutMs;
      phaseTimer = setTimeoutImpl(() => abortForTimeout(phase), delay);
    };
    const markActivity = () => {
      activitySeen = true;
      armActivityTimer();
    };

    phaseTimer = setTimeoutImpl(
      () => abortForTimeout('connection'),
      policy.connectionTimeoutMs
    );
    hardTimer = setTimeoutImpl(
      () => abortForTimeout('hard'),
      policy.hardTimeoutMs
    );

    try {
      const response = await fetchImpl(base + endpoint, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(init.headers || {})
        }
      });
      clearPhaseTimer();
      if (timeoutPhase) throw createTimeoutError(timeoutPhase, activitySeen);
      if (!response.ok) {
        const raw = await response.text();
        let data = null;
        try { data = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON 错误交给统一提示 */ }
        const message = data?.error?.message || data?.message || `请求失败（HTTP ${response.status}）`;
        throw new Error(message);
      }
      if (!response.body?.getReader) throw new Error('服务未返回可读取的流式响应');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finishReason = '';
      let usage = null;
      armActivityTimer();

      const handleEvent = block => {
        const dataLine = block.split(/\r?\n/).find(line => line.startsWith('data:'));
        if (!dataLine) return { done: false, activity: false };
        const payload = dataLine.slice(5).trim();
        if (payload === '[DONE]') return { done: true, activity: false };
        let data;
        try { data = JSON.parse(payload); } catch { return { done: false, activity: false }; }
        const choice = data?.choices?.[0];
        const delta = choice?.delta || {};
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (data?.usage) usage = data.usage;
        const textOf = value => {
          if (typeof value === 'string') return value;
          if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.text || '').join('');
          return '';
        };
        const reasoning = textOf(delta.reasoning_content || delta.reasoning);
        const content = textOf(delta.content);
        const activity = Boolean(reasoning || content);
        if (activity) onDelta({ reasoning, content });
        return { done: false, activity };
      };

      let done = false;
      while (!done) {
        const result = await reader.read();
        buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
        const events = buffer.split(/\r?\n\r?\n/);
        buffer = events.pop() || '';
        for (const event of events) {
          const outcome = handleEvent(event);
          if (outcome.activity) markActivity();
          if (outcome.done) { done = true; break; }
        }
        if (result.done) {
          if (buffer.trim()) {
            const outcome = handleEvent(buffer);
            if (outcome.activity) markActivity();
          }
          done = true;
        }
      }
      return { finishReason: finishReason || 'stop', usage };
    } catch (error) {
      if (timeoutPhase || error?.name === 'AbortError') {
        throw createTimeoutError(
          timeoutPhase || (activitySeen ? 'idle' : 'connection'),
          activitySeen
        );
      }
      throw error;
    } finally {
      clearPhaseTimer();
      if (hardTimer !== null) clearTimeoutImpl(hardTimer);
    }
  };
}

module.exports = {
  DEFAULT_AI_STREAM_TIMEOUT_POLICY,
  createAiStream,
  resolveAiStreamTimeoutPolicy
};
