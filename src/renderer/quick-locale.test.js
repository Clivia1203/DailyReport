const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const quickSource = fs.readFileSync(path.join(__dirname, 'quick.js'), 'utf8');

function createHarness({ initialLocale = 'zh-CN', mainLocale = 'en-US' } = {}) {
  const elements = new Map();
  const apiListeners = {};
  const localeSetCalls = [];
  const element = id => {
    const value = {
      value: '',
      textContent: '',
      offsetWidth: 0,
      focus() {},
      classList: { add() {}, remove() {} },
      addEventListener() {}
    };
    elements.set(id, value);
    return value;
  };
  element('quick-input');
  element('quick-status');
  element('quick-dt');
  const bar = { offsetWidth: 0, classList: { add() {}, remove() {} } };
  const i18n = {
    locale: initialLocale,
    t: value => String(value),
    setLocale: async locale => {
      localeSetCalls.push(locale);
      i18n.locale = locale;
      return locale;
    }
  };
  const api = {
    getTheme: () => Promise.resolve('light'),
    getLocale: () => Promise.resolve(mainLocale),
    onThemeChanged: handler => { apiListeners.theme = handler; },
    onLocaleChanged: handler => { apiListeners.locale = handler; },
    onQuickOut: handler => { apiListeners.out = handler; },
    onQuickReset: handler => { apiListeners.reset = handler; },
    quickResetReady() {},
    hideQuick() {},
    add: async () => ({ ok: true })
  };
  const context = {
    document: {
      documentElement: { dataset: {} },
      getElementById: id => elements.get(id),
      querySelector: selector => selector === '.quickbar' ? bar : null
    },
    window: { api, DRI18n: i18n },
    setTimeout: handler => { handler(); return 0; },
    clearTimeout() {},
    setInterval() {},
    Date
  };
  vm.runInNewContext(quickSource, context, { filename: 'quick.js' });
  return {
    i18n,
    apiListeners,
    localeSetCalls,
    flush() { return Promise.resolve().then(() => Promise.resolve()); }
  };
}

test('快速记录条启动时同步主进程语言，避免错过语言广播后保留旧语言', async () => {
  const harness = createHarness({ initialLocale: 'zh-CN', mainLocale: 'en-US' });
  await harness.flush();

  assert.deepEqual(harness.localeSetCalls, ['en-US']);
  assert.equal(harness.i18n.locale, 'en-US');
});
