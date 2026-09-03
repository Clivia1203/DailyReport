const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog,
  nativeImage, nativeTheme, Notification, screen, shell
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ASSETS = path.join(__dirname, 'assets');
const DEFAULT_HOTKEY = 'Alt+Shift+D';
// 窗口比可见的圆角输入条大一圈（上下 16/56px、左右 28px），
// 多出的透明区域用来容纳 CSS 阴影，避免阴影被窗口边界切成方形
const QUICK_SIZE = { width: 736, height: 176 };

// 覆盖式滚动条：不占布局空间，滚动/悬停时浮于内容右缘，杜绝滚动条出现引起的跳动
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  return;
}

let tray = null;
let mainWindow = null;
let quickWindow = null;
let quitting = false;

/* ---------------- 主题：主进程统一持有，两个窗口同步 ---------------- */

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

const DEFAULT_SETTINGS = {
  theme: 'auto',          // 'auto' | 'light' | 'dark'
  hotkey: DEFAULT_HOTKEY, // 唤起快速记录条的全局快捷键
  openAtLogin: false      // 开机自启（写入系统启动项，默认关闭）
};

let settings = { ...DEFAULT_SETTINGS };

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (s && typeof s === 'object') {
      if (['auto', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
      if (typeof s.hotkey === 'string' && s.hotkey) settings.hotkey = s.hotkey;
      if (typeof s.openAtLogin === 'boolean') settings.openAtLogin = s.openAtLogin;
    }
  } catch { /* 首次运行，使用默认设置 */ }
}

function saveSettings() {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}

function resolvedTheme() {
  if (settings.theme === 'auto') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return settings.theme;
}

// Windows 窗口控制按钮区（最小化/最大化/关闭）配色跟随主题
const TITLEBAR_COLORS = {
  light: { color: '#f5f6fa', symbolColor: '#3a3f4b' },
  dark: { color: '#21252b', symbolColor: '#abb2bf' }
};

const THEMED_BG = { light: '#f5f6fa', dark: '#21252b' };

// 模态打开时把标题栏覆盖层染成遮罩色，原生控制按钮无法被 CSS 盖住，只能同色隐没
let modalCoverActive = false;

function chromeOverlayColors() {
  if (modalCoverActive) {
    // 与 backdrop 遮罩(rgba(15,17,23,.35) 叠加主题底色)近似的实色
    return resolvedTheme() === 'dark'
      ? { color: '#1a1c22', symbolColor: '#1a1c22' }
      : { color: '#a8a6ab', symbolColor: '#a8a6ab' };
  }
  return TITLEBAR_COLORS[resolvedTheme()];
}

function applyChromeOverlay() {
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    try { mainWindow.setTitleBarOverlay(chromeOverlayColors()); } catch { /* 窗口未就绪时忽略 */ }
  }
}

function broadcastTheme() {
  const t = resolvedTheme();
  for (const w of [mainWindow, quickWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('theme:changed', t);
  }
  applyChromeOverlay();
}

/* ---------------- 存储层：本地 JSON 文件 ---------------- */

function dataFile() {
  return path.join(app.getPath('userData'), 'data.json');
}

function loadDB() {
  try {
    const db = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    if (db && Array.isArray(db.entries)) return db;
  } catch { /* 首次运行或文件损坏，返回空库 */ }
  return { version: 1, entries: [] };
}

function saveDB(db) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

/* ---------------- 时间与导出 ---------------- */

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function localDateStr(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function localTimeStr(ts) {
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function weekdayOf(dateStr) {
  return WEEKDAYS[new Date(dateStr + 'T00:00:00').getDay()];
}

function buildExport(entries, start, end, format) {
  const byDay = new Map();
  for (const e of entries) {
    const day = localDateStr(e.ts);
    if (day < start || day > end) continue;
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(e);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.ts - b.ts);

  const days = [...byDay.keys()].sort();
  const range = `${start} ~ ${end}`;
  const flat = s => s.replace(/\r?\n/g, ' ');

  if (format === 'txt') {
    const lines = [`日报 ${range}`, ''];
    for (const day of days) {
      lines.push(`【${day} 星期${weekdayOf(day)}】`);
      for (const e of byDay.get(day)) lines.push(`${localTimeStr(e.ts)}  ${flat(e.text)}`);
      lines.push('');
    }
    return lines.join('\r\n');
  }

  const md = [`# 日报 ${range}`, ''];
  for (const day of days) {
    md.push(`## ${day} 星期${weekdayOf(day)}`, '');
    for (const e of byDay.get(day)) md.push(`- \`${localTimeStr(e.ts)}\` ${flat(e.text)}`);
    md.push('');
  }
  return md.join('\n');
}

/* ---------------- IPC 接口 ---------------- */

function notifyMainChanged() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('entries:changed');
  }
}

ipcMain.handle('entries:list', () => loadDB().entries);

ipcMain.handle('entries:add', (_e, { text, ts }) => {
  const entry = {
    id: crypto.randomUUID(),
    text: String(text || '').trim(),
    ts: Number(ts) || Date.now(),
    createdAt: Date.now()
  };
  if (!entry.text) return { ok: false };
  const db = loadDB();
  db.entries.push(entry);
  saveDB(db);
  notifyMainChanged();
  return { ok: true, entry };
});

ipcMain.handle('entries:update', (_e, { id, patch }) => {
  const db = loadDB();
  const entry = db.entries.find(x => x.id === id);
  if (!entry) return { ok: false };
  if (patch.text !== undefined) entry.text = String(patch.text).trim();
  if (patch.ts !== undefined) entry.ts = Number(patch.ts) || entry.ts;
  saveDB(db);
  notifyMainChanged();
  return { ok: true };
});

ipcMain.handle('entries:delete', (_e, { id }) => {
  const db = loadDB();
  db.entries = db.entries.filter(x => x.id !== id);
  saveDB(db);
  notifyMainChanged();
  return { ok: true };
});

ipcMain.handle('entries:deleteMany', (_e, { ids }) => {
  if (!Array.isArray(ids) || !ids.length) return { ok: false, removed: 0 };
  const db = loadDB();
  const set = new Set(ids);
  const before = db.entries.length;
  db.entries = db.entries.filter(x => !set.has(x.id));
  saveDB(db);
  notifyMainChanged();
  return { ok: true, removed: before - db.entries.length };
});

ipcMain.handle('export:run', async (_e, { start, end, format }) => {
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };
  const content = buildExport(loadDB().entries, start, end, format);
  const ext = format === 'md' ? 'md' : 'txt';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出日报',
    defaultPath: `日报_${start}_${end}.${ext}`,
    filters: [{ name: format === 'md' ? 'Markdown 文件' : '纯文本文件', extensions: [ext] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, '\ufeff' + content, 'utf8');
  return { ok: true, filePath };
});

ipcMain.on('quick:hide', () => {
  if (quickHideTimer) { clearTimeout(quickHideTimer); quickHideTimer = null; }
  hideQuickNow();
});

ipcMain.on('window:modal-cover', (_e, on) => {
  modalCoverActive = !!on;
  applyChromeOverlay();
});

ipcMain.handle('theme:get', () => resolvedTheme());

ipcMain.handle('theme:set', (_e, pref) => {
  settings.theme = ['light', 'dark'].includes(pref) ? pref : 'auto';
  saveSettings();
  broadcastTheme();
  return resolvedTheme();
});

/* ---------------- 设置 ---------------- */

ipcMain.handle('settings:get', () => ({
  theme: settings.theme,
  resolvedTheme: resolvedTheme(),
  hotkey: settings.hotkey,
  defaultHotkey: DEFAULT_HOTKEY,
  openAtLogin: settings.openAtLogin,
  dataFile: dataFile()
}));

ipcMain.handle('settings:set', (_e, patch) => {
  const result = { ok: true, error: null };
  if (patch && typeof patch === 'object') {
    if (['auto', 'light', 'dark'].includes(patch.theme)) {
      settings.theme = patch.theme;
      saveSettings();
      broadcastTheme();
    }
    if (typeof patch.hotkey === 'string' && patch.hotkey) {
      const r = applyHotkey(patch.hotkey);
      if (!r.ok) { result.ok = false; result.error = r.error; }
    }
    if (typeof patch.openAtLogin === 'boolean') {
      settings.openAtLogin = patch.openAtLogin;
      // 唯一的系统级设置项：仅当用户在设置页打开/关闭时写入
      app.setLoginItemSettings({ openAtLogin: settings.openAtLogin });
      saveSettings();
    }
  }
  result.settings = { theme: settings.theme, hotkey: settings.hotkey, openAtLogin: settings.openAtLogin };
  return result;
});

ipcMain.handle('data:openFolder', () => shell.openPath(path.dirname(dataFile())));

/* ---------------- 全局快捷键：注册 / 冲突检测 / 热更新 ---------------- */

function toggleQuick() {
  if (quickWindow && quickWindow.isVisible()) hideQuickAnimated();
  else showQuick();
}

let quickHideTimer = null;

function hideQuickNow() {
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) quickWindow.hide();
}

// 发起退出：页面播完动画会回 quick:hide，主进程再隐藏。
// 不可由主进程按固定时长隐藏——IPC 延迟会把动画截断在非透明帧，
// 该陈旧帧就是下次弹出闪烁的来源。兜底计时仅防渲染层失联。
function hideQuickAnimated() {
  if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) return;
  if (quickHideTimer) return; // 退出已在进行
  quickWindow.webContents.send('quick:out');
  quickHideTimer = setTimeout(() => {
    quickHideTimer = null;
    hideQuickNow();
  }, 400);
}

function initHotkey() {
  let ok = false;
  try { ok = globalShortcut.register(settings.hotkey, toggleQuick); } catch { ok = false; }
  if (!ok && settings.hotkey !== DEFAULT_HOTKEY) {
    try { ok = globalShortcut.register(DEFAULT_HOTKEY, toggleQuick); } catch { ok = false; }
    if (ok) settings.hotkey = DEFAULT_HOTKEY;
  }
  if (!ok) {
    settings.hotkey = '';
    if (Notification.isSupported()) {
      new Notification({
        title: '快捷键注册失败',
        body: '全局快捷键被其他程序占用，请打开主界面到设置中更换',
        silent: true
      }).show();
    }
  }
}

function applyHotkey(accel) {
  if (accel === settings.hotkey) return { ok: true };
  const prev = settings.hotkey;
  try { if (prev) globalShortcut.unregister(prev); } catch { /* 忽略 */ }
  let ok = false;
  try {
    ok = globalShortcut.register(accel, toggleQuick);
  } catch {
    try { if (prev) globalShortcut.register(prev, toggleQuick); } catch { /* 忽略 */ }
    return { ok: false, error: '快捷键格式无效' };
  }
  if (ok) {
    settings.hotkey = accel;
    saveSettings();
    refreshTrayMenu();
    return { ok: true };
  }
  // 被其他程序占用：恢复旧注册
  try { if (prev) globalShortcut.register(prev, toggleQuick); } catch { /* 忽略 */ }
  return { ok: false, error: '该快捷键已被其他程序占用，请换一组' };
}

/* ---------------- 窗口与托盘 ---------------- */

function createMainWindow() {
  const t = resolvedTheme();
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 760,
    minHeight: 680, // 保证录入区+工具栏固定时，列表仍有足够可视高度
    show: false,
    backgroundColor: THEMED_BG[t],
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: { ...TITLEBAR_COLORS[t], height: 40 },
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // 调试/演示用途：electron . --open-settings 直接进入设置页
    if (process.argv.includes('--open-settings')) {
      mainWindow.webContents.send('ui:navigate', 'settings');
    }
  });
  // 关闭主窗口 = 隐藏到托盘，程序继续常驻，从托盘菜单真正退出
  mainWindow.on('close', e => {
    if (!quitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; });
}

function createQuickWindow() {
  quickWindow = new BrowserWindow({
    width: QUICK_SIZE.width,
    height: QUICK_SIZE.height,
    show: false,
    frame: false,
    resizable: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  quickWindow.loadFile(path.join(__dirname, 'renderer', 'quick.html'));
  quickWindow.on('blur', () => hideQuickAnimated());
  quickWindow.on('closed', () => { quickWindow = null; });
}

function showQuick() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  if (quickHideTimer) { clearTimeout(quickHideTimer); quickHideTimer = null; } // 取消进行中的退出
  // 每次唤起都重申尺寸：DPI/分辨率变化后旧窗口尺寸会失真，这里兜底自愈
  quickWindow.setSize(QUICK_SIZE.width, QUICK_SIZE.height, false);
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - QUICK_SIZE.width) / 2);
  // 视觉上输入条底边距工作区底部约 80px（高度中含 56px 透明阴影区）
  const y = Math.round(workArea.y + workArea.height - QUICK_SIZE.height - 24);
  quickWindow.setPosition(x, y, false);
  quickWindow.show();
  quickWindow.focus();
  quickWindow.webContents.send('quick:reset');
}

// 系统缩放/分辨率变化时，透明固定尺寸窗口不会自动按新 DPI 重算，
// 直接销毁小窗，下次唤起按新环境重建（display-metrics-changed 根治）
function watchDisplayMetrics() {
  screen.on('display-metrics-changed', (_e, display, changed) => {
    if (!changed.includes('scaleFactor') && !changed.includes('bounds')) return;
    if (display.id !== screen.getPrimaryDisplay().id) return;
    if (quickHideTimer) { clearTimeout(quickHideTimer); quickHideTimer = null; }
    if (quickWindow && !quickWindow.isDestroyed()) {
      quickWindow.destroy();
      quickWindow = null;
    }
  });
}

function trayMenuTemplate() {
  return Menu.buildFromTemplate([
    { label: settings.hotkey ? `快速记录（${settings.hotkey}）` : '快速记录（未设置快捷键）', click: () => showQuick() },
    { label: '打开主界面', click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit(); } }
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(trayMenuTemplate());
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'icon.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('日报随手记');
  tray.on('click', () => showQuick());
  tray.setContextMenu(trayMenuTemplate());
}

/* ---------------- 应用生命周期 ---------------- */

app.on('second-instance', () => {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.ddup5.dailyreport');

  loadSettings();
  // 跟随系统模式下，系统主题变化时通知所有窗口
  nativeTheme.on('updated', () => {
    if (settings.theme === 'auto') broadcastTheme();
  });

  createMainWindow();
  createQuickWindow();
  createTray();
  initHotkey();
  watchDisplayMetrics();
  if (settings.openAtLogin) app.setLoginItemSettings({ openAtLogin: true });

  if (Notification.isSupported() && settings.hotkey) {
    const n = new Notification({
      title: '日报随手记已启动',
      body: `按 ${settings.hotkey} 随时记录一条，点击托盘图标也可以`,
      silent: true
    });
    n.on('click', () => showQuick());
    n.show();
  }
});

app.on('will-quit', () => globalShortcut.unregisterAll());
