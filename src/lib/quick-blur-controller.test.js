const assert = require('node:assert/strict');
const test = require('node:test');

const { createQuickBlurController } = require('./quick-blur-controller');

function createHarness() {
  let currentTime = 1000;
  let timerId = 0;
  let dismissed = 0;
  let focused = false;
  const timers = new Map();
  const controller = createQuickBlurController({
    now: () => currentTime,
    setTimer: (handler, delay) => {
      const id = ++timerId;
      timers.set(id, { handler, delay });
      return id;
    },
    clearTimer: id => timers.delete(id),
    shouldDismiss: () => !focused,
    onDismiss: () => { dismissed += 1; }
  });

  return {
    controller,
    timers,
    setFocused(value) { focused = value; },
    advance(ms) { currentTime += ms; },
    runTimers() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.handler();
      }
    },
    get dismissed() { return dismissed; }
  };
}

test('保护期内发生失焦时延迟复查，而不是永久丢弃这次失焦', () => {
  const harness = createHarness();

  const result = harness.controller.handleBlur(1900);

  assert.equal(result.deferred, true);
  assert.equal(harness.timers.size, 1);
  harness.advance(900);
  harness.runTimers();
  assert.equal(harness.dismissed, 1);
});

test('保护期内失焦后重新获得焦点，不再执行延迟退出', () => {
  const harness = createHarness();

  harness.controller.handleBlur(1900);
  harness.setFocused(true);
  harness.controller.cancel();
  harness.advance(900);
  harness.runTimers();

  assert.equal(harness.dismissed, 0);
});

test('保护期结束后的失焦立即退出', () => {
  const harness = createHarness();

  harness.controller.handleBlur(900);

  assert.equal(harness.dismissed, 1);
  assert.equal(harness.timers.size, 0);
});
