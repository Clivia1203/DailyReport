const assert = require('node:assert/strict');
const test = require('node:test');

const {
  DEFAULTS,
  createClosureAutoRefresh
} = require('./closure-autorefresh');

function fakeClock() {
  let current = 0;
  let nextId = 1;
  const timers = new Map();

  function setTimeoutFn(fn, delay) {
    const id = nextId++;
    timers.set(id, { at: current + Math.max(0, Number(delay) || 0), fn });
    return id;
  }

  function clearTimeoutFn(id) {
    timers.delete(id);
  }

  function tick(ms) {
    const target = current + ms;
    while (true) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort(([, a], [, b]) => a.at - b.at)[0];
      if (!due) break;
      const [id, timer] = due;
      timers.delete(id);
      current = timer.at;
      timer.fn();
    }
    current = target;
  }

  return {
    now: () => current,
    setTimeout: setTimeoutFn,
    clearTimeout: clearTimeoutFn,
    tick
  };
}

function eligibleSnapshot(overrides = {}) {
  return {
    enabled: true,
    visible: true,
    hasRecentSources: true,
    cacheStatus: 'source-changed',
    periodKey: 'week|2026-09-07|2026-09-13',
    ...overrides
  };
}

test('近期闭环在后台、小窗、无 AI 或无记录时不会自动触发', () => {
  const clock = fakeClock();
  let calls = 0;
  const scheduler = createClosureAutoRefresh({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDue: () => { calls += 1; }
  });

  for (const snapshot of [
    eligibleSnapshot({ visible: false }),
    eligibleSnapshot({ enabled: false }),
    eligibleSnapshot({ hasRecentSources: false }),
    eligibleSnapshot({ cacheStatus: 'fresh' })
  ]) {
    scheduler.update(snapshot);
    assert.equal(scheduler.request({ reason: 'source-change', delayMs: 0 }).scheduled, false);
  }
  clock.tick(DEFAULTS.debounceMs + DEFAULTS.cooldownMs);
  assert.equal(calls, 0);
});

test('记录变化后等待防抖时间，再自动分析一次', () => {
  const clock = fakeClock();
  const reasons = [];
  const scheduler = createClosureAutoRefresh({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDue: event => reasons.push(event.reason)
  });

  scheduler.update(eligibleSnapshot());
  scheduler.request({ reason: 'source-change', delayMs: DEFAULTS.debounceMs });
  clock.tick(DEFAULTS.debounceMs - 1);
  assert.deepEqual(reasons, []);
  clock.tick(1);
  assert.deepEqual(reasons, ['source-change']);
  scheduler.endAttempt();
});

test('从后台或小窗切换到大窗口时，待更新结果可以立即触发', () => {
  const clock = fakeClock();
  let calls = 0;
  const scheduler = createClosureAutoRefresh({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDue: () => { calls += 1; }
  });

  scheduler.update(eligibleSnapshot({ visible: false }));
  scheduler.update(eligibleSnapshot({ visible: true }));
  scheduler.request({ reason: 'visible', delayMs: 0 });
  assert.equal(calls, 1);
});

test('同一周期自动分析有冷却时间，冷却结束前不会重复消耗 Token', () => {
  const clock = fakeClock();
  let calls = 0;
  const scheduler = createClosureAutoRefresh({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDue: () => { calls += 1; }
  });

  scheduler.update(eligibleSnapshot());
  scheduler.request({ reason: 'visible', delayMs: 0 });
  assert.equal(calls, 1);
  scheduler.endAttempt();
  scheduler.request({ reason: 'retry', delayMs: 0 });
  assert.equal(calls, 1);
  clock.tick(DEFAULTS.cooldownMs - 1);
  assert.equal(calls, 1);
  clock.tick(1);
  assert.equal(calls, 2);
});

test('结果变为最新后会取消尚未执行的自动任务', () => {
  const clock = fakeClock();
  let calls = 0;
  const scheduler = createClosureAutoRefresh({
    now: clock.now,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    onDue: () => { calls += 1; }
  });

  scheduler.update(eligibleSnapshot());
  scheduler.request({ reason: 'source-change', delayMs: DEFAULTS.debounceMs });
  scheduler.update(eligibleSnapshot({ cacheStatus: 'fresh' }));
  clock.tick(DEFAULTS.debounceMs);
  assert.equal(calls, 0);
});
