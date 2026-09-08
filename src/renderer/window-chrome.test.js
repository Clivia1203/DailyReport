const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const mainSource = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const preloadSource = fs.readFileSync(path.join(root, 'preload.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, 'app.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const styleSource = fs.readFileSync(path.join(__dirname, 'style.css'), 'utf8');

function mainWindowSource() {
  const start = mainSource.indexOf('function createMainWindow()');
  const end = mainSource.indexOf('function createQuickWindow()', start);
  return mainSource.slice(start, end === -1 ? mainSource.length : end);
}

test('主窗口使用网页自绘标题栏，模态遮罩不再依赖原生覆盖层', () => {
  const source = mainWindowSource();

  assert.match(source, /frame:\s*false/);
  assert.doesNotMatch(source, /titleBarOverlay/);
  assert.doesNotMatch(mainSource, /window:modal-cover/);
  assert.doesNotMatch(preloadSource, /setModalCover/);
  assert.match(indexSource, /id="window-controls"/);
  assert.match(indexSource, /id="window-minimize"/);
  assert.match(indexSource, /id="window-maximize"/);
  assert.match(indexSource, /id="window-close"/);
  assert.match(appSource, /window\.api\.windowControls/);
});

test('自绘窗口控制区保留拖拽边界和悬停反馈', () => {
  assert.match(styleSource, /\.window-controls[\s\S]*-webkit-app-region:\s*no-drag/);
  assert.match(styleSource, /\.window-control:hover/);
  assert.match(styleSource, /\.window-control\.close:hover/);
  assert.match(styleSource, /\.window-control\.is-maximized/);
  assert.match(styleSource, /\.modal-backdrop[\s\S]*z-index:\s*80/);
});

test('窗口控制通过受控 IPC 接口操作，并同步最大化状态', () => {
  assert.match(preloadSource, /windowControls:\s*\{/);
  assert.match(preloadSource, /minimize:\s*\(\)\s*=>\s*ipcRenderer\.send\('window:minimize'/);
  assert.match(preloadSource, /toggleMaximize:\s*\(\)\s*=>\s*ipcRenderer\.send\('window:toggle-maximize'/);
  assert.match(preloadSource, /close:\s*\(\)\s*=>\s*ipcRenderer\.send\('window:close'/);
  assert.match(preloadSource, /onStateChanged/);
  assert.match(mainSource, /ipcMain\.on\('window:minimize'/);
  assert.match(mainSource, /ipcMain\.on\('window:toggle-maximize'/);
  assert.match(mainSource, /ipcMain\.on\('window:close'/);
  assert.match(mainSource, /send\('window:state'/);
});
