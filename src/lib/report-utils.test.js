const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  sourceBundle,
  splitSources,
  buildPrompt,
  coveredRefs,
  auditSourceRecords,
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

test('splitSources: 超长周期按记录分段且不丢记录', () => {
  const sources = sourceBundle([
    { id: '1', text: '第一条记录', ts: new Date(2026, 8, 1, 9).getTime(), createdAt: 1 },
    { id: '2', text: '第二条记录', ts: new Date(2026, 8, 1, 10).getTime(), createdAt: 2 },
    { id: '3', text: '第三条记录', ts: new Date(2026, 8, 1, 11).getTime(), createdAt: 3 }
  ]);
  const chunks = splitSources(sources, { maxSources: 2, maxChars: 10000 });
  assert.deepEqual(chunks.map(chunk => chunk.map(source => source.ref)), [['R001', 'R002'], ['R003']]);
  assert.deepEqual(chunks.flat().map(source => source.id), ['1', '2', '3']);
});

test('splitSources: 单条超出目标长度时仍保持记录完整', () => {
  const sources = sourceBundle([{ id: 'long', text: '很长'.repeat(100), ts: Date.now() }]);
  const chunks = splitSources(sources, { maxSources: 40, maxChars: 20 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0][0].id, 'long');
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
  assert.match(prompt, /原始记录未明确/);
  assert.match(prompt, /只输出一个最终版本/);
});

test('buildPrompt: 长周期分段明确只整理当前记录组', () => {
  const sources = sourceBundle(entries).slice(0, 1);
  const prompt = buildPrompt({
    start: '2026-09-01', end: '2026-09-30', periodLabel: '2026 年 9 月工作总结',
    template: '按事项整理', sources, segmentIndex: 1, segmentCount: 3
  });
  assert.match(prompt, /第 2\/3 个分段/);
  assert.match(prompt, /只整理本段提供的原始记录/);
  assert.match(prompt, /本段每一个来源编号/);
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

test('auditSourceRecords: 分别检查 AI 引用和原始明细保留', () => {
  const sources = sourceBundle(entries);
  const output = appendRawRecords('## 本周完成\n- 已完成接口工作 [R001]', sources);
  assert.deepEqual(auditSourceRecords('已完成接口工作 [R001]', output, sources), [
    { ref: 'R001', cited: true, rawPreserved: true },
    { ref: 'R002', cited: false, rawPreserved: true }
  ]);
});

test('markdownToText: 纯文本显示去除 Markdown 标记但保留内容', () => {
  assert.equal(markdownToText('# 标题\n\n- **完成**接口\n\n---'), '标题\n\n• 完成接口\n\n────────────────');
});
