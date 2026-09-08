const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('周期总结工具栏提供日历跳转控件，并在自定义周期时隐藏', () => {
  assert.match(htmlSource, /<div class="report-jump" id="report-jump">[\s\S]*id="report-anchor"/);
  assert.match(appSource, /const reportJump = \$\('#report-jump'\);/);
  assert.match(appSource, /const reportAnchor = \$\('#report-anchor'\);/);
  assert.match(appSource, /reportJump\.hidden = state\.report\.type === 'custom';/);
  assert.match(cssSource, /\.report-jump\s*\{[\s\S]*display:flex;[\s\S]*align-items:center;/);
  assert.match(cssSource, /\.report-jump:focus-within\s*\{/);
});

test('选择日期会按当前周期类型跳转，并复用未来空周期限制', () => {
  assert.match(appSource, /function reportPeriodForAnchor\(value\)/);
  assert.match(appSource, /const bounds = periodBounds\(state\.report\.type, localDateFromString\(value\)\.getTime\(\)\);/);
  assert.match(appSource, /if \(!canViewReportPeriod\(bounds\)\) \{/);
  assert.match(appSource, /reportAnchor\.addEventListener\('change'/);
  assert.match(appSource, /toast\(uiText\('未来空周期没有日报记录，无法查看。'\)\);/);
});
