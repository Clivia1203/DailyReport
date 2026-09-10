const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = file => fs.readFileSync(path.join(__dirname, file), 'utf8');
const quickHtml = read('quick.html');
const quickCss = read('quick.css');
const quickJs = read('quick.js');
const mainSource = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const appSource = read('app.js');
const indexSource = read('index.html');
const styleSource = read('style.css');

test('快速记录条超过一行后平滑增高，达到上限后在输入区内部滚动', () => {
  assert.match(quickHtml, /<textarea[^>]*id="quick-input"/, '快速记录条需要使用多行输入控件');
  assert.match(quickCss, /#quick-input[\s\S]*max-height:\s*\d+px[\s\S]*overflow-y:\s*hidden/, '快速记录条需要有受限输入高度');
  assert.match(quickJs, /scrollHeight/, '快速记录条需要根据内容高度计算布局');
  assert.match(quickJs, /resizeQuick/, '快速记录条需要把目标高度同步给主进程');
  assert.match(mainSource, /ipcMain\.on\('quick:resize'/, '主进程需要接收快速记录条尺寸变化');
  assert.match(mainSource, /setBounds\(/, '快速记录条尺寸变化需要通过窗口边界更新');
  assert.match(mainSource, /QUICK_MAX_HEIGHT/, '快速记录条需要有原生窗口最大高度');
});

test('快速记录条连续输入时复用正在运行的尺寸动画，避免窗口抖动', () => {
  const resizeStart = mainSource.indexOf('function resizeQuickWindow(');
  const resizeEnd = mainSource.indexOf('\nfunction updateQuickBounds', resizeStart);
  const resizeFunction = mainSource.slice(resizeStart, resizeEnd === -1 ? mainSource.length : resizeEnd);

  assert.match(mainSource, /let quickResizeTarget\s*=\s*QUICK_SIZE\.height/, '需要保存当前动画目标');
  assert.match(resizeFunction, /quickResizeTarget\s*=\s*target/, '连续输入时应更新目标高度');
  assert.match(resizeFunction, /if \(quickResizeTimer !== null\)[\s\S]*return;/, '已有动画时不能反复重启定时器');
});

test('快速记录条隐藏保存状态时不占用输入区宽度', () => {
  assert.match(quickCss, /\.row\s*\{[\s\S]*position:\s*relative/, '状态提示需要相对输入行定位');
  assert.match(quickCss, /\.status\s*\{[\s\S]*width:\s*0[;\s]/, '隐藏状态提示需要收缩宽度');
  assert.match(quickCss, /\.status\.show\s*\{[\s\S]*width:\s*[^0]/, '状态提示显示时才恢复自身宽度');
});

test('主界面记录输入区保持更大的固定高度，超出后只在输入框内部滚动', () => {
  assert.match(indexSource, /<textarea id="composer-text"/, '主界面记录输入区应保持多行文本框');
  assert.match(styleSource, /\.composer textarea[\s\S]*height:\s*\d+px[\s\S]*overflow-y:\s*auto/, '主界面输入区需要固定高度并允许内部滚动');
  assert.doesNotMatch(appSource, /composerText\.addEventListener\('input', \(\) => growTextarea\(composerText\)\)/, '主界面输入区不能再随输入自动增高');
  assert.doesNotMatch(appSource, /growTextarea\(composerText\)/, '保存后不能再调用自动增高逻辑');
});
