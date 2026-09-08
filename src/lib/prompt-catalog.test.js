const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CATALOG,
  TEMPLATE_TYPES,
  createPromptOverrides,
  defaultPrompt,
  migrateLegacyPromptOverrides,
  normalizePromptOverrides,
  promptSourceMap,
  resolvePrompt,
  validateCatalog,
  writePromptOverride
} = require('./prompt-catalog');

test('三种语言都提供完整的外部 AI 提示词目录', () => {
  assert.equal(validateCatalog(), true);
  for (const locale of ['zh-CN', 'en-US', 'ja-JP']) {
    assert.ok(CATALOG[locale]);
    for (const type of TEMPLATE_TYPES) {
      assert.equal(typeof CATALOG[locale].reportTemplates[type], 'string');
      assert.ok(CATALOG[locale].reportTemplates[type].trim());
    }
    assert.ok(CATALOG[locale].closurePrompt.trim());
    assert.ok(CATALOG[locale].terminologyDiscoveryPrompt.trim());
  }
});

test('提示词优先使用当前语言的自定义内容，否则使用当前语言默认值', () => {
  const overrides = createPromptOverrides();
  const englishDefault = resolvePrompt({ locale: 'en-US', overrides, kind: 'closure' });
  assert.equal(englishDefault.source, 'default');
  assert.equal(englishDefault.value, defaultPrompt('en-US', 'closure'));

  writePromptOverride(overrides, {
    locale: 'zh-CN',
    kind: 'closure',
    value: '我的中文闭环规则'
  });
  assert.equal(resolvePrompt({ locale: 'zh-CN', overrides, kind: 'closure' }).value, '我的中文闭环规则');
  assert.equal(resolvePrompt({ locale: 'en-US', overrides, kind: 'closure' }).source, 'default');
});

test('恢复默认只删除当前语言覆盖，不影响其他语言', () => {
  const overrides = createPromptOverrides();
  writePromptOverride(overrides, { locale: 'zh-CN', kind: 'closure', value: '中文自定义' });
  writePromptOverride(overrides, { locale: 'en-US', kind: 'closure', value: 'English custom' });
  writePromptOverride(overrides, { locale: 'zh-CN', kind: 'closure', value: defaultPrompt('zh-CN', 'closure') });
  assert.equal(resolvePrompt({ locale: 'zh-CN', overrides, kind: 'closure' }).source, 'default');
  assert.equal(resolvePrompt({ locale: 'en-US', overrides, kind: 'closure' }).value, 'English custom');
});

test('旧版本的单份中文提示词迁移到 zh-CN，并保留自定义内容', () => {
  const overrides = migrateLegacyPromptOverrides({
    locale: 'en-US',
    closurePrompt: '用户写过的中文规则',
    terminologyDiscoveryPrompt: defaultPrompt('zh-CN', 'terminologyDiscovery'),
    reportTemplates: {
      day: '用户写过的中文模板'
    }
  });
  assert.equal(resolvePrompt({ locale: 'zh-CN', overrides, kind: 'closure' }).value, '用户写过的中文规则');
  assert.equal(resolvePrompt({ locale: 'en-US', overrides, kind: 'closure' }).source, 'default');
  assert.equal(resolvePrompt({ locale: 'zh-CN', overrides, kind: 'reportTemplate', type: 'day' }).value, '用户写过的中文模板');
  assert.equal(resolvePrompt({ locale: 'zh-CN', overrides, kind: 'terminologyDiscovery' }).source, 'default');
});

test('新版本已经有按语言覆盖时，不会再次把运行中的其他语言内容迁移到中文', () => {
  const overrides = migrateLegacyPromptOverrides({
    promptSchemaVersion: 2,
    locale: 'en-US',
    closurePrompt: '当前英文生效内容',
    promptOverrides: {
      closure: { 'en-US': '当前英文自定义内容' }
    }
  });
  assert.equal(overrides.closure['zh-CN'], undefined);
  assert.equal(overrides.closure['en-US'], '当前英文自定义内容');
});

test('提示词目录结构归一化时不会接受未知语言或非法数组', () => {
  const normalized = normalizePromptOverrides({
    reportTemplates: { day: { 'zh-CN': '有效', 'xx-XX': '忽略' } },
    closure: { 'en-US': '英文' },
    terminologyDiscovery: []
  });
  assert.equal(normalized.reportTemplates.day['zh-CN'], '有效');
  assert.equal(normalized.reportTemplates.day['xx-XX'], undefined);
  assert.equal(normalized.closure['en-US'], '英文');
  assert.deepEqual(promptSourceMap('ja-JP', normalized).reportTemplates, {
    day: 'default', week: 'default', month: 'default', custom: 'default'
  });
});
