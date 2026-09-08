const {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  normalizeLocale
} = require('./locale');

const TEMPLATE_TYPES = Object.freeze(['day', 'week', 'month', 'custom']);
const PROMPT_SCHEMA_VERSION = 2;
const PROMPT_MAX_LENGTH = 2400;
const TEMPLATE_MAX_LENGTH = 12000;

const CATALOG = Object.freeze({
  'zh-CN': require('../prompts/zh-CN.json'),
  'en-US': require('../prompts/en-US.json'),
  'ja-JP': require('../prompts/ja-JP.json')
});

function cleanValue(value, maxLength) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function createPromptOverrides() {
  return {
    reportTemplates: Object.fromEntries(TEMPLATE_TYPES.map(type => [type, {}])),
    closure: {},
    terminologyDiscovery: {}
  };
}

function copyLocaleValue(target, source, locale, maxLength) {
  if (!source || typeof source !== 'object') return;
  const value = cleanValue(source[locale], maxLength);
  if (value) target[locale] = value;
}

function normalizePromptOverrides(value) {
  const result = createPromptOverrides();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;

  const reportTemplates = value.reportTemplates;
  if (reportTemplates && typeof reportTemplates === 'object' && !Array.isArray(reportTemplates)) {
    for (const type of TEMPLATE_TYPES) {
      const source = reportTemplates[type];
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
      for (const locale of SUPPORTED_LOCALES) {
        copyLocaleValue(result.reportTemplates[type], source, locale, TEMPLATE_MAX_LENGTH);
      }
    }
  }
  for (const key of ['closure', 'terminologyDiscovery']) {
    for (const locale of SUPPORTED_LOCALES) {
      copyLocaleValue(result[key], value[key], locale, PROMPT_MAX_LENGTH);
    }
  }
  return result;
}

function catalogFor(locale) {
  const normalized = normalizeLocale(locale) || DEFAULT_LOCALE;
  return CATALOG[normalized] || CATALOG[DEFAULT_LOCALE];
}

function defaultPrompt(locale, kind, type) {
  const catalog = catalogFor(locale);
  if (kind === 'reportTemplate') return cleanValue(catalog.reportTemplates?.[type], TEMPLATE_MAX_LENGTH);
  if (kind === 'closure') return cleanValue(catalog.closurePrompt, PROMPT_MAX_LENGTH);
  if (kind === 'terminologyDiscovery') return cleanValue(catalog.terminologyDiscoveryPrompt, PROMPT_MAX_LENGTH);
  return '';
}

function overrideBucket(overrides, kind, type) {
  if (kind === 'reportTemplate') return overrides?.reportTemplates?.[type];
  return overrides?.[kind];
}

function resolvePrompt({ locale, overrides, kind, type } = {}) {
  const resolvedLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
  const bucket = overrideBucket(overrides, kind, type);
  const custom = cleanValue(bucket?.[resolvedLocale], kind === 'reportTemplate' ? TEMPLATE_MAX_LENGTH : PROMPT_MAX_LENGTH);
  if (custom) return { value: custom, source: 'custom', locale: resolvedLocale };
  return { value: defaultPrompt(resolvedLocale, kind, type), source: 'default', locale: resolvedLocale };
}

function writePromptOverride(overrides, { locale, kind, type, value } = {}) {
  const normalizedLocale = normalizeLocale(locale) || DEFAULT_LOCALE;
  const normalized = normalizePromptOverrides(overrides);
  const bucket = overrideBucket(normalized, kind, type);
  if (!bucket) return resolvePrompt({ locale: normalizedLocale, overrides: normalized, kind, type });

  const maxLength = kind === 'reportTemplate' ? TEMPLATE_MAX_LENGTH : PROMPT_MAX_LENGTH;
  const cleaned = cleanValue(value, maxLength);
  if (!cleaned || cleaned === defaultPrompt(normalizedLocale, kind, type)) delete bucket[normalizedLocale];
  else bucket[normalizedLocale] = cleaned;

  Object.assign(overrides, normalized);
  return resolvePrompt({ locale: normalizedLocale, overrides, kind, type });
}

function migrateLegacyPromptOverrides(source) {
  const overrides = normalizePromptOverrides(source?.promptOverrides);
  if (Number(source?.promptSchemaVersion) >= PROMPT_SCHEMA_VERSION) return overrides;
  const writeLegacy = (kind, type, value) => {
    const cleaned = cleanValue(value, kind === 'reportTemplate' ? TEMPLATE_MAX_LENGTH : PROMPT_MAX_LENGTH);
    if (!cleaned || cleaned === defaultPrompt(DEFAULT_LOCALE, kind, type)) return;
    const bucket = overrideBucket(overrides, kind, type);
    if (bucket && !bucket[DEFAULT_LOCALE]) bucket[DEFAULT_LOCALE] = cleaned;
  };

  for (const type of TEMPLATE_TYPES) writeLegacy('reportTemplate', type, source?.reportTemplates?.[type]);
  writeLegacy('closure', undefined, source?.closurePrompt);
  writeLegacy('terminologyDiscovery', undefined, source?.terminologyDiscoveryPrompt);
  return overrides;
}

function promptSourceMap(locale, overrides) {
  const reportTemplates = {};
  for (const type of TEMPLATE_TYPES) {
    reportTemplates[type] = resolvePrompt({ locale, overrides, kind: 'reportTemplate', type }).source;
  }
  return {
    reportTemplates,
    closure: resolvePrompt({ locale, overrides, kind: 'closure' }).source,
    terminologyDiscovery: resolvePrompt({ locale, overrides, kind: 'terminologyDiscovery' }).source
  };
}

function validateCatalog() {
  for (const locale of SUPPORTED_LOCALES) {
    const catalog = CATALOG[locale];
    if (!catalog || !catalog.reportTemplates) throw new Error(`缺少 ${locale} 的报告模板目录`);
    for (const type of TEMPLATE_TYPES) {
      if (!defaultPrompt(locale, 'reportTemplate', type)) throw new Error(`${locale} 缺少 ${type} 报告模板`);
    }
    if (!defaultPrompt(locale, 'closure') || !defaultPrompt(locale, 'terminologyDiscovery')) {
      throw new Error(`${locale} 缺少 AI 提示词`);
    }
  }
  return true;
}

module.exports = {
  TEMPLATE_TYPES,
  PROMPT_SCHEMA_VERSION,
  PROMPT_MAX_LENGTH,
  CATALOG,
  catalogFor,
  createPromptOverrides,
  normalizePromptOverrides,
  defaultPrompt,
  resolvePrompt,
  writePromptOverride,
  migrateLegacyPromptOverrides,
  promptSourceMap,
  validateCatalog
};
