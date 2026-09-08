const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '../..');
const appSource = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const autoRefreshSource = fs.readFileSync(path.join(root, 'src/renderer/closure-autorefresh.js'), 'utf8');
const htmlSource = fs.readFileSync(path.join(root, 'src/renderer/index.html'), 'utf8');
const cssSource = fs.readFileSync(path.join(root, 'src/renderer/style.css'), 'utf8');
const previewPath = path.join(root, '.scratch/ai-report-prototype/ai-report-prototype.html');
const previewSource = fs.existsSync(previewPath) ? fs.readFileSync(previewPath, 'utf8') : '';

test('正式侧栏只保留近期总结，不再暴露演示方案或本周工作台卡片', () => {
  assert.doesNotMatch(htmlSource, /workbench-prototype-switcher/);
  assert.doesNotMatch(appSource, /WORKBENCH_VARIANTS|\brenderWorkbenchB\s*\(|\brenderWorkbenchC\s*\(|setWorkbenchVariant/);
  assert.doesNotMatch(appSource, /本周工作台/);
  assert.doesNotMatch(appSource, /function renderWeeklyReportCard\(/);
  assert.doesNotMatch(appSource, /loadWorkbenchReport|syncWorkbenchReportFromCurrentWeek|workbenchReportPreview/);
  assert.match(appSource, /weeklyWorkbench\.appendChild\(renderWorkbenchClosureCard\(\)\)/);
});

test('闭环界面只展示事件信息，不泄漏内部来源编号', () => {
  assert.doesNotMatch(appSource, /source\.ref/);
  assert.doesNotMatch(appSource, /wb-closure-ref/);
  assert.match(appSource, /wb-closure-evidence-time/);
});

test('近期闭环支持默认收起且不落盘的 AI 思考过程', () => {
  assert.match(appSource, /function createClosureThinking\(visible = false\)/);
  assert.match(appSource, /thinking:\s*createClosureThinking\(\)/);
  assert.match(appSource, /function renderClosureThinking\(\)/);
  assert.match(appSource, /const thinking = renderClosureThinking\(\);/);
  assert.match(appSource, /thinking\.open \? '收起详细过程' : '查看详细过程'/);
  assert.match(appSource, /thinking\.open = !thinking\.open;/);
  assert.match(appSource, /thinkingState\.appendThinkingProgress\(thinking,[\s\S]*progress\.phase === 'thinking'/);
  assert.match(cssSource, /\.wb-closure-thinking\s*\{[\s\S]*background:var\(--accent-soft\)/s);
});

test('近期闭环自动分析受大窗口可见性、内容变化和冷却时间控制', () => {
  assert.match(htmlSource, /closure-autorefresh\.js[\s\S]*app\.js/);
  assert.match(appSource, /function isClosureWorkbenchVisible\(\)[\s\S]*weeklyWorkbench\.hidden[\s\S]*viewMain\.hidden[\s\S]*document\.hidden/);
  assert.match(appSource, /createClosureAutoRefresh\([\s\S]*generateWorkbenchClosure\(false, \{ automatic: true \}\)/);
  assert.match(autoRefreshSource, /debounceMs/);
  assert.match(autoRefreshSource, /cooldownMs/);
  assert.match(appSource, /loadWorkbenchClosure\(\{ autoReason: 'startup', schedule: false \}\)/);
  assert.match(appSource, /resumeVisibleClosureAutomation\('visible'\)/);
});

test('首次术语识别也不会在后台或小窗口自动调用 AI', () => {
  assert.match(appSource, /function ensureTerminologyDiscovery\(\)[\s\S]*!isClosureWorkbenchVisible\(\)/);
  assert.match(appSource, /document\.addEventListener\('visibilitychange',[\s\S]*resumeVisibleClosureAutomation\('visible'\)/);
});

test('近期闭环的 AI 工作过程与空结果卡片保持清晰间距', () => {
  assert.match(cssSource, /\.wb-closure-card\s*>\s*\.wb-closure-thinking\s*\+\s*\.wb-empty\s*\{[\s\S]*margin-top:\s*11px/);
});

test('切换语言时正在生成的近期闭环也会完整重绘固定文案', () => {
  assert.match(appSource, /function renderWeeklyWorkbench\(\{\s*force = false\s*\} = \{\}\)/);
  assert.match(appSource, /if \(!force && livePlan === 'patch'\)/);
  assert.match(appSource, /renderWeeklyWorkbench\(\{ force: true \}\)/);
  assert.match(appSource, /workbenchHeader\('近期总结', '最近完成了什么', info\)/);
});

test('近期闭环头部和操作区能容纳长语言，不让标题与状态互相挤压', () => {
  assert.match(appSource, /wbNode\('div', 'wb-head-copy'\)/);
  assert.match(cssSource, /\.wb-head\s*\{[^}]*display:grid;[^}]*grid-template-columns:minmax\(0,1fr\)/s);
  assert.match(cssSource, /\.wb-head-copy\s*\{[^}]*min-width:0/s);
  assert.match(cssSource, /\.wb-status\s*\{[^}]*max-width:100%[^}]*text-align:left/s);
  assert.match(cssSource, /\.wb-action\s*\{[^}]*height:auto[^}]*min-height:[^;]+[^}]*white-space:normal/s);
});

test('主界面日期按当前语言格式化，不会显示 undefined', () => {
  assert.match(appSource, /function localizedTodayDate\(date\)/);
  assert.match(appSource, /date\.textContent = localizedTodayDate\(d\)/);
  assert.doesNotMatch(appSource, /date\.textContent = uiText\(`\$\{d\.getMonth\(\) \+ 1\}/);
});

test('待确认叫法只在术语规范设置中展示，主画面不阻塞使用', () => {
  assert.match(htmlSource, /id="terminology-pending"[\s\S]*id="terminology-pending-list"/);
  assert.match(appSource, /function renderTerminologyPending\(\)/);
  assert.match(appSource, /appendClosureSuggestions\(terminologyPendingList, \{ needs_confirmation: suggestions \}, false, false\)/);
  assert.doesNotMatch(appSource, /appendClosureSuggestions\(card, data, true\)/);
  assert.doesNotMatch(appSource, /appendClosureSuggestions\(closureModalContent, data, false\)/);
});

test('待确认叫法提供是、不是、不处理三种语义明确的选择', () => {
  assert.match(appSource, /uiText\('是'\)/);
  assert.match(appSource, /uiText\('不是'\)/);
  assert.match(appSource, /uiText\('不处理'\)/);
  assert.match(appSource, /window\.api\.addTerminologyExclusion\(/);
  assert.match(appSource, /function dismissClosureSuggestion\(/);
});

test('AI 工作过程标题、状态和操作按钮各有稳定区域，长状态不会挤掉按钮', () => {
  assert.match(htmlSource, /report-thinking-head[\s\S]*report-thinking-title[\s\S]*report-thinking-status[\s\S]*report-thinking-toggle/);
  assert.match(appSource, /const title = wbNode\('span', 'report-thinking-title'/);
  assert.match(appSource, /const status = wbNode\('span', 'report-thinking-status'/);
  assert.match(appSource, /head\.append\(title, status, toggle\)/);
  assert.match(cssSource, /\.report-thinking-head\s*\{[^}]*display:grid;[^}]*grid-template-columns:max-content minmax\(0,1fr\) minmax\(0,max-content\)/s);
  assert.match(cssSource, /\.report-thinking-status\s*\{[\s\S]*min-width:0[\s\S]*white-space:\s*normal[\s\S]*overflow-wrap:\s*anywhere/s);
  assert.match(cssSource, /\.report-thinking-head > \.link-btn\s*\{[\s\S]*min-width:0[\s\S]*white-space:\s*normal/s);
  assert.doesNotMatch(cssSource, /\.report-thinking-head\s*\{[^}]*flex-wrap:\s*wrap/);
});

test('报告 AI 工作过程按报告周期缓存，空周期不会继承其他周期', () => {
  assert.match(appSource, /const reportThinkingCache = reportLifecycle\.createReportThinkingCache\(\)/);
  assert.match(appSource, /function syncReportThinkingForPeriod\(\)[\s\S]*reportThinkingCache\.read/);
  assert.match(appSource, /function beginReportThinking\(\)[\s\S]*saveReportThinking\(period, thinking\)/);
  assert.match(appSource, /function reportThinkingForJob\(job\)[\s\S]*cached\.jobId === job\.id/);
  assert.match(appSource, /function reloadReportContent\(\)[\s\S]*syncReportThinkingForPeriod\(\)/);
  assert.match(appSource, /window\.api\.onReportProgress\(progress =>[\s\S]*reportGenerationManager\.updateProgress\(progress\.jobId, progress\)/);
  assert.match(appSource, /reportThinkingToggle\.addEventListener\('click',[\s\S]*reportThinkingCache\.write\(currentReportPeriod\(\), state\.report\.thinking\)/);
});

test('已保存的报告不向用户暴露内部截断提示，且思考耗时在结束后冻结', () => {
  assert.match(appSource, /finalizeThinkingState\(/);
  assert.match(appSource, /thinkingState\.elapsedSeconds\(thinking\)/);
  assert.doesNotMatch(appSource, /总结已保存为部分结果/);
  assert.match(appSource, /总结已生成，已保留全部原始记录/);
  assert.match(appSource, /progress\.phase === 'recovering'[\s\S]*正在继续整理总结正文/);
  assert.match(appSource, /progress\.phase === 'fallback'[\s\S]*正在继续生成总结/);
});

test('周期报告允许切换周期并按任务并发生成，只禁止当前周期重复提交', () => {
  assert.match(htmlSource, /report-generation\.js[\s\S]*app\.js/);
  assert.match(appSource, /createReportGenerationManager\(/);
  assert.match(appSource, /maxConcurrent:\s*2/);
  assert.match(appSource, /reportGenerationManager\.getForPeriod\(currentReportPeriod\(\)\)/);
  assert.match(appSource, /reportType\.disabled = editing/);
  assert.match(appSource, /reportPrev\.disabled = editing \|\| state\.report\.type === 'custom'/);
  assert.doesNotMatch(appSource, /if \(state\.report\.loading\) return/);
});

test('当前周期没有记录时点击总结只提示用户，不创建 AI 任务', () => {
  assert.match(appSource, /function generateReport\(force = false\)\s*\{[\s\S]*const period = currentReportPeriod\(\);[\s\S]*if \(!reportEntries\(\)\.length\)/);
  assert.match(appSource, /本周期没有日报记录，无法生成总结/);
  assert.match(appSource, /if \(!reportEntries\(\)\.length\)[\s\S]*state\.report\.data = null[\s\S]*state\.report\.cacheStatus = 'missing'/);
  assert.match(appSource, /if \(!reportEntries\(\)\.length\)[\s\S]*toast\(message\)[\s\S]*return Promise\.resolve/);
  assert.match(appSource, /if \(!reportEntries\(\)\.length\)[\s\S]*reportGenerationManager\.enqueue/);
});

test('旧的本地预览页也只保留单一正式方案', () => {
  if (!previewSource) return;
  assert.doesNotMatch(previewSource, /variant-bar|variant-label|const variants|function change\(/);
});

test('工作台在左栏中拥有独立的可视高度和滚动容器', () => {
  assert.match(htmlSource, /id="recent-summary-thumb"/);
  assert.match(appSource, /attachOverlayScrollbar\(weeklyWorkbench, \$\('#recent-summary-thumb'\)\)/);
  assert.match(cssSource, /\.cols\s*\{[^}]*align-items:\s*stretch/s);
  assert.match(cssSource, /\.side-col\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(cssSource, /\.recent-summary-panel\s*\{[^}]*overflow-y:\s*auto/s);
});

test('主视图用共享标题栏对齐左右两栏，问候日期不再提前占用左栏', () => {
  assert.match(htmlSource, /<div class="main-titlebar">[\s\S]*?id="today-panel"[\s\S]*?<\/div>\s*<div class="cols">/);
  assert.doesNotMatch(htmlSource, /<div class="side-col">\s*<!-- 今日面板 -->/);
  assert.match(cssSource, /\.main-titlebar\s*\{[^}]*flex:\s*none[^}]*justify-content:\s*space-between/s);
  assert.match(cssSource, /\.cols\s*\{\s*flex-direction:\s*row;\s*align-items:\s*stretch;\s*height:\s*auto;/s);
});

test('小窗口将问候和统计压缩为有层次的工作概览栏，极窄时安全换行', () => {
  assert.match(cssSource, /#view-main > \.main-titlebar,[\s\S]*#view-main > \.cols,[\s\S]*#view-main \.side-col \{\s*display:\s*contents;/);
  assert.match(cssSource, /#view-main \.main-titlebar > \.today-panel\s*\{[\s\S]*grid-column:\s*1;[\s\S]*min-height:\s*56px/);
  assert.match(cssSource, /#view-main \.main-titlebar > \.today-panel\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center/s);
  assert.match(cssSource, /#view-main #stats-strip\s*\{[\s\S]*grid-column:\s*2 \/ -1;[\s\S]*grid-template-columns:\s*repeat\(3/s);
  assert.match(cssSource, /#view-main #stats-strip \.stat-card\s*\{[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*center;[\s\S]*justify-content:\s*center/s);
  assert.match(cssSource, /@media \(max-width:\s*760px\)[\s\S]*#view-main\s*\{[\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\)/);
  assert.doesNotMatch(cssSource, /#view-main \.main-titlebar > \.today-panel::(?:before|after)/);
  assert.doesNotMatch(cssSource, /#view-main #stats-strip \.stat-card::after/);
});
