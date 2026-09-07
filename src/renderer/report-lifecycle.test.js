const test = require('node:test');
const assert = require('node:assert/strict');
const {
  reportViewTransition,
  reportContentTransition,
  createReportThinkingCache
} = require('./report-lifecycle');

test('生成中离开总结页再返回时保留进行中的报告状态', () => {
  assert.deepEqual(reportViewTransition({ loading: true }), {
    preserveGeneration: true,
    resetReport: false,
    hideThinking: false
  });
});

test('没有生成任务时进入总结页仍会读取当前周期缓存', () => {
  assert.deepEqual(reportViewTransition({ loading: false }), {
    preserveGeneration: false,
    resetReport: true,
    hideThinking: true
  });
});

test('已有最近一次思考快照时切回总结页不会隐藏思考过程', () => {
  assert.deepEqual(reportViewTransition({ loading: false, hasThinking: true }), {
    preserveGeneration: false,
    resetReport: true,
    hideThinking: false
  });
});

test('切换总结周期或显示内容时保留最近一次 AI 工作过程', () => {
  assert.deepEqual(reportContentTransition({ hasThinking: true }), {
    resetReport: true,
    hideThinking: false,
    preserveThinking: true
  });
});

test('不同报告周期分别保存 AI 工作过程，空周期不会继承其他周期', () => {
  const cache = createReportThinkingCache();
  const weekWithRecords = { type: 'week', start: '2026-08-17', end: '2026-08-23' };
  const emptyWeek = { type: 'week', start: '2026-08-10', end: '2026-08-16' };
  const thinking = { visible: true, phase: 'done', content: '上一周的总结输出' };

  cache.write(weekWithRecords, thinking);

  assert.equal(cache.read(emptyWeek), null);
  assert.equal(cache.read(weekWithRecords), thinking);
});

test('生成中的工作台采用原位更新，避免重置展开按钮和转圈动画', () => {
  const { liveRenderStrategy } = require('./report-lifecycle');
  assert.equal(liveRenderStrategy({
    generating: true,
    hasExistingCard: true,
    hasThinking: true,
    hasProgress: true
  }), 'patch');
  assert.equal(liveRenderStrategy({
    generating: true,
    hasExistingCard: false,
    hasThinking: false,
    hasProgress: false
  }), 'rebuild');
});
