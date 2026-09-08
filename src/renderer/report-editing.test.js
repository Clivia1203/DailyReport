const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cssSource = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

test('报告编辑器占满编辑态可用空间且不提供原生缩放', () => {
  const editor = htmlSource.match(/<textarea[^>]*id="report-editor"[^>]*>/)?.[0];
  assert.ok(editor, '报告编辑器不存在');
  assert.doesNotMatch(editor, /data-resizable="true"/);
  assert.match(cssSource, /\.report-card\.report-full\.editing\s*\{[\s\S]*display:flex;[\s\S]*flex-direction:column;/);
  assert.match(cssSource, /\.report-card\.report-full\.editing\s+\.report-editor:not\(\[hidden\]\)\s*\{[\s\S]*resize:none;/);
  assert.match(appSource, /reportFull\.classList\.toggle\('editing', state\.report\.editing\)/);
});

test('报告编辑以 Markdown 为唯一源并在格式切换和保存时同步', () => {
  assert.match(appSource, /function reportContentForFormat\(content, format/);
  assert.match(appSource, /function reportEditorToMarkdown\(content, format/);
  assert.match(appSource, /const previousFormat = state\.report\.format/);
  assert.match(appSource, /reportEditor\.value = reportContentForFormat\(state\.report\.draftMarkdown, nextFormat\)/);
  assert.match(appSource, /const content = currentReportDraftMarkdown\(\)/);
  assert.match(htmlSource, /保存会自动同步 Markdown、纯文本和导出内容/);
});

test('报告编辑底部说明与编辑内容有独立的视觉分隔', () => {
  assert.match(cssSource, /\.report-edit-foot\s*\{[\s\S]*padding:\s*14px\s+20px\s+18px[\s\S]*border-top:\s*1px solid var\(--border\)/);
  assert.match(cssSource, /\.report-edit-foot\s+\.note\s*\{[\s\S]*color:\s*var\(--text-3\)[\s\S]*font-size:\s*12px/);
});

test('报告元信息精简为常用字段，异常时才补充原始明细状态', () => {
  assert.match(appSource, /function renderReportMeta\(data, rawRecordLabel\)/);
  assert.match(appSource, /const fields = \[[\s\S]*`来源：\$\{data\.sourceCount\} 条`,[\s\S]*`模型：\$\{data\.model \|\| '--'\}`/);
  assert.match(appSource, /fields\.push\(`原始明细：\$\{rawRecordLabel\}`\)/);
  assert.doesNotMatch(appSource, /`周期：\$\{data\.start\} 至 \$\{data\.end\}`/);
  assert.doesNotMatch(appSource, /`AI 归纳覆盖：\$\{data\.coveredCount\} \/ \$\{data\.sourceCount\}`/);
  assert.match(appSource, /className\s*=\s*'report-meta-item'/);
  assert.match(appSource, /renderReportMeta\(data, rawRecordLabel\)/);
  assert.match(cssSource, /\.report-meta\s*\{[\s\S]*overflow-wrap:\s*normal;[\s\S]*word-break:\s*normal;/);
  assert.match(cssSource, /\.report-meta-item\s*\{[\s\S]*display:\s*inline-block;[\s\S]*white-space:\s*nowrap;/);
});

test('报告标题栏在宽窗口中让常用元信息与标题同排', () => {
  assert.match(cssSource, /\.report-card-head\s*> div:first-child\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/);
  assert.match(cssSource, /\.report-meta\s*\{[\s\S]*margin-top:\s*0;[\s\S]*flex:\s*1 1 220px;/);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*\.report-meta\s*\{[\s\S]*margin-top:\s*6px;/);
});

test('查看态报告标题栏固定，正文区域独立滚动', () => {
  const headRule = cssSource.match(/\.report-card-head\s*\{[^}]*\}/)?.[0] || '';
  assert.match(headRule, /position:\s*sticky;/);
  assert.match(headRule, /top:\s*0;/);
  assert.match(headRule, /background:\s*var\(--card\);/);
  assert.match(headRule, /z-index:\s*\d+;/);
});

test('报告侧栏滚动视口裁切时保留圆角边界', () => {
  const reportSideRules = [...cssSource.matchAll(/\.report-side\s*\{[^}]*\}/g)].map(match => match[0]);
  const reportSideRule = reportSideRules.find(rule => /overflow:auto;/.test(rule)) || '';
  assert.ok(reportSideRule, '报告侧栏没有独立的滚动规则');
  assert.match(reportSideRule, /overflow:auto;/);
  assert.doesNotMatch(reportSideRule, /border-radius/);
  assert.match(cssSource, /\.report-side-content\s*\{[\s\S]*display:flex;[\s\S]*flex-direction:column;[\s\S]*gap:14px;/);
  assert.match(cssSource, /\.report-side-card\s*\{[\s\S]*border-radius:\s*14px;[\s\S]*overflow:hidden;/);
  assert.match(htmlSource, /<aside class="report-side">\s*<div class="report-side-content">\s*<div class="card report-side-card">/);
  assert.doesNotMatch(cssSource, /report-side-card-frame|clip-path:inset\(0 round 14px\)/);
  assert.match(cssSource, /@media \(min-width: 1200px\)[\s\S]*\.report-side\s*\{[\s\S]*padding:\s*2px 10px 14px 2px;[\s\S]*scroll-padding-block:\s*14px;/);
  assert.match(cssSource, /#view-report \.report-side\s*\{[\s\S]*overflow:visible;[\s\S]*scrollbar-gutter:auto;/);
});

test('左右栏拖拽分隔条在两栏高度之间垂直居中', () => {
  const resizerRule = cssSource.match(/\.report-resizer\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const resizerHandleRule = cssSource.match(/\.report-resizer::after\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(resizerRule, /display:flex;/);
  assert.match(resizerRule, /align-items:center;/);
  assert.match(resizerRule, /justify-content:center;/);
  assert.match(resizerHandleRule, /margin:0;/);
});

test('报告编辑态锁定周期切换，避免编辑内容与页面周期割裂', () => {
  assert.match(appSource, /const editing = state\.report\.editing;/);
  assert.match(appSource, /reportType\.disabled = editing;/);
  assert.match(appSource, /reportStart\.disabled = editing;/);
  assert.match(appSource, /reportEnd\.disabled = editing;/);
  assert.match(appSource, /reportPrev\.disabled = editing \|\| state\.report\.type === 'custom';/);
  assert.match(appSource, /reportNext\.disabled = editing \|\| state\.report\.type === 'custom';/);
  assert.match(appSource, /function shiftReportPeriod\(delta\) \{\s*if \(state\.report\.editing \|\| state\.report\.type === 'custom'\) return;/);
  assert.match(appSource, /reportType\.addEventListener\('change', \(\) => \{\s*if \(state\.report\.editing\) return;/);
  assert.match(appSource, /reportStart\.addEventListener\('change', \(\) => \{\s*if \(state\.report\.editing \|\|/);
  assert.match(appSource, /reportEnd\.addEventListener\('change', \(\) => \{\s*if \(state\.report\.editing \|\|/);
});

test('点击编辑时保留当前阅读位置，不把编辑框自动滚到末尾', () => {
  assert.match(appSource, /function captureReportEditScroll\(\)/);
  assert.match(appSource, /function restoreReportEditScroll\(position\)/);
  assert.match(appSource, /reportEditor\.focus\(\{ preventScroll: true \}\)/);
  assert.match(appSource, /const scrollPosition = captureReportEditScroll\(\);[\s\S]*renderReportState\(\);[\s\S]*restoreReportEditScroll\(scrollPosition\);/);
  assert.match(appSource, /const editorMax = Math\.max\(0, reportEditor\.scrollHeight - reportEditor\.clientHeight\);/);
});

test('取消或保存编辑后保留当前报告阅读位置', () => {
  assert.match(appSource, /function captureReportEditScroll\(\)\s*\{[\s\S]*const card = state\.report\.editing \? reportEditor : reportContent;[\s\S]*card: scrollProgress\(card\),/);
  assert.match(appSource, /function restoreReportViewScroll\(position\)/);
  assert.match(appSource, /const cardMax = Math\.max\(0, reportContent\.scrollHeight - reportContent\.clientHeight\);[\s\S]*reportContent\.scrollTop = cardMax \* snapshot\.card;/);
  assert.match(appSource, /reportEditCancel\.addEventListener\('click', \(\) => \{[\s\S]*const scrollPosition = captureReportEditScroll\(\);[\s\S]*renderReportState\(\);[\s\S]*restoreReportViewScroll\(scrollPosition\);/);
  assert.match(appSource, /reportEditSave\.addEventListener\('click', async \(\) => \{[\s\S]*const scrollPosition = captureReportEditScroll\(\);[\s\S]*state\.report\.editing = false;[\s\S]*renderReportState\('总结修改已保存。'\);[\s\S]*restoreReportViewScroll\(scrollPosition\);/);
});

test('查看态和编辑态都使用内部滚动，报告卡片不再承担外层滚动', () => {
  const reportCardRule = cssSource.match(/\.report-card\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const reportContentRule = cssSource.match(/\.report-content\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const reportEditorRule = cssSource.match(/\.report-editor\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(reportCardRule, /display:flex;/);
  assert.match(reportCardRule, /flex-direction:column;/);
  assert.match(reportCardRule, /overflow:hidden;/);
  assert.match(reportContentRule, /flex:1 1 auto;/);
  assert.match(reportContentRule, /min-height:0;/);
  assert.match(reportContentRule, /overflow-y:auto;/);
  assert.match(reportContentRule, /scrollbar-gutter:stable;/);
  assert.match(reportEditorRule, /overflow:auto;/);
  assert.match(reportEditorRule, /scrollbar-gutter:stable;/);
  assert.match(cssSource, /#view-report\s*\{[^}]*overflow-y:auto;[^}]*scrollbar-gutter:\s*stable;/);
});
