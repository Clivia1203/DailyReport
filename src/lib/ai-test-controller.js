/* 管理设置页 AI 连接测试的当前请求，避免旧请求回写新配置。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRAiTestController = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function createAiTestController({ onCancel = () => {} } = {}) {
    let sequence = 0;
    let activeId = 0;

    return {
      start() {
        if (activeId) {
          activeId = 0;
          onCancel();
        }
        activeId = ++sequence;
        return activeId;
      },
      cancel() {
        if (!activeId) return false;
        activeId = 0;
        onCancel();
        return true;
      },
      isCurrent(id) {
        return Number.isInteger(id) && id > 0 && id === activeId;
      },
      finish(id) {
        if (!this.isCurrent(id)) return false;
        activeId = 0;
        return true;
      }
    };
  }

  return { createAiTestController };
});
