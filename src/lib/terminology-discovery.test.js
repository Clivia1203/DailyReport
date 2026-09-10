const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverySources,
  splitDiscoverySources,
  buildDiscoveryPrompt,
  buildConsolidationPrompt,
  parseTerminologyResponse,
  parseTerminologyResponseDetailed,
  mergeTerminologyResults,
  normalizeDiscoveryState
} = require('./terminology-discovery');

const entries = [
  { id: 'b', text: 'DP3C-X2 硬件飞线问题解决，可以给客户发去使用', ts: new Date(2026, 8, 2, 13, 40).getTime(), createdAt: 2 },
  { id: 'a', text: '双轴推进驱动器现场测试，等待硬件确认', ts: new Date(2026, 7, 31, 9, 12).getTime(), createdAt: 1 },
  { id: 'c', text: '两轴功率段继续排查', ts: new Date(2026, 8, 3, 10, 0).getTime(), createdAt: 3 }
];

test('discoverySources 和分批提示词覆盖全部日报', () => {
  const sources = discoverySources(entries);
  const chunks = splitDiscoverySources(sources, { maxSources: 1, maxChars: 10000 });
  const prompts = chunks.map(chunk => buildDiscoveryPrompt(chunk));
  assert.equal(prompts.length, entries.length);
  for (const source of sources) {
    assert.ok(prompts.some(prompt => prompt.includes(`[${source.ref}]`) && prompt.includes(source.text)));
  }
});

test('parseTerminologyResponse: 能处理代码围栏、蛇形字段和字符串别名', () => {
  const result = parseTerminologyResponse('```json\n{"terms":[{"canonical_name":"DP3C-X2","aliases":["双轴","两轴"],"scope":"驱动器"}]}\n```');
  assert.equal(result.length, 1);
  assert.equal(result[0].canonicalName, 'DP3C-X2');
  assert.deepEqual(result[0].aliases, ['双轴', '两轴']);
  assert.equal(result[0].scope, '驱动器');
});

test('parseTerminologyResponse: 忽略思考块并提取最终 JSON', () => {
  const result = parseTerminologyResponse([
    '<think>先分析输出格式：{"terms":[]}，然后再给出最终结果。</think>',
    '下面是结果：',
    '```json',
    '{"terms":[{"canonical_name":"DP3C-X2","aliases":["双轴"]}]}',
    '```',
    '以上。'
  ].join('\n'));
  assert.equal(result.length, 1);
  assert.equal(result[0].canonicalName, 'DP3C-X2');
  assert.deepEqual(result[0].aliases, ['双轴']);
});

test('parseTerminologyResponse: 多段说明中的空示例不会遮挡最终词典', () => {
  const result = parseTerminologyResponse([
    '示例格式：{"terms":[]}',
    '最终结果：{"terms":[{"canonical_name":"双轴步进驱动器","aliases":["双轴"]}]}'
  ].join('\n'));
  assert.equal(result.length, 1);
  assert.equal(result[0].canonicalName, '双轴步进驱动器');
});

test('parseTerminologyResponseDetailed: 不确定关系单独返回，不混入已确认术语', () => {
  const result = parseTerminologyResponseDetailed(JSON.stringify({
    terms: [{ canonical_name: 'DP3C-X2', aliases: ['双轴'] }],
    uncertain_matches: [{
      left: { canonical_name: 'DP3C-X2', aliases: ['双轴'] },
      right: { canonical_name: 'DP3C-X2量产前整改', aliases: ['双轴问题'] },
      reason: '记录没有明确说明范围是否相同',
      confidence: 'low'
    }]
  }));
  assert.deepEqual(result.terms.map(item => item.canonicalName), ['DP3C-X2']);
  assert.equal(result.uncertainRelations.length, 1);
  assert.equal(result.uncertainRelations[0].right.canonicalName, 'DP3C-X2量产前整改');
  assert.equal(parseTerminologyResponse(JSON.stringify({
    terms: [],
    uncertain_matches: result.uncertainRelations
  })).length, 0);
});

test('mergeTerminologyResults: 同一规范名称的跨批次候选会合并别名且保留已有词典', () => {
  const result = mergeTerminologyResults([
    [{ canonicalName: 'DP3C-X2', aliases: ['双轴'] }],
    [{ canonicalName: 'DP3C-X2', aliases: ['两轴'], note: '宏观名称' }],
    [{ canonicalName: '控制软件', aliases: ['上位机'] }]
  ]);
  assert.deepEqual(result.map(item => item.canonicalName), ['DP3C-X2', '控制软件']);
  assert.deepEqual(result[0].aliases, ['双轴', '两轴']);
  assert.equal(result[0].note, '宏观名称');
});

test('buildConsolidationPrompt: 明确要求保留已有词典并处理细分不确定性', () => {
  const prompt = buildConsolidationPrompt(
    [{ canonicalName: 'DP3C-X2', aliases: ['两轴'] }],
    [{ canonicalName: 'DP3C-X2', aliases: ['双轴'] }]
  );
  assert.match(prompt, /用户已经存在的词典/);
  assert.match(prompt, /不得删除/);
  assert.match(prompt, /功率段/);
  assert.match(prompt, /DP3C-X2/);
  assert.match(prompt, /uncertain_matches/);
  assert.match(prompt, /用户选择|user to decide|ユーザー/);
});

test('buildConsolidationPrompt: 支持使用用户修改后的识别规则', () => {
  const prompt = buildConsolidationPrompt([], [], '只合并有明确上下文证据的叫法；不确定时保持分开。');
  assert.match(prompt, /只合并有明确上下文证据/);
  assert.match(prompt, /不确定时保持分开/);
});

test('normalizeDiscoveryState: 非法元数据回退为稳定默认值', () => {
  assert.deepEqual(normalizeDiscoveryState({ initialized: 1, lastRunAt: '12', sourceHash: ' abc ', model: ' model ', recordCount: -1 }), {
    initialized: true,
    lastRunAt: 12,
    sourceHash: 'abc',
    model: 'model',
    recordCount: 0,
    termCount: 0
  });
});
