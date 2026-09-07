/* 仅在渲染进程内维护最近一次 AI 思考快照；不写入日报数据或导出文件。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRThinkingState = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const phases = new Set([
    'queued', 'thinking', 'writing', 'segment', 'continuing', 'recovering', 'fallback',
    'stream-done', 'saving', 'saved', 'done', 'incomplete', 'error', 'segment-done'
  ]);

  function createThinkingState({ visible = false, phase = '', startedAt } = {}) {
    const active = !!visible;
    return {
      visible: active,
      open: false,
      phase: active ? (phase || 'thinking') : '',
      text: '',
      content: '',
      segment: 0,
      totalSegments: 0,
      continuation: 0,
      maxContinuations: 0,
      progressNote: '',
      reasoningLength: 0,
      contentLength: 0,
      sourceCount: 0,
      coveredCount: 0,
      rawRecordCount: 0,
      finishReason: '',
      startedAt: active
        ? (Number.isFinite(startedAt) ? startedAt : Date.now())
        : 0,
      finishedAt: 0
    };
  }

  function finalizeThinkingState(thinking, phase = 'done', finishedAt) {
    const current = { ...(thinking || createThinkingState()) };
    return {
      ...current,
      phase,
      finishedAt: Number.isFinite(finishedAt) ? finishedAt : Date.now()
    };
  }

  function elapsedSeconds(thinking, now = Date.now()) {
    const startedAt = Number(thinking?.startedAt) || 0;
    if (!startedAt) return 0;
    const endedAt = Number(thinking?.finishedAt) || now;
    return Math.max(0, Math.floor((endedAt - startedAt) / 1000));
  }

  function appendThinkingProgress(thinking, progress) {
    const next = { ...(thinking || createThinkingState()) };
    if (!progress) return next;
    if (Number.isFinite(progress.segment)) next.segment = progress.segment;
    if (Number.isFinite(progress.totalSegments)) next.totalSegments = progress.totalSegments;
    if (Number.isFinite(progress.continuation)) next.continuation = progress.continuation;
    if (Number.isFinite(progress.maxContinuations)) next.maxContinuations = progress.maxContinuations;
    if (Number.isFinite(progress.reasoningLength)) next.reasoningLength = progress.reasoningLength;
    if (Number.isFinite(progress.contentLength)) next.contentLength = progress.contentLength;
    if (Number.isFinite(progress.sourceCount)) next.sourceCount = progress.sourceCount;
    if (Number.isFinite(progress.coveredCount)) next.coveredCount = progress.coveredCount;
    if (Number.isFinite(progress.rawRecordCount)) next.rawRecordCount = progress.rawRecordCount;
    if (progress.finishReason) next.finishReason = progress.finishReason;
    if (phases.has(progress.phase)) next.phase = progress.phase;
    if (progress.phase === 'thinking' && progress.text) next.text += progress.text;
    if (progress.phase === 'writing' && progress.text) next.content += progress.text;
    if (['queued', 'thinking', 'writing', 'segment', 'continuing', 'recovering', 'fallback',
      'stream-done', 'saving'].includes(progress.phase)) next.finishedAt = 0;
    return next;
  }

  function toggleThinking(thinking) {
    const current = thinking || createThinkingState();
    return { ...current, open: !current.open };
  }

  function preserveThinking(thinking) {
    return thinking?.visible ? { ...thinking } : createThinkingState();
  }

  return {
    createThinkingState,
    finalizeThinkingState,
    elapsedSeconds,
    appendThinkingProgress,
    toggleThinking,
    preserveThinking
  };
});
