const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  closureSourceBundle,
  splitClosureHistory,
  buildClosurePrompt,
  parseClosureResponse,
  mergeClosureResults,
  closureInputHash,
  closureCacheKey,
  findCachedClosure,
  findLatestClosure,
  closureCacheStatus,
  hydrateClosureResult,
  filterResolvedClosureSuggestions
} = require('./closure-utils');

const entries = [
  { id: 'old', text: '双轴测试存在问题，待继续排查', ts: new Date('2026-08-28T12:00:00').getTime() },
  { id: 'new', text: 'DP310-X2 两轴测试完成，可以发给客户使用', ts: new Date('2026-09-05T12:00:00').getTime() }
];

test('闭环来源会区分历史 H 和当前 N，并保持日期顺序', () => {
  const historical = closureSourceBundle([entries[0]], 'H');
  const recent = closureSourceBundle([entries[1]], 'N');
  assert.equal(historical[0].ref, 'H001');
  assert.equal(recent[0].ref, 'N001');
  assert.equal(recent[0].text, entries[1].text);
});

test('历史记录按来源数和字符数分批，不会丢掉记录', () => {
  const sources = closureSourceBundle(Array.from({ length: 5 }, (_, i) => ({
    id: `e${i}`,
    text: `记录 ${i}`,
    ts: i + 1
  })), 'H');
  const chunks = splitClosureHistory(sources, { maxSources: 2, maxChars: 10000 });
  assert.deepEqual(chunks.map(chunk => chunk.length), [2, 2, 1]);
  assert.deepEqual(chunks.flat().map(source => source.ref), ['H001', 'H002', 'H003', 'H004', 'H005']);
});

test('闭环提示词要求当前记录全部参与，并包含术语和宏观降级规则', () => {
  const prompt = buildClosurePrompt({
    start: '2026-08-31',
    end: '2026-09-06',
    recentSources: closureSourceBundle([entries[1]], 'N'),
    historicalSources: closureSourceBundle([entries[0]], 'H'),
    terminology: [{ canonicalName: 'DP310-X2', aliases: ['双轴', '两轴'], scope: '', note: '' }],
    customPrompt: '只整理近期完成的事项，不总结整个项目。'
  });
  assert.match(prompt, /DP310-X2/);
  assert.match(prompt, /当前周期记录（必须全部参与判断）/);
  assert.match(prompt, /提升到产品族或宏观层级/);
  assert.match(prompt, /只整理近期完成的事项/);
  assert.match(prompt, /合法 JSON/);
});

test('闭环响应支持 JSON 围栏，并清理无效来源引用', () => {
  const parsed = parseClosureResponse('```json\n{"completed_items":[{"title":"DP310-X2 双轴测试已完成","summary":"问题已解决","confidence":"high","before_refs":["H001","X001"],"recent_refs":["N001"]}]}\n```');
  assert.equal(parsed.completed_items.length, 1);
  assert.deepEqual(parsed.completed_items[0].before_refs, ['H001']);
  assert.deepEqual(parsed.completed_items[0].recent_refs, ['N001']);
});

test('术语已确认后旧闭环缓存不再重复返回同一待确认关联', () => {
  const summary = {
    needs_confirmation: [
      {
        alias: '产品部要求出差查看问题（家中无法复现）',
        canonical_name: '铭工现场售前问题',
        reason: '上下文可能相关，但尚未确认',
        before_refs: ['H009'],
        recent_refs: ['N002']
      },
      {
        alias: '另一个叫法',
        canonical_name: '另一个术语',
        reason: '仍待确认',
        before_refs: ['H001'],
        recent_refs: ['N001']
      }
    ]
  };
  const filtered = filterResolvedClosureSuggestions(summary, [
    {
      canonicalName: '铭工现场售前问题',
      aliases: ['产品部要求出差查看问题（家中无法复现）'],
      scope: ''
    }
  ]);

  assert.equal(filtered.needs_confirmation.length, 1);
  assert.equal(filtered.needs_confirmation[0].alias, '另一个叫法');
  assert.notEqual(filtered, summary);
});

test('分批结果会合并同一闭环的证据并保留高置信度', () => {
  const merged = mergeClosureResults([
    { completed_items: [{ title: 'DP310-X2 双轴测试已完成', summary: '完成阶段一', confidence: 'medium', before_refs: ['H001'], recent_refs: ['N001'] }] },
    { completed_items: [{ title: 'DP310-X2 双轴测试已完成', summary: '测试结果已经可以交付', confidence: 'high', before_refs: ['H002'], recent_refs: ['N001'] }] }
  ]);
  assert.equal(merged.completed_items.length, 1);
  assert.equal(merged.completed_items[0].confidence, 'high');
  assert.deepEqual(merged.completed_items[0].before_refs, ['H001', 'H002']);
});

test('闭环指纹覆盖历史和术语变化，缓存键包含周期', () => {
  const recent = closureSourceBundle([entries[1]], 'N');
  const history = closureSourceBundle([entries[0]], 'H');
  const first = closureInputHash(recent, history, [{ canonicalName: 'DP310-X2', aliases: ['双轴'] }]);
  const second = closureInputHash(recent, history, [{ canonicalName: 'DP310-X2', aliases: ['双轴', '两轴'] }]);
  assert.notEqual(first, second);
  assert.equal(closureCacheKey({ start: '2026-08-31', end: '2026-09-06', inputHash: first, terminologyHash: 't' }), `week|2026-08-31|2026-09-06|${first}|t|`);
  assert.notEqual(
    closureCacheKey({ start: '2026-08-31', end: '2026-09-06', inputHash: first, terminologyHash: 't', promptHash: 'p1' }),
    closureCacheKey({ start: '2026-08-31', end: '2026-09-06', inputHash: first, terminologyHash: 't', promptHash: 'p2' })
  );
});

test('闭环缓存只在周期和完整输入指纹都相同时命中', () => {
  const summaries = [
    { id: 'old', periodType: 'week', start: '2026-08-31', end: '2026-09-06', cacheKey: 'old', inputHash: 'old', terminologyHash: 't', updatedAt: 1 },
    { id: 'new', periodType: 'week', start: '2026-08-31', end: '2026-09-06', cacheKey: 'new', inputHash: 'new', terminologyHash: 't', updatedAt: 2 }
  ];
  const params = { periodType: 'week', start: '2026-08-31', end: '2026-09-06', cacheKey: 'new', inputHash: 'new', terminologyHash: 't' };
  assert.equal(findCachedClosure(summaries, params).id, 'new');
  assert.equal(findLatestClosure(summaries, { ...params, cacheKey: 'missing' }).id, 'new');
  assert.equal(closureCacheStatus(summaries[1], params), 'fresh');
  assert.equal(closureCacheStatus(summaries[1], { ...params, inputHash: 'changed', cacheKey: 'changed' }), 'source-changed');
  assert.equal(closureCacheStatus({ ...summaries[1], promptHash: 'p1' }, { ...params, cacheKey: 'changed', promptHash: 'p2' }), 'prompt-changed');
});

test('证据展示使用本地原文，而不是信任 AI 自己改写的引用文本', () => {
  const result = hydrateClosureResult({
    completed_items: [{ title: '闭环', summary: '已完成', before_refs: ['H001'], recent_refs: ['N001'] }]
  }, new Map([
    ['H001', { ref: 'H001', date: '2026-08-28', time: '12:00', text: '原始历史内容' }],
    ['N001', { ref: 'N001', date: '2026-09-05', time: '12:00', text: '原始当前内容' }]
  ]));
  assert.equal(result.completed_items[0].before_evidence[0].text, '原始历史内容');
  assert.equal(result.completed_items[0].recent_evidence[0].text, '原始当前内容');
});
