/* 总结页进入/返回时的状态策略，保持生成任务与页面显示状态解耦。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRReportLifecycle = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function reportViewTransition({ loading = false, hasThinking = false } = {}) {
    const preserveGeneration = !!loading;
    const keepThinking = preserveGeneration || !!hasThinking;
    return {
      preserveGeneration,
      resetReport: !preserveGeneration,
      hideThinking: !keepThinking
    };
  }

  function reportContentTransition({ hasThinking = false } = {}) {
    return {
      resetReport: true,
      hideThinking: false,
      preserveThinking: !!hasThinking
    };
  }

  function reportThinkingKey({ type = '', start = '', end = '' } = {}) {
    return [type, start, end].map(value => String(value || '')).join('|');
  }

  function createReportThinkingCache() {
    const snapshots = new Map();
    return {
      read(period) {
        return snapshots.get(reportThinkingKey(period)) || null;
      },
      write(period, thinking) {
        if (thinking) snapshots.set(reportThinkingKey(period), thinking);
        return thinking;
      },
      clear() {
        snapshots.clear();
      }
    };
  }

  function liveRenderStrategy({
    generating = false,
    hasExistingCard = false,
    hasThinking = false,
    hasProgress = false
  } = {}) {
    return generating && hasExistingCard && hasThinking && hasProgress
      ? 'patch'
      : 'rebuild';
  }

  return {
    reportViewTransition,
    reportContentTransition,
    createReportThinkingCache,
    liveRenderStrategy
  };
});
