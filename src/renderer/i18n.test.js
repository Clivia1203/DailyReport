const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const DRLocale = require('../lib/locale');

function loadI18n() {
  const context = {
    DRLocale,
    console,
    api: {
      loadLocale: async locale => ({
        ok: true,
        locale,
        messages: JSON.parse(fs.readFileSync(path.join(__dirname, 'locales', `${locale}.json`), 'utf8'))
      })
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, 'i18n.js'), 'utf8'),
    context,
    { filename: 'i18n.js' }
  );
  return context.DRI18n;
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
