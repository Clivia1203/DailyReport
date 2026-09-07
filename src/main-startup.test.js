const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const mainSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'renderer', 'app.js'), 'utf8');
const discovery = require('./lib/terminology-discovery');

test('主进程默认设置使用的术语提示词必须从术语模块导入', () => {
  assert.equal(typeof discovery.DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT, 'string');
  assert.match(
    mainSource,
    /const\s*\{[\s\S]*DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT[\s\S]*\}\s*=\s*require\('\.\/lib\/terminology-discovery'\);/
  );
});

test('术语识别把模型思考与最终输出作为进度事件传给渲染层', () => {
  assert.match(mainSource, /function responseMessageReasoning\(data\)/);
  assert.match(mainSource, /phase:\s*'thinking'[\s\S]*reasoningLength/);
  assert.match(mainSource, /phase:\s*'writing'[\s\S]*contentLength/);
  assert.match(mainSource, /requestTerminologyDiscovery\(\{[\s\S]*notify/);
});

test('术语识别使用流式响应，模型生成期间持续回传 AI 输出', () => {
  const start = mainSource.indexOf('async function requestTerminologyDiscovery');
  const end = mainSource.indexOf('\nasync function discoverTerminologyFromEntries', start);
  const requestSource = mainSource.slice(start, end === -1 ? mainSource.length : end);
  assert.match(requestSource, /await deepSeekStream\(/);
  assert.match(requestSource, /stream:\s*true/);
  assert.match(requestSource, /delta\.content[\s\S]*content \+= delta\.content/);
});

test('并发周期报告的进度事件携带任务 ID，避免切周后串到当前页面', () => {
  assert.match(mainSource, /const jobId = String\(payload\.jobId \|\| ''\)\.trim\(\)/);
  assert.match(mainSource, /send\('report:progress', \{ \.\.\.progress, jobId \}\)/);
  assert.match(mainSource, /send\('report:progress', \{ phase: 'error', error: settings\.ai\.lastError, jobId \}\)/);
});

test('报告流正常结束但缺少 finish_reason 时按完成处理，续写不重复开启思考', () => {
  assert.match(mainSource, /return \{ finishReason: finishReason \|\| 'stop', usage \}/);
  assert.match(mainSource, /const thinkingEnabled = continuationCount === 0/);
});

test('无日报记录时在读取缓存和调用 AI 前直接返回', () => {
  assert.match(mainSource, /reportInputStatus/);
  assert.match(
    mainSource,
    /const sources = sourceBundle\(reportEntries\(start, end\)\);[\s\S]*const sourceStatus = reportInputStatus\(sources\);[\s\S]*if \(!sourceStatus\.ok\)/
  );
  assert.match(mainSource, /error: sourceStatus\.error/);
  assert.match(
    mainSource,
    /ipcMain\.handle\('report:generate'[\s\S]*const sourceStatus = reportInputStatus\(sources\);[\s\S]*if \(!sourceStatus\.ok\)[\s\S]*fetchAvailableModels/
  );
});

test('周期报告保存 AI 思考快照，重启后可从已保存报告恢复', () => {
  assert.match(mainSource, /app\.commandLine\.appendSwitch\('in-process-gpu'\)/);
  assert.match(mainSource, /attachReportThinking/);
  const reportStart = mainSource.indexOf("ipcMain.handle('report:generate'");
  const reportEnd = mainSource.indexOf("ipcMain.handle('report:save'", reportStart);
  const reportHandler = mainSource.slice(reportStart, reportEnd === -1 ? mainSource.length : reportEnd);
  assert.match(reportHandler, /const generationStartedAt = Date\.now\(\)/);
  assert.match(mainSource, /reasoning \+= delta\.reasoning/);
  assert.match(mainSource, /text: segments\.map\(segment => segment\.reasoning/);
  assert.match(mainSource, /ipcMain\.handle\('report:saveThinking'/);
  assert.match(preloadSource, /saveReportThinking: \(id, thinking\) => ipcRenderer\.invoke\('report:saveThinking'/);
  assert.match(appSource, /extractReportThinking\(report\)/);
  assert.match(appSource, /restoreReportThinkingFromReport\(res\.report\)/);
});

test('AI 连接测试不落盘，配置由独立保存动作持久化', () => {
  const testStart = mainSource.indexOf("ipcMain.handle('ai:test'");
  const testEnd = mainSource.indexOf("ipcMain.handle('ai:save'", testStart);
  const testHandler = mainSource.slice(testStart, testEnd === -1 ? mainSource.length : testEnd);

  assert.notEqual(testStart, -1, 'AI 测试处理器不存在');
  assert.doesNotMatch(testHandler, /saveSettings\(\)/);
  assert.doesNotMatch(testHandler, /encryptApiKey\(/);
  assert.match(mainSource, /ipcMain\.handle\('ai:save'[\s\S]*saveSettings\(\)/);
});

test('快速记录条按唤起代次隔离退出事件，避免托盘重呼出后被旧回调隐藏', () => {
  const hideStart = mainSource.indexOf("ipcMain.on('quick:hide'");
  const hideEnd = mainSource.indexOf("ipcMain.on('window:modal-cover'", hideStart);
  const hideHandler = mainSource.slice(hideStart, hideEnd === -1 ? mainSource.length : hideEnd);
  const showStart = mainSource.indexOf('function showQuick(');
  const showEnd = mainSource.indexOf('// 系统缩放/分辨率变化', showStart);
  const showFunction = mainSource.slice(showStart, showEnd === -1 ? mainSource.length : showEnd);
  const animatedStart = mainSource.indexOf('function hideQuickAnimated()');
  const animatedEnd = mainSource.indexOf('function initHotkey()', animatedStart);
  const animatedFunction = mainSource.slice(animatedStart, animatedEnd === -1 ? mainSource.length : animatedEnd);

  assert.match(hideHandler, /generation\s*!==\s*quickGeneration/);
  assert.match(showFunction, /quickGeneration\s*\+=\s*1/);
  assert.match(showFunction, /quickShowPending\s*=\s*true/);
  assert.match(mainSource, /webContents\.once\('did-finish-load'/);
  assert.match(mainSource, /createQuickBlurController/);
  assert.match(mainSource, /blurController\.handleBlur\(quickBlurIgnoreUntil\)/);
  assert.match(mainSource, /windowRef\.on\('focus',\s*\(\)\s*=>\s*blurController\.cancel\(\)\)/);
  assert.match(mainSource, /showQuick\(\{ ignoreBlur: true \}\)/);
  assert.match(mainSource, /send\('quick:reset',\s*generation\)/);
  assert.match(animatedFunction, /const generation = quickGeneration/);
  assert.match(animatedFunction, /send\('quick:out',\s*generation\)/);
  assert.match(animatedFunction, /generation\s*!==\s*quickGeneration/);
  assert.match(preloadSource, /hideQuick:\s*generation\s*=>\s*ipcRenderer\.send\('quick:hide',\s*generation\)/);
  assert.match(preloadSource, /const h = \(_e, generation\) => cb\(generation\)/);
});

test('快速记录条显示时先呈现再交接焦点，避免快捷键或托盘触发瞬时失焦退出', () => {
  const presentStart = mainSource.indexOf('function presentQuick()');
  const presentEnd = mainSource.indexOf('function showQuick(', presentStart);
  const presentFunction = mainSource.slice(presentStart, presentEnd === -1 ? mainSource.length : presentEnd);
  const revealStart = mainSource.indexOf('function revealQuick(');
  const revealEnd = mainSource.indexOf('ipcMain.on(\'quick:reset-ready\'', revealStart);
  const revealFunction = mainSource.slice(revealStart, revealEnd === -1 ? mainSource.length : revealEnd);

  assert.notEqual(presentStart, -1, '快速记录条显示函数不存在');
  assert.notEqual(revealStart, -1, '快速记录条原生显示函数不存在');
  assert.match(presentFunction, /quickResetPending/);
  assert.match(presentFunction, /quickPresentTimer/);
  assert.match(revealFunction, /(?:quickWindow|windowRef)\.show\(\)/);
  assert.match(revealFunction, /(?:quickWindow|windowRef)\.focus\(\)/);
  assert.match(mainSource, /if \(quickBlurController\) quickBlurController\.cancel\(\)/);
  assert.match(mainSource, /blurController\.handleBlur\(quickBlurIgnoreUntil\)/);
});

test('快速记录条在渲染层确认复位后才显示，避免退场残帧造成空白或闪现', () => {
  assert.match(mainSource, /ready-to-show/);
  assert.match(mainSource, /quick:reset-ready/);
  assert.match(mainSource, /quickResetPending/);
  assert.match(preloadSource, /quickResetReady:\s*generation\s*=>\s*ipcRenderer\.send\('quick:reset-ready',\s*generation\)/);
  assert.match(mainSource, /setTimeout\([\s\S]*quickResetPending[\s\S]*\d+\)/);
});
