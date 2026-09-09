const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const DRLocale = require('../lib/locale');

function loadI18n(extra = {}) {
  const context = {
    DRLocale,
    console,
    api: {
      loadLocale: async locale => ({
        ok: true,
        locale,
        messages: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${locale}.json`), 'utf8'))
      })
    },
    ...extra
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8'),
    context,
    { filename: 'i18n.js' }
  );
  return context.DRI18n;
}

function createFakeDocument() {
  let trackedNode = null;
  let observer = null;
  const document = {
    title: '日报随手记',
    documentElement: {},
    body: {},
    dispatchEvent() {},
    querySelectorAll() { return []; },
    createTreeWalker() {
      let emitted = false;
      return {
        nextNode() {
          if (emitted || !trackedNode) return null;
          emitted = true;
          return trackedNode;
        }
      };
    }
  };
  class FakeMutationObserver {
    constructor(callback) {
      observer = { callback };
    }
    observe() {}
  }
  return {
    document,
    Node: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
    NodeFilter: { SHOW_TEXT: 4 },
    MutationObserver: FakeMutationObserver,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
    setTrackedNode(node) { trackedNode = node; },
    notifyAddedNode(node) {
      observer?.callback([{ type: 'childList', addedNodes: [node] }]);
    }
  };
}

test('界面语言支持中英日，且会翻译动态状态文案', async () => {
  const i18n = loadI18n();
  assert.equal(i18n.locale, 'zh-CN');
  assert.equal(await i18n.setLocale('en-US'), 'en-US');
  assert.equal(i18n.t('工作记录'), 'Work log');
  assert.equal(i18n.t('AI 正在思考 · 第 2/3 段 · 4s'), 'AI is thinking · segment 2/3 · 4s');
  assert.equal(await i18n.setLocale('ja-JP'), 'ja-JP');
  assert.equal(i18n.t('设置'), '設定');
  assert.equal(i18n.t('本周期没有记录'), 'この期間の記録はありません');
  assert.equal(i18n.t('例如：名称不明确时只保留通用名称'), '例：名称が不明確な場合は一般名称だけを使用');
  assert.equal(i18n.t('安装时选择的语言，也可以在这里切换；切换后立即生效。'), 'インストール時の言語はここでも変更でき、変更はすぐに反映されます。');
});

test('多语言层不会改写用户记录和 AI 思考正文', async () => {
  const i18n = loadI18n();
  await i18n.setLocale('en-US');
  const userText = '项目 DP3S-705-MQ 已完成，下一步继续观察。';
  assert.equal(i18n.translateText(userText), userText);
  assert.equal(i18n.translateText('AI 正在处理 · 3s'), 'AI is processing · 3s');
});

test('报告缓存状态、问候语和日期完整切换语言', async () => {
  const i18n = loadI18n();
  await i18n.setLocale('ja-JP');
  assert.equal(i18n.t('夜深了'), '夜更けです');
  assert.equal(i18n.t('9 月 8 日 星期一'), '9月8日（月）');
  assert.equal(i18n.t('最近完成了什么'), '最近完了したこと');
  assert.equal(
    i18n.t('报告模板已变化，当前显示上一次生成的报告；点击“重新生成”即可更新。'),
    'レポートテンプレートが変更されたため、前回生成したレポートを表示しています。「再生成」をクリックすると更新できます。'
  );
});

test('动态数量和模型更新状态在中英日之间都能切换', async () => {
  const i18n = loadI18n();
  await i18n.setLocale('en-US');
  assert.equal(i18n.t('3 条'), '3 entries');
  assert.equal(i18n.t('2 项'), '2 items');
  assert.equal(
    i18n.t('当前模型已更新为 gpt-5，总结已生成，已保留全部原始记录。'),
    'Current model updated to gpt-5; Summary generated; all original records are preserved.'
  );
  await i18n.setLocale('ja-JP');
  assert.equal(i18n.t('3 条'), '3件');
  assert.equal(i18n.t('2 项'), '2項目');
  assert.equal(
    i18n.t('当前模型已更新为 gpt-5，总结已生成，已保留全部原始记录。'),
    '現在のモデルをgpt-5に更新しました。まとめを生成しました。元の記録はすべて保持されています。'
  );
});

test('动态节点记录源文案后可以连续切换语言', async () => {
  const fake = createFakeDocument();
  const i18n = loadI18n(fake);
  await i18n.setLocale('en-US');
  const node = { nodeType: 3, nodeValue: i18n.t('最近完成了什么'), parentElement: null };
  fake.setTrackedNode(node);
  fake.notifyAddedNode(node);
  assert.equal(node.nodeValue, 'What was recently completed');
  await i18n.setLocale('ja-JP');
  assert.equal(node.nodeValue, '最近完了したこと');
  await i18n.setLocale('zh-CN');
  assert.equal(node.nodeValue, '最近完成了什么');
});

test('静态 HTML 文案和属性都存在三语言外部目录', () => {
  const values = new Set();
  for (const file of ['index.html', 'quick.html']) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    for (const match of source.matchAll(/["']([^"']*)["']/g)) values.add(match[1]);
    for (const match of source.matchAll(/>([^<>]+)</g)) values.add(match[1].trim());
  }
  const isCjk = value => [...value].some(ch => ch.codePointAt(0) >= 0x3400 && ch.codePointAt(0) <= 0x9fff);
  const keys = [...values].filter(value => value && isCjk(value));
  for (const locale of DRLocale.SUPPORTED_LOCALES) {
    const messages = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${locale}.json`), 'utf8'));
    const missing = keys.filter(key => !(key in messages));
    assert.deepEqual(missing, [], `${locale} 缺少 HTML 文案：${missing.join('、')}`);
  }
});

test('app 中的静态 uiText 文案都存在三语言外部目录', () => {
  const source = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
  const re = /uiText\(\s*(?:"([^"]*)"|\x27([^\x27]*)\x27)\s*\)/g;
  const keys = new Set();
  let match;
  while ((match = re.exec(source))) keys.add(match[1] ?? match[2]);

  for (const locale of DRLocale.SUPPORTED_LOCALES) {
    const messages = JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${locale}.json`), 'utf8'));
    const missing = [...keys].filter(key => !(key in messages));
    assert.deepEqual(missing, [], `${locale} 缺少静态文案：${missing.join('、')}`);
  }
});
