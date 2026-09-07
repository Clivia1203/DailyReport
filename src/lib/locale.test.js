const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalizeLocale,
  localeFromInstallerLanguage
} = require('./locale');

test('语言配置默认使用简体中文，并只接受中英日三种语言', () => {
  assert.equal(DEFAULT_LOCALE, 'zh-CN');
  assert.deepEqual(SUPPORTED_LOCALES, ['zh-CN', 'en-US', 'ja-JP']);
  assert.equal(normalizeLocale('zh_CN'), 'zh-CN');
  assert.equal(normalizeLocale('en'), 'en-US');
  assert.equal(normalizeLocale('ja-JP'), 'ja-JP');
  assert.equal(normalizeLocale('fr-FR'), null);
});

test('安装器语言编号可以映射为应用语言', () => {
  assert.equal(localeFromInstallerLanguage('2052'), 'zh-CN');
  assert.equal(localeFromInstallerLanguage('1033'), 'en-US');
  assert.equal(localeFromInstallerLanguage('1041'), 'ja-JP');
  assert.equal(localeFromInstallerLanguage('unknown'), 'zh-CN');
});
