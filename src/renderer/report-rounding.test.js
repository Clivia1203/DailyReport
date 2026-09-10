const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cssSource = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

test('周期报告外框的圆角会裁切标题栏和编辑区，避免报告卡片角落变成直角', () => {
  const match = cssSource.match(/\.report-card\s*\{([\s\S]*?)\n\}/);
  assert.ok(match, '报告卡片样式不存在');
  assert.match(match[1], /border-radius\s*:\s*14px/);
  assert.match(match[1], /overflow\s*:\s*hidden/);

  const responsiveMatch = cssSource.match(/#view-report \.report-card\s*\{([^}]*)\}/);
  assert.ok(responsiveMatch, '报告卡片窄窗口样式不存在');
  assert.match(responsiveMatch[1], /overflow\s*:\s*hidden/);
});
