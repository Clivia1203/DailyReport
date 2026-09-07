/* 应用语言配置：安装器、主进程和渲染进程共用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRLocale = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_LOCALE = 'zh-CN';
  const SUPPORTED_LOCALES = Object.freeze(['zh-CN', 'en-US', 'ja-JP']);

  function normalizeLocale(value) {
    const raw = String(value || '').trim().replace('_', '-').toLowerCase();
    if (!raw) return null;
    if (raw === 'zh' || raw === 'zh-cn' || raw === 'zh-sg' || raw === '2052') return 'zh-CN';
    if (raw === 'en' || raw === 'en-us' || raw === '1033') return 'en-US';
    if (raw === 'ja' || raw === 'ja-jp' || raw === '1041') return 'ja-JP';
    return SUPPORTED_LOCALES.find(locale => locale.toLowerCase() === raw) || null;
  }

  function localeFromInstallerLanguage(value) {
    return normalizeLocale(value) || DEFAULT_LOCALE;
  }

  return {
    DEFAULT_LOCALE,
    SUPPORTED_LOCALES,
    normalizeLocale,
    localeFromInstallerLanguage
  };
});
