const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const quickSource = fs.readFileSync(path.join(__dirname, 'quick.js'), 'utf8');

function createQuickHarness() {
  const listeners = new Map();
  const timers = new Map();
  const elements = new Map();
  let timerId = 0;
  let hideCalls = 0;
  const resetReadyCalls = [];

  function element(id) {
    const value = {
      value: '',
      textContent: '',
      offsetWidth: 0,
      focus() {},
      classList: {
        add() {},
        remove() {}
      },
      addEventListener(type, handler) {
        listeners.set(`${id}:${type}`, handler);
      }
    };
    elements.set(id, value);
    return value;
  }

  const input = element('quick-input');
  const status = element('quick-status');
  const dt = element('quick-dt');
  const bar = {
    offsetWidth: 0,
    classList: {
      add() {},
      remove() {}
    }
  };
  const apiListeners = {};
  const api = {
    getTheme: () => Promise.resolve('light'),
    onThemeChanged: handler => { apiListeners.theme = handler; },
    onQuickOut: handler => { apiListeners.out = handler; },
    onQuickReset: handler => { apiListeners.reset = handler; },
    quickResetReady: generation => { resetReadyCalls.push(generation); },
    hideQuick: () => { hideCalls += 1; },
    add: async () => ({ ok: true })
  };

  const context = {
    document: {
      documentElement: { dataset: {} },
      getElementById: id => elements.get(id),
      querySelector: selector => selector === '.quickbar' ? bar : null
    },
    window: { api },
    setTimeout: (handler, delay) => {
      const id = ++timerId;
      timers.set(id, { handler, delay });
      return id;
    },
    clearTimeout: id => timers.delete(id),
    setInterval: () => 0,
    Date
  };

  vm.runInNewContext(quickSource, context, { filename: 'quick.js' });

  return {
    input,
    apiListeners,
    flushTimers() {
      for (const [id, timer] of [...timers]) {
        timers.delete(id);
        timer.handler();
      }
    },
    get hideCalls() { return hideCalls; },
    get resetReadyCalls() { return resetReadyCalls; }
  };
}

test('快速记录条重新唤起时取消上一轮退出回调，避免新一轮被旧回调隐藏', () => {
  const harness = createQuickHarness();

  // 失焦/热键切换开始退出，随后托盘点击在退出回调执行前重新唤起。
  harness.apiListeners.out();
  harness.apiListeners.reset();
  harness.apiListeners.out();
  harness.apiListeners.reset();
  harness.flushTimers();

  assert.equal(harness.hideCalls, 0, '重新唤起后不应执行上一轮延迟隐藏');
});

test('快速记录条忽略旧一轮退出事件，避免旧事件关闭新一轮窗口', () => {
  const harness = createQuickHarness();

  harness.apiListeners.reset(2);
  harness.apiListeners.out(1);
  harness.flushTimers();

  assert.equal(harness.hideCalls, 0, '旧一轮退出事件不应隐藏当前窗口');
});

test('快速记录条首次唤起未收到 reset 时，仍能处理当前退出事件', () => {
  const harness = createQuickHarness();

  // 首次创建窗口时 reset 可能早于页面脚本监听器到达；随后收到的
  // 当前代次退出事件不能因为 quickSession 仍为 0 而被静默丢弃。
  harness.apiListeners.out(1);
  harness.flushTimers();

  assert.equal(harness.hideCalls, 1, '当前代次退出事件应触发一次隐藏请求');
});

test('快速记录条完成复位后回执当前代次，主进程可安全显示窗口', () => {
  const harness = createQuickHarness();

  harness.apiListeners.reset(3);

  assert.deepEqual(harness.resetReadyCalls, [3], '复位完成后应回执同一代次');
});
