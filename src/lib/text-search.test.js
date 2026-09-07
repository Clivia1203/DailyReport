const test = require('node:test');
const assert = require('node:assert/strict');
const { matchesSearch } = require('./text-search');

test('搜索忽略大小写、空格和常见标点差异', () => {
  assert.equal(matchesSearch('完成日报工具登录接口联调，推进接口功能验证。', '接口 联调'), true);
  assert.equal(matchesSearch('Excel 导出问题已修复', 'excel-导出'), true);
});

test('搜索支持多个关键词分别命中，词序不影响结果', () => {
  assert.equal(matchesSearch('与产品部确认客户现场问题，安排出差检查并跟进解决', '解决 客户'), true);
  assert.equal(matchesSearch('与产品部确认客户现场问题，安排出差检查并跟进解决', '客户 风险'), false);
});

test('中文连续输入也支持有间隔的模糊匹配', () => {
  assert.equal(matchesSearch('模切行业设备问题已解决，可以给客户发去使用', '设备客户'), true);
  assert.equal(matchesSearch('模切行业设备问题已解决，可以给客户发去使用', '客户设备'), false);
});

test('空搜索保持匹配全部记录', () => {
  assert.equal(matchesSearch('任意日报内容', ''), true);
  assert.equal(matchesSearch('任意日报内容', '   '), true);
});
