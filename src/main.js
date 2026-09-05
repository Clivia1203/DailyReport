const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog,
  nativeImage, nativeTheme, Notification, screen, shell, safeStorage
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const buildXlsxBuffer = require('./lib/xlsx-export');
const {
  DEFAULT_REPORT_TEMPLATES,
  sourceBundle,
  buildPrompt,
  coveredRefs,
  appendRawRecords,
  markdownToText,
  sourceHash,
  templateHash,
  reportId
} = require('./lib/report-utils');

const ASSETS = path.join(__dirname, 'assets');
const DEFAULT_HOTKEY = 'Alt+Shift+D';
// 窗口比可见的圆角输入条大一圈（上下 16/56px、左右 28px），
// 多出的透明区域用来容纳 CSS 阴影，避免阴影被窗口边界切成方形
const QUICK_SIZE = { width: 736, height: 176 };

// 关闭 GPU 加速：透明小窗在部分机器上偶发 DWM 合成闪烁（弹出瞬间黑/白块）。
// 本应用界面简单，软件渲染完全够用，以此换取透明窗口的显示稳定性。
app.commandLine.appendSwitch('disable-gpu');
app.disableHardwareAcceleration();

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
  openAtLogin: false,     // 开机自启（写入系统启动项，默认关闭）
  silentStart: false,     // 静默启动：开机后仅驻留托盘，不显示主窗口
  ai: {
    baseUrl: 'https://api.deepseek.com',
    model: '',
    encryptedApiKey: '',
    lastTestAt: 0,
    lastTestOk: false,
    lastError: ''
  },
  reportTemplates: { ...DEFAULT_REPORT_TEMPLATES }
};

// 开机自启带 --hidden 参数（由 applyLoginItem 写入启动项），启动时据此静默驻留
const startHidden = process.argv.includes('--hidden');

let settings = {
  ...DEFAULT_SETTINGS,
  ai: { ...DEFAULT_SETTINGS.ai },
  reportTemplates: { ...DEFAULT_SETTINGS.reportTemplates }
};

function loadSettings() {
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (s && typeof s === 'object') {
      if (['auto', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
      if (typeof s.hotkey === 'string' && s.hotkey) settings.hotkey = s.hotkey;
      if (typeof s.openAtLogin === 'boolean') settings.openAtLogin = s.openAtLogin;
      if (typeof s.silentStart === 'boolean') settings.silentStart = s.silentStart;
      if (s.ai && typeof s.ai === 'object') {
        if (typeof s.ai.baseUrl === 'string' && s.ai.baseUrl) settings.ai.baseUrl = s.ai.baseUrl;
        if (typeof s.ai.model === 'string') settings.ai.model = s.ai.model;
        if (typeof s.ai.encryptedApiKey === 'string') settings.ai.encryptedApiKey = s.ai.encryptedApiKey;
        if (Number.isFinite(s.ai.lastTestAt)) settings.ai.lastTestAt = s.ai.lastTestAt;
        if (typeof s.ai.lastTestOk === 'boolean') settings.ai.lastTestOk = s.ai.lastTestOk;
        if (typeof s.ai.lastError === 'string') settings.ai.lastError = s.ai.lastError;
      }
      if (s.reportTemplates && typeof s.reportTemplates === 'object') {
        for (const key of Object.keys(DEFAULT_REPORT_TEMPLATES)) {
          if (typeof s.reportTemplates[key] === 'string' && s.reportTemplates[key].trim()) {
            settings.reportTemplates[key] = s.reportTemplates[key];
          }
        }
      }
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
    if (db && Array.isArray(db.entries)) {
      return {
        version: 2,
        entries: db.entries,
        reports: Array.isArray(db.reports) ? db.reports : []
      };
    }
  } catch { /* 首次运行或文件损坏，返回空库 */ }
  return { version: 2, entries: [], reports: [] };
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

/* ---------------- DeepSeek 与周期总结 ---------------- */

const AI_TIMEOUT_MS = 45000;
const REPORT_TYPES = new Set(['day', 'week', 'month', 'custom']);

function apiKeyFromStorage() {
  if (!settings.ai.encryptedApiKey) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(settings.ai.encryptedApiKey, 'base64'));
  } catch { return ''; }
}

function encryptApiKey(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows 安全存储暂不可用，请稍后重试');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function aiPublicState(models = []) {
  return {
    configured: !!settings.ai.encryptedApiKey,
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    models,
    lastTestAt: settings.ai.lastTestAt,
    lastTestOk: settings.ai.lastTestOk,
    lastError: settings.ai.lastError
  };
}

async function deepSeekRequest(endpoint, apiKey, init = {}) {
  if (typeof fetch !== 'function') throw new Error('当前运行环境不支持网络请求');
  const base = String(settings.ai.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  try {
    const response = await fetch(base + endpoint, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(init.headers || {})
      }
    });
    const raw = await response.text();
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON 错误交给统一提示 */ }
    if (!response.ok) {
      const message = data?.error?.message || data?.message || `请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时，请检查网络或稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAvailableModels(apiKey) {
  const data = await deepSeekRequest('/models', apiKey);
  const models = Array.isArray(data?.data)
    ? data.data.map(x => typeof x === 'string' ? x : x?.id).filter(Boolean)
    : [];
  if (!models.length) throw new Error('接口已连接，但没有返回可用模型');
  return [...new Set(models)];
}

function chooseModel(models, current) {
  if (current && models.includes(current)) return current;
  // 仅作为新模型列表中的偏好排序；实际可用模型永远以 /models 返回为准。
  const preferred = ['deepseek-v4-pro', 'deepseek-v4-flash'];
  return preferred.find(x => models.includes(x)) || models[0];
}

function reportEntries(start, end) {
  return loadDB().entries.filter(entry => {
    const day = localDateStr(entry.ts);
    return day >= start && day <= end;
  });
}

function reportCacheKey({ start, end, periodType, model, sourceHashValue, templateHashValue }) {
  return [periodType, start, end, model, sourceHashValue, templateHashValue].join('|');
}

function findCachedReport(db, params) {
  const key = reportCacheKey(params);
  return db.reports.find(report => report.cacheKey === key) || null;
}

function reportTypeOrCustom(type) {
  return REPORT_TYPES.has(type) ? type : 'custom';
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

  if (format === 'xlsx') {
    const rows = loadDB().entries
      .filter(e => { const d = localDateStr(e.ts); return d >= start && d <= end; })
      .sort((a, b) => a.ts - b.ts)
      .map(e => {
        const d = localDateStr(e.ts);
        return { date: d, week: `星期${weekdayOf(d)}`, time: localTimeStr(e.ts), text: e.text.replace(/\r?\n/g, ' ') };
      });
    const buf = await buildXlsxBuffer(rows);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: '导出日报',
      defaultPath: `日报_${start}_${end}.xlsx`,
      filters: [{ name: 'Excel 工作表', extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, buf);
    return { ok: true, filePath };
  }

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

ipcMain.handle('ai:status', () => aiPublicState());

ipcMain.handle('ai:test', async (_e, { apiKey } = {}) => {
  const suppliedKey = String(apiKey || '').trim();
  const key = suppliedKey || apiKeyFromStorage();
  if (!key) return { ok: false, error: '请先填写 DeepSeek API Key' };
  try {
    const models = await fetchAvailableModels(key);
    const selected = chooseModel(models, settings.ai.model);
    const modelChanged = selected !== settings.ai.model;
    if (suppliedKey) settings.ai.encryptedApiKey = encryptApiKey(suppliedKey);
    settings.ai.model = selected;
    settings.ai.lastTestAt = Date.now();
    settings.ai.lastTestOk = true;
    settings.ai.lastError = '';
    saveSettings();
    return { ok: true, modelChanged, ai: aiPublicState(models) };
  } catch (error) {
    settings.ai.lastTestAt = Date.now();
    settings.ai.lastTestOk = false;
    settings.ai.lastError = error?.message || '连接失败';
    saveSettings();
    return { ok: false, error: settings.ai.lastError, ai: aiPublicState() };
  }
});

ipcMain.handle('ai:clear', () => {
  settings.ai.encryptedApiKey = '';
  settings.ai.model = '';
  settings.ai.lastTestAt = 0;
  settings.ai.lastTestOk = false;
  settings.ai.lastError = '';
  saveSettings();
  return { ok: true, ai: aiPublicState() };
});

ipcMain.handle('ai:setModel', (_e, { model } = {}) => {
  const value = String(model || '').trim();
  if (!value) return { ok: false, error: '模型名称不能为空' };
  settings.ai.model = value;
  settings.ai.lastTestOk = false;
  settings.ai.lastError = '模型已更换，请重新测试连接';
  saveSettings();
  return { ok: true, ai: aiPublicState() };
});

ipcMain.handle('report:getCached', (_e, { start, end, periodType, template } = {}) => {
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };
  const type = reportTypeOrCustom(periodType);
  const sources = sourceBundle(reportEntries(start, end));
  const templateText = String(template || settings.reportTemplates[type] || DEFAULT_REPORT_TEMPLATES.custom);
  const report = findCachedReport(loadDB(), {
    start,
    end,
    periodType: type,
    model: settings.ai.model,
    sourceHashValue: sourceHash(sources),
    templateHashValue: templateHash(templateText)
  });
  return { ok: true, report: report || null };
});

ipcMain.handle('report:generate', async (_e, payload = {}) => {
  const { start, end, periodLabel, force } = payload;
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };
  const periodType = reportTypeOrCustom(payload.periodType);
  const template = String(payload.template || settings.reportTemplates[periodType] || DEFAULT_REPORT_TEMPLATES.custom).trim();
  const entries = reportEntries(start, end);
  const sources = sourceBundle(entries);
  const sourceHashValue = sourceHash(sources);
  const templateHashValue = templateHash(template);
  const key = apiKeyFromStorage();
  if (!key) return { ok: false, error: '尚未配置 DeepSeek API Key，请先到设置中连接 AI' };

  let models;
  try {
    models = await fetchAvailableModels(key);
  } catch (error) {
    settings.ai.lastTestOk = false;
    settings.ai.lastError = error?.message || '连接失败';
    saveSettings();
    return { ok: false, error: settings.ai.lastError };
  }

  const previousModel = settings.ai.model;
  const model = chooseModel(models, previousModel);
  const cacheParams = { start, end, periodType, model, sourceHashValue, templateHashValue };
  if (!force) {
    const cached = findCachedReport(loadDB(), cacheParams);
    if (cached) return { ok: true, cached: true, report: cached, models, modelChanged: previousModel !== model };
  }

  if (settings.ai.model !== model || !settings.ai.lastTestOk) {
    settings.ai.model = model;
    settings.ai.lastTestAt = Date.now();
    settings.ai.lastTestOk = true;
    settings.ai.lastError = '';
    saveSettings();
  }

  try {
    const response = await deepSeekRequest('/chat/completions', key, {
      method: 'POST',
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: '你是一个严谨的工作总结整理助手。你只能基于用户提供的原始记录进行归纳和语言润色，不能编造、扩写或删除事实。总结正文必须覆盖每一条来源记录；如果多条记录属于同一事项，可以合并表达，但必须保留所有任务细节、结果、问题和时间线。'
          },
          { role: 'user', content: buildPrompt({ start, end, periodLabel, template, sources }) }
        ],
        stream: false,
        max_tokens: 8192
      })
    });
    const generated = response?.choices?.[0]?.message?.content;
    const aiContent = Array.isArray(generated)
      ? generated.map(x => typeof x === 'string' ? x : x?.text || '').join('')
      : String(generated || '').trim();
    if (!aiContent) throw new Error('AI 没有返回总结内容');

    const covered = coveredRefs(aiContent, sources);
    const db = loadDB();
    const report = {
      id: reportId(),
      cacheKey: reportCacheKey({ ...cacheParams, model }),
      periodType,
      periodLabel: periodLabel || `${start} 至 ${end}`,
      start,
      end,
      model,
      template,
      sourceCount: sources.length,
      coveredCount: covered.length,
      content: appendRawRecords(aiContent, sources),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    db.reports.push(report);
    saveDB(db);
    return { ok: true, cached: false, report, models, modelChanged: previousModel !== model };
  } catch (error) {
    settings.ai.lastTestOk = false;
    settings.ai.lastError = error?.message || '生成总结失败';
    saveSettings();
    return { ok: false, error: settings.ai.lastError };
  }
});

ipcMain.handle('report:save', (_e, { id, content } = {}) => {
  if (!id || typeof content !== 'string') return { ok: false, error: '总结内容无效' };
  const db = loadDB();
  const report = db.reports.find(x => x.id === id);
  if (!report) return { ok: false, error: '总结不存在或已被清理' };
  report.content = content;
  report.updatedAt = Date.now();
  saveDB(db);
  return { ok: true, report };
});

ipcMain.handle('report:export', async (_e, { id, format } = {}) => {
  const report = loadDB().reports.find(x => x.id === id);
  if (!report) return { ok: false, error: '总结不存在或已被清理' };
  const isText = format === 'txt';
  const ext = isText ? 'txt' : 'md';
  const content = isText ? markdownToText(report.content) : report.content;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '导出周期总结',
    defaultPath: `总结_${report.start}_${report.end}.${ext}`,
    filters: [{ name: isText ? '纯文本文件' : 'Markdown 文件', extensions: [ext] }]
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

// 把自启 + 静默偏好写入系统启动项；静默时附带 --hidden 参数供启动时识别
function applyLoginItem() {
  app.setLoginItemSettings({
    openAtLogin: settings.openAtLogin,
    args: settings.openAtLogin && settings.silentStart ? ['--hidden'] : []
  });
}

ipcMain.handle('settings:get', () => ({
  theme: settings.theme,
  resolvedTheme: resolvedTheme(),
  hotkey: settings.hotkey,
  defaultHotkey: DEFAULT_HOTKEY,
  openAtLogin: settings.openAtLogin,
  silentStart: settings.silentStart,
  dataFile: dataFile(),
  ai: aiPublicState(),
  reportTemplates: { ...settings.reportTemplates }
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
    let loginChanged = false;
    if (typeof patch.openAtLogin === 'boolean') {
      settings.openAtLogin = patch.openAtLogin;
      loginChanged = true;
    }
    if (typeof patch.silentStart === 'boolean') {
      settings.silentStart = patch.silentStart;
      loginChanged = true;
    }
    if (loginChanged) {
      // 系统级设置项：仅当用户在设置页修改时写入启动项
      applyLoginItem();
      saveSettings();
    }
  }
  result.settings = {
    theme: settings.theme,
    hotkey: settings.hotkey,
    openAtLogin: settings.openAtLogin,
    silentStart: settings.silentStart,
    ai: aiPublicState(),
    reportTemplates: { ...settings.reportTemplates }
  };
  return result;
});

ipcMain.handle('settings:setReportTemplate', (_e, { type, template } = {}) => {
  if (!Object.prototype.hasOwnProperty.call(DEFAULT_REPORT_TEMPLATES, type)) {
    return { ok: false, error: '总结周期无效' };
  }
  const value = String(template || '').trim();
  if (!value) return { ok: false, error: '模板内容不能为空' };
  settings.reportTemplates[type] = value;
  saveSettings();
  return { ok: true, type, template: value };
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
  }, 1200);  // 页面正常会在 150ms 回执；此兜底仅防渲染层失联，宁长勿短
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
    // 静默启动（开机自启 + 静默）时驻留托盘不显示窗口；--open-settings 调试例外
    if (!startHidden || process.argv.includes('--open-settings')) {
      mainWindow.show();
    }
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
      nodeIntegration: false,
      backgroundThrottling: false  // 隐藏时不节流渲染：保证退场动画播完、末帧恒为透明
    }
  });
  quickWindow.loadFile(path.join(__dirname, 'renderer', 'quick.html'));
  quickWindow.on('blur', () => hideQuickAnimated());
  quickWindow.on('closed', () => { quickWindow = null; });
}

function showQuick() {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  if (quickHideTimer) { clearTimeout(quickHideTimer); quickHideTimer = null; } // 取消进行中的退出
  const { workArea } = screen.getPrimaryDisplay();
  const x = Math.round(workArea.x + (workArea.width - QUICK_SIZE.width) / 2);
  // 视觉上输入条底边距工作区底部约 80px（高度中含 56px 透明阴影区）
  const y = Math.round(workArea.y + workArea.height - QUICK_SIZE.height - 24);
  // DPI/分辨率变化的兜底自愈：仅在尺寸/位置实际偏离时才设置，
  // 无条件的 setSize/setPosition 会让透明窗口重建表面，正是残余闪烁来源之一
  const [w, h] = quickWindow.getSize();
  if (w !== QUICK_SIZE.width || h !== QUICK_SIZE.height) {
    quickWindow.setSize(QUICK_SIZE.width, QUICK_SIZE.height, false);
  }
  const [px, py] = quickWindow.getPosition();
  if (px !== x || py !== y) quickWindow.setPosition(x, y, false);
  // 先让页面重启入场动画（从全透明起），再显示窗口，消灭"可见但未重置"的空窗帧
  quickWindow.webContents.send('quick:reset');
  quickWindow.show();
  quickWindow.focus();
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
  applyLoginItem();

  if (Notification.isSupported() && settings.hotkey && !startHidden) {
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
