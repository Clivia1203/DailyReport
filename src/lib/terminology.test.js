const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  terminologyKey,
  normalizeTerminology,
  upsertTerminology,
  addTerminologyAlias,
  findTerminologyCandidates,
  normalizeTerminologyExclusions,
  addTerminologyExclusion,
  removeTerminologyExclusion
} = require('./terminology');

test('术语规范会统一空白、别名并保留输出名称', () => {
  const result = normalizeTerminology([{
    id: 't1',
    canonicalName: ' DP310-X2 ',
    aliases: ['双轴', ' 两轴 ', '双轴', 'DP310-X2'],
    scope: '模切设备'
  }]);
  assert.deepEqual(result, [{
    id: 't1',
    canonicalName: 'DP310-X2',
    aliases: ['双轴', '两轴'],
    scope: '模切设备',
    note: ''
  }]);
  assert.equal(terminologyKey(' DP310-X2 '), 'dp310x2');
});

test('同一规范名称可以更新，新增别名不会重复创建术语', () => {
  let terms = upsertTerminology([], { canonicalName: 'DP310-X2', aliases: ['双轴'] });
  const id = terms[0].id;
  terms = addTerminologyAlias(terms, 'DP310-X2', '两轴');
  terms = upsertTerminology(terms, { id, canonicalName: 'DP310-X2', aliases: ['双轴', '两轴'], note: '模切设备' });
  assert.equal(terms.length, 1);
  assert.deepEqual(terms[0].aliases, ['双轴', '两轴']);
  assert.equal(terms[0].note, '模切设备');
});

test('重复规范名称会合并别名，避免输出存在两个同名术语', () => {
  const terms = normalizeTerminology([
    { id: 'a', canonicalName: 'DP310-X2', aliases: ['双轴'] },
    { id: 'b', canonicalName: ' DP310-X2 ', aliases: ['两轴'], note: '功率段不明确时用宏观名称' }
  ]);
  assert.equal(terms.length, 1);
  assert.deepEqual(terms[0].aliases, ['双轴', '两轴']);
  assert.equal(terms[0].note, '功率段不明确时用宏观名称');
});

test('术语查找支持规范名称和别名，并尊重范围', () => {
  const terms = normalizeTerminology([
    { id: 'a', canonicalName: 'DP310-X2', aliases: ['双轴'], scope: '模切设备' },
    { id: 'b', canonicalName: '另一个双轴项目', aliases: ['双轴'], scope: '机器人' }
  ]);
  assert.equal(findTerminologyCandidates(terms, '两轴', '模切设备').length, 0);
  assert.equal(findTerminologyCandidates(terms, '双轴', '模切设备')[0].canonicalName, 'DP310-X2');
  assert.equal(findTerminologyCandidates(terms, '双轴').length, 2);
});

test('术语排除关系会规范化、去重，并支持被正向确认后移除', () => {
  let exclusions = normalizeTerminologyExclusions([
    { canonicalName: ' 铭工现场售前问题 ', alias: '风格现场问题' },
    { canonical_name: '铭工现场售前问题', alias: '风格现场问题' },
    { canonicalName: '另一个事项', alias: '另一个叫法' }
  ]);
  assert.deepEqual(exclusions, [
    { canonicalName: '铭工现场售前问题', alias: '风格现场问题' },
    { canonicalName: '另一个事项', alias: '另一个叫法' }
  ]);
  exclusions = addTerminologyExclusion(exclusions, '铭工现场售前问题', '风格现场问题');
  assert.equal(exclusions.length, 2);
  exclusions = removeTerminologyExclusion(exclusions, '铭工现场问题', '风格现场问题');
  assert.equal(exclusions.length, 2);
  exclusions = removeTerminologyExclusion(exclusions, '铭工现场售前问题', '风格现场问题');
  assert.deepEqual(exclusions, [{ canonicalName: '另一个事项', alias: '另一个叫法' }]);
});
