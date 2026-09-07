const test = require('node:test');
const assert = require('node:assert/strict');
const {
  attachReportThinking,
  extractReportThinking
} = require('./thinking-snapshot');

test('报告生成后的 AI 思考快照经过持久化后仍可恢复', () => {
  const report = { id: 'report-1', content: '总结正文' };
  const thinking = {
    visible: true,
    open: false,
    phase: 'done',
    text: '先核对本周日报，再整理事项之间的关系。',
    content: '本周完成了两项工作。',
    progressNote: '报告已保存，可以查看、编辑或导出。',
    reasoningLength: 21,
    contentLength: 11,
    sourceCount: 2,
    coveredCount: 2,
    rawRecordCount: 2,
    startedAt: 1000,
    finishedAt: 2500
  };

  const persisted = attachReportThinking(report, thinking);
  const restored = extractReportThinking(JSON.parse(JSON.stringify(persisted)));

  assert.equal(restored.visible, true);
  assert.equal(restored.phase, 'done');
  assert.equal(restored.text, thinking.text);
  assert.equal(restored.content, thinking.content);
  assert.equal(restored.progressNote, thinking.progressNote);
  assert.equal(restored.reasoningLength, 21);
  assert.equal(restored.finishedAt, 2500);
});

test('旧报告没有思考快照时保持兼容', () => {
  assert.equal(extractReportThinking({ id: 'legacy-report' }), null);
});
