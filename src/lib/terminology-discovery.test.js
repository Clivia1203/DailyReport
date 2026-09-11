const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  discoverySources,
  splitDiscoverySources,
  buildExtractionPrompt,
  buildClusteringPrompt,
  normalizeMention,
  mergeMentions,
  verifyMentions,
  dictionaryNameKeys,
  dictionaryNamesForPrompt,
  parseMentionsResponse,
  parseTerminologyResponse,
  parseTerminologyResponseDetailed,
  verifyExtractedTerms,
  verifyUncertainRelations,
  mergeTerminologyResults,
  normalizeDiscoveryState
} = require('./terminology-discovery');

const entries = [
  { id: 'b', text: 'DP3C-X2 硬件飞线问题解决，可以给客户发去使用', ts: new Date(2026, 8, 2, 13, 40).getTime(), createdAt: 2 },
  { id: 'a', text: '双轴推进驱动器现场测试，等待硬件确认', ts: new Date(2026, 7, 31, 9, 12).getTime(), createdAt: 1 },
  { id: 'c', text: '两轴功率段继续排查', ts: new Date(2026, 8, 3, 10, 0).getTime(), createdAt: 3 }
];

test('discoverySources 和分批摘词提示词覆盖全部日报，并列出已知叫法', () => {
  const sources = discoverySources(entries);
  const chunks = splitDiscoverySources(sources, { maxSources: 1, maxChars: 10000 });
  const known = dictionaryNamesForPrompt([{ canonicalName: '双轴推进驱动器', aliases: ['两轴'] }]);
  const prompts = chunks.map(chunk => buildExtractionPrompt(chunk, known));
  assert.equal(prompts.length, entries.length);
  for (const source of sources) {
    assert.ok(prompts.some(prompt => prompt.includes(`[${source.ref}]`) && prompt.includes(source.text)));
  }
  assert.ok(prompts.every(prompt => prompt.includes('已认识的叫法') && prompt.includes('双轴推进驱动器、两轴')));
  // 逐字摘录与 JSON 形状要求必须在场。
  assert.ok(prompts.every(prompt => prompt.includes('逐字') && prompt.includes('mentions')));
});

test('提及的清洗、验收与合并：逐字回查、剔除已知、跨批去重', () => {
  const sources = [
    { ref: 'R001', id: 'a', date: '2026-09-01', time: '09:00', text: 'DP3C-X2 飞线问题，陆永波跟进' },
    { ref: 'R002', id: 'b', date: '2026-09-02', time: '10:00', text: '陆永波回复客户' }
  ];
  const known = dictionaryNameKeys([{ canonicalName: '飞线问题', aliases: [] }]);
  const verified = verifyMentions([
    { name: '「DP3C-X2」', type: 'matter', refs: ['R001'] },
    { name: '陆永波', type: 'person', refs: ['R001'] },
    { name: '飞线问题', type: 'matter', refs: ['R001'] },      // 已知叫法：剔除
    { name: '编造的词', type: 'matter', refs: ['R001'] }        // 原文查无：剔除
  ], sources, known);
  assert.deepEqual(verified.map(item => item.name), ['DP3C-X2', '陆永波']);
  assert.equal(verified[0].type, 'matter');
  assert.equal(verified[1].type, 'person');

  const merged = mergeMentions([
    { name: '陆永波', type: 'matter', refs: ['R001'] },
    { name: '陆永波 ', type: 'person', refs: ['R002'] },
    { name: 'DP3C-X2', type: 'matter', refs: ['R001'] }
  ]);
  assert.equal(merged.length, 2);
  const person = merged.find(item => item.name === '陆永波');
  assert.equal(person.type, 'person');
  assert.deepEqual(person.refs, ['R001', 'R002']);
});

test('parseMentionsResponse: 兼容代码围栏与 terms 字段名', () => {
  const fenced = parseMentionsResponse([
    '```json',
    '{"mentions":[{"name":"DP3C-X2","type":"matter","refs":["R001"]}]}',
    '```'
  ].join('\n'));
  assert.equal(fenced.mentions.length, 1);
  assert.equal(fenced.mentions[0].name, 'DP3C-X2');
  const viaTerms = parseMentionsResponse('{"terms":[{"name":"陆永波","type":"person","refs":["R002"]}]}');
  assert.equal(viaTerms.mentions[0].type, 'person');
  assert.equal(parseMentionsResponse('说明文字，没有 JSON'), null);
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

test('buildClusteringPrompt: 已有词典、新叫法清单和不确定关系规则齐全', () => {
  const prompt = buildClusteringPrompt(
    [{ name: 'DP3C-X2', type: 'matter', refs: ['R001'] }],
    [{ canonicalName: '双轴驱动器', aliases: ['双轴'] }]
  );
  assert.match(prompt, /用户已经存在的词典/);
  assert.match(prompt, /不得删除/);
  assert.match(prompt, /DP3C-X2/);
  assert.match(prompt, /uncertain_matches/);
  assert.match(prompt, /同一事项只允许输出一个规范名称/);
  assert.match(prompt, /人物和事项是两类词条/);
});

test('buildClusteringPrompt: 支持使用用户修改后的识别规则', () => {
  const prompt = buildClusteringPrompt([], [], '只合并有明确上下文证据的叫法；不确定时保持分开。');
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

test('机器验收：AI 输出的名字必须逐字出现在原文里，编造即丢弃', () => {
  const sources = [
    { ref: 'R001', id: 'a', date: '2026-09-01', time: '09:00', text: 'DP3C-X2 硬件飞线问题解决' },
    { ref: 'R002', id: 'b', date: '2026-09-02', time: '10:00', text: '双轴推进驱动器现场测试' }
  ];
  const kept = verifyExtractedTerms([
    { canonicalName: 'DP3C-X2', aliases: ['飞线问题'] },
    // 规范名不在原文、但别名逐字出现：整条保留（有真实出处）。
    { canonicalName: '驱动器项目', aliases: ['双轴推进驱动器'] },
    // 规范名和别名都查无出处：编造，丢弃。
    { canonicalName: '编造的型号X9', aliases: ['不存在的说法'] },
    // 全角/空格差异不算编造。
    { canonicalName: 'ｄｐ３ｃ－ｘ ２', aliases: [] }
  ], sources);
  assert.equal(kept.length, 3);
  assert.deepEqual(kept.map(item => item.canonicalName), ['DP3C-X2', '驱动器项目', 'ｄｐ３ｃ－ｘ ２']);
});

test('机器验收：不确定关系的两侧名字也必须有出处', () => {
  const sources = [
    { ref: 'R001', id: 'a', date: '2026-09-01', time: '09:00', text: '处理铭工现场问题' }
  ];
  const terms = [{ canonicalName: 'DP3C-X2', aliases: [] }];
  const kept = verifyUncertainRelations([
    { left: { canonicalName: '铭工现场问题' }, right: { canonicalName: 'DP3C-X2' } },
    { left: { canonicalName: '铭工现场问题' }, right: { canonicalName: '凭空的另一侧' } }
  ], terms, sources);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].right.canonicalName, 'DP3C-X2');
});
