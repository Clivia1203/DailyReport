const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cssSource = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');
const htmlSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');

test('可缩放文本框使用无底色且主题自适应的自绘三角手柄', () => {
  assert.match(htmlSource, /id="term-aliases"[^>]*data-resizable="true"/, 'term-aliases 未声明自绘缩放');
  const reportEditor = htmlSource.match(/<textarea[^>]*id="report-editor"[^>]*>/)?.[0];
  assert.ok(reportEditor, 'report-editor 不存在');
  assert.doesNotMatch(reportEditor, /data-resizable="true"/, '报告编辑器不应声明可缩放');
  assert.match(cssSource, /\.textarea-resize-shell\s*\{[\s\S]*position:\s*relative;[\s\S]*background:\s*transparent;/s);
  assert.match(cssSource, /\.textarea-resize-shell\s*>\s*textarea\[data-resizable="true"\]\s*\{[\s\S]*resize:\s*none\s*!important;/s);
  assert.match(cssSource, /\.textarea-resize-handle\s*\{[\s\S]*color:\s*var\(--accent\);/s);
  assert.match(cssSource, /\.textarea-resize-handle\s+svg\s*\{[\s\S]*width:\s*14px;[\s\S]*height:\s*14px/s);
  assert.match(appSource, /handle\.innerHTML\s*=\s*'<svg viewBox="0 0 16 16" fill="currentColor"/);
  assert.match(appSource, /handle\.innerHTML\s*=\s*'[^']*<path d="M4 13 L13 4 L13 13 Z"\/>/);
  assert.doesNotMatch(appSource, /handle\.innerHTML\s*=\s*'[^']*stroke-linecap="round"/);
  assert.doesNotMatch(appSource, /handle\.innerHTML\s*=\s*'[^']*<path d="M4 12 L11 5"\/><path d="M8 14 L14 8"\/>/);
  assert.doesNotMatch(cssSource, /\.textarea-resize-handle::before/);
  assert.doesNotMatch(cssSource, /textarea::-webkit-resizer/);
  assert.match(appSource, /function syncTextareaResizerVisibility\(textarea\)/);
  assert.match(appSource, /function installTextareaResizer\(textarea\)/);
  assert.match(appSource, /textarea\.dataset\.resizable\s*!==\s*'true'/);
  assert.match(appSource, /installTextareaResizer\(ta\)/);
});

test('固定提示词文本框不显示缩放手柄，也不保留原生缩放入口', () => {
  for (const id of ['template-text', 'closure-prompt-text', 'terminology-prompt-text']) {
    const textarea = htmlSource.match(new RegExp(`<textarea[^>]*id="${id}"[^>]*>`))?.[0];
    assert.ok(textarea, `${id} 不存在`);
    assert.doesNotMatch(textarea, /data-resizable="true"/, `${id} 不应声明可缩放`);
  }

  const templateTextareaRule = cssSource.match(/^\.template-textarea\s*\{([\s\S]*?)^\}/m)?.[1] || '';
  assert.match(templateTextareaRule, /resize:\s*none/);
});
