const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROVIDER_ID,
  getProvider,
  listProviders,
  normalizeProviderId,
  normalizeBaseUrl,
  preferredModels,
  extractModelIds,
  buildChatRequestBody
} = require('./ai-providers');

test('AI 平台目录保留 DeepSeek 默认值并提供通用兼容平台', () => {
  assert.equal(DEFAULT_PROVIDER_ID, 'deepseek');
  assert.equal(normalizeProviderId('unknown'), 'deepseek');
  assert.equal(getProvider('openai').defaultBaseUrl, 'https://api.openai.com/v1');
  assert.deepEqual(listProviders().map(provider => provider.id), ['deepseek', 'openai', 'custom']);
});

test('AI 平台地址按平台补默认值并清理末尾斜杠', () => {
  assert.equal(normalizeBaseUrl('', 'deepseek'), 'https://api.deepseek.com');
  assert.equal(normalizeBaseUrl('', 'openai'), 'https://api.openai.com/v1');
  assert.equal(normalizeBaseUrl('https://example.test/v1///', 'custom'), 'https://example.test/v1');
  assert.equal(normalizeBaseUrl('', 'custom'), '');
});

test('模型目录兼容 data 和 models 两种常见返回结构', () => {
  assert.deepEqual(extractModelIds({ data: [{ id: 'a' }, { id: 'a' }, 'b'] }), ['a', 'b']);
  assert.deepEqual(extractModelIds({ models: [{ name: 'c' }, { id: 'd' }] }), ['c', 'd']);
});

test('DeepSeek 保留思考和 JSON 参数，通用平台不发送 DeepSeek 专用字段', () => {
  const deepSeekBody = buildChatRequestBody('deepseek', {
    model: 'deepseek-v4-pro',
    messages: [{ role: 'user', content: 'x' }],
    thinkingEnabled: true,
    reasoningEffort: 'high',
    jsonModeEnabled: true,
    streamOptions: { include_usage: true },
    maxTokens: 100
  });
  assert.deepEqual(deepSeekBody.thinking, { type: 'enabled' });
  assert.equal(deepSeekBody.reasoning_effort, 'high');
  assert.deepEqual(deepSeekBody.response_format, { type: 'json_object' });

  const customBody = buildChatRequestBody('custom', {
    model: 'provider-model',
    messages: [],
    thinkingEnabled: true,
    reasoningEffort: 'high',
    jsonModeEnabled: true,
    streamOptions: { include_usage: true }
  });
  assert.equal('thinking' in customBody, false);
  assert.equal('reasoning_effort' in customBody, false);
  assert.equal('response_format' in customBody, false);
  assert.equal('stream_options' in customBody, false);
});

test('不同平台仍共享 DeepSeek 之外的空模型偏好', () => {
  assert.deepEqual(preferredModels('deepseek', 'report'), ['deepseek-v4-flash', 'deepseek-v4-pro']);
  assert.deepEqual(preferredModels('openai', 'report'), []);
  assert.deepEqual(preferredModels('custom', 'closure'), []);
});
