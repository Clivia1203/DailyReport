const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname);
const htmlSource = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const customSelectSource = fs.readFileSync(path.join(root, 'custom-select.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, '..', 'preload.js'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'style.css'), 'utf8');

function readThemeVariables(selector) {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cssSource.match(new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${selector} 主题变量不存在`);
  const variables = {};
  for (const [, name, value] of match[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-f]{6})\s*;/gi)) {
    variables[name] = value;
  }
  return variables;
}

function colorLuminance(hex) {
  const channels = [1, 3, 5].map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(channel => channel <= 0.03928
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function colorContrast(first, second) {
  const light = Math.max(colorLuminance(first), colorLuminance(second));
  const dark = Math.min(colorLuminance(first), colorLuminance(second));
  return (light + 0.05) / (dark + 0.05);
}

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

test('设置页底部展示应用关于信息', () => {
  const general = sectionSource('view-settings');
  assert.match(general, /class="card set-group about-card"/);
  assert.match(general, /<div class="set-title">关于<\/div>/);
  assert.match(general, /<img class="about-icon" src="\.\.\/assets\/icon\.png"[^>]*draggable="false"/);
  assert.match(general, /id="about-name">日报随手记<\/div>/);
  assert.match(general, /id="about-version">v0\.3\.0<\/span>/);
  assert.match(cssSource, /\.about-body\s*\{[\s\S]*align-items:center/);
  assert.match(cssSource, /\.about-icon\s*\{[\s\S]*-webkit-user-drag:none/);
  assert.match(appSource, /Promise\.resolve\(window\.api\.getAppInfo\?\.\(\)\)/);
  assert.match(preloadSource, /getAppInfo:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('app:info'/);
});

test('顶栏使用应用图标作为品牌标识', () => {
  assert.match(htmlSource, /<img class="brand-icon" src="\.\.\/assets\/icon\.png"[^>]*draggable="false"/);
  assert.match(cssSource, /\.brand-icon\s*\{[\s\S]*width:\s*20px[\s\S]*height:\s*20px[\s\S]*-webkit-user-drag:\s*none/);
});

test('所有原生下拉框统一由应用内自定义菜单呈现', () => {
  assert.equal((htmlSource.match(/<select\b/g) || []).length, 14);
  assert.match(htmlSource, /custom-select\.js[\s\S]*app\.js/);
  assert.match(appSource, /customSelect\?\.enhanceAll\(document\)/);
  assert.match(appSource, /function syncCustomSelect\(select\)/);
  assert.match(cssSource, /\.custom-select-menu\s*\{[\s\S]*position:\s*fixed/);
  assert.match(cssSource, /\.custom-select-option\.selected\s*\{[\s\S]*font-weight:\s*600/);
});

test('日期筛选和更多菜单的箭头会随展开状态翻转', () => {
  for (const id of ['date-filter-toggle', 'btn-more']) {
    assert.match(
      htmlSource,
      new RegExp(`id="${id}"[^>]*aria-expanded="false"[^>]*>[\\s\\S]*?<span class="custom-select-chevron" aria-hidden="true"><\\/span>`),
      `${id} 应使用统一的下拉箭头`
    );
  }

  assert.match(customSelectSource, /chevron\.className = 'custom-select-chevron'/);
  assert.match(appSource, /dateFilterToggle\.setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(appSource, /moreToggle\.setAttribute\('aria-expanded', String\(open\)\)/);
  assert.match(cssSource, /\.custom-select-chevron\s*\{[\s\S]*width:\s*8px[\s\S]*height:\s*8px[\s\S]*transition:\s*transform/);
  assert.match(cssSource, /\[aria-expanded="true"\]\s*>\s*\.custom-select-chevron\s*\{[\s\S]*transform:\s*rotate\(225deg\)/);
  assert.doesNotMatch(cssSource, /\.date-filter-toggle\s*>\s*svg|#btn-more\s*>\s*svg/);
  assert.match(htmlSource, /id="btn-more"[^>]*>[\s\S]*?<span class="more-label">/);
  assert.match(cssSource, /#btn-more\s*\{[^}]*gap:\s*4px[^}]*justify-content:\s*space-between/);
  assert.match(cssSource, /#btn-more\s+\.more-label\s*\{[\s\S]*overflow:\s*hidden[\s\S]*text-overflow:\s*ellipsis/);
});

test('AI 服务将连接测试与配置保存拆成两个明确动作', () => {
  const serviceStart = htmlSource.indexOf('<section class="card set-group ai-settings-panel" data-ai-panel="service"');
  const serviceEnd = htmlSource.indexOf('<section class="card set-group ai-settings-panel" data-ai-panel="report"', serviceStart);
  const service = htmlSource.slice(serviceStart, serviceEnd === -1 ? htmlSource.length : serviceEnd);
  const testHandlerStart = appSource.indexOf("$('#ai-test').addEventListener('click'");
  const testHandlerEnd = appSource.indexOf('aiSave.addEventListener', testHandlerStart);
  const testHandler = appSource.slice(testHandlerStart, testHandlerEnd === -1 ? appSource.length : testHandlerEnd);

  assert.match(service, /id="ai-test"[^>]*>测试连接<\/button>/);
  assert.match(service, /id="ai-save"[^>]*>保存配置<\/button>/);
  assert.match(service, /id="ai-provider"/);
  assert.match(service, /id="ai-base-url"/);
  assert.match(service, /value="deepseek"/);
  assert.match(service, /value="openai"/);
  assert.match(service, /value="custom"/);
  assert.doesNotMatch(service, /测试连接并保存/);
  assert.match(appSource, /\$\('#ai-test'\)\.addEventListener\('click'[\s\S]*window\.api\.testAi/);
  assert.match(appSource, /window\.api\.testAi\(\{[\s\S]*providerId:[\s\S]*baseUrl:/);
  assert.match(testHandler, /const requestId = aiTestController\.start\(\)/);
  assert.ok(
    testHandler.indexOf('syncAiEntry();') < testHandler.indexOf('const enteredKey'),
    '开始测试前应只更新状态，不能用旧设置覆盖用户刚选择的平台'
  );
  assert.doesNotMatch(
    testHandler.slice(0, testHandler.indexOf('const enteredKey')),
    /syncAiSettingsUI\(/,
    '开始测试前不能重绘整个设置表单'
  );
  assert.match(appSource, /const aiSave = \$\('#ai-save'\)/);
  assert.match(appSource, /aiSave\.addEventListener\('click'[\s\S]*window\.api\.saveAi/);
  assert.match(appSource, /window\.api\.saveAi\(\{[\s\S]*providerId:[\s\S]*baseUrl:/);
  assert.match(preloadSource, /saveAi:\s*config\s*=>\s*ipcRenderer\.invoke\('ai:save'/);
  assert.match(preloadSource, /testAi:\s*config\s*=>\s*ipcRenderer\.invoke\('ai:test'/);
  assert.match(preloadSource, /cancelAiTest:\s*\(\)\s*=>\s*ipcRenderer\.send\('ai:test:cancel'\)/);
});

test('AI 设置可以关闭报告、闭环和术语识别的详细过程入口', () => {
  const serviceStart = htmlSource.indexOf('<section class="card set-group ai-settings-panel" data-ai-panel="service"');
  const serviceEnd = htmlSource.indexOf('<section class="card set-group ai-settings-panel" data-ai-panel="report"', serviceStart);
  const service = htmlSource.slice(serviceStart, serviceEnd === -1 ? htmlSource.length : serviceEnd);

  assert.match(service, /type="checkbox"[^>]*id="ai-show-thinking"/);
  assert.match(service, /显示 AI 思考过程入口/);
  assert.match(service, /关闭后隐藏报告、闭环和术语识别中的详细过程按钮；不影响 AI 生成。/);
  assert.match(appSource, /function aiThinkingDetailsEnabled\(\)[\s\S]*showThinking !== false/);
  assert.match(appSource, /reportThinkingToggle\.hidden = !showDetails/);
  assert.match(appSource, /toggle\.hidden = !showDetails/);
  assert.match(appSource, /terminologyThinkingToggle\.hidden = !showDetails/);
  assert.match(appSource, /aiShowThinking\?\.addEventListener\('change'[\s\S]*setAiThinkingVisibility/);
  assert.match(preloadSource, /setAiThinkingVisibility:\s*showThinking\s*=>\s*ipcRenderer\.invoke\('ai:setThinkingVisibility'/);
});

test('清空 API Key 后不回填旧掩码，并把清除意图传给主进程', () => {
  assert.match(appSource, /function readAiKeyDraft\(\)[\s\S]*clearRequested[\s\S]*useStoredApiKey/);
  assert.match(appSource, /aiKey\.dataset\.saved === 'true'/);
  assert.match(appSource, /clearApiKey:\s*draft\.clearRequested/);
  assert.match(appSource, /useStoredApiKey:\s*draft\.useStoredApiKey/);
  assert.doesNotMatch(
    appSource,
    /if \(!aiKey\.value\.trim\(\) && state\.settings\?\.ai\?\.configured\) setMaskedAiKey\(state\.settings\.ai\)/
  );
});

test('已保存 API Key 默认只读，替换操作显式进入编辑状态', () => {
  assert.match(htmlSource, /id="ai-key-sub"/);
  assert.match(htmlSource, /id="ai-key-replace"[^>]*>替换<\/button>/);

  const focusStart = appSource.indexOf("aiKey.addEventListener('focus'");
  const inputStart = appSource.indexOf("aiKey.addEventListener('input'", focusStart);
  const focusHandler = appSource.slice(focusStart, inputStart === -1 ? appSource.length : inputStart);
  assert.notEqual(focusStart, -1, 'API Key 聚焦处理器不存在');
  assert.doesNotMatch(focusHandler, /aiKey\.value\s*=\s*''/, '聚焦掩码时不能静默清空输入框');
  assert.match(appSource, /aiKey\.readOnly\s*=\s*mode\s*===\s*'stored'/);
  assert.match(appSource, /aiKeyReplace\.addEventListener\('click'/);
  assert.match(appSource, /dataset\.mode\s*=\s*'replace'/);
  assert.match(appSource, /dataset\.savedMask/);
  assert.match(appSource, /function restoreSavedMaskedAiKey\(\)/);
  assert.match(appSource, /正在替换 API Key；输入新 Key 后可测试并保存，留空则保持当前 Key。/);
});

test('API Key 的替换按钮与输入框同高且保持同一行对齐', () => {
  const keyControl = cssSource.match(/\.ai-key-control\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const replaceButton = cssSource.match(/\.ai-key-control\s+\.ai-key-replace\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(keyControl, /align-items\s*:\s*center/);
  assert.match(keyControl, /flex-wrap\s*:\s*nowrap/);
  assert.match(replaceButton, /height\s*:\s*36px/);
  assert.match(replaceButton, /min-width\s*:\s*56px/);
  assert.match(replaceButton, /padding\s*:\s*0 8px/);
  assert.match(replaceButton, /flex\s*:\s*0 0 auto/);
});

test('软件启动时自动检查已保存的 AI 配置，且同一会话不会重复检查', () => {
  assert.match(appSource, /let aiStartupCheckPromise\s*=\s*null/);
  assert.match(appSource, /function autoTestAiOnStartup\(\)/);
  assert.match(appSource, /if \(aiStartupCheckPromise\) return aiStartupCheckPromise/);
  assert.match(appSource, /window\.api\.testAi\(\{\s*requestId\s*\}\)/);
  assert.match(appSource, /aiTestController\.isCurrent\(requestId\)/);
  assert.match(preloadSource, /cancelAiTest:\s*\(\)\s*=>\s*ipcRenderer\.send\('ai:test:cancel'\)/);
  assert.match(appSource, /loadSettingsUI\(\)[\s\S]*autoTestAiOnStartup/);
  assert.doesNotMatch(appSource, /AI 已配置，待测试/);
});

test('主题配色覆盖十套主题家族，并保留亮暗模式切换', () => {
  assert.match(htmlSource, /<select id="theme-family-select" class="theme-family-select"/);
  assert.doesNotMatch(htmlSource, /theme-family-seg/);
  for (const family of ['gold', 'sky', 'mint', 'violet', 'navy', 'graphite', 'pine', 'amber', 'indigo', 'steel']) {
    assert.match(htmlSource, new RegExp(`<option value="${family}">`));
    assert.match(cssSource, new RegExp(`data-theme-family="${family}"`));
  }
  for (const mode of ['auto', 'light', 'dark']) {
    assert.match(htmlSource, new RegExp(`data-v="${mode}"`));
  }
  assert.match(appSource, /function syncThemeFamilySelect\(\)/);
  assert.match(appSource, /themeFamilySelect\.addEventListener\('change'/);
  assert.match(appSource, /setSettings\(\{ themeFamily: nextFamily \}\)/);
  assert.match(appSource, /if \(res\.ok && state\.settings\) state\.settings\.themeFamily = nextFamily;\s*syncThemeFamilySelect\(\);/);
  assert.match(cssSource, /.theme-family-select\s*\{[^}]*width:\s*148px/);
  assert.match(cssSource, /\[data-theme="dark"\]\[data-theme-family="steel"\]/);
  assert.match(cssSource, /--scrollbar-thumb:[^;]+/);
  assert.match(cssSource, /::-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--scrollbar-thumb\)/);
});

test('所有主题的控件表面、边框和辅助文字保持可辨识对比度', () => {
  const themes = [
    ['gold-light', ':root, [data-theme-family="gold"]'],
    ['sky-light', '[data-theme-family="sky"]'],
    ['mint-light', '[data-theme-family="mint"]'],
    ['violet-light', '[data-theme-family="violet"]'],
    ['navy-light', '[data-theme-family="navy"]'],
    ['graphite-light', '[data-theme-family="graphite"]'],
    ['pine-light', '[data-theme-family="pine"]'],
    ['amber-light', '[data-theme-family="amber"]'],
    ['indigo-light', '[data-theme-family="indigo"]'],
    ['steel-light', '[data-theme-family="steel"]'],
    ['gold-dark', '[data-theme="dark"][data-theme-family="gold"]'],
    ['sky-dark', '[data-theme="dark"][data-theme-family="sky"]'],
    ['mint-dark', '[data-theme="dark"][data-theme-family="mint"]'],
    ['violet-dark', '[data-theme="dark"][data-theme-family="violet"]'],
    ['navy-dark', '[data-theme="dark"][data-theme-family="navy"]'],
    ['graphite-dark', '[data-theme="dark"][data-theme-family="graphite"]'],
    ['pine-dark', '[data-theme="dark"][data-theme-family="pine"]'],
    ['amber-dark', '[data-theme="dark"][data-theme-family="amber"]'],
    ['indigo-dark', '[data-theme="dark"][data-theme-family="indigo"]'],
    ['steel-dark', '[data-theme="dark"][data-theme-family="steel"]']
  ];

  for (const [name, selector] of themes) {
    const variables = readThemeVariables(selector);
    assert.ok(
      colorContrast(variables.bg, variables['input-bg']) >= 1.08,
      `${name}: 输入/下拉框底色与页面背景过于接近`
    );
    assert.ok(
      colorContrast(variables.card, variables.border) >= 1.55,
      `${name}: 卡片边框与卡片背景过于接近`
    );
    assert.ok(
      colorContrast(variables['input-bg'], variables['text-2']) >= 4.5,
      `${name}: 输入区域辅助文字对比度不足`
    );
    assert.ok(
      colorContrast(variables['accent-soft'], variables.accent) >= 4,
      `${name}: 浅色强调底上的强调文字对比度不足`
    );
    for (const status of ['success', 'warning', 'danger']) {
      assert.ok(
        colorContrast(variables[`${status}-soft`], variables[status]) >= 4,
        `${name}: ${status} 状态文字与状态底色对比度不足`
      );
    }
  }
});

test('下拉框、状态卡和禁用按钮在默认状态也保留清晰边界', () => {
  const nativeControlRule = cssSource.match(/input\[type="datetime-local"\],[\s\S]*?select\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  const triggerRule = cssSource.match(/\.custom-select-trigger\s*\{([\s\S]*?)\n\}/)?.[1] || '';

  assert.match(nativeControlRule, /border:\s*1px solid var\(--border\)/);
  assert.match(triggerRule, /border:\s*1px solid var\(--border\)/);
  assert.match(cssSource, /\.btn:disabled\s*\{[\s\S]*opacity:\s*1/);
  assert.match(cssSource, /\.btn\.primary:disabled,[\s\S]*background:\s*var\(--input-bg\)/);
  assert.match(cssSource, /\.custom-select-trigger:disabled\s*\{[\s\S]*border-color:\s*var\(--border-strong\)/);
  assert.match(cssSource, /\.wb-action:disabled\s*\{[\s\S]*background:\s*var\(--input-bg\)[\s\S]*border-color:\s*var\(--border-strong\)/);
  assert.match(cssSource, /\.wb-action\.primary:disabled,[\s\S]*background:\s*var\(--input-bg\)/);
  assert.match(cssSource, /\.wb-status\.ok\s*\{[\s\S]*background:\s*var\(--success-soft\)/);
  assert.match(cssSource, /\.wb-status\.warn\s*\{[\s\S]*background:\s*var\(--warning-soft\)/);
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

test('切换语言后刷新自定义下拉框，选中语言名称使用当前界面语言', () => {
  assert.match(appSource, /function syncAllCustomSelects\(\)/);
  assert.match(appSource, /window\.DRI18n\.setLocale\(locale\)\.then\(\(\) => \{[\s\S]*localeSelect\.value = locale;[\s\S]*syncAllCustomSelects\(\);/);
  assert.match(appSource, /window\.api\.getSettings\(\)\.then\(localizedSettings/);
  assert.match(appSource, /syncTemplateUI\(\);[\s\S]*syncClosurePromptUI\(\);[\s\S]*syncTerminologyPromptUI\(\);/);
  assert.match(appSource, /reportTemplateDefaults/);
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

test('术语词典清空操作使用显式按钮，并与搜索框成组', () => {
  assert.match(
    htmlSource,
    /<div class="terminology-list-actions">[\s\S]*<button class="btn small danger-ghost" id="terminology-clear"/
  );
  assert.match(cssSource, /\.terminology-list-actions\s*\{[\s\S]*display:flex[\s\S]*gap:8px/);
});

test('术语编辑行的自定义下拉框与两侧输入框保持同一顶部间距和宽度', () => {
  assert.match(cssSource, /\.terminology-grid \.custom-select\s*\{[\s\S]*width:100%[\s\S]*margin-top:4px/);
});

test('术语词条的编辑删除按钮固定在右侧同一行，并与长文字保持隔离', () => {
  assert.match(cssSource, /\.terminology-item\s*\{[\s\S]*display:grid[\s\S]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(cssSource, /\.terminology-copy\s*\{[\s\S]*min-width:0/);
  assert.match(cssSource, /\.terminology-item-actions\s*\{[\s\S]*flex:none[\s\S]*flex-wrap:nowrap[\s\S]*white-space:nowrap/);
  assert.match(cssSource, /\.terminology-item-actions \.link-btn\s*\{[\s\S]*height:28px/);
  assert.match(cssSource, /\.terminology-item-actions \.link-btn\s*\{[\s\S]*border:1px solid var\(--border\)/);
  assert.match(cssSource, /\.terminology-item-actions \.link-btn\s*\{[\s\S]*flex:0 0 auto/);
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
  assert.match(cssSource, /\.report-thinking-head\s*\{[\s\S]*display:grid;[\s\S]*grid-template-columns:max-content minmax\(0,1fr\) minmax\(0,max-content\)/);
  assert.match(cssSource, /\.report-thinking-status\s*\{[\s\S]*white-space:\s*normal[\s\S]*overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(cssSource, /\.report-thinking-status\s*\{[^}]*text-overflow:\s*ellipsis/);
});

test('术语识别等待模型返回时，展开区域显示明确状态而不是空白', () => {
  assert.match(appSource, /if \(!blocks\.length\)\s*\{[\s\S]*blocks\.push\(/);
  assert.match(appSource, /等待 AI 返回内容/);
});
