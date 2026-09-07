const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname);
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, '..', 'preload.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function sectionSource(id) {
  const start = htmlSource.indexOf(`id="${id}"`);
  assert.notEqual(start, -1, `${id} 不存在`);
  const next = htmlSource.indexOf('<section ', start + 1);
  return htmlSource.slice(start, next === -1 ? htmlSource.length : next);
}

test('设置页将普通设置与 AI 设置分开，AI 设置提供左右项目导航', () => {
  const general = sectionSource('view-settings');
  const aiStart = htmlSource.indexOf('<!-- ===== AI 设置视图 ===== -->');
  assert.notEqual(aiStart, -1, 'AI 设置视图标记不存在');
  const aiEnd = htmlSource.indexOf('\n    </main>', aiStart);
  const ai = htmlSource.slice(aiStart, aiEnd === -1 ? htmlSource.length : aiEnd);

  assert.match(general, /id="btn-ai-settings"/);
  assert.doesNotMatch(general, /id="ai-key"|id="template-text"|id="closure-prompt-text"|id="terminology-list"/);
  assert.match(ai, /class="ai-settings-layout"/);
  assert.equal((ai.match(/class="ai-nav-item(?: active)?"/g) || []).length, 4);
  assert.equal((ai.match(/class="card set-group ai-settings-panel/g) || []).length, 4);
  for (const id of ['ai-key', 'template-text', 'closure-prompt-text', 'terminology-list']) {
    assert.equal((htmlSource.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} 不应重复`);
  }
  assert.match(appSource, /viewAiSettings\.hidden = name !== 'ai-settings'/);
  assert.match(appSource, /setAiSettingsPanel\('service'\)/);
});

test('所有原生下拉框统一由应用内自定义菜单呈现', () => {
  assert.equal((htmlSource.match(/<select\b/g) || []).length, 11);
  assert.match(htmlSource, /custom-select\.js[\s\S]*app\.js/);
  assert.match(appSource, /customSelect\?\.enhanceAll\(document\)/);
  assert.match(appSource, /function syncCustomSelect\(select\)/);
  assert.match(cssSource, /\.custom-select-menu\s*\{[\s\S]*position:\s*fixed/);
  assert.match(cssSource, /\.custom-select-option\.selected\s*\{[\s\S]*font-weight:\s*600/);
});

test('AI 服务将连接测试与配置保存拆成两个明确动作', () => {
  const serviceStart = htmlSource.indexOf('<section class="card set-group ai-settings-panel" data-ai-panel="service"');
  const serviceEnd = htmlSource.indexOf('<section class="card set-group ai-settings-panel" data-ai-panel="report"', serviceStart);
  const service = htmlSource.slice(serviceStart, serviceEnd === -1 ? htmlSource.length : serviceEnd);

  assert.match(service, /id="ai-test"[^>]*>测试连接<\/button>/);
  assert.match(service, /id="ai-save"[^>]*>保存配置<\/button>/);
  assert.doesNotMatch(service, /测试连接并保存/);
  assert.match(appSource, /\$\('#ai-test'\)\.addEventListener\('click'[\s\S]*window\.api\.testAi/);
  assert.match(appSource, /const aiSave = \$\('#ai-save'\)/);
  assert.match(appSource, /aiSave\.addEventListener\('click'[\s\S]*window\.api\.saveAi/);
  assert.match(preloadSource, /saveAi:\s*apiKey\s*=>\s*ipcRenderer\.invoke\('ai:save'/);
});

test('软件启动时自动检查已保存的 AI 配置，且同一会话不会重复检查', () => {
  assert.match(appSource, /let aiStartupCheckPromise\s*=\s*null/);
  assert.match(appSource, /function autoTestAiOnStartup\(\)/);
  assert.match(appSource, /if \(aiStartupCheckPromise\) return aiStartupCheckPromise/);
  assert.match(appSource, /window\.api\.testAi\(''\)/);
  assert.match(appSource, /loadSettingsUI\(\)[\s\S]*autoTestAiOnStartup/);
  assert.doesNotMatch(appSource, /AI 已配置，待测试/);
});

test('下拉选项之间保留间距，长文本不会突破选项边界', () => {
  const menuRule = cssSource.match(/\.custom-select-menu\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const optionRule = cssSource.match(/\.custom-select-option\s*\{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(menuRule, /display:\s*flex/);
  assert.match(menuRule, /flex-direction:\s*column/);
  assert.match(menuRule, /gap:\s*4px/);
  assert.match(optionRule, /min-width:\s*0/);
  assert.match(optionRule, /overflow:\s*hidden/);
  assert.match(optionRule, /text-overflow:\s*ellipsis/);
  assert.match(optionRule, /white-space:\s*nowrap/);
});

test('多语言文案变长时按钮和操作区不会溢出', () => {
  const buttonRule = cssSource.match(/\.btn\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const toolbarRule = cssSource.match(/\.list-toolbar\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const menuRule = cssSource.match(/\.menu-item\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const rowRule = cssSource.match(/\.set-row\s*\{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(buttonRule, /max-width:\s*100%/);
  assert.match(buttonRule, /overflow:\s*hidden/);
  assert.match(buttonRule, /text-overflow:\s*ellipsis/);
  assert.match(toolbarRule, /flex-wrap:\s*nowrap/);
  assert.match(cssSource, /#btn-report\s*\{[^}]*width:\s*auto[^}]*flex:\s*0 0 auto/);
  assert.match(cssSource, /\.more-group, #btn-more\s*\{[^}]*width:\s*auto[^}]*flex:\s*0 0 auto/);
  assert.match(cssSource, /\.f-count\s*\{[\s\S]*flex:\s*0 1 76px[\s\S]*text-overflow:\s*ellipsis/);
  assert.match(cssSource, /@media \(max-width: 1199px\)[\s\S]*\.list-toolbar \.search-wrap\s*\{[\s\S]*min-width:\s*0[\s\S]*flex-basis:\s*160px/);
  assert.match(menuRule, /height:\s*auto/);
  assert.match(menuRule, /white-space:\s*normal/);
  assert.match(menuRule, /overflow-wrap:\s*anywhere/);
  assert.match(rowRule, /flex-wrap:\s*wrap/);
  assert.match(cssSource, /\.template-foot\s*\{[\s\S]*flex-wrap:\s*wrap/);
});

test('术语表输入控件使用统一圆角样式且双列表单顶端对齐', () => {
  assert.match(cssSource, /\.terminology-editor input\s*\{[\s\S]*border-radius:9px/);
  assert.match(cssSource, /\.terminology-grid\s*\{[^}]*align-items:start/);
  assert.match(cssSource, /\.terminology-editor > label \+ label\s*\{\s*margin-top:9px/);
  assert.doesNotMatch(cssSource, /\.terminology-editor label \+ label\s*\{\s*margin-top:9px/);
});

test('AI 内容面板填满可用高度，长文本编辑区随窗口放大', () => {
  assert.match(cssSource, /\.ai-settings-panel\s*\{[\s\S]*width:100%; height:100%;[\s\S]*overflow-y:auto;[\s\S]*display:flex;/);
  assert.match(cssSource, /\.ai-settings-panel\[data-ai-panel="report"\] \.template-editor-row,[\s\S]*\.ai-settings-panel\[data-ai-panel="closure"\] \.template-editor-row,[\s\S]*\.ai-settings-panel\[data-ai-panel="terminology"\] \.terminology-prompt-row/);
  assert.match(cssSource, /\.template-textarea\s*\{[\s\S]*min-height:clamp\(240px, 42vh, 560px\)[\s\S]*flex:1 1 auto;/);
});

test('AI 设置使用固定外框和内部滚动面板，左右底部保持对齐', () => {
  assert.match(cssSource, /\.ai-settings-content\s*\{[\s\S]*display:block;[\s\S]*padding:0;[\s\S]*overflow:hidden;[\s\S]*border:1px solid var\(--border\);[\s\S]*border-radius:14px;/);
  assert.match(cssSource, /\.ai-settings-panel::-webkit-scrollbar\s*\{\s*display:none;\s*\}/);
});

test('术语页提示词区不能覆盖后续术语列表和编辑表单', () => {
  assert.match(cssSource, /\.ai-settings-panel\[data-ai-panel="terminology"\] \.terminology-prompt-row\s*\{[\s\S]*flex:0 0 auto;/);
  assert.match(cssSource, /\.ai-settings-panel\[data-ai-panel="terminology"\] \.terminology-prompt-row \.template-textarea\s*\{[\s\S]*flex:none;/);
});

test('术语页先显示新增表单，并支持词典模糊搜索', () => {
  const editorIndex = htmlSource.indexOf('id="terminology-editor"');
  const listIndex = htmlSource.indexOf('id="terminology-list"');
  assert.ok(editorIndex >= 0 && listIndex > editorIndex, '新增表单应位于已有词典之前');
  assert.match(htmlSource, /id="terminology-search"[^>]*type="search"/);
  assert.match(htmlSource, /id="terminology-search-clear"/);
  assert.match(appSource, /window\.DRTextSearch\.matchesSearch\(\[[\s\S]*term\.canonicalName/);
  assert.match(appSource, /terminologySearch\?\.addEventListener\('input', renderTerminologyUI\)/);
  assert.match(appSource, /window\.api\.setTerminology\(allTerms\.filter\(item => item\.id !== term\.id\)\)/);
  assert.match(cssSource, /\.terminology-search-wrap input\s*\{[\s\S]*border-radius:10px/);
});

test('术语识别提供默认收起的 AI 思考与输出面板', () => {
  assert.match(htmlSource, /class="card report-thinking terminology-thinking"/);
  for (const id of [
    'terminology-thinking',
    'terminology-thinking-status',
    'terminology-thinking-toggle',
    'terminology-thinking-note',
    'terminology-thinking-content'
  ]) {
    assert.equal((htmlSource.match(new RegExp(`id="${id}"`, 'g')) || []).length, 1, `${id} 不应重复`);
  }
  assert.match(htmlSource, /id="terminology-thinking-content"[^>]*hidden/);
  assert.match(appSource, /function renderTerminologyThinking\(\)/);
  assert.match(appSource, /const thinking = state\.terminologyDiscovery\.thinking;[\s\S]*thinkingState\.toggleThinking\(thinking\)/);
  assert.match(appSource, /thinkingState\.appendThinkingProgress\(thinking, \{ \.\.\.progress, phase: mappedPhase \}\)/);
  assert.match(appSource, /terminologyThinkingContent\.textContent/);
});

test('AI 工作过程的固定状态格式完整显示，不使用省略号裁切', () => {
  assert.match(cssSource, /\.report-thinking-head > div:first-child\s*\{[\s\S]*display:flex;[\s\S]*overflow:visible;/);
  assert.doesNotMatch(cssSource, /\.report-thinking-head > div:first-child\s*\{[^}]*text-overflow:\s*ellipsis/);
});

test('术语识别等待模型返回时，展开区域显示明确状态而不是空白', () => {
  assert.match(appSource, /if \(!blocks\.length\)\s*\{[\s\S]*blocks\.push\(/);
  assert.match(appSource, /等待 AI 返回内容/);
});
