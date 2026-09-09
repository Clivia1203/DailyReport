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

  function createReportThinkingCache({ maxEntries = 12 } = {}) {
    const snapshots = new Map();
    const limit = Math.max(1, Math.floor(Number(maxEntries) || 1));
    return {
      read(period) {
        const key = reportThinkingKey(period);
        const value = snapshots.get(key) || null;
        if (value) {
          // 读取也算一次使用，避免正在反复查看的周期被淘汰。
          snapshots.delete(key);
          snapshots.set(key, value);
        }
        return value;
      },
      write(period, thinking) {
        if (thinking) {
          const key = reportThinkingKey(period);
          snapshots.delete(key);
          snapshots.set(key, thinking);
          while (snapshots.size > limit) snapshots.delete(snapshots.keys().next().value);
        }
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
