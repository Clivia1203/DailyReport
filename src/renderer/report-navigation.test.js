const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

test('周期总结工具栏提供日历跳转控件，并在自定义周期时隐藏', () => {
  assert.match(htmlSource, /<div class="report-jump" id="report-jump">[\s\S]*id="report-calendar-trigger"[\s\S]*id="report-calendar"/);
  assert.match(appSource, /const reportJump = \$\('#report-jump'\);/);
  assert.match(appSource, /const reportCalendarTrigger = \$\('#report-calendar-trigger'\);/);
  assert.match(appSource, /const reportCalendarGrid = \$\('#report-calendar-grid'\);/);
  assert.match(appSource, /reportJump\.hidden = custom;/);
  assert.match(cssSource, /\.report-jump\s*\{[\s\S]*position:relative;/);
  assert.match(cssSource, /\.report-calendar-week\.selected-week\s*\{[\s\S]*border-color:var\(--accent\);/);
  assert.match(cssSource, /\.report-calendar-record-dot\s*\{/);
});

test('日历按当前周期类型跳转，显示日报日期并复用未来空周期限制', () => {
  assert.match(appSource, /function reportPeriodForAnchor\(value\)/);
  assert.match(appSource, /function renderReportCalendar\(\)/);
  assert.match(appSource, /const count = counts\.get\(key\) \|\| 0;/);
  assert.match(appSource, /if \(weekHasRecords\) week\.classList\.add\('has-records'\);/);
  assert.match(appSource, /function selectReportCalendarDate\(value\)/);
  assert.match(appSource, /if \(!canViewReportPeriod\(bounds\)\) \{/);
  assert.match(appSource, /reportCalendarTrigger\.addEventListener\('click'/);
  assert.match(appSource, /reportCalendarPrev\.addEventListener\('click'/);
  assert.match(appSource, /toast\(uiText\('未来空周期没有日报记录，无法查看。'\)\);/);
});
