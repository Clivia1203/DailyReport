/* AI 平台目录和 OpenAI 兼容请求适配。
 * 主进程和渲染层共用；平台差异集中在这里，业务流程只依赖统一的请求参数。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRAiProviders = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEFAULT_PROVIDER_ID = 'deepseek';
  const PROVIDERS = Object.freeze({
    deepseek: Object.freeze({
      id: 'deepseek',
      label: 'DeepSeek',
      defaultBaseUrl: 'https://api.deepseek.com',
      supportsReasoningControl: true,
      supportsJsonMode: true,
      supportsStreamOptions: true,
      preferredModels: {
        report: Object.freeze(['deepseek-v4-flash', 'deepseek-v4-pro']),
        closure: Object.freeze(['deepseek-v4-pro', 'deepseek-reasoner', 'deepseek-v4-flash', 'deepseek-chat'])
      }
    }),
    openai: Object.freeze({
      id: 'openai',
      label: 'OpenAI',
      defaultBaseUrl: 'https://api.openai.com/v1',
      supportsReasoningControl: false,
      supportsJsonMode: true,
      supportsStreamOptions: true,
      preferredModels: { report: Object.freeze([]), closure: Object.freeze([]) }
    }),
    custom: Object.freeze({
      id: 'custom',
      label: '自定义 OpenAI 兼容',
      defaultBaseUrl: '',
      supportsReasoningControl: false,
      supportsJsonMode: false,
      supportsStreamOptions: false,
      preferredModels: { report: Object.freeze([]), closure: Object.freeze([]) }
    })
  });

  function normalizeProviderId(value) {
    const id = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PROVIDERS, id) ? id : DEFAULT_PROVIDER_ID;
  }

  function getProvider(value) {
    return PROVIDERS[normalizeProviderId(value)];
  }

  function normalizeBaseUrl(value, providerId = DEFAULT_PROVIDER_ID) {
    const provider = getProvider(providerId);
    const input = String(value ?? '').trim().replace(/\/+$/, '');
    return input || provider.defaultBaseUrl;
  }

  function listProviders() {
    return Object.values(PROVIDERS).map(provider => ({
      id: provider.id,
      label: provider.label,
      defaultBaseUrl: provider.defaultBaseUrl,
      supportsReasoningControl: provider.supportsReasoningControl
    }));
  }

  function preferredModels(providerId, role) {
    const provider = getProvider(providerId);
    return [...(provider.preferredModels?.[role] || [])];
  }

  function extractModelIds(payload) {
    const list = Array.isArray(payload?.data)
      ? payload.data
      : Array.isArray(payload?.models)
      ? payload.models
      : [];
    return [...new Set(list.map(item => {
      if (typeof item === 'string') return item.trim();
      return String(item?.id || item?.name || '').trim();
    }).filter(Boolean))];
  }

  function buildChatRequestBody(providerId, options = {}) {
    const provider = getProvider(providerId);
    const body = {
      model: String(options.model || '').trim(),
      messages: Array.isArray(options.messages) ? options.messages : [],
      stream: options.stream !== false
    };

    if (provider.supportsReasoningControl) {
      body.thinking = { type: options.thinkingEnabled ? 'enabled' : 'disabled' };
      if (options.thinkingEnabled && options.reasoningEffort) {
        body.reasoning_effort = options.reasoningEffort;
      }
    }
    if (provider.supportsJsonMode && options.jsonModeEnabled) {
      body.response_format = { type: 'json_object' };
    }
    if (provider.supportsStreamOptions && options.streamOptions) {
      body.stream_options = options.streamOptions;
    }
    if (Number.isFinite(options.maxTokens)) body.max_tokens = options.maxTokens;
    return body;
  }

  return {
    DEFAULT_PROVIDER_ID,
    getProvider,
    listProviders,
    normalizeProviderId,
    normalizeBaseUrl,
    preferredModels,
    extractModelIds,
    buildChatRequestBody
  };
});
