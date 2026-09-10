const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const rendererRoot = __dirname;
const styleSource = fs.readFileSync(path.join(rendererRoot, 'style.css'), 'utf8');
const quickStyleSource = fs.readFileSync(path.join(rendererRoot, 'quick.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(rendererRoot, 'index.html'), 'utf8');

test('界面操作层禁止无意义的文本拖选', () => {
  assert.match(styleSource, /button,\s*select,\s*label,\s*\[role="button"\]/);
  assert.match(styleSource, /\.custom-select,\s*\.custom-select \*/);
  assert.match(styleSource, /\.topbar,\s*\.topbar \*/);
  assert.match(styleSource, /\.main-titlebar,\s*\.main-titlebar \*/);
  assert.match(styleSource, /\.activity-chart,\s*\.activity-chart \*/);
  assert.match(styleSource, /\.ui-no-select,\s*\.ui-no-select \*/);
  assert.match(styleSource, /user-select:\s*none;/);
  assert.match(htmlSource, /class="topbar"/);
  assert.match(htmlSource, /class="main-titlebar"/);
  assert.match(htmlSource, /class="activity-chart"/);
});

test('日报、报告正文和路径仍然保留复制选择能力', () => {
  assert.match(styleSource, /\.entry-text,\s*\.report-content,\s*\.report-source-entry/);
  assert.match(styleSource, /\.report-thinking-content,\s*\.set-sub\.path/);
  assert.match(styleSource, /user-select:\s*text;/);
});

test('快速记录条只限制状态提示，输入框仍可选择文本', () => {
  assert.match(quickStyleSource, /\.meta[\s\S]*?user-select:\s*none;/);
  assert.match(quickStyleSource, /#quick-input[\s\S]*?user-select:\s*text;/);
  assert.match(quickStyleSource, /\.status[\s\S]*?user-select:\s*none;/);
  assert.match(quickStyleSource, /\.hint[\s\S]*?user-select:\s*none;/);
});
