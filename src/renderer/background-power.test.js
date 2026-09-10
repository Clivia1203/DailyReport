const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const quickSource = fs.readFileSync(path.join(__dirname, 'quick.js'), 'utf8');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');

test('主界面后台工作同时受可见性和焦点约束', () => {
  assert.match(appSource, /function isRendererInteractive\(\)/);
  assert.match(appSource, /document\.hidden/);
  assert.match(appSource, /document\.hasFocus/);
  assert.match(appSource, /createVisibilityBoundTicker/);
  assert.match(appSource, /pauseBackgroundUiTimers/);
  assert.match(appSource, /if \(!isRendererInteractive\(\)\) \{[\s\S]*state\.needsVisibleRefresh[\s\S]*return;/);
});

test('主界面恢复时只补一次刷新，静默启动不主动联网', () => {
  assert.match(appSource, /function resumeRendererWork\(reason = 'visible'\)/);
  assert.match(appSource, /state\.needsVisibleRefresh/);
  assert.match(appSource, /loadWorkbenchClosure\(\{ autoReason: reason, schedule: true \}\)/);
  assert.match(appSource, /autoTestAiOnStartup\(\)\.finally/);

  const loadStart = appSource.indexOf('async function loadSettingsUI');
  const loadEnd = appSource.indexOf('function refreshLocalizedViews', loadStart);
  const loadFunction = appSource.slice(loadStart, loadEnd === -1 ? appSource.length : loadEnd);
  assert.match(loadFunction, /if \(!isRendererInteractive\(\)\)/);
  assert.match(loadFunction, /state\.needsVisibleRefresh = true/);
  assert.match(loadFunction, /return;/);
});

test('快速记录条后台停止时钟并允许 Chromium 节流', () => {
  assert.match(quickSource, /function scheduleQuickClock\(\)/);
  assert.match(quickSource, /if \(document\.hidden\) return/);
  assert.match(quickSource, /visibilitychange/);
  assert.match(mainSource, /backgroundThrottling:\s*true/);
  assert.doesNotMatch(mainSource, /backgroundThrottling:\s*false/);
});

test('主窗口隐藏到托盘时不广播无效的记录变更 IPC', () => {
  const notifyStart = mainSource.indexOf('function notifyMainChanged()');
  const notifyEnd = mainSource.indexOf("ipcMain.handle('entries:list'", notifyStart);
  const notifyFunction = mainSource.slice(notifyStart, notifyEnd === -1 ? mainSource.length : notifyEnd);
  assert.match(notifyFunction, /mainWindow\.isVisible\(\)/);
});

test('热力图数据没有变化时不重复重建 DOM', () => {
  assert.match(appSource, /function renderActivity\(\{ force = false \} = \{\}\)/);
  assert.match(appSource, /state\.activityRenderKey === renderKey/);
});
