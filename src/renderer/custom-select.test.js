const assert = require('node:assert/strict');
const test = require('node:test');
const { optionModel, findNextEnabledIndex } = require('./custom-select');

test('自定义下拉框保留原生选项的文本、值和选中项', () => {
  const model = optionModel([
    { value: 'day', label: '日报' },
    { value: 'week', label: '周报' },
    { value: 'month', label: '月报' }
  ], 'week');

  assert.deepEqual(model.items.map(item => ({ value: item.value, label: item.label })), [
    { value: 'day', label: '日报' },
    { value: 'week', label: '周报' },
    { value: 'month', label: '月报' }
  ]);
  assert.equal(model.selectedIndex, 1);
  assert.equal(model.selected.label, '周报');
});

test('自定义下拉框的键盘移动会跳过禁用项并循环', () => {
  const items = [
    { disabled: false },
    { disabled: true },
    { disabled: false }
  ];

  assert.equal(findNextEnabledIndex(items, 0, 1), 2);
  assert.equal(findNextEnabledIndex(items, 2, 1), 0);
  assert.equal(findNextEnabledIndex(items, 0, -1), 2);
});

test('没有匹配值时沿用原生单选框的首项显示逻辑', () => {
  const model = optionModel([{ value: 'all', label: '全部' }], 'missing');
  assert.equal(model.selectedIndex, 0);
  assert.equal(model.selected.label, '全部');
});
