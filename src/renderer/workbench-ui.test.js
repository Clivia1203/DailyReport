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

test('近期闭环事项统一使用深色左边框，不再用来源区分卡片样式', () => {
  assert.match(appSource, /const row = wbNode\('article', 'wb-closure-item'\);/);
  assert.doesNotMatch(appSource, /item\.kind === 'recent'/);
  assert.match(cssSource, /\.wb-closure-item\s*\{[\s\S]*border-left:\s*3px solid var\(--border-strong\)/);
  assert.doesNotMatch(cssSource, /\.wb-closure-item\.recent\s*\{/);
  assert.match(cssSource, /\.closure-modal-content \.wb-closure-item\s*\{[\s\S]*border-left:\s*3px solid var\(--border-strong\)/);
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

test('未配置 AI 时隐藏左侧近期闭环卡片，连接后再恢复显示', () => {
  assert.match(appSource, /const visible = wide && !viewMain\.hidden && !!state\.settings\?\.ai\?\.configured/);
  assert.match(appSource, /state\.settings = s;\s*syncWeeklyWorkbenchViewport\(\);/);
  assert.match(appSource, /weeklyWorkbench\.hidden = !visible/);
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

test('报告 AI 工作过程没有展开时连滚动包装层也必须隐藏', () => {
  assert.match(appSource, /const contentVisible = showDetails && thinking\.open;[\s\S]*reportThinkingContentWrap\.hidden = !contentVisible;[\s\S]*reportThinkingContent\.hidden = !contentVisible/);
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

test('滚动区域在上下仍有内容时渐隐，并保护日期标题不被覆盖', () => {
  assert.match(appSource, /function syncScrollEdgeFade\(scroller/);
  assert.match(appSource, /has-scroll-top/);
  assert.match(appSource, /has-scroll-bottom/);
  assert.match(appSource, /paddingBottom/);
  assert.match(appSource, /new ResizeObserver\(update\)/);
  assert.match(appSource, /new MutationObserver\(update\)/);
  assert.match(cssSource, /\.edge-fade-host::before,[\s\S]*z-index:\s*1/);
  assert.match(cssSource, /\.edge-fade-host\.has-scroll-top::before/);
  assert.match(cssSource, /\.edge-fade-host\.has-scroll-bottom::after/);
  assert.match(cssSource, /\.day-head\s*\{[^}]*position:\s*sticky[^}]*z-index:\s*2/s);
  assert.match(cssSource, /\.edge-fade-host::before,[\s\S]*pointer-events:\s*none/);
});

test('渐隐固定在滚动视口边缘，不会跟随日报内容漂移且范围克制', () => {
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host recent-summary-wrap">[\s\S]*id="recent-summary-panel"[\s\S]*id="recent-summary-thumb"/);
  assert.match(appSource, /const fadeHost = explicitHost \|\| scroller\.closest\('\.edge-fade-host'\)/);
  assert.match(appSource, /weeklyWorkbenchWrap\.hidden = !visible/);
  assert.match(cssSource, /\.edge-fade-host\.has-scroll-top::before/);
  assert.match(cssSource, /\.edge-fade-host\.has-scroll-bottom::after/);
  assert.doesNotMatch(cssSource, /\.scroll-edge-fade-scroller::before/);
  assert.match(cssSource, /height:\s*28px/);
  assert.match(cssSource, /backdrop-filter:\s*blur\(6px\)/);
  assert.match(cssSource, /\.recent-summary-wrap\s*\{\s*display:\s*none/);
});

test('边缘渐隐让内容本身连续软化，不能用实色覆盖制造硬边界', () => {
  assert.doesNotMatch(appSource, /scroller\.classList\.add\('edge-fade-content'\)/);
  assert.match(cssSource, /-webkit-mask-image:\s*linear-gradient/);
  assert.match(cssSource, /mask-image:\s*linear-gradient/);
  assert.doesNotMatch(cssSource, /backdrop-filter:\s*blur\(1px\)/);
  assert.match(cssSource, /color-mix\(in srgb, var\(--bg\) 82%, transparent\)/);
  assert.match(cssSource, /\.content::before,\s*\.content::after,\s*\.edge-fade-host::before,\s*\.edge-fade-host::after/);
  assert.doesNotMatch(htmlSource, /edge-fade-mask-host|edge-fade-maskable|edge-fade-content/);
});

test('无明确内容框的滚动区统一使用同一套边界软化层，日报卡片边框不能走另一条路径', () => {
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host">[\s\S]*<section class="list" id="list">/);
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host recent-summary-wrap">[\s\S]*id="recent-summary-panel"/);
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host report-side-wrap"[^>]*>[\s\S]*<aside class="report-side">/);
  assert.doesNotMatch(htmlSource, /edge-fade-mask-host|edge-fade-maskable|edge-fade-content/);
  assert.match(cssSource, /\.content::before,\s*\.content::after,\s*\.edge-fade-host::before,\s*\.edge-fade-host::after/);
  assert.match(cssSource, /backdrop-filter:\s*blur\(6px\)/);
  assert.match(cssSource, /\.edge-fade-host\.has-scroll-bottom::after/);
  assert.match(cssSource, /\.day-head\s*\{[\s\S]*z-index:\s*2/s);
});

test('小窗口主视图发生纵向溢出时拥有独立滚动出口和视口渐隐', () => {
  assert.match(appSource, /function attachScrollEdgeFade\(scroller, fadeHost\)/);
  assert.match(appSource, /attachScrollEdgeFade\(viewMain, \$\('\.content'\)\)/);
  assert.match(cssSource, /\.content::before,[\s\S]*pointer-events:\s*none/);
  assert.match(cssSource, /\.content\.has-scroll-top::before/);
  assert.match(cssSource, /\.content\.has-scroll-bottom::after/);
  assert.match(cssSource, /#view-main\s*\{[^}]*overflow-y:\s*auto[^}]*scrollbar-width:\s*none/s);
  assert.match(cssSource, /#view-main::-webkit-scrollbar\s*\{\s*display:\s*none;/);
  assert.doesNotMatch(cssSource, /@media \(max-height:\s*760px\)\s+and\s+\(min-width:\s*1200px\)/);
});

test('周期总结只在页面边缘渐隐，明确内容框不叠加虚化', () => {
  assert.match(htmlSource, /<div class="scroll-wrap report-content-wrap"[^>]*>[\s\S]*id="report-content"/);
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host report-side-wrap"[^>]*>[\s\S]*<aside class="report-side">/);
  assert.match(htmlSource, /class="settings-scroll ai-settings-content"/);
  assert.match(htmlSource, /<div class="scroll-wrap closure-modal-scroll-wrap"[^>]*>[\s\S]*id="closure-modal-content"/);
  assert.match(appSource, /attachScrollEdgeFade\(viewReport, \$\('\.content'\)\)/);
  assert.doesNotMatch(appSource, /attachScrollEdgeFade\(reportContent,/);
  assert.match(appSource, /attachScrollEdgeFade\(reportSide, reportSideWrap\)/);
  assert.doesNotMatch(appSource, /attachScrollEdgeFade\(reportThinkingContent,/);
  assert.doesNotMatch(appSource, /attachScrollEdgeFade\(closureModalContent,/);
  assert.doesNotMatch(appSource, /aiSettingsPanels\.map\(panel => attachScrollEdgeFade/);
  assert.match(cssSource, /\.report-content-wrap[\s\S]*\.report-side-wrap/);
});

test('明确内容框不使用渐隐，只有页面边缘和无框滚动区保留渐隐', () => {
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host recent-summary-wrap">/);
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host">[\s\S]*<section class="list" id="list">/);
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host settings-wrap">/);
  assert.match(htmlSource, /<div class="scroll-wrap edge-fade-host report-side-wrap"[^>]*>[\s\S]*<aside class="report-side">/);
  assert.doesNotMatch(htmlSource, /class="settings-scroll ai-settings-content scroll-wrap/);
  assert.match(appSource, /const fadeHost = explicitHost \|\| scroller\.closest\('\.edge-fade-host'\)/);
  assert.doesNotMatch(appSource, /attachScrollEdgeFade\(reportContent, reportContentWrap\)/);
  assert.match(appSource, /attachScrollEdgeFade\(reportSide, reportSideWrap\)/);
  assert.doesNotMatch(appSource, /attachScrollEdgeFade\(reportThinkingContent,/);
  assert.doesNotMatch(appSource, /attachScrollEdgeFade\(terminologyThinkingContent,/);
  assert.doesNotMatch(appSource, /attachScrollEdgeFade\(closureModalContent,/);
  assert.doesNotMatch(appSource, /aiSettingsPanels\.map\(panel => attachScrollEdgeFade/);
  assert.match(cssSource, /\.edge-fade-host::before,[\s\S]*\.edge-fade-host::after/);
  assert.doesNotMatch(cssSource, /\.scroll-wrap::before/);
  assert.doesNotMatch(htmlSource, /edge-fade-mask-host|edge-fade-maskable|edge-fade-content/);
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

test('宽屏统计数字相对整张卡片居中，不受语言标签宽度影响', () => {
  assert.match(cssSource, /@media \(min-width:\s*1200px\)[\s\S]*\.stat-card\s*\{[\s\S]*display:\s*grid;[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
  assert.match(cssSource, /@media \(min-width:\s*1200px\)[\s\S]*\.stat-value\s*\{[\s\S]*grid-column:\s*2;/);
  assert.match(cssSource, /@media \(min-width:\s*1200px\)[\s\S]*\.stat-label\s*\{[\s\S]*grid-column:\s*3;[\s\S]*justify-self:\s*end;/);
});
