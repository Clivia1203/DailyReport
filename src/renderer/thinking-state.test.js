const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createThinkingState,
  appendThinkingProgress,
  finalizeThinkingState,
  elapsedSeconds,
  toggleThinking,
  preserveThinking
} = require('./thinking-state');

test('最近一次思考快照在切页后保留文本和展开状态', () => {
  let thinking = createThinkingState({ visible: true, startedAt: 100 });
  thinking = appendThinkingProgress(thinking, {
    phase: 'thinking',
    text: '先对照历史记录，再核对本期完成结果。',
    reasoningLength: 18
  });
  thinking = toggleThinking(thinking);
  const restored = preserveThinking(thinking);

  assert.equal(restored.visible, true);
  assert.equal(restored.open, true);
  assert.equal(restored.text, '先对照历史记录，再核对本期完成结果。');
  assert.equal(restored.reasoningLength, 18);
  assert.equal(restored.startedAt, 100);
});

test('新的 AI 生成会从干净快照开始，不混入上一次思考内容', () => {
  const previous = createThinkingState({ visible: true, startedAt: 100 });
  const next = createThinkingState({ visible: true, startedAt: 200 });
  assert.equal(previous.text, '');
  assert.equal(next.text, '');
  assert.equal(next.open, false);
  assert.equal(next.startedAt, 200);
});

test('同一份思考快照同时保留思考文本和 AI 最终输出', () => {
  let thinking = createThinkingState({ visible: true, startedAt: 100 });
  thinking = appendThinkingProgress(thinking, { phase: 'thinking', text: '先核对日报上下文。' });
  thinking = appendThinkingProgress(thinking, { phase: 'writing', text: '{"terms":[]}' });

  assert.equal(thinking.text, '先核对日报上下文。');
  assert.equal(thinking.content, '{"terms":[]}');
});

test('已结束的思考快照冻结结束时间，切回页面后不会继续累加耗时', () => {
  const thinking = finalizeThinkingState(
    createThinkingState({ visible: true, startedAt: 100 }),
    'done',
    2250
  );

  assert.equal(thinking.phase, 'done');
  assert.equal(thinking.finishedAt, 2250);
  assert.equal(thinking.startedAt, 100);
  assert.equal(elapsedSeconds(thinking, 2250), 2);
});
