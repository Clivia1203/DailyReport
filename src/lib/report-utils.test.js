const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sourceBundle,
  buildPrompt,
  coveredRefs,
  appendRawRecords,
  markdownToText
} = require('./report-utils');

const entries = [
  { id: 'b', text: '修复导出问题', ts: new Date(2026, 8, 2, 13, 40).getTime(), createdAt: 2 },
  { id: 'a', text: '完成接口联调', ts: new Date(2026, 8, 1, 9, 12).getTime(), createdAt: 1 }
];

test('sourceBundle: 按时间排序并生成稳定来源编号', () => {
  const sources = sourceBundle(entries);
  assert.deepEqual(sources.map(s => s.ref), ['R001', 'R002']);
  assert.equal(sources[0].text, '完成接口联调');
  assert.equal(sources[1].date, '2026-09-02');
});

test('buildPrompt: 包含模板、周期和全部原始记录编号', () => {
  const sources = sourceBundle(entries);
  const prompt = buildPrompt({
    start: '2026-09-01', end: '2026-09-02', periodLabel: '本周',
    template: '按完成/问题/计划分组', sources
  });
  assert.match(prompt, /本周/);
  assert.match(prompt, /按完成\/问题\/计划分组/);
  assert.match(prompt, /\[R001\].*完成接口联调/);
  assert.match(prompt, /\[R002\].*修复导出问题/);
});

test('coveredRefs: 能识别完整与不完整的来源引用', () => {
  const sources = sourceBundle(entries);
  assert.deepEqual(coveredRefs('完成接口联调 [R001]', sources).map(s => s.ref), ['R001']);
  assert.deepEqual(coveredRefs('完成接口联调 [R001] 修复导出问题【R002】', sources).map(s => s.ref), ['R001', 'R002']);
});

test('appendRawRecords: 无论 AI 正文如何改写都附带完整原始记录', () => {
  const sources = sourceBundle(entries);
  const output = appendRawRecords('## 本周完成\n- 已完成接口工作 [R001]', sources);
  assert.match(output, /## 原始记录明细/);
  assert.match(output, /09:12  完成接口联调/);
  assert.match(output, /13:40  修复导出问题/);
});

test('markdownToText: 纯文本显示去除 Markdown 标记但保留内容', () => {
  assert.equal(markdownToText('# 标题\n\n- **完成**接口\n\n---'), '标题\n\n• 完成接口\n\n────────────────');
});
