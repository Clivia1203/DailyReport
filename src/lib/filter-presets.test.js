const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeFilterSnapshot,
  normalizeSavedFilters,
  filterSignature,
  savedFilterSelectModel,
  upsertSavedFilter
} = require('./filter-presets');

test('筛选快照保留关键词，并遵守范围聚焦与年月互斥', () => {
  assert.deepEqual(normalizeFilterSnapshot({
    year: '2026',
    month: '03',
    text: '  客户问题  ',
    rangeFocus: { type: 'day', day: '2026-09-01' }
  }), {
    year: 'all',
    month: 'all',
    text: '客户问题',
    rangeFocus: { type: 'day', day: '2026-09-01' }
  });
});

test('无范围聚焦时规范化有效的年份和月份', () => {
  assert.deepEqual(normalizeFilterSnapshot({ year: '2026', month: '03', text: '' }), {
    year: '2026',
    month: '3',
    text: '',
    rangeFocus: { type: 'all' }
  });
});

test('保存的筛选条件会去除空名称、清理字段并限制数量', () => {
  const filters = Array.from({ length: 22 }, (_, index) => ({
    id: `f${index}`,
    name: ` 筛选 ${index} `,
    year: '2026',
    month: '2',
    text: `词${index}`
  }));
  filters.splice(2, 0, { id: 'empty', name: '   ' });
  const result = normalizeSavedFilters(filters);

  assert.equal(result.length, 20);
  assert.equal(result[0].name, '筛选 0');
  assert.equal(result[1].name, '筛选 1');
  assert.ok(result.every(item => item.year === '2026' && item.month === '2'));
});

test('等价筛选条件生成稳定签名，便于识别当前是否命中已保存筛选', () => {
  assert.equal(
    filterSignature({ year: '2026', month: '03', text: '客户', rangeFocus: { type: 'all' } }),
    filterSignature({ year: '2026', month: '3', text: ' 客户 ', rangeFocus: { type: 'all' } })
  );
});

test('热力图日期筛选保存后，下拉框保持可打开并保留保存项', () => {
  const model = savedFilterSelectModel([{
    id: 'day-1',
    name: '当天',
    year: 'all',
    month: 'all',
    text: '',
    rangeFocus: { type: 'day', day: '2026-09-01' }
  }]);

  assert.equal(model.disabled, false);
  assert.deepEqual(model.options, [
    { value: '', label: '已保存筛选' },
    { value: 'day-1', label: '当天' }
  ]);
});

test('保存多关键词筛选后会保留关键词并生成可加载项', () => {
  const result = upsertSavedFilter([], {
    year: 'all',
    month: 'all',
    text: '模切 飞线',
    rangeFocus: { type: 'all' }
  }, '模切飞线问题', 'filter-test');

  assert.deepEqual(result, [{
    id: 'filter-test',
    name: '模切飞线问题',
    year: 'all',
    month: 'all',
    text: '模切 飞线',
    rangeFocus: { type: 'all' }
  }]);
  assert.deepEqual(savedFilterSelectModel(result).options, [
    { value: '', label: '已保存筛选' },
    { value: 'filter-test', label: '模切飞线问题' }
  ]);
});
