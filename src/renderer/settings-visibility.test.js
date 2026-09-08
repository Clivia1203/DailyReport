const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'src/renderer/style.css'), 'utf8');

test('小窗口设置页的 AI 设置入口属于同一滚动内容流', () => {
  const settingsStart = htmlSource.indexOf('id="view-settings"');
  const aiViewStart = htmlSource.indexOf('<!-- ===== AI 设置视图 ===== -->');
  assert.ok(settingsStart >= 0 && aiViewStart > settingsStart, '设置视图边界不存在');
  const settings = htmlSource.slice(settingsStart, aiViewStart);
  const scrollIndex = settings.indexOf('class="scroll-wrap settings-wrap"');
  const entryIndex = settings.indexOf('class="card settings-ai-entry"');
  assert.ok(scrollIndex >= 0 && entryIndex > scrollIndex, 'AI 设置入口必须位于设置滚动容器内');
  assert.match(settings, /<div class="card settings-ai-entry">\s*<button[^>]*id="btn-ai-settings"/s);
  const entryRule = cssSource.match(/#view-settings\s+\.settings-ai-entry\s*\{([^}]*)\}/s);
  assert.ok(entryRule, 'AI 设置入口的小窗口规则不存在');
  assert.doesNotMatch(entryRule[1], /position:\s*sticky;/s);
  assert.doesNotMatch(entryRule[1], /top:\s*2px;/s);
  assert.doesNotMatch(entryRule[1], /z-index:\s*5;/s);
});

test('AI 设置入口在宽而矮的窗口中不会被纵向 flex 压缩', () => {
  const entryRule = cssSource.match(/\.settings-ai-entry\s*\{([^}]*)\}/s);
  assert.ok(entryRule, 'AI 设置入口基础规则不存在');
  assert.match(entryRule[1], /flex:\s*0\s+0\s+auto\s*;/s);
});

test('AI 设置入口在所有窗口尺寸共用同一条页面跳转逻辑', () => {
  assert.match(appSource, /#btn-ai-settings'\)\.addEventListener\('click',[\s\S]*showView\('ai-settings'\)/);
});
