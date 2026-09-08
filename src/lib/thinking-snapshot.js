/* AI 工作过程的持久化快照：只保存可恢复 UI 所需的纯数据，不保存任务运行时对象。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRThinkingSnapshot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const MAX_TEXT_LENGTH = 512 * 1024;

  function text(value) {
    return typeof value === 'string' ? value.slice(0, MAX_TEXT_LENGTH) : '';
  }

  function count(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  }

  function timestamp(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function normalizeThinkingSnapshot(snapshot, { defaultPhase = 'done' } = {}) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const phase = typeof snapshot.phase === 'string' && snapshot.phase.trim()
      ? snapshot.phase.trim()
      : defaultPhase;
    return {
      visible: snapshot.visible !== false,
      open: !!snapshot.open,
      phase,
      text: text(snapshot.text),
      content: text(snapshot.content),
      locale: text(snapshot.locale).slice(0, 16),
      segment: count(snapshot.segment),
      totalSegments: count(snapshot.totalSegments),
      continuation: count(snapshot.continuation),
      maxContinuations: count(snapshot.maxContinuations),
      progressNote: text(snapshot.progressNote),
      reasoningLength: count(snapshot.reasoningLength),
      contentLength: count(snapshot.contentLength),
      sourceCount: count(snapshot.sourceCount),
      coveredCount: count(snapshot.coveredCount),
      rawRecordCount: count(snapshot.rawRecordCount),
      finishReason: text(snapshot.finishReason),
      startedAt: timestamp(snapshot.startedAt),
      finishedAt: timestamp(snapshot.finishedAt)
    };
  }

  function attachReportThinking(report, thinking) {
    if (!report || typeof report !== 'object') return report;
    const next = { ...report };
    const snapshot = normalizeThinkingSnapshot(thinking);
    if (snapshot) next.thinking = snapshot;
    else delete next.thinking;
    return next;
  }

  function extractReportThinking(report) {
    return normalizeThinkingSnapshot(report?.thinking);
  }

  return {
    normalizeThinkingSnapshot,
    attachReportThinking,
    extractReportThinking
  };
});
