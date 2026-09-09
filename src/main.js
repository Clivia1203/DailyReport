const {
  app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog,
  nativeImage, nativeTheme, Notification, screen, shell, safeStorage
} = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const UI_LOCALE_CATALOG = Object.freeze({
  'zh-CN': require('./renderer/locales/zh-CN.json'),
  'en-US': require('./renderer/locales/en-US.json'),
  'ja-JP': require('./renderer/locales/ja-JP.json')
});
const buildXlsxBuffer = require('./lib/xlsx-export');
const {
  DEFAULT_REPORT_TEMPLATES,
  sourceBundle,
  splitSources,
  buildPrompt,
  coveredRefs,
  auditSourceRecords,
  appendRawRecords,
  markdownToText,
  sourceHash,
  templateHash,
  reportId,
  reportInputStatus
} = require('./lib/report-utils');
const {
  reportCacheKey,
  findCachedReport,
  findLatestReport,
  reportCacheStatus
} = require('./lib/report-cache');
const {
  REASONING_EFFORTS,
  normalizeReasoningEffort,
  resolveReasoningEffort
} = require('./lib/reasoning-effort');
const {
  DEFAULT_LOCALE,
  normalizeLocale,
  localeFromInstallerLanguage
} = require('./lib/locale');
const {
  TEMPLATE_TYPES,
  PROMPT_SCHEMA_VERSION,
  createPromptOverrides,
  migrateLegacyPromptOverrides,
  normalizePromptOverrides,
  defaultPrompt,
  resolvePrompt,
  writePromptOverride,
  catalogFor
} = require('./lib/prompt-catalog');
const {
  normalizeSavedFilters
} = require('./lib/filter-presets');
const {
  createBackupPayload,
  validateBackupPayload,
  restoreSettingsSnapshot,
  restoreDataSnapshot
} = require('./lib/backup');
const {
  normalizeTerminology,
  addTerminologyAlias,
  normalizeTerminologyExclusions,
  addTerminologyExclusion,
  removeTerminologyExclusion
} = require('./lib/terminology');
const {
  attachReportThinking,
  normalizeThinkingSnapshot
} = require('./lib/thinking-snapshot');
const {
  DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT,
  MAX_DISCOVERY_OUTPUT_TOKENS,
  MAX_DISCOVERY_CANDIDATES,
  discoverySystemPrompt,
  discoverySources,
  splitDiscoverySources,
  buildDiscoveryPrompt,
  buildConsolidationPrompt,
  parseTerminologyResponse,
  mergeTerminologyResults,
  normalizeDiscoveryState
} = require('./lib/terminology-discovery');
const {
  DEFAULT_CLOSURE_PROMPT,
  closureSourceBundle,
  splitClosureHistory,
  buildClosurePrompt,
  parseClosureResponse,
  mergeClosureResults,
  closureInputHash,
  closureCacheKey,
  findCachedClosure,
  findLatestClosure,
  closureCacheStatus,
  hydrateClosureResult,
  filterResolvedClosureSuggestions
} = require('./lib/closure-utils');
const { createQuickBlurController } = require('./lib/quick-blur-controller');
const { createBufferedJsonStore } = require('./lib/buffered-json-store');
const {
  DEFAULT_PROVIDER_ID,
  getProvider,
  normalizeProviderId,
  normalizeBaseUrl,
  preferredModels,
  extractModelIds,
  buildChatRequestBody
} = require('./lib/ai-providers');

const ASSETS = path.join(__dirname, 'assets');
const DEFAULT_HOTKEY = 'Alt+Shift+D';
// 窗口比可见的圆角输入条大一圈（上下 16/56px、左右 28px），
// 多出的透明区域用来容纳 CSS 阴影，避免阴影被窗口边界切成方形
const QUICK_SIZE = { width: 736, height: 176 };
const QUICK_MAX_HEIGHT = 320;
const QUICK_RESIZE_DURATION = 180;

// 关闭 GPU 加速：透明小窗在部分机器上偶发 DWM 合成闪烁（弹出瞬间黑/白块）。
// 本应用界面简单，软件渲染完全够用，以此换取透明窗口的显示稳定性。
app.commandLine.appendSwitch('disable-gpu');
// 某些 Windows 环境即使关闭硬件加速，Chromium 仍会尝试启动独立 GPU 子进程；
// 该子进程缺少运行库时会在窗口创建前直接崩溃。放到主进程内运行，避免用户看到系统级错误框。
app.commandLine.appendSwitch('in-process-gpu');
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

function isMainWindowEvent(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function mainWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { maximized: false, fullscreen: false };
  }
  return {
    maximized: mainWindow.isMaximized(),
    fullscreen: mainWindow.isFullScreen()
  };
}

function broadcastMainWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('window:state', mainWindowState());
}

/* ---------------- 主题：主进程统一持有，两个窗口同步 ---------------- */

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function installerLocaleFile() {
  // NSIS 把安装器选择的语言写在应用安装目录；开发模式通常不存在该文件。
  return path.join(path.dirname(process.execPath), 'installer-locale.txt');
}

function readInstallerLocale() {
  try {
    return localeFromInstallerLanguage(fs.readFileSync(installerLocaleFile(), 'utf8'));
  } catch {
    return null;
  }
}

const THEME_FAMILIES = [
  'gold', 'sky', 'mint', 'violet',
  'navy', 'graphite', 'pine', 'amber', 'indigo', 'steel'
];

const THEME_WINDOW_COLORS = {
  gold: {
    light: { color: '#fffaf1', symbolColor: '#2e2a22' },
    dark: { color: '#19150d', symbolColor: '#eee6d7' }
  },
  sky: {
    light: { color: '#f4f8ff', symbolColor: '#1b2538' },
    dark: { color: '#111827', symbolColor: '#e5e9f2' }
  },
  mint: {
    light: { color: '#f2fbf7', symbolColor: '#17322b' },
    dark: { color: '#0f1e1a', symbolColor: '#e3f0ea' }
  },
  violet: {
    light: { color: '#faf7ff', symbolColor: '#27223a' },
    dark: { color: '#171424', symbolColor: '#eae8f4' }
  },
  navy: {
    light: { color: '#f3f6fa', symbolColor: '#1f2c3a' },
    dark: { color: '#111923', symbolColor: '#e6edf3' }
  },
  graphite: {
    light: { color: '#f2f6f6', symbolColor: '#213438' },
    dark: { color: '#121b1d', symbolColor: '#e5eeee' }
  },
  pine: {
    light: { color: '#f2f6f3', symbolColor: '#20352d' },
    dark: { color: '#111c17', symbolColor: '#e5eee8' }
  },
  amber: {
    light: { color: '#f5f5f2', symbolColor: '#2e3234' },
    dark: { color: '#1d1f20', symbolColor: '#ecedeb' }
  },
  indigo: {
    light: { color: '#f4f5f9', symbolColor: '#282e3e' },
    dark: { color: '#161a25', symbolColor: '#e8ebf4' }
  },
  steel: {
    light: { color: '#f3f5f7', symbolColor: '#26323c' },
    dark: { color: '#151b20', symbolColor: '#e6edf2' }
  }
};

const DEFAULT_SETTINGS = {
  locale: DEFAULT_LOCALE,
  theme: 'auto',          // 'auto' | 'light' | 'dark'
  themeFamily: 'gold',    // gold/sky/mint/violet + navy/graphite/pine/amber/indigo/steel
  hotkey: DEFAULT_HOTKEY, // 唤起快速记录条的全局快捷键
  openAtLogin: false,     // 开机自启（写入系统启动项，默认关闭）
  silentStart: false,     // 静默启动：开机后仅驻留托盘，不显示主窗口
  ai: {
    providerId: DEFAULT_PROVIDER_ID,
    baseUrl: 'https://api.deepseek.com',
    model: '',
    closureModel: '',
    models: [],
    reasoningEffort: 'auto',
    closureReasoningEffort: 'auto',
    encryptedApiKey: '',
    lastTestAt: 0,
    lastTestOk: false,
    lastError: ''
  },
  promptSchemaVersion: PROMPT_SCHEMA_VERSION,
  promptOverrides: createPromptOverrides(),
  reportTemplates: { ...DEFAULT_REPORT_TEMPLATES },
  closurePrompt: DEFAULT_CLOSURE_PROMPT,
  terminologyDiscoveryPrompt: DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT,
  terminology: [],
  terminologyExclusions: [],
  terminologyDiscovery: {
    initialized: false,
    lastRunAt: 0,
    sourceHash: '',
    model: '',
    recordCount: 0,
    termCount: 0
  },
  savedFilters: []
};

// 开机自启带 --hidden 参数（由 applyLoginItem 写入启动项），启动时据此静默驻留
const startHidden = process.argv.includes('--hidden');

let settings = {
  ...DEFAULT_SETTINGS,
  ai: { ...DEFAULT_SETTINGS.ai },
  promptOverrides: createPromptOverrides(),
  reportTemplates: { ...DEFAULT_SETTINGS.reportTemplates },
  terminology: [],
  terminologyExclusions: [],
  terminologyDiscovery: { ...DEFAULT_SETTINGS.terminologyDiscovery }
};

function resolvedPrompt(kind, type, target = settings) {
  return resolvePrompt({
    locale: target.locale,
    overrides: target.promptOverrides,
    kind,
    type
  });
}

function syncEffectivePromptFields(target = settings) {
  target.promptSchemaVersion = PROMPT_SCHEMA_VERSION;
  target.promptOverrides = normalizePromptOverrides(target.promptOverrides);
  target.reportTemplates = target.reportTemplates && typeof target.reportTemplates === 'object'
    ? target.reportTemplates
    : {};
  for (const type of TEMPLATE_TYPES) {
    target.reportTemplates[type] = resolvedPrompt('reportTemplate', type, target).value;
  }
  target.closurePrompt = resolvedPrompt('closure', undefined, target).value;
  target.terminologyDiscoveryPrompt = resolvedPrompt('terminologyDiscovery', undefined, target).value;
}

function promptSettingsForClient(target = settings) {
  const reportTemplates = {};
  const reportTemplateDefaults = {};
  const reportTemplateSources = {};
  for (const type of TEMPLATE_TYPES) {
    const resolved = resolvedPrompt('reportTemplate', type, target);
    reportTemplates[type] = resolved.value;
    reportTemplateDefaults[type] = defaultPrompt(target.locale, 'reportTemplate', type);
    reportTemplateSources[type] = resolved.source;
  }
  const closure = resolvedPrompt('closure', undefined, target);
  const terminology = resolvedPrompt('terminologyDiscovery', undefined, target);
  return {
    promptLocale: target.locale,
    reportTemplates,
    reportTemplateDefaults,
    promptSources: {
      reportTemplates: reportTemplateSources,
      closure: closure.source,
      terminologyDiscovery: terminology.source
    },
    closurePrompt: closure.value,
    closurePromptDefault: defaultPrompt(target.locale, 'closure'),
    closurePromptSource: closure.source,
    terminologyDiscoveryPrompt: terminology.value,
    terminologyDiscoveryPromptDefault: defaultPrompt(target.locale, 'terminologyDiscovery'),
    terminologyDiscoveryPromptSource: terminology.source
  };
}

function settingsForClient(target = settings) {
  return {
    locale: target.locale,
    theme: target.theme,
    themeFamily: target.themeFamily,
    resolvedTheme: resolvedTheme(),
    hotkey: target.hotkey,
    defaultHotkey: DEFAULT_HOTKEY,
    openAtLogin: target.openAtLogin,
    silentStart: target.silentStart,
    dataFile: dataFile(),
    ai: aiPublicState(),
    promptSchemaVersion: PROMPT_SCHEMA_VERSION,
    ...promptSettingsForClient(target),
    terminology: normalizeTerminology(target.terminology),
    terminologyExclusions: normalizeTerminologyExclusions(target.terminologyExclusions),
    terminologyDiscovery: { ...normalizeDiscoveryState(target.terminologyDiscovery) },
    savedFilters: target.savedFilters.map(filter => ({ ...filter, rangeFocus: { ...filter.rangeFocus } }))
  };
}

function loadSettings() {
  let storedLocale = false;
  let shouldSave = false;
  try {
    const s = JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
    if (s && typeof s === 'object') {
      const locale = normalizeLocale(s.locale);
      if (locale) {
        settings.locale = locale;
        storedLocale = true;
      }
      if (['auto', 'light', 'dark'].includes(s.theme)) settings.theme = s.theme;
      if (THEME_FAMILIES.includes(s.themeFamily)) settings.themeFamily = s.themeFamily;
      if (typeof s.hotkey === 'string' && s.hotkey) settings.hotkey = s.hotkey;
      if (typeof s.openAtLogin === 'boolean') settings.openAtLogin = s.openAtLogin;
      if (typeof s.silentStart === 'boolean') settings.silentStart = s.silentStart;
      if (s.ai && typeof s.ai === 'object') {
        if (typeof s.ai.providerId === 'string') settings.ai.providerId = normalizeProviderId(s.ai.providerId);
        settings.ai.baseUrl = normalizeBaseUrl(s.ai.baseUrl, settings.ai.providerId);
        if (typeof s.ai.model === 'string') settings.ai.model = s.ai.model;
        if (typeof s.ai.closureModel === 'string') settings.ai.closureModel = s.ai.closureModel;
        if (Array.isArray(s.ai.models)) settings.ai.models = [...new Set(s.ai.models.filter(x => typeof x === 'string' && x.trim()))];
        if (typeof s.ai.reasoningEffort === 'string') {
          const reasoningEffort = s.ai.reasoningEffort.trim().toLowerCase();
          if (REASONING_EFFORTS.includes(reasoningEffort)) settings.ai.reasoningEffort = reasoningEffort;
        }
        if (typeof s.ai.closureReasoningEffort === 'string') {
          const closureReasoningEffort = s.ai.closureReasoningEffort.trim().toLowerCase();
          if (REASONING_EFFORTS.includes(closureReasoningEffort)) settings.ai.closureReasoningEffort = closureReasoningEffort;
        }
        if (typeof s.ai.encryptedApiKey === 'string') settings.ai.encryptedApiKey = s.ai.encryptedApiKey;
        if (Number.isFinite(s.ai.lastTestAt)) settings.ai.lastTestAt = s.ai.lastTestAt;
        if (typeof s.ai.lastTestOk === 'boolean') settings.ai.lastTestOk = s.ai.lastTestOk;
        if (typeof s.ai.lastError === 'string') settings.ai.lastError = s.ai.lastError;
      }
      if (Array.isArray(s.terminology)) settings.terminology = normalizeTerminology(s.terminology);
      if (Array.isArray(s.terminologyExclusions)) {
        settings.terminologyExclusions = normalizeTerminologyExclusions(s.terminologyExclusions);
      }
      if (s.terminologyDiscovery && typeof s.terminologyDiscovery === 'object') {
        settings.terminologyDiscovery = normalizeDiscoveryState(s.terminologyDiscovery);
      }
      const storedPromptSchema = Number(s.promptSchemaVersion);
      settings.promptOverrides = migrateLegacyPromptOverrides(s);
      if (storedPromptSchema < PROMPT_SCHEMA_VERSION) shouldSave = true;
      if (typeof s.closurePrompt === 'string' && s.closurePrompt.trim()) settings.closurePrompt = s.closurePrompt.trim().slice(0, 2400);
      if (typeof s.terminologyDiscoveryPrompt === 'string' && s.terminologyDiscoveryPrompt.trim()) {
        settings.terminologyDiscoveryPrompt = s.terminologyDiscoveryPrompt.trim().slice(0, 2400);
      }
      if (s.reportTemplates && typeof s.reportTemplates === 'object') {
        for (const key of Object.keys(DEFAULT_REPORT_TEMPLATES)) {
          if (typeof s.reportTemplates[key] === 'string' && s.reportTemplates[key].trim()) {
            settings.reportTemplates[key] = s.reportTemplates[key];
          }
        }
      }
      if (Array.isArray(s.savedFilters)) settings.savedFilters = normalizeSavedFilters(s.savedFilters);
    }
  } catch { /* 首次运行，使用默认设置 */ }

  if (!storedLocale) {
    const selectedLocale = readInstallerLocale();
    if (selectedLocale) {
      settings.locale = selectedLocale;
      shouldSave = true;
    }
  }
  syncEffectivePromptFields(settings);
  if (shouldSave) saveSettings();
}

function saveSettings() {
  const file = settingsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
}

function resolvedThemeMode() {
  if (settings.theme === 'auto') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  return settings.theme;
}

function resolvedTheme() {
  return { family: settings.themeFamily, mode: resolvedThemeMode() };
}

function themeWindowColors(theme = resolvedTheme()) {
  return THEME_WINDOW_COLORS[theme.family]?.[theme.mode]
    || THEME_WINDOW_COLORS.gold[theme.mode]
    || THEME_WINDOW_COLORS.gold.light;
}

function applyThemeWindowBackground() {
  if (process.platform === 'win32' && mainWindow && !mainWindow.isDestroyed()) {
    try {
      mainWindow.setBackgroundColor(themeWindowColors().color);
    } catch { /* 窗口未就绪时忽略 */ }
  }
}

function broadcastTheme() {
  const t = resolvedTheme();
  for (const w of [mainWindow, quickWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('theme:changed', t);
  }
  applyThemeWindowBackground();
}

function broadcastLocale() {
  for (const w of [mainWindow, quickWindow]) {
    if (w && !w.isDestroyed()) w.webContents.send('locale:changed', settings.locale);
  }
  refreshTrayMenu();
}

function mainText(key) {
  const messages = {
    'en-US': {
      '快速记录': 'Quick entry',
      '快速记录（未设置快捷键）': 'Quick entry (shortcut not set)',
      '打开主界面': 'Open main window',
      '退出': 'Exit',
      '日报随手记': 'Daily Notes',
      '快捷键注册失败': 'Shortcut registration failed',
      '全局快捷键被其他程序占用，请打开主界面到设置中更换': 'The global shortcut is already used by another app. Open Settings to change it.',
      '日报随手记已启动': 'Daily Notes started',
      '随时记录一条，点击托盘图标也可以': 'Press the shortcut to add an entry, or click the tray icon.',
      '导出完整备份': 'Export full backup',
      '从备份恢复': 'Restore from backup',
      '导出日报': 'Export entries',
      '导出周期总结': 'Export periodic summary'
    },
    'ja-JP': {
      '快速记录': 'クイック記録',
      '快速记录（未设置快捷键）': 'クイック記録（ショートカット未設定）',
      '打开主界面': 'メイン画面を開く',
      '退出': '終了',
      '日报随手记': 'Daily Notes',
      '快捷键注册失败': 'ショートカットの登録に失敗しました',
      '全局快捷键被其他程序占用，请打开主界面到设置中更换': 'グローバルショートカットが他のアプリで使用されています。設定から変更してください。',
      '日报随手记已启动': 'Daily Notes を起動しました',
      '随时记录一条，点击托盘图标也可以': 'ショートカットまたはトレイアイコンから記録できます。',
      '导出完整备份': '完全バックアップをエクスポート',
      '从备份恢复': 'バックアップから復元',
      '导出日报': '記録をエクスポート',
      '导出周期总结': '期間まとめをエクスポート'
    }
  };
  return UI_LOCALE_CATALOG[settings.locale]?.[key] || messages[settings.locale]?.[key] || key;
}

/* ---------------- 存储层：本地 JSON 文件 ---------------- */

function dataFile() {
  return path.join(app.getPath('userData'), 'data.json');
}

function normalizeDB(db) {
  if (db && Array.isArray(db.entries)) {
    return {
      version: 2,
      entries: db.entries,
      reports: Array.isArray(db.reports) ? db.reports : [],
      closureSummaries: Array.isArray(db.closureSummaries) ? db.closureSummaries : []
    };
  }
  return { version: 2, entries: [], reports: [], closureSummaries: [] };
}

function readDBFromDisk() {
  try {
    return normalizeDB(JSON.parse(fs.readFileSync(dataFile(), 'utf8')));
  } catch { /* 首次运行或文件损坏，返回空库 */ }
  return normalizeDB(null);
}

function writeDBToDisk(db) {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

function dbFileSignature() {
  try {
    const stat = fs.statSync(dataFile());
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return 'missing';
  }
}

let loadedDb = null;
let dbRevision = 0;
const dbStore = createBufferedJsonStore({
  read: readDBFromDisk,
  write: writeDBToDisk,
  signature: dbFileSignature,
  delay: 350,
  onError: error => console.error('[日报随手记] data.json 延迟写入失败，将在下次保存或退出时重试', error)
});

function loadDB() {
  const db = dbStore.load();
  if (db !== loadedDb) {
    loadedDb = db;
    dbRevision += 1;
  }
  return db;
}

function saveDB(db, options = {}) {
  loadedDb = db;
  dbRevision += 1;
  return dbStore.save(db, options);
}

function flushDB() {
  return dbStore.flush();
}

// 多个周期并发生成时，报告完成时间可能不同；串行合并写入，避免后完成的任务覆盖先完成的报告。
let reportPersistenceChain = Promise.resolve();

function appendReportRecord(report) {
  const write = () => {
    const db = loadDB();
    db.reports.push(report);
    saveDB(db, { immediate: true });
  };
  const next = reportPersistenceChain.then(write, write);
  reportPersistenceChain = next.catch(() => {});
  return next;
}

function reportContentDir() {
  return path.join(app.getPath('userData'), 'reports');
}

function reportContentFileName(id) {
  return `${String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
}

function reportContentPath(report) {
  if (!report?.id) return '';
  const fileName = report.contentFile || reportContentFileName(report.id);
  return path.join(reportContentDir(), fileName);
}

function readReportContent(report) {
  if (!report) return '';
  if (report.contentFile) {
    try { return fs.readFileSync(reportContentPath(report), 'utf8').replace(/^\ufeff/, ''); }
    catch { return String(report.content || ''); }
  }
  return String(report.content || '');
}

function reportForClient(report) {
  if (!report) return null;
  return { ...report, content: readReportContent(report) };
}

function persistReportContent(report, { uniqueFile = false } = {}) {
  if (!report?.id) return;
  const content = String(report.content || '');
  if (content.length <= REPORT_INLINE_CONTENT_LIMIT) {
    if (report.contentFile) {
      try { fs.unlinkSync(reportContentPath(report)); } catch { /* 文件已不存在 */ }
      delete report.contentFile;
    }
    report.content = content;
    return;
  }

  const dir = reportContentDir();
  fs.mkdirSync(dir, { recursive: true });
  // 恢复备份时使用新文件名，避免恢复过程覆盖现有报告正文；即使后续设置写入失败，
  // 回滚后的旧报告仍然指向原文件。普通编辑继续使用稳定文件名，便于复用与读取。
  const fileName = uniqueFile
    ? reportContentFileName(`${report.id}-${crypto.randomUUID()}`)
    : reportContentFileName(report.id);
  const file = path.join(dir, fileName);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    try {
      fs.unlinkSync(file);
      fs.renameSync(tmp, file);
    } catch (replaceError) {
      try { fs.unlinkSync(tmp); } catch { /* 忽略临时文件清理失败 */ }
      throw replaceError;
    }
  }
  report.contentFile = fileName;
  delete report.content;
}

function backupSnapshot() {
  const db = loadDB();
  return createBackupPayload({
    settings,
    entries: db.entries,
    reports: db.reports.map(report => ({ ...report, content: readReportContent(report) })),
    closureSummaries: db.closureSummaries
  });
}

function backupDirectory() {
  return path.join(app.getPath('userData'), 'backups');
}

function backupFileStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function writeBackupFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function createSafetyBackup() {
  const filePath = path.join(backupDirectory(), `pre-restore-${backupFileStamp()}-${crypto.randomUUID()}.json`);
  writeBackupFile(filePath, backupSnapshot());
  return filePath;
}

function normalizeRestoredSettings(snapshot) {
  const restored = restoreSettingsSnapshot(settings, snapshot, DEFAULT_SETTINGS);
  restored.locale = normalizeLocale(restored.locale) || settings.locale || DEFAULT_LOCALE;
  restored.theme = ['auto', 'light', 'dark'].includes(restored.theme) ? restored.theme : DEFAULT_SETTINGS.theme;
  restored.themeFamily = THEME_FAMILIES.includes(restored.themeFamily)
    ? restored.themeFamily
    : DEFAULT_SETTINGS.themeFamily;
  restored.hotkey = typeof restored.hotkey === 'string' && restored.hotkey.trim()
    ? restored.hotkey.trim()
    : DEFAULT_SETTINGS.hotkey;
  restored.openAtLogin = !!restored.openAtLogin;
  restored.silentStart = !!restored.silentStart;
  restored.ai = { ...DEFAULT_SETTINGS.ai, ...(restored.ai || {}) };
  restored.ai.providerId = normalizeProviderId(restored.ai.providerId);
  restored.ai.baseUrl = normalizeBaseUrl(restored.ai.baseUrl, restored.ai.providerId);
  restored.ai.model = typeof restored.ai.model === 'string' ? restored.ai.model.trim() : '';
  restored.ai.closureModel = typeof restored.ai.closureModel === 'string' ? restored.ai.closureModel.trim() : '';
  restored.ai.models = Array.isArray(restored.ai.models)
    ? [...new Set(restored.ai.models.filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))]
    : [];
  restored.ai.reasoningEffort = normalizeReasoningEffort(restored.ai.reasoningEffort);
  restored.ai.closureReasoningEffort = normalizeReasoningEffort(restored.ai.closureReasoningEffort);
  restored.ai.encryptedApiKey = settings.ai.encryptedApiKey || '';
  restored.promptSchemaVersion = PROMPT_SCHEMA_VERSION;
  restored.promptOverrides = migrateLegacyPromptOverrides(snapshot);
  restored.reportTemplates = { ...DEFAULT_REPORT_TEMPLATES };
  for (const key of TEMPLATE_TYPES) {
    if (typeof snapshot?.reportTemplates?.[key] === 'string' && snapshot.reportTemplates[key].trim()) {
      restored.reportTemplates[key] = snapshot.reportTemplates[key].trim();
    }
  }
  restored.savedFilters = normalizeSavedFilters(
    Array.isArray(snapshot?.savedFilters) ? snapshot.savedFilters : settings.savedFilters
  );
  restored.closurePrompt = typeof snapshot?.closurePrompt === 'string' && snapshot.closurePrompt.trim()
    ? snapshot.closurePrompt.trim().slice(0, 2400)
    : DEFAULT_SETTINGS.closurePrompt;
  restored.terminologyDiscoveryPrompt = typeof snapshot?.terminologyDiscoveryPrompt === 'string' && snapshot.terminologyDiscoveryPrompt.trim()
    ? snapshot.terminologyDiscoveryPrompt.trim().slice(0, 2400)
    : DEFAULT_SETTINGS.terminologyDiscoveryPrompt;
  restored.terminology = normalizeTerminology(snapshot?.terminology);
  restored.terminologyExclusions = normalizeTerminologyExclusions(snapshot?.terminologyExclusions);
  restored.terminologyDiscovery = normalizeDiscoveryState({
    ...(snapshot?.terminologyDiscovery || restored.terminologyDiscovery),
    termCount: restored.terminology.length
  });
  syncEffectivePromptFields(restored);
  return restored;
}

/* ---------------- 时间与导出 ---------------- */

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

function localizedWeekday(dateStr, locale = settings.locale) {
  return new Intl.DateTimeFormat(normalizeLocale(locale) || DEFAULT_LOCALE, { weekday: 'short' })
    .format(new Date(`${dateStr}T00:00:00`));
}

/* ---------------- AI 平台与周期总结 ---------------- */

// v4-pro 的完整总结可能需要几十秒；保留足够的服务端推理时间，避免客户端 45 秒提前中断。
const AI_TIMEOUT_MS = 150000;
const REPORT_TYPES = new Set(['day', 'week', 'month', 'custom']);
// 流式传输不会突破单次 completion 的输出上限；先给一次请求较大的预算，
// 仍然由自动续写和长周期分段负责承接更大的报告。
const REPORT_MAX_OUTPUT_TOKENS = 32768;
const REPORT_LEGACY_MAX_OUTPUT_TOKENS = 8192;
const REPORT_MAX_CONTINUATIONS = 2;
const REPORT_SEGMENT_MAX_SOURCES = 40;
const REPORT_SEGMENT_MAX_CHARS = 20000;
// 普通报告仍内嵌在 data.json；真正较大的正文落到独立 Markdown 文件，
// 避免每次保存一条记录都重写几 MB 的 JSON。
const REPORT_INLINE_CONTENT_LIMIT = 128 * 1024;
// 近期闭环是结构化 JSON，单次只需要返回结论、证据编号和少量待确认项。
// 历史记录会按批次发送，避免把一个超长历史一次性塞进上下文。
const CLOSURE_MAX_OUTPUT_TOKENS = 16384;
const CLOSURE_LEGACY_MAX_OUTPUT_TOKENS = 8192;
const CLOSURE_MAX_CONTINUATIONS = 1;
const CLOSURE_MAX_HISTORY_SOURCES = 36;
const CLOSURE_MAX_HISTORY_CHARS = 16000;

function apiKeyFromStorage() {
  if (!settings.ai.encryptedApiKey) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(settings.ai.encryptedApiKey, 'base64'));
  } catch { return ''; }
}

function maskApiKeyValue(key) {
  const value = String(key || '');
  if (!value) return '';
  if (value.length <= 8) return '••••••••';
  return `${value.slice(0, 3)}${'•'.repeat(Math.min(16, Math.max(8, value.length - 7)))}${value.slice(-4)}`;
}

function maskedApiKey() {
  const key = apiKeyFromStorage();
  return maskApiKeyValue(key);
}

function aiPublicState(models = settings.ai.models, source = settings.ai, options = {}) {
  const target = source && typeof source === 'object' ? source : settings.ai;
  const provider = getProvider(target.providerId);
  const configured = options.configured === undefined
    ? !!target.encryptedApiKey
    : !!options.configured;
  const masked = options.maskedApiKey === undefined
    ? (target === settings.ai ? maskedApiKey() : '')
    : String(options.maskedApiKey || '');
  return {
    configured,
    providerId: provider.id,
    providerName: provider.label,
    maskedApiKey: masked,
    baseUrl: target.baseUrl,
    model: target.model,
    closureModel: target.closureModel,
    models: Array.isArray(models) ? models : [],
    reasoningEffort: normalizeReasoningEffort(target.reasoningEffort),
    closureReasoningEffort: normalizeReasoningEffort(target.closureReasoningEffort),
    supportsReasoningControl: provider.supportsReasoningControl,
    lastTestAt: target.lastTestAt,
    lastTestOk: target.lastTestOk,
    lastError: target.lastError
  };
}

function encryptApiKey(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows 安全存储暂不可用，请稍后重试');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function clearAiStoredCredential() {
  settings.ai.encryptedApiKey = '';
  settings.ai.model = '';
  settings.ai.closureModel = '';
  settings.ai.models = [];
  settings.ai.lastTestAt = 0;
  settings.ai.lastTestOk = false;
  settings.ai.lastError = '';
}

function aiConnection(overrides = {}) {
  const providerId = normalizeProviderId(overrides.providerId ?? settings.ai.providerId);
  const baseUrl = normalizeBaseUrl(overrides.baseUrl ?? settings.ai.baseUrl, providerId);
  if (!baseUrl) throw new Error('请填写 API 地址');
  return { providerId, baseUrl };
}

function applyAiConnectionTo(target, connection) {
  const changed = target.providerId !== connection.providerId
    || target.baseUrl !== connection.baseUrl;
  target.providerId = connection.providerId;
  target.baseUrl = connection.baseUrl;
  if (changed) {
    target.model = '';
    target.closureModel = '';
    target.models = [];
    target.lastTestAt = 0;
    target.lastTestOk = false;
    target.lastError = '';
  }
  return changed;
}

function applyAiConnection(connection) {
  return applyAiConnectionTo(settings.ai, connection);
}

async function aiRequest(endpoint, apiKey, init = {}, connection = null, externalSignal = null) {
  if (typeof fetch !== 'function') throw new Error('当前运行环境不支持网络请求');
  const target = connection || aiConnection();
  const base = target.baseUrl;
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener('abort', abortFromExternal, { once: true });
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
    if (externalSignal?.aborted) {
      const canceled = new Error('AI 连接测试已取消');
      canceled.code = 'AI_TEST_CANCELED';
      throw canceled;
    }
    if (error?.name === 'AbortError') throw new Error('请求超时，请检查网络或稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', abortFromExternal);
  }
}

async function aiStream(endpoint, apiKey, init = {}, onDelta = () => {}, connection = null) {
  if (typeof fetch !== 'function') throw new Error('当前运行环境不支持网络请求');
  const target = connection || aiConnection();
  const base = target.baseUrl;
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
    if (!response.ok) {
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch { /* 非 JSON 错误交给统一提示 */ }
      const message = data?.error?.message || data?.message || `请求失败（HTTP ${response.status}）`;
      throw new Error(message);
    }
    if (!response.body?.getReader) throw new Error('服务未返回可读取的流式响应');

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finishReason = '';
    let usage = null;

    const handleEvent = block => {
      const dataLine = block.split(/\r?\n/).find(line => line.startsWith('data:'));
      if (!dataLine) return false;
      const payload = dataLine.slice(5).trim();
      if (payload === '[DONE]') return true;
      let data;
      try { data = JSON.parse(payload); } catch { return false; }
      const choice = data?.choices?.[0];
      const delta = choice?.delta || {};
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (data?.usage) usage = data.usage;
      const textOf = value => {
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.text || '').join('');
        return '';
      };
      const reasoning = textOf(delta.reasoning_content || delta.reasoning);
      const content = textOf(delta.content);
      if (reasoning || content) onDelta({ reasoning, content });
      return false;
    };

    let done = false;
    while (!done) {
      const result = await reader.read();
      buffer += decoder.decode(result.value || new Uint8Array(), { stream: !result.done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() || '';
      for (const event of events) {
        if (handleEvent(event)) { done = true; break; }
      }
      if (result.done) {
        if (buffer.trim()) handleEvent(buffer);
        done = true;
      }
    }
    // 某些兼容接口会在流正常结束时省略 finish_reason；只要流已完整读完，
    // 就按正常结束处理，避免把一个可用的报告误判成“部分结果”。
    return { finishReason: finishReason || 'stop', usage };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('请求超时，请检查网络或稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchAvailableModels(apiKey, connection = null, externalSignal = null) {
  const data = await aiRequest('/models', apiKey, {}, connection, externalSignal);
  const models = extractModelIds(data);
  if (!models.length) throw new Error('接口已连接，但没有返回可用模型');
  return [...new Set(models)];
}

function chooseModel(models, current) {
  if (current && models.includes(current)) return current;
  // 仅作为新模型列表中的偏好排序；实际可用模型永远以 /models 返回为准。
  const preferred = preferredModels(settings.ai.providerId, 'report');
  return preferred.find(x => models.includes(x)) || models[0];
}

function chooseClosureModel(models, current) {
  if (current && models.includes(current)) return current;
  // 闭环需要做历史语义对应，默认优先能力更强的模型；用户仍可在设置中切换。
  const preferred = preferredModels(settings.ai.providerId, 'closure');
  return preferred.find(x => models.includes(x)) || models[0];
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function terminologyDiscoverySourceHash(entries) {
  const sources = discoverySources(entries);
  return hashText(sources.map(source => `${source.id}|${source.date}|${source.time}|${source.text}`).join('\n'));
}

function responseMessageText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => responseMessageText(item)).join('');
  if (value && typeof value === 'object') {
    const nested = value.text ?? value.content ?? value.value;
    return nested === undefined ? JSON.stringify(value) : responseMessageText(nested);
  }
  return '';
}

function responseMessageContent(data) {
  return responseMessageText(data?.choices?.[0]?.message?.content);
}

function responseMessageReasoning(data) {
  const message = data?.choices?.[0]?.message;
  return responseMessageText(message?.reasoning_content ?? message?.reasoning);
}

async function requestTerminologyDiscovery({ key, model, prompt, locale = settings.locale, notify = () => {} }) {
  let thinkingEnabled = true;
  let jsonModeEnabled = true;
  let repairAttempted = false;
  let requestPrompt = prompt;
  while (true) {
    try {
      let reasoning = '';
      let content = '';
      await aiStream('/chat/completions', key, {
        method: 'POST',
        body: JSON.stringify(buildChatRequestBody(settings.ai.providerId, {
          model,
          messages: [
            { role: 'system', content: discoverySystemPrompt(locale) },
            { role: 'user', content: requestPrompt }
          ],
          thinkingEnabled,
          reasoningEffort: closureReasoningEffort(),
          jsonModeEnabled,
          streamOptions: { include_usage: true },
          maxTokens: MAX_DISCOVERY_OUTPUT_TOKENS
        }))
      }, delta => {
        if (delta.reasoning) {
          reasoning += delta.reasoning;
          notify({
            scope: 'terminology',
            phase: 'thinking',
            text: delta.reasoning,
            reasoningLength: reasoning.length
          });
        }
        if (delta.content) {
          content += delta.content;
          notify({
            scope: 'terminology',
            phase: 'writing',
            text: delta.content,
            contentLength: content.length
          });
        }
      });
      const terms = parseTerminologyResponse(content);
      if (!terms) {
        if (thinkingEnabled) {
          // 结构化词典不需要把思考文本返回给解析器；若思考预算挤占了最终 JSON，
          // 只对这次请求降级重试，不改变用户保存的思考强度设置。
          thinkingEnabled = false;
          continue;
        }
        if (!repairAttempted) {
          // 即使服务端没有严格执行 JSON mode，也给模型一次无状态重试机会，
          // 防止说明文字、思考标签或一次偶发的格式偏差让首次初始化直接失败。
          repairAttempted = true;
          requestPrompt = [
            prompt,
            '',
            catalogFor(locale).terminologyRetryPrompt
          ].join('\n');
          continue;
        }
        throw new Error('AI 返回的术语词典无法解析，请重试');
      }
      return terms;
    } catch (error) {
      if (thinkingEnabled && canRetryWithoutThinking(error)) {
        thinkingEnabled = false;
        continue;
      }
      if (jsonModeEnabled && canRetryWithoutJsonMode(error)) {
        jsonModeEnabled = false;
        continue;
      }
      throw error;
    }
  }
}

async function discoverTerminologyFromEntries({ key, model, entries, existing = [], customPrompt, locale = settings.locale, notify = () => {} }) {
  const sources = discoverySources(entries);
  const chunks = sources.length ? splitDiscoverySources(sources) : [];
  const candidates = [];
  notify({ scope: 'terminology', phase: 'started', model, totalBatches: chunks.length, recordCount: sources.length });

  for (let index = 0; index < chunks.length; index += 1) {
    notify({
      scope: 'terminology',
      phase: 'extracting',
      model,
      batch: index + 1,
      totalBatches: chunks.length,
      recordCount: chunks[index].length
    });
    const terms = await requestTerminologyDiscovery({
      key,
      model,
      locale,
      prompt: buildDiscoveryPrompt(chunks[index], customPrompt, locale),
      notify
    });
    candidates.push(terms);
    notify({
      scope: 'terminology',
      phase: 'batch-done',
      model,
      batch: index + 1,
      totalBatches: chunks.length,
      candidateCount: mergeTerminologyResults(candidates).length
    });
  }

  let discovered = mergeTerminologyResults(candidates).slice(0, MAX_DISCOVERY_CANDIDATES);
  let consolidationFallback = false;
  if (discovered.length > 0 && chunks.length > 1) {
    notify({ scope: 'terminology', phase: 'consolidating', model, candidateCount: discovered.length });
    try {
      const consolidated = await requestTerminologyDiscovery({
        key,
        model,
        locale,
        prompt: buildConsolidationPrompt(discovered, existing, customPrompt, locale),
        notify
      });
      if (consolidated.length) discovered = consolidated;
    } catch {
      // 归并调用失败时保留已经逐批识别出的候选，不让一次辅助调用导致已有结果丢失。
      consolidationFallback = true;
    }
  }

  return {
    terminology: mergeTerminologyResults([existing, discovered]),
    recordCount: sources.length,
    batchCount: chunks.length,
    candidateCount: discovered.length,
    consolidationFallback
  };
}

function closurePromptHash() {
  return hashText(`${settings.locale}\n${resolvedPrompt('closure').value || DEFAULT_CLOSURE_PROMPT}`);
}

function closureTerminologyHash() {
  return hashText(JSON.stringify({
    terminology: settings.terminology || [],
    terminologyExclusions: settings.terminologyExclusions || []
  }));
}

function reportTerminologyHash() {
  // 空词典与旧版本报告兼容；一旦配置过词典，报告缓存必须感知其变化。
  return settings.terminology?.length ? hashText(JSON.stringify(settings.terminology)) : '';
}

const closureContextCache = new Map();

function closureContext(start, end, periodType = 'week') {
  const db = loadDB();
  const terminologyHash = closureTerminologyHash();
  const promptHash = closurePromptHash();
  const contextCacheKey = [dbRevision, periodType, start, end, terminologyHash, promptHash].join('|');
  const cached = closureContextCache.get(contextCacheKey);
  if (cached) {
    closureContextCache.delete(contextCacheKey);
    closureContextCache.set(contextCacheKey, cached);
    return cached;
  }
  const recentEntries = db.entries.filter(entry => {
    const day = localDateStr(entry.ts);
    return day >= start && day <= end;
  });
  const historyEntries = db.entries.filter(entry => localDateStr(entry.ts) < start);
  const recentSources = closureSourceBundle(recentEntries, 'N');
  const historicalSources = closureSourceBundle(historyEntries, 'H');
  const inputHash = closureInputHash(
    recentSources,
    historicalSources,
    settings.terminology,
    settings.terminologyExclusions
  );
  const context = {
    periodType,
    start,
    end,
    recentSources,
    historicalSources,
    inputHash,
    terminologyHash,
    promptHash,
    cacheKey: closureCacheKey({
      periodType,
      start,
      end,
      inputHash,
      terminologyHash,
      promptHash
    })
  };
  closureContextCache.set(contextCacheKey, context);
  while (closureContextCache.size > 4) {
    closureContextCache.delete(closureContextCache.keys().next().value);
  }
  return context;
}

function closureMaxOutputTokens(model) {
  if (model === 'deepseek-chat' || model === 'deepseek-reasoner') return CLOSURE_LEGACY_MAX_OUTPUT_TOKENS;
  return CLOSURE_MAX_OUTPUT_TOKENS;
}

function closureReasoningEffort() {
  const value = normalizeReasoningEffort(settings.ai.closureReasoningEffort);
  return value === 'auto' ? 'high' : value;
}

function reportMaxOutputTokens(model) {
  // 旧版 deepseek-chat / deepseek-reasoner 的兼容上限更保守；
  // V4 使用更大的预算，遇到供应商拒绝时仍会在分段模块中回退。
  if (model === 'deepseek-chat' || model === 'deepseek-reasoner') {
    return REPORT_LEGACY_MAX_OUTPUT_TOKENS;
  }
  return REPORT_MAX_OUTPUT_TOKENS;
}

function reportReasoningEffort(segmentCount) {
  // 自动模式让普通报告优先响应速度，长周期分段时提高到标准强度。
  // 用户手动选择后，使用用户选择的值；续写请求仍在下方单独降为 low，避免重复消耗思考预算。
  return resolveReasoningEffort(settings.ai.reasoningEffort, segmentCount);
}

function canRetryWithSmallerOutput(error, receivedContent) {
  if (receivedContent) return false;
  const message = String(error?.message || '').toLowerCase();
  return /max[_ -]?tokens|maximum.{0,24}tokens|output.{0,24}tokens|token limit/.test(message);
}

function canRetryWithoutThinking(error) {
  const message = String(error?.message || '').toLowerCase();
  return /thinking|reasoning[_ -]?effort|reasoning.*unsupported|unsupported.*reasoning|invalid.*reasoning/.test(message);
}

function canRetryWithoutJsonMode(error) {
  const message = String(error?.message || '').toLowerCase();
  return /response[_ -]?format|json[_ -]?object|json mode|structured output|unsupported.*format|invalid.*format/.test(message);
}

function reportSystemPrompt(locale = settings.locale) {
  return catalogFor(locale).reportSystemPrompt;
}

function reportSegmentLabel(sources, index) {
  const first = sources[0]?.date;
  const last = sources[sources.length - 1]?.date;
  if (!first) return `分段 ${index + 1}`;
  return first === last ? first : `${first} 至 ${last}`;
}

function combineReportSegments(segments, locale = settings.locale) {
  const rules = catalogFor(locale).reportPromptRules;
  if (segments.length <= 1) return String(segments[0]?.content || '').trim();
  return segments.map((segment, index) => {
    const title = segment.label || `${rules.segmentScope} ${index + 1}`;
    const content = String(segment.content || '').trim() || rules.emptyBody;
    return `## ${title}\n\n${content}`;
  }).join('\n\n');
}

async function generateReportSegment({ key, model, prompt, segmentIndex, segmentCount, locale = settings.locale, notify }) {
  const system = reportSystemPrompt(locale);
  const continuationPrompt = catalogFor(locale).reportContinuationPrompt;
  let reasoning = '';
  let content = '';
  let reasoningLength = 0;
  let continuationCount = 0;
  let finishReason = '';
  let usage = null;
  let maxTokens = reportMaxOutputTokens(model);
  const reasoningEffort = reportReasoningEffort(segmentCount);
  let messages = [
    { role: 'system', content: system },
    { role: 'user', content: prompt }
  ];
  const continuationMessages = () => [
    { role: 'system', content: system },
    { role: 'user', content: prompt },
    { role: 'assistant', content: content.trimEnd() },
    {
      role: 'user',
      content: continuationPrompt
    }
  ];

  while (true) {
    notify({
      phase: continuationCount ? 'continuing' : 'segment',
      model,
      segment: segmentIndex + 1,
      totalSegments: segmentCount,
      continuation: continuationCount,
      maxContinuations: REPORT_MAX_CONTINUATIONS
    });

    let receivedContent = false;
    // 续写只负责接上正文，不再重复开启思考，避免一次截断被多轮推理放大为长时间等待。
    const thinkingEnabled = continuationCount === 0;
    try {
      const streamResult = await aiStream('/chat/completions', key, {
        method: 'POST',
        body: JSON.stringify(buildChatRequestBody(settings.ai.providerId, {
          model,
          messages,
          thinkingEnabled,
          reasoningEffort: continuationCount === 0 ? reasoningEffort : 'low',
          streamOptions: { include_usage: true },
          maxTokens
        }))
      }, delta => {
        if (delta.reasoning) {
          reasoning += delta.reasoning;
          reasoningLength += delta.reasoning.length;
          notify({
            phase: 'thinking',
            text: delta.reasoning,
            segment: segmentIndex + 1,
            totalSegments: segmentCount,
            continuation: continuationCount
          });
        }
        if (delta.content) {
          receivedContent = true;
          content += delta.content;
          notify({
            phase: 'writing',
            text: delta.content,
            segment: segmentIndex + 1,
            totalSegments: segmentCount,
            continuation: continuationCount
          });
        }
      });
      finishReason = streamResult.finishReason || '';
      usage = streamResult.usage || usage;
    } catch (error) {
      if (receivedContent) {
        if (continuationCount < REPORT_MAX_CONTINUATIONS) {
          continuationCount += 1;
          finishReason = 'length';
          messages = continuationMessages();
          notify({
            phase: 'recovering',
            model,
            segment: segmentIndex + 1,
            totalSegments: segmentCount,
            continuation: continuationCount,
            maxContinuations: REPORT_MAX_CONTINUATIONS,
            text: '流式连接暂时中断，正在续写已经收到的正文。'
          });
          continue;
        }
        finishReason = 'stream_error';
        notify({
          phase: 'recovering',
          model,
          segment: segmentIndex + 1,
          totalSegments: segmentCount,
          continuation: continuationCount,
          maxContinuations: REPORT_MAX_CONTINUATIONS,
          text: `流式连接多次中断，已保留已经收到的正文。${error?.message ? `（${error.message}）` : ''}`
        });
        break;
      }
      if (maxTokens > REPORT_LEGACY_MAX_OUTPUT_TOKENS && canRetryWithSmallerOutput(error, receivedContent)) {
        maxTokens = REPORT_LEGACY_MAX_OUTPUT_TOKENS;
        notify({
          phase: 'fallback',
          model,
          segment: segmentIndex + 1,
          totalSegments: segmentCount,
          text: '当前模型不接受较大的输出预算，已切换兼容模式继续生成。'
        });
        continue;
      }
      throw error;
    }

    if (finishReason !== 'length' || continuationCount >= REPORT_MAX_CONTINUATIONS) break;

    continuationCount += 1;
    messages = continuationMessages();
  }

  return {
    reasoning,
    content: content.trim(),
    reasoningLength,
    continuationCount,
    finishReason,
    usage
  };
}

function closureSystemPrompt(locale = settings.locale) {
  return catalogFor(locale).closureSystemPrompt;
}

async function generateClosureSegment({ key, model, prompt, segmentIndex, segmentCount, locale = settings.locale, notify }) {
  let content = '';
  let reasoningLength = 0;
  let continuationCount = 0;
  let finishReason = '';
  let usage = null;
  let maxTokens = closureMaxOutputTokens(model);
  let thinkingEnabled = true;
  let messages = [
    { role: 'system', content: closureSystemPrompt(locale) },
    { role: 'user', content: prompt }
  ];

  const continuationMessages = () => [
    { role: 'system', content: closureSystemPrompt(locale) },
    { role: 'user', content: prompt },
    { role: 'assistant', content: content.trimEnd() },
    {
      role: 'user',
      content: catalogFor(locale).closureContinuationPrompt
    }
  ];

  while (true) {
    notify({
      scope: 'closure',
      phase: continuationCount ? 'continuing' : 'segment',
      model,
      segment: segmentIndex + 1,
      totalSegments: segmentCount,
      continuation: continuationCount,
      maxContinuations: CLOSURE_MAX_CONTINUATIONS
    });

    let receivedContent = false;
    try {
      const streamResult = await aiStream('/chat/completions', key, {
        method: 'POST',
        body: JSON.stringify(buildChatRequestBody(settings.ai.providerId, {
          model,
          messages,
          thinkingEnabled,
          reasoningEffort: closureReasoningEffort(),
          streamOptions: { include_usage: true },
          maxTokens
        }))
      }, delta => {
        if (delta.reasoning) {
          reasoningLength += delta.reasoning.length;
          notify({
            scope: 'closure',
            phase: 'thinking',
            text: delta.reasoning,
            segment: segmentIndex + 1,
            totalSegments: segmentCount,
            continuation: continuationCount,
            reasoningLength
          });
        }
        if (delta.content) {
          receivedContent = true;
          content += delta.content;
          notify({
            scope: 'closure',
            phase: 'writing',
            text: delta.content,
            segment: segmentIndex + 1,
            totalSegments: segmentCount,
            continuation: continuationCount,
            contentLength: content.length
          });
        }
      });
      finishReason = streamResult.finishReason || '';
      usage = streamResult.usage || usage;
    } catch (error) {
      if (receivedContent && continuationCount < CLOSURE_MAX_CONTINUATIONS) {
        continuationCount += 1;
        messages = continuationMessages();
        notify({
          scope: 'closure',
          phase: 'recovering',
          model,
          segment: segmentIndex + 1,
          totalSegments: segmentCount,
          continuation: continuationCount,
          maxContinuations: CLOSURE_MAX_CONTINUATIONS,
          text: '闭环分析的流式连接暂时中断，正在继续接收结构化结果。'
        });
        continue;
      }
      if (!receivedContent && thinkingEnabled && canRetryWithoutThinking(error)) {
        thinkingEnabled = false;
        notify({
          scope: 'closure',
          phase: 'fallback',
          model,
          segment: segmentIndex + 1,
          totalSegments: segmentCount,
          text: '当前模型不支持思考参数，已切换为兼容模式继续分析。'
        });
        continue;
      }
      if (!receivedContent && maxTokens > CLOSURE_LEGACY_MAX_OUTPUT_TOKENS && canRetryWithSmallerOutput(error, receivedContent)) {
        maxTokens = CLOSURE_LEGACY_MAX_OUTPUT_TOKENS;
        notify({
          scope: 'closure',
          phase: 'fallback',
          model,
          segment: segmentIndex + 1,
          totalSegments: segmentCount,
          text: '当前模型不接受较大的结构化输出预算，已切换兼容模式继续分析。'
        });
        continue;
      }
      throw error;
    }

    const parsed = parseClosureResponse(content);
    if (parsed) return { ...parsed, reasoningLength, continuationCount, finishReason, usage };
    if (continuationCount >= CLOSURE_MAX_CONTINUATIONS) {
      throw new Error('AI 返回的闭环结果不是完整的 JSON，请重试或缩短历史记录范围');
    }
    continuationCount += 1;
    messages = continuationMessages();
  }
}

function reportEntries(start, end) {
  return loadDB().entries.filter(entry => {
    const day = localDateStr(entry.ts);
    return day >= start && day <= end;
  });
}

function reportTypeOrCustom(type) {
  return REPORT_TYPES.has(type) ? type : 'custom';
}

function buildExport(entries, start, end, format, locale = settings.locale) {
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
  const reportTitle = mainText('日报');

  if (format === 'txt') {
    const lines = [`${reportTitle} ${range}`, ''];
    for (const day of days) {
      lines.push(`【${day} ${localizedWeekday(day, locale)}】`);
      for (const e of byDay.get(day)) lines.push(`${localTimeStr(e.ts)}  ${flat(e.text)}`);
      lines.push('');
    }
    return lines.join('\r\n');
  }

  const md = [`# ${reportTitle} ${range}`, ''];
  for (const day of days) {
    md.push(`## ${day} ${localizedWeekday(day, locale)}`, '');
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

ipcMain.handle('data:backup', async () => {
  const payload = backupSnapshot();
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: mainText('导出完整备份'),
    defaultPath: `日报随手记_备份_${backupFileStamp()}.json`,
    filters: [{ name: '日报随手记备份', extensions: ['json'] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    writeBackupFile(filePath, payload);
    return {
      ok: true,
      filePath,
      summary: {
        entries: payload.data.entries.length,
        reports: payload.data.reports.length,
        closureSummaries: payload.data.closureSummaries.length
      }
    };
  } catch (error) {
    return { ok: false, error: `备份导出失败：${error?.message || '无法写入文件'}` };
  }
});

ipcMain.handle('data:restore', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: mainText('从备份恢复'),
    properties: ['openFile'],
    filters: [{ name: '日报随手记备份', extensions: ['json'] }]
  });
  if (canceled || !filePaths?.[0]) return { ok: false, canceled: true };

  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(filePaths[0], 'utf8').replace(/^\ufeff/, ''));
  } catch (error) {
    return { ok: false, error: `备份文件无法读取：${error?.message || 'JSON 格式错误'}` };
  }
  const checked = validateBackupPayload(payload);
  if (!checked.ok) return checked;

  // 保留独立副本；恢复过程中会原地补充报告正文文件引用，不能让回滚对象跟着变化。
  const previousDb = JSON.parse(JSON.stringify(loadDB()));
  const previousSettings = JSON.parse(JSON.stringify(settings));
  let safetyBackupPath = '';
  try {
    safetyBackupPath = createSafetyBackup();
    const restoredDb = restoreDataSnapshot(payload.data);
    const restoredSettings = normalizeRestoredSettings(payload.settings);
    const previousHotkey = settings.hotkey;

    // 先以完整内联正文提交一次数据库，再把大正文写入唯一的新文件。
    // 这样恢复中途失败时，旧数据库及其外置正文仍保持可回滚；不会出现同 ID 文件被覆盖的问题。
    saveDB(restoredDb, { immediate: true });
    for (const report of restoredDb.reports) persistReportContent(report, { uniqueFile: true });
    saveDB(restoredDb, { immediate: true });
    settings = restoredSettings;
    if (previousHotkey !== settings.hotkey) {
      try { if (previousHotkey) globalShortcut.unregister(previousHotkey); } catch { /* 忽略旧快捷键清理失败 */ }
      const registered = globalShortcut.register(settings.hotkey, toggleQuick);
      if (!registered) {
        try { if (previousHotkey) globalShortcut.register(previousHotkey, toggleQuick); } catch { /* 忽略回退失败 */ }
        settings.hotkey = previousHotkey;
      }
    }
    saveSettings();
    applyLoginItem();
    refreshTrayMenu();
    broadcastTheme();
    broadcastLocale();
    notifyMainChanged();
    return { ok: true, summary: checked.summary, safetyBackupPath };
  } catch (error) {
    try {
      saveDB(previousDb, { immediate: true });
      settings = previousSettings;
      saveSettings();
      applyLoginItem();
      refreshTrayMenu();
      broadcastTheme();
      notifyMainChanged();
    } catch { /* 保留恢复前安全备份，供用户手动回滚 */ }
    return {
      ok: false,
      error: `恢复失败：${error?.message || '无法写入数据'}`,
      safetyBackupPath
    };
  }
});

ipcMain.handle('export:run', async (_e, { start, end, format }) => {
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };

  if (format === 'xlsx') {
    const rows = loadDB().entries
      .filter(e => { const d = localDateStr(e.ts); return d >= start && d <= end; })
      .sort((a, b) => a.ts - b.ts)
      .map(e => {
        const d = localDateStr(e.ts);
        return { date: d, week: localizedWeekday(d, settings.locale), time: localTimeStr(e.ts), text: e.text.replace(/\r?\n/g, ' ') };
      });
    const buf = await buildXlsxBuffer(rows);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: mainText('导出日报'),
      defaultPath: `日报_${start}_${end}.xlsx`,
      filters: [{ name: mainText('Excel 工作表'), extensions: ['xlsx'] }]
    });
    if (canceled || !filePath) return { ok: false, canceled: true };
    fs.writeFileSync(filePath, buf);
    return { ok: true, filePath };
  }

  const content = buildExport(loadDB().entries, start, end, format, settings.locale);
  const ext = format === 'md' ? 'md' : 'txt';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: mainText('导出日报'),
    defaultPath: `日报_${start}_${end}.${ext}`,
    filters: [{ name: mainText(format === 'md' ? 'Markdown 文件' : '纯文本文件'), extensions: [ext] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, '\ufeff' + content, 'utf8');
  return { ok: true, filePath };
});

ipcMain.handle('ai:status', () => aiPublicState());

ipcMain.handle('ai:reveal', () => {
  const key = apiKeyFromStorage();
  return key ? { ok: true, apiKey: key } : { ok: false, error: '本机安全存储中没有可读取的 API Key' };
});

const aiTestRequests = new Map();

function beginAiTestRequest(senderId, requestId) {
  const previous = aiTestRequests.get(senderId);
  previous?.controller.abort();
  const request = { requestId, controller: new AbortController() };
  aiTestRequests.set(senderId, request);
  return request;
}

function finishAiTestRequest(senderId, request) {
  if (aiTestRequests.get(senderId) === request) aiTestRequests.delete(senderId);
}

ipcMain.on('ai:test:cancel', event => {
  aiTestRequests.get(event.sender.id)?.controller.abort();
});

ipcMain.handle('ai:test', async (event, payload = {}) => {
  const input = typeof payload === 'string' ? { apiKey: payload } : (payload || {});
  const hasApiKeyField = Object.prototype.hasOwnProperty.call(input, 'apiKey');
  const useStoredApiKey = input.useStoredApiKey !== false
    && (!hasApiKeyField || input.useStoredApiKey === true);
  // 连接测试只操作本次请求的草稿；只有 ai:save 才能改变 settings.ai 并落盘。
  const draftAi = {
    ...settings.ai,
    models: Array.isArray(settings.ai.models) ? [...settings.ai.models] : []
  };
  let testKey = '';
  try {
    const request = beginAiTestRequest(event.sender.id, input.requestId);
    try {
      let connection;
      try {
        connection = aiConnection(input);
      } catch (error) {
        return { ok: false, error: error?.message || 'AI 连接配置无效', ai: aiPublicState() };
      }
      const suppliedKey = String(input.apiKey || '').trim();
      const connectionChanged = settings.ai.providerId !== connection.providerId
        || settings.ai.baseUrl !== connection.baseUrl;
      if (connectionChanged && !suppliedKey) {
        return { ok: false, error: '切换 AI 平台后请重新填写 API Key', ai: aiPublicState() };
      }
      applyAiConnectionTo(draftAi, connection);
      testKey = suppliedKey || (useStoredApiKey ? apiKeyFromStorage() : '');
      if (!testKey) {
        return {
          ok: false,
          error: '请先填写 API Key',
          ai: aiPublicState(draftAi.models, draftAi, { configured: false })
        };
      }

      const models = await fetchAvailableModels(testKey, connection, request.controller.signal);
      const modelBeforeTest = draftAi.model;
      const closureModelBeforeTest = draftAi.closureModel;
      if (request.controller.signal.aborted) {
        return {
          ok: false,
          canceled: true,
          ai: aiPublicState(draftAi.models, draftAi, {
            configured: !!testKey,
            maskedApiKey: maskApiKeyValue(testKey)
          })
        };
      }
      const selected = chooseModel(models, modelBeforeTest);
      const closureSelected = chooseClosureModel(models, closureModelBeforeTest);
      const modelChanged = selected !== modelBeforeTest;
      const closureModelChanged = closureSelected !== closureModelBeforeTest;
      draftAi.models = models;
      draftAi.model = selected;
      draftAi.closureModel = closureSelected;
      draftAi.lastTestAt = Date.now();
      draftAi.lastTestOk = true;
      draftAi.lastError = '';
      return {
        ok: true,
        modelChanged,
        closureModelChanged,
        ai: aiPublicState(models, draftAi, {
          configured: true,
          maskedApiKey: maskApiKeyValue(testKey)
        })
      };
    } catch (error) {
      if (request.controller.signal.aborted || error?.code === 'AI_TEST_CANCELED') {
        return {
          ok: false,
          canceled: true,
          ai: aiPublicState(draftAi.models, draftAi, {
            configured: !!testKey,
            maskedApiKey: maskApiKeyValue(testKey)
          })
        };
      }
      draftAi.lastTestAt = Date.now();
      draftAi.lastTestOk = false;
      draftAi.lastError = error?.message || '连接失败';
      return {
        ok: false,
        error: draftAi.lastError,
        ai: aiPublicState(draftAi.models, draftAi, {
          configured: !!testKey,
          maskedApiKey: maskApiKeyValue(testKey)
        })
      };
    } finally {
      finishAiTestRequest(event.sender.id, request);
    }
  } catch (error) {
    return { ok: false, error: error?.message || 'AI 连接测试失败', ai: aiPublicState() };
  }
});

ipcMain.handle('ai:save', (_e, payload = {}) => {
  const input = typeof payload === 'string' ? { apiKey: payload } : (payload || {});
  try {
    const connection = aiConnection(input);
    const hasApiKeyField = Object.prototype.hasOwnProperty.call(input, 'apiKey');
    const suppliedKey = String(input.apiKey || '').trim();
    const preserveExistingApiKey = input.preserveExistingApiKey === true
      || (!hasApiKeyField && input.clearApiKey !== true);
    const clearRequested = input.clearApiKey === true
      || (hasApiKeyField && !suppliedKey && !preserveExistingApiKey);
    const connectionChanged = settings.ai.providerId !== connection.providerId
      || settings.ai.baseUrl !== connection.baseUrl;
    if (connectionChanged && !suppliedKey && !clearRequested) {
      return { ok: false, error: '切换 AI 平台后请重新填写 API Key', ai: aiPublicState() };
    }
    applyAiConnection(connection);
    if (clearRequested) {
      clearAiStoredCredential();
      saveSettings();
      return { ok: true, ai: aiPublicState() };
    }
    if (suppliedKey) settings.ai.encryptedApiKey = encryptApiKey(suppliedKey);
    if (!settings.ai.encryptedApiKey) return { ok: false, error: '请先填写 API Key', ai: aiPublicState() };
    saveSettings();
    return { ok: true, ai: aiPublicState() };
  } catch (error) {
    return { ok: false, error: error?.message || 'AI 配置保存失败' };
  }
});

ipcMain.handle('ai:clear', () => {
  clearAiStoredCredential();
  saveSettings();
  return { ok: true, ai: aiPublicState() };
});

ipcMain.handle('ai:setModel', (_e, { model } = {}) => {
  const value = String(model || '').trim();
  if (!value) return { ok: false, error: '模型名称不能为空' };
  if (settings.ai.models.length && !settings.ai.models.includes(value)) {
    return { ok: false, error: '该模型不在最近读取的可用列表中，请重新测试连接' };
  }
  settings.ai.model = value;
  settings.ai.lastTestOk = false;
  settings.ai.lastError = '模型已更换，请重新测试连接';
  saveSettings();
  return { ok: true, ai: aiPublicState() };
});

ipcMain.handle('ai:setClosureModel', (_e, { model } = {}) => {
  const value = String(model || '').trim();
  if (!value) return { ok: false, error: '闭环模型名称不能为空' };
  if (settings.ai.models.length && !settings.ai.models.includes(value)) {
    return { ok: false, error: '该模型不在最近读取的可用列表中，请重新测试连接' };
  }
  settings.ai.closureModel = value;
  settings.ai.lastTestOk = false;
  settings.ai.lastError = '闭环模型已更换，请重新测试连接';
  saveSettings();
  return { ok: true, ai: aiPublicState() };
});

ipcMain.handle('ai:setReasoningEffort', (_e, { reasoningEffort } = {}) => {
  const value = typeof reasoningEffort === 'string' ? reasoningEffort.trim().toLowerCase() : '';
  if (!REASONING_EFFORTS.includes(value)) return { ok: false, error: '思考强度选项无效' };
  settings.ai.reasoningEffort = value;
  saveSettings();
  return { ok: true, ai: aiPublicState() };
});

ipcMain.handle('ai:setClosureReasoningEffort', (_e, { reasoningEffort } = {}) => {
  const value = typeof reasoningEffort === 'string' ? reasoningEffort.trim().toLowerCase() : '';
  if (!REASONING_EFFORTS.includes(value)) return { ok: false, error: '闭环思考强度选项无效' };
  settings.ai.closureReasoningEffort = value;
  saveSettings();
  return { ok: true, ai: aiPublicState() };
});

function terminologyDiscoveryForClient() {
  return { ...normalizeDiscoveryState(settings.terminologyDiscovery) };
}

function sendTerminologyProgress(event, progress) {
  if (event.sender && !event.sender.isDestroyed()) {
    event.sender.send('terminology:progress', { scope: 'terminology', ...progress });
  }
}

ipcMain.handle('terminology:discover', async (event, payload = {}) => {
  const force = !!payload.force;
  const key = apiKeyFromStorage();
  if (!key) return { ok: false, error: '尚未配置 API Key，请先到设置中连接 AI' };

  const entries = loadDB().entries;
  const sourceHashValue = terminologyDiscoverySourceHash(entries);
  const previous = normalizeDiscoveryState(settings.terminologyDiscovery);
  if (!force && previous.initialized) {
    return {
      ok: true,
      skipped: true,
      terminology: normalizeTerminology(settings.terminology),
      discovery: terminologyDiscoveryForClient(),
      ai: aiPublicState()
    };
  }

  const notify = progress => sendTerminologyProgress(event, progress);
  try {
    // 识别前重新读取模型目录，防止用户更新 API 后旧的模型名称失效。
    const models = await fetchAvailableModels(key);
    const previousModel = settings.ai.closureModel || settings.ai.model;
    const model = chooseClosureModel(models, previousModel);
    settings.ai.models = models;
    settings.ai.closureModel = model;
    settings.ai.lastTestAt = Date.now();
    settings.ai.lastTestOk = true;
    settings.ai.lastError = '';
    saveSettings();

    if (!entries.length) {
      const now = Date.now();
      settings.terminologyDiscovery = normalizeDiscoveryState({
        initialized: true,
        lastRunAt: now,
        sourceHash: sourceHashValue,
        model,
        recordCount: 0,
        termCount: settings.terminology.length
      });
      saveSettings();
      notify({ phase: 'saved', model, recordCount: 0, termCount: settings.terminology.length });
      return {
        ok: true,
        skipped: false,
        terminology: normalizeTerminology(settings.terminology),
        discovery: terminologyDiscoveryForClient(),
        ai: aiPublicState(models)
      };
    }

    const result = await discoverTerminologyFromEntries({
      key,
      model,
      entries,
      existing: settings.terminology,
      customPrompt: resolvedPrompt('terminologyDiscovery').value,
      locale: settings.locale,
      notify
    });
    // 识别期间允许用户继续编辑；最终合并当前设置，避免覆盖刚保存的手工词条。
    settings.terminology = mergeTerminologyResults([settings.terminology, result.terminology]);
    settings.terminologyDiscovery = normalizeDiscoveryState({
      initialized: true,
      lastRunAt: Date.now(),
      sourceHash: sourceHashValue,
      model,
      recordCount: result.recordCount,
      termCount: settings.terminology.length
    });
    saveSettings();
    notify({
      phase: 'saved',
      model,
      recordCount: result.recordCount,
      batchCount: result.batchCount,
      termCount: settings.terminology.length,
      consolidationFallback: result.consolidationFallback
    });
    return {
      ok: true,
      skipped: false,
      terminology: normalizeTerminology(settings.terminology),
      discovery: terminologyDiscoveryForClient(),
      ai: aiPublicState(models),
      stats: {
        recordCount: result.recordCount,
        batchCount: result.batchCount,
        termCount: settings.terminology.length,
        consolidationFallback: result.consolidationFallback
      }
    };
  } catch (error) {
    notify({ phase: 'error', error: error?.message || '术语识别失败' });
    return { ok: false, error: error?.message || '术语识别失败' };
  }
});

function closureForClient(summary) {
  if (!summary) return null;
  const cloned = JSON.parse(JSON.stringify(summary));
  return filterResolvedClosureSuggestions(cloned, settings.terminology, settings.terminologyExclusions);
}

ipcMain.handle('closure:getCached', (_e, { start, end, periodType } = {}) => {
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };
  const type = reportTypeOrCustom(periodType);
  const context = closureContext(start, end, type);
  const summaries = loadDB().closureSummaries;
  const cached = findCachedClosure(summaries, { ...context, cacheKey: context.cacheKey });
  const summary = cached || findLatestClosure(summaries, context);
  return {
    ok: true,
    cached: !!cached,
    cacheStatus: closureCacheStatus(summary, context),
    summary: closureForClient(summary),
    recentCount: context.recentSources.length,
    historicalCount: context.historicalSources.length
  };
});

ipcMain.handle('closure:generate', async (event, payload = {}) => {
  const { start, end, force } = payload;
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };
  const periodType = reportTypeOrCustom(payload.periodType);
  const context = closureContext(start, end, periodType);
  const summaries = loadDB().closureSummaries;
  if (!force) {
    const cached = findCachedClosure(summaries, context);
    if (cached) {
      return {
        ok: true,
        cached: true,
        cacheStatus: 'fresh',
        summary: closureForClient(cached),
        model: cached.model || settings.ai.closureModel || '',
        modelChanged: false
      };
    }
  }

  if (!context.recentSources.length) {
    const now = Date.now();
    const emptySummary = {
      id: crypto.randomUUID(),
      cacheKey: context.cacheKey,
      periodType,
      start,
      end,
      model: settings.ai.closureModel || '',
      inputHash: context.inputHash,
      terminologyHash: context.terminologyHash,
      promptHash: context.promptHash,
      recentSourceCount: 0,
      historicalSourceCount: context.historicalSources.length,
      segmentCount: 0,
      reasoningLength: 0,
      completed_items: [],
      recent_explicit_completions: [],
      needs_confirmation: [],
      createdAt: now,
      updatedAt: now
    };
    const db = loadDB();
    db.closureSummaries.push(emptySummary);
    saveDB(db);
    return { ok: true, cached: false, cacheStatus: 'fresh', summary: closureForClient(emptySummary), model: emptySummary.model, modelChanged: false };
  }

  const key = apiKeyFromStorage();
  if (!key) return { ok: false, error: '尚未配置 API Key，请先到设置中连接 AI' };

  let models;
  try {
    models = await fetchAvailableModels(key);
  } catch (error) {
    settings.ai.lastTestAt = Date.now();
    settings.ai.lastTestOk = false;
    settings.ai.lastError = error?.message || '连接失败';
    saveSettings();
    return { ok: false, error: settings.ai.lastError };
  }

  const previousModel = settings.ai.closureModel;
  const previousTestOk = settings.ai.lastTestOk;
  const model = chooseClosureModel(models, previousModel);
  const catalogChanged = JSON.stringify(settings.ai.models) !== JSON.stringify(models);
  settings.ai.models = models;
  settings.ai.closureModel = model;
  settings.ai.lastTestAt = Date.now();
  settings.ai.lastTestOk = true;
  settings.ai.lastError = '';
  if (catalogChanged || previousModel !== model || !previousTestOk) saveSettings();

  try {
    const notify = progress => {
      if (event.sender && !event.sender.isDestroyed()) event.sender.send('closure:progress', progress);
    };
    const historyChunks = splitClosureHistory(context.historicalSources, {
      maxSources: CLOSURE_MAX_HISTORY_SOURCES,
      maxChars: CLOSURE_MAX_HISTORY_CHARS
    });
    const segments = [];
    for (let index = 0; index < historyChunks.length; index += 1) {
      const segmentResult = await generateClosureSegment({
        key,
        model,
        segmentIndex: index,
        segmentCount: historyChunks.length,
        locale: settings.locale,
        prompt: buildClosurePrompt({
          start,
          end,
          recentSources: context.recentSources,
          historicalSources: historyChunks[index],
          terminology: settings.terminology,
          terminologyExclusions: settings.terminologyExclusions,
          customPrompt: resolvedPrompt('closure').value,
          segmentIndex: index,
          segmentCount: historyChunks.length,
          locale: settings.locale
        }),
        notify
      });
      segments.push(segmentResult);
      notify({
        scope: 'closure',
        phase: 'segment-done',
        segment: index + 1,
        totalSegments: historyChunks.length,
        completedCount: segmentResult.completed_items.length + segmentResult.recent_explicit_completions.length,
        confirmationCount: segmentResult.needs_confirmation.length
      });
    }

    const sourceMap = new Map([
      ...context.recentSources.map(source => [source.ref, source]),
      ...context.historicalSources.map(source => [source.ref, source])
    ]);
    const merged = hydrateClosureResult(mergeClosureResults(segments), sourceMap);
    const now = Date.now();
    const summary = {
      id: crypto.randomUUID(),
      cacheKey: context.cacheKey,
      periodType,
      start,
      end,
      model,
      inputHash: context.inputHash,
      terminologyHash: context.terminologyHash,
      promptHash: context.promptHash,
      recentSourceCount: context.recentSources.length,
      historicalSourceCount: context.historicalSources.length,
      segmentCount: segments.length,
      reasoningLength: segments.reduce((sum, segment) => sum + (segment.reasoningLength || 0), 0),
      completed_items: merged.completed_items,
      recent_explicit_completions: merged.recent_explicit_completions,
      needs_confirmation: merged.needs_confirmation,
      createdAt: now,
      updatedAt: now
    };
    const db = loadDB();
    db.closureSummaries.push(summary);
    saveDB(db);
    notify({
      scope: 'closure',
      phase: 'saved',
      model,
      segment: historyChunks.length,
      totalSegments: historyChunks.length,
      completedCount: summary.completed_items.length + summary.recent_explicit_completions.length,
      confirmationCount: summary.needs_confirmation.length
    });
    return {
      ok: true,
      cached: false,
      cacheStatus: 'fresh',
      summary: closureForClient(summary),
      models,
      model,
      modelChanged: previousModel !== model
    };
  } catch (error) {
    // 生成过程失败不等于连接失效；连接状态只由 ai:test 和模型/平台变更维护。
    const message = error?.message || '近期闭环生成失败';
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('closure:progress', { scope: 'closure', phase: 'error', error: message });
    }
    return { ok: false, error: message };
  }
});

ipcMain.handle('report:getCached', (_e, { start, end, periodType, template } = {}) => {
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };
  const type = reportTypeOrCustom(periodType);
  const sources = sourceBundle(reportEntries(start, end));
  const sourceStatus = reportInputStatus(sources);
  if (!sourceStatus.ok) {
    return { ok: true, cached: false, cacheStatus: 'missing', report: null, sourceCount: 0 };
  }
  const templateText = String(template || resolvedPrompt('reportTemplate', type).value || DEFAULT_REPORT_TEMPLATES.custom).trim();
  const cacheParams = {
    start,
    end,
    periodType: type,
    sourceHashValue: sourceHash(sources),
    templateHashValue: templateHash(templateText),
    terminologyHashValue: reportTerminologyHash()
  };
  const reports = loadDB().reports;
  const cached = findCachedReport(reports, cacheParams);
  const report = cached || findLatestReport(reports, cacheParams);
  return {
    ok: true,
    cached: !!cached,
    cacheStatus: reportCacheStatus(report, cacheParams),
    report: reportForClient(report)
  };
});

ipcMain.handle('report:generate', async (event, payload = {}) => {
  const { start, end, periodLabel, force } = payload;
  const jobId = String(payload.jobId || '').trim();
  if (!start || !end || start > end) return { ok: false, error: '日期范围无效' };
  const periodType = reportTypeOrCustom(payload.periodType);
  const template = String(payload.template || resolvedPrompt('reportTemplate', periodType).value || DEFAULT_REPORT_TEMPLATES.custom).trim();
  const entries = reportEntries(start, end);
  const sources = sourceBundle(entries);
  const sourceStatus = reportInputStatus(sources);
  if (!sourceStatus.ok) {
    return { ok: false, code: 'NO_SOURCES', error: sourceStatus.error, sourceCount: 0 };
  }
  const sourceHashValue = sourceHash(sources);
  const templateHashValue = templateHash(template);
  // 缓存是否有效只由周期、原始记录指纹和模板指纹决定；模型变化不应让旧报告消失。
  const cacheParams = {
    start,
    end,
    periodType,
    sourceHashValue,
    templateHashValue,
    terminologyHashValue: reportTerminologyHash()
  };
  if (!force) {
    const cached = findCachedReport(loadDB().reports, cacheParams);
    if (cached) {
      return {
        ok: true,
        cached: true,
        cacheStatus: 'fresh',
        report: reportForClient(cached),
        models: Array.isArray(settings.ai.models) ? settings.ai.models : [],
        modelChanged: false
      };
    }
  }

  const key = apiKeyFromStorage();
  if (!key) return { ok: false, error: '尚未配置 API Key，请先到设置中连接 AI' };

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
  const catalogChanged = JSON.stringify(settings.ai.models) !== JSON.stringify(models);
  settings.ai.models = models;
  if (settings.ai.model !== model || !settings.ai.lastTestOk || catalogChanged) {
    settings.ai.model = model;
    settings.ai.lastTestAt = Date.now();
    settings.ai.lastTestOk = true;
    settings.ai.lastError = '';
    saveSettings();
  }
  try {
    const generationStartedAt = Date.now();
    const notify = progress => {
      if (event.sender && !event.sender.isDestroyed()) {
        event.sender.send('report:progress', { ...progress, jobId });
      }
    };
    const sourceChunks = splitSources(sources, {
      maxSources: REPORT_SEGMENT_MAX_SOURCES,
      maxChars: REPORT_SEGMENT_MAX_CHARS
    });
    const segments = [];
    for (let index = 0; index < sourceChunks.length; index += 1) {
      const chunk = sourceChunks[index];
      const segmentResult = await generateReportSegment({
        key,
        model,
        segmentIndex: index,
        segmentCount: sourceChunks.length,
        locale: settings.locale,
        prompt: buildPrompt({
          start,
          end,
          periodLabel,
          template,
          sources: chunk,
          terminology: settings.terminology,
          segmentIndex: index,
          segmentCount: sourceChunks.length,
          locale: settings.locale
        }),
        notify
      });
      const chunkCovered = coveredRefs(segmentResult.content, chunk);
      segments.push({
        label: reportSegmentLabel(chunk, index),
        reasoning: segmentResult.reasoning,
        content: segmentResult.content,
        sourceCount: chunk.length,
        coveredCount: chunkCovered.length,
        continuationCount: segmentResult.continuationCount,
        finishReason: segmentResult.finishReason,
        reasoningLength: segmentResult.reasoningLength,
        usage: segmentResult.usage
      });
    }

    const aiContent = combineReportSegments(segments, settings.locale);
    if (!aiContent) throw new Error('AI 没有返回总结正文');
    const finalContent = appendRawRecords(aiContent, sources, { locale: settings.locale });
    const sourceAudit = auditSourceRecords(aiContent, finalContent, sources);
    const coveredCount = sourceAudit.filter(item => item.cited).length;
    const rawRecordCount = sourceAudit.filter(item => item.rawPreserved).length;
    const truncated = segments.some(segment => segment.finishReason === 'length');
    const naturallyCompleted = segments.every(segment => segment.finishReason === 'stop');
    const complete = naturallyCompleted
      && !truncated
      && sourceAudit.every(item => item.cited && item.rawPreserved);
    const finishReason = truncated ? 'length' : (naturallyCompleted ? 'stop' : segments[segments.length - 1]?.finishReason || 'unknown');
    const progressDetails = {
      reasoningLength: segments.reduce((sum, segment) => sum + segment.reasoningLength, 0),
      contentLength: aiContent.length,
      segmentCount: segments.length,
      continuationCount: segments.reduce((sum, segment) => sum + segment.continuationCount, 0),
      finishReason,
      complete,
      sourceCount: sources.length,
      coveredCount,
      rawRecordCount,
      missingRefs: sourceAudit.filter(item => !item.cited).map(item => item.ref)
    };
    notify({
      phase: 'stream-done',
      ...progressDetails
    });

    const createdAt = Date.now();
    const report = attachReportThinking({
      id: reportId(),
      cacheKey: reportCacheKey(cacheParams),
      periodType,
      periodLabel: periodLabel || `${start} 至 ${end}`,
      start,
      end,
      model,
      template,
      sourceHash: sourceHashValue,
      templateHash: templateHashValue,
      terminologyHash: cacheParams.terminologyHashValue,
      sourceCount: sources.length,
      coveredCount,
      rawRecordCount,
      sourceAudit,
      complete,
      finishReason,
      segmentCount: segments.length,
      continuationCount: segments.reduce((sum, segment) => sum + segment.continuationCount, 0),
      segments: segments.map(segment => ({
        label: segment.label,
        sourceCount: segment.sourceCount,
        coveredCount: segment.coveredCount,
        continuationCount: segment.continuationCount,
        finishReason: segment.finishReason
      })),
      content: finalContent,
      createdAt,
      updatedAt: createdAt
    }, {
      visible: true,
      open: false,
      phase: 'done',
      text: segments.map(segment => segment.reasoning || '').filter(Boolean).join('\n\n'),
      content: aiContent,
      segment: segments.length,
      totalSegments: segments.length,
      continuation: progressDetails.continuationCount,
      maxContinuations: REPORT_MAX_CONTINUATIONS,
      progressNote: '报告已保存，可以查看、编辑或导出。',
      ...progressDetails,
      startedAt: generationStartedAt,
      finishedAt: createdAt
    });
    notify({ phase: 'saving', ...progressDetails });
    persistReportContent(report);
    await appendReportRecord(report);
    notify({ phase: 'saved', ...progressDetails });
    return { ok: true, cached: false, report: reportForClient(report), models, modelChanged: previousModel !== model };
  } catch (error) {
    // 报告生成/解析/保存失败不应把已经可用的 AI 连接标成失败。
    const message = error?.message || '生成总结失败';
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('report:progress', { phase: 'error', error: message, jobId });
    }
    return { ok: false, error: message };
  }
});

ipcMain.handle('report:save', (_e, { id, content } = {}) => {
  if (!id || typeof content !== 'string') return { ok: false, error: '总结内容无效' };
  const db = loadDB();
  const report = db.reports.find(x => x.id === id);
  if (!report) return { ok: false, error: '总结不存在或已被清理' };
  const sources = sourceBundle(reportEntries(report.start, report.end));
  const rawAudit = auditSourceRecords('', content, sources);
  const previousAudit = new Map(Array.isArray(report.sourceAudit)
    ? report.sourceAudit.map(item => [item.ref, item])
    : []);
  const hasLegacyCoverage = report.sourceCount > 0 && report.coveredCount >= report.sourceCount;
  const sourceAudit = rawAudit.map(item => ({
    ref: item.ref,
    // 正文保存前已去除引用标记，编辑时沿用生成阶段的逐条引用结果，避免误报。
    cited: previousAudit.get(item.ref)?.cited ?? hasLegacyCoverage,
    rawPreserved: item.rawPreserved
  }));
  report.content = content;
  report.coveredCount = sourceAudit.filter(item => item.cited).length;
  report.rawRecordCount = sourceAudit.filter(item => item.rawPreserved).length;
  report.sourceAudit = sourceAudit;
  report.complete = sourceAudit.every(item => item.cited && item.rawPreserved);
  report.finishReason = 'edited';
  report.updatedAt = Date.now();
  persistReportContent(report);
  saveDB(db, { immediate: true });
  return { ok: true, report: reportForClient(report) };
});

ipcMain.handle('report:saveThinking', (_e, { id, thinking } = {}) => {
  if (!id) return { ok: false, error: '报告标识无效' };
  const snapshot = normalizeThinkingSnapshot(thinking);
  if (!snapshot) return { ok: false, error: 'AI 工作过程无效' };
  const db = loadDB();
  const report = db.reports.find(x => x.id === id);
  if (!report) return { ok: false, error: '总结不存在或已被清理' };
  report.thinking = snapshot;
  saveDB(db, { immediate: true });
  return { ok: true, thinking: snapshot };
});

ipcMain.handle('report:export', async (_e, { id, format } = {}) => {
  const report = loadDB().reports.find(x => x.id === id);
  if (!report) return { ok: false, error: '总结不存在或已被清理' };
  const isText = format === 'txt';
  const ext = isText ? 'txt' : 'md';
  const reportContentText = readReportContent(report);
  const content = isText ? markdownToText(reportContentText) : reportContentText;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: mainText('导出周期总结'),
    defaultPath: `总结_${report.start}_${report.end}.${ext}`,
    filters: [{ name: isText ? '纯文本文件' : 'Markdown 文件', extensions: [ext] }]
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  fs.writeFileSync(filePath, '\ufeff' + content, 'utf8');
  return { ok: true, filePath };
});

ipcMain.on('quick:hide', (_e, generation) => {
  if (!Number.isInteger(generation) || generation !== quickGeneration) return;
  if (quickHideTimer) { clearTimeout(quickHideTimer); quickHideTimer = null; }
  hideQuickNow();
});

ipcMain.on('quick:resize', (event, requestedHeight) => {
  if (!quickWindow || event.sender !== quickWindow.webContents) return;
  resizeQuickWindow(requestedHeight);
});

ipcMain.on('window:minimize', event => {
  if (!isMainWindowEvent(event)) return;
  mainWindow.minimize();
});

ipcMain.on('window:toggle-maximize', event => {
  if (!isMainWindowEvent(event)) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on('window:close', event => {
  if (!isMainWindowEvent(event)) return;
  mainWindow.close();
});

ipcMain.handle('window:state:get', event => (
  isMainWindowEvent(event) ? mainWindowState() : { maximized: false, fullscreen: false }
));

ipcMain.handle('theme:get', () => resolvedTheme());

ipcMain.handle('theme:set', (_e, pref) => {
  const next = pref && typeof pref === 'object' ? pref : { mode: pref };
  if (['light', 'dark'].includes(next.mode)) settings.theme = next.mode;
  else if (next.mode === 'auto') settings.theme = 'auto';
  if (THEME_FAMILIES.includes(next.family)) settings.themeFamily = next.family;
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

ipcMain.handle('locale:load', (_event, requestedLocale) => {
  const locale = normalizeLocale(requestedLocale);
  if (!locale) return { ok: false, error: '不支持的语言' };
  const file = path.join(__dirname, 'renderer', 'locales', `${locale}.json`);
  try {
    const messages = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
      return { ok: false, error: '语言文件格式无效' };
    }
    return { ok: true, locale, messages };
  } catch {
    return { ok: false, error: '语言文件读取失败' };
  }
});

ipcMain.handle('locale:get', () => settings.locale);

ipcMain.handle('app:info', () => ({
  name: app.getName(),
  version: app.getVersion()
}));

ipcMain.handle('settings:get', () => settingsForClient());

ipcMain.handle('settings:set', (_e, patch) => {
  const result = { ok: true, error: null };
  if (patch && typeof patch === 'object') {
    const nextLocale = normalizeLocale(patch.locale);
    if (nextLocale && nextLocale !== settings.locale) {
      settings.locale = nextLocale;
      syncEffectivePromptFields(settings);
      saveSettings();
      broadcastLocale();
    }
    let themeChanged = false;
    if (['auto', 'light', 'dark'].includes(patch.theme)) {
      settings.theme = patch.theme;
      themeChanged = true;
    }
    if (THEME_FAMILIES.includes(patch.themeFamily)) {
      settings.themeFamily = patch.themeFamily;
      themeChanged = true;
    }
    if (themeChanged) {
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
  result.settings = settingsForClient();
  return result;
});

ipcMain.handle('settings:setReportTemplate', (_e, { type, template } = {}) => {
  if (!TEMPLATE_TYPES.includes(type)) {
    return { ok: false, error: '总结周期无效' };
  }
  const value = String(template || '').trim();
  if (!value) return { ok: false, error: '模板内容不能为空' };
  const resolved = writePromptOverride(settings.promptOverrides, {
    locale: settings.locale,
    kind: 'reportTemplate',
    type,
    value
  });
  syncEffectivePromptFields(settings);
  saveSettings();
  return { ok: true, type, template: resolved.value, source: resolved.source, locale: settings.locale };
});

ipcMain.handle('settings:setClosurePrompt', (_e, { prompt } = {}) => {
  const value = String(prompt || '').trim().slice(0, 2400);
  if (!value) return { ok: false, error: '闭环提示词不能为空' };
  const resolved = writePromptOverride(settings.promptOverrides, {
    locale: settings.locale,
    kind: 'closure',
    value
  });
  syncEffectivePromptFields(settings);
  saveSettings();
  return { ok: true, prompt: resolved.value, source: resolved.source, locale: settings.locale };
});

ipcMain.handle('settings:setTerminologyDiscoveryPrompt', (_e, { prompt } = {}) => {
  const value = String(prompt || '').trim().slice(0, 2400);
  if (!value) return { ok: false, error: '术语识别提示词不能为空' };
  const resolved = writePromptOverride(settings.promptOverrides, {
    locale: settings.locale,
    kind: 'terminologyDiscovery',
    value
  });
  syncEffectivePromptFields(settings);
  saveSettings();
  return { ok: true, prompt: resolved.value, source: resolved.source, locale: settings.locale };
});

ipcMain.handle('settings:setTerminology', (_e, { terminology } = {}) => {
  settings.terminology = normalizeTerminology(terminology);
  settings.terminologyDiscovery = normalizeDiscoveryState({
    ...settings.terminologyDiscovery,
    termCount: settings.terminology.length
  });
  saveSettings();
  return { ok: true, terminology: normalizeTerminology(settings.terminology) };
});

ipcMain.handle('settings:addTerminologyAlias', (_e, { canonicalName, alias, scope } = {}) => {
  const canonical = String(canonicalName || '').trim();
  const value = String(alias || '').trim();
  if (!canonical || !value) return { ok: false, error: '规范名称和别名不能为空' };
  try {
    settings.terminology = addTerminologyAlias(settings.terminology, canonical, value, scope);
    settings.terminologyExclusions = removeTerminologyExclusion(
      settings.terminologyExclusions,
      canonical,
      value
    );
    settings.terminologyDiscovery = normalizeDiscoveryState({
      ...settings.terminologyDiscovery,
      termCount: settings.terminology.length
    });
    saveSettings();
    return {
      ok: true,
      terminology: normalizeTerminology(settings.terminology),
      terminologyExclusions: normalizeTerminologyExclusions(settings.terminologyExclusions)
    };
  } catch (error) {
    return { ok: false, error: error?.message || '术语别名保存失败' };
  }
});

ipcMain.handle('settings:addTerminologyExclusion', (_e, { canonicalName, alias } = {}) => {
  const canonical = String(canonicalName || '').trim();
  const value = String(alias || '').trim();
  if (!canonical || !value) return { ok: false, error: '规范名称和叫法不能为空' };
  settings.terminologyExclusions = addTerminologyExclusion(
    settings.terminologyExclusions,
    canonical,
    value
  );
  saveSettings();
  return {
    ok: true,
    terminologyExclusions: normalizeTerminologyExclusions(settings.terminologyExclusions)
  };
});

ipcMain.handle('settings:setSavedFilters', (_e, { filters } = {}) => {
  settings.savedFilters = normalizeSavedFilters(filters);
  saveSettings();
  return {
    ok: true,
    savedFilters: settings.savedFilters.map(filter => ({ ...filter, rangeFocus: { ...filter.rangeFocus } }))
  };
});

ipcMain.handle('data:openFolder', () => shell.openPath(path.dirname(dataFile())));

/* ---------------- 全局快捷键：注册 / 冲突检测 / 热更新 ---------------- */

function toggleQuick() {
  if (quickWindow && quickWindow.isVisible()) hideQuickAnimated();
  else if (quickShowPending || quickResetPending) {
    quickShowPending = false;
    cancelQuickPresentation();
  }
  else showQuick();
}

let quickHideTimer = null;
let quickGeneration = 0;
let quickReady = false;
let quickShowPending = false;
let quickBlurIgnoreUntil = 0;
let quickFocusTimer = null;
let quickPresentTimer = null;
let quickResetPending = null;
let quickBlurController = null;
let quickResizeTimer = null;
let quickResizeTarget = QUICK_SIZE.height;

function cancelQuickResize() {
  if (quickResizeTimer !== null) {
    clearInterval(quickResizeTimer);
    quickResizeTimer = null;
  }
}

function cancelQuickPresentation() {
  if (quickPresentTimer !== null) {
    clearTimeout(quickPresentTimer);
    quickPresentTimer = null;
  }
  quickResetPending = null;
}

function revealQuick(windowRef, generation) {
  if (
    !windowRef || windowRef.isDestroyed() || quickWindow !== windowRef ||
    generation !== quickGeneration ||
    !quickResetPending || quickResetPending.windowRef !== windowRef ||
    quickResetPending.generation !== generation
  ) return;

  cancelQuickPresentation();
  // 页面已确认完成复位后再显示，避免窗口可见但内容仍停留在上一轮退场态。
  windowRef.show();
  quickFocusTimer = setTimeout(() => {
    quickFocusTimer = null;
    if (quickWindow !== windowRef || windowRef.isDestroyed() || !windowRef.isVisible()) return;
    windowRef.focus();
  }, 80);
}

ipcMain.on('quick:reset-ready', (event, generation) => {
  const pending = quickResetPending;
  if (
    !Number.isInteger(generation) || !pending ||
    pending.windowRef !== quickWindow || pending.generation !== generation ||
    event.sender !== pending.windowRef.webContents
  ) return;
  revealQuick(pending.windowRef, pending.generation);
});

function hideQuickNow() {
  cancelQuickResize();
  if (quickBlurController) quickBlurController.cancel();
  cancelQuickPresentation();
  if (quickFocusTimer) { clearTimeout(quickFocusTimer); quickFocusTimer = null; }
  if (quickWindow && !quickWindow.isDestroyed() && quickWindow.isVisible()) quickWindow.hide();
}

// 发起退出：页面播完动画会回 quick:hide，主进程再隐藏。
// 不可由主进程按固定时长隐藏——IPC 延迟会把动画截断在非透明帧，
// 该陈旧帧就是下次弹出闪烁的来源。兜底计时仅防渲染层失联。
function hideQuickAnimated() {
  if (!quickWindow || quickWindow.isDestroyed() || !quickWindow.isVisible()) return;
  if (quickHideTimer) return; // 退出已在进行
  cancelQuickPresentation();
  if (quickFocusTimer) { clearTimeout(quickFocusTimer); quickFocusTimer = null; }
  const generation = quickGeneration;
  quickWindow.webContents.send('quick:out', generation);
  quickHideTimer = setTimeout(() => {
    quickHideTimer = null;
    if (generation !== quickGeneration) return;
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
        title: mainText('快捷键注册失败'),
        body: mainText('全局快捷键被其他程序占用，请打开主界面到设置中更换'),
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
  const colors = themeWindowColors(t);
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 760,
    minHeight: 680, // 保证录入区+工具栏固定时，列表仍有足够可视高度
    show: false,
    backgroundColor: colors.color,
    autoHideMenuBar: true,
    frame: false,
    thickFrame: true,
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
    broadcastMainWindowState();
  });
  mainWindow.on('maximize', broadcastMainWindowState);
  mainWindow.on('unmaximize', broadcastMainWindowState);
  mainWindow.on('enter-full-screen', broadcastMainWindowState);
  mainWindow.on('leave-full-screen', broadcastMainWindowState);
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
      // 快速记录条只在显示和退场动画期间工作；隐藏后允许 Chromium 节流，减少常驻耗电。
      backgroundThrottling: true
    }
  });
  const windowRef = quickWindow;
  const blurController = createQuickBlurController({
    shouldDismiss: () => (
      quickWindow === windowRef && !windowRef.isDestroyed() &&
      windowRef.isVisible() && !windowRef.isFocused()
    ),
    onDismiss: () => hideQuickAnimated()
  });
  quickBlurController = blurController;
  cancelQuickPresentation();
  if (quickFocusTimer) { clearTimeout(quickFocusTimer); quickFocusTimer = null; }
  quickReady = false;
  const markQuickReady = () => {
    if (quickWindow !== windowRef || windowRef.isDestroyed()) return;
    if (quickReady) return;
    quickReady = true;
    if (quickShowPending) presentQuick();
  };
  // ready-to-show 等待首帧更稳；did-finish-load 作为透明窗口未派发首帧事件时的兜底。
  windowRef.webContents.once('ready-to-show', markQuickReady);
  windowRef.webContents.once('did-finish-load', markQuickReady);
  windowRef.loadFile(path.join(__dirname, 'renderer', 'quick.html'));
  windowRef.on('blur', () => blurController.handleBlur(quickBlurIgnoreUntil));
  windowRef.on('focus', () => blurController.cancel());
  windowRef.on('closed', () => {
    if (quickWindow !== windowRef) return;
    blurController.cancel();
    cancelQuickResize();
    quickBlurController = null;
    cancelQuickPresentation();
    if (quickFocusTimer) { clearTimeout(quickFocusTimer); quickFocusTimer = null; }
    quickWindow = null;
    quickReady = false;
    quickShowPending = false;
  });
}

function quickBoundsForHeight(height) {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + (workArea.width - QUICK_SIZE.width) / 2),
    // 视觉上输入条底边距工作区底部约 80px（高度中含 56px 透明阴影区）
    y: Math.round(workArea.y + workArea.height - height - 24),
    width: QUICK_SIZE.width,
    height
  };
}

function applyQuickBounds(height) {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  const next = quickBoundsForHeight(height);
  const current = quickWindow.getBounds();
  if (current.x !== next.x || current.y !== next.y || current.width !== next.width || current.height !== next.height) {
    quickWindow.setBounds(next, false);
  }
}

function resizeQuickWindow(requestedHeight) {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  const parsed = Number(requestedHeight);
  if (!Number.isFinite(parsed)) return;

  const target = Math.min(QUICK_MAX_HEIGHT, Math.max(QUICK_SIZE.height, Math.round(parsed)));
  quickResizeTarget = target;
  const start = quickWindow.getBounds().height;
  if (start === target) {
    cancelQuickResize();
    return;
  }

  // 连续输入时复用同一个定时器，只更新目标高度，避免原生窗口动画反复重启而抖动。
  if (quickResizeTimer !== null) return;

  let segmentStart = start;
  let segmentTarget = target;
  let startedAt = Date.now();
  const tick = () => {
    if (!quickWindow || quickWindow.isDestroyed()) {
      cancelQuickResize();
      return;
    }
    if (quickResizeTarget !== segmentTarget) {
      segmentStart = quickWindow.getBounds().height;
      segmentTarget = quickResizeTarget;
      startedAt = Date.now();
    }
    const progress = Math.min(1, (Date.now() - startedAt) / QUICK_RESIZE_DURATION);
    const eased = 1 - Math.pow(1 - progress, 3);
    applyQuickBounds(Math.round(segmentStart + (segmentTarget - segmentStart) * eased));
    if (progress >= 1) {
      cancelQuickResize();
      applyQuickBounds(quickResizeTarget);
    }
  };
  tick();
  quickResizeTimer = setInterval(tick, 16);
}

function updateQuickBounds() {
  if (!quickWindow || quickWindow.isDestroyed()) return;
  cancelQuickResize();
  quickResizeTarget = QUICK_SIZE.height;
  applyQuickBounds(QUICK_SIZE.height);
}

function presentQuick() {
  if (!quickWindow || quickWindow.isDestroyed() || !quickReady) return;
  cancelQuickPresentation();
  if (quickFocusTimer) { clearTimeout(quickFocusTimer); quickFocusTimer = null; }
  const windowRef = quickWindow;
  const generation = quickGeneration;
  quickShowPending = false;
  updateQuickBounds();
  // 快捷键的 Alt 键或托盘鼠标可能仍处于按下状态；显示阶段暂时忽略瞬时失焦，
  // 待窗口稳定后再交接焦点，避免触发输入产生 blur -> hide 的竞态。
  quickBlurIgnoreUntil = Math.max(quickBlurIgnoreUntil, Date.now() + 900);
  // 页面已经完成加载并注册 IPC 监听器后再 reset，避免首次唤起丢失入场状态。
  quickResetPending = { windowRef, generation };
  windowRef.webContents.send('quick:reset', generation);
  quickPresentTimer = setTimeout(() => {
    quickPresentTimer = null;
    revealQuick(windowRef, generation);
  }, 400);
}

function showQuick(options = {}) {
  if (!quickWindow || quickWindow.isDestroyed()) createQuickWindow();
  quickGeneration += 1;
  if (quickHideTimer) { clearTimeout(quickHideTimer); quickHideTimer = null; } // 取消进行中的退出
  if (quickBlurController) quickBlurController.cancel();
  cancelQuickPresentation();
  quickShowPending = true;
  if (options.ignoreBlur) quickBlurIgnoreUntil = Date.now() + 500;
  if (quickReady) presentQuick();
}

// 系统缩放/分辨率变化时，透明固定尺寸窗口不会自动按新 DPI 重算，
// 直接销毁小窗，下次唤起按新环境重建（display-metrics-changed 根治）
function watchDisplayMetrics() {
  screen.on('display-metrics-changed', (_e, display, changed) => {
    if (!changed.includes('scaleFactor') && !changed.includes('bounds')) return;
    if (display.id !== screen.getPrimaryDisplay().id) return;
    if (quickHideTimer) { clearTimeout(quickHideTimer); quickHideTimer = null; }
    cancelQuickPresentation();
    quickReady = false;
    quickShowPending = false;
    quickBlurIgnoreUntil = 0;
    if (quickFocusTimer) { clearTimeout(quickFocusTimer); quickFocusTimer = null; }
    if (quickWindow && !quickWindow.isDestroyed()) {
      quickWindow.destroy();
      quickWindow = null;
    }
  });
}

function trayMenuTemplate() {
  return Menu.buildFromTemplate([
    { label: settings.hotkey ? `${mainText('快速记录')}（${settings.hotkey}）` : mainText('快速记录（未设置快捷键）'), click: () => showQuick({ ignoreBlur: true }) },
    { label: mainText('打开主界面'), click: () => { if (mainWindow) { mainWindow.show(); mainWindow.focus(); } } },
    { type: 'separator' },
    { label: mainText('退出'), click: () => { quitting = true; app.quit(); } }
  ]);
}

function refreshTrayMenu() {
  if (tray) tray.setContextMenu(trayMenuTemplate());
}

function createTray() {
  // 托盘使用专门的 32px 简化图标，避免把完整应用图标强制缩成 16px 后细节糊成一团。
  // Windows 会根据系统 DPI 对托盘资源做最终显示适配；旧环境缺少专用资源时回退到主图标。
  const trayIconPath = path.join(ASSETS, 'tray.png');
  const iconPath = fs.existsSync(trayIconPath) ? trayIconPath : path.join(ASSETS, 'icon.png');
  tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip(mainText('日报随手记'));
  tray.on('click', () => showQuick({ ignoreBlur: true }));
  tray.setContextMenu(trayMenuTemplate());
}

/* ---------------- 应用生命周期 ---------------- */

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => {
  app.setAppUserModelId('com.ddup5.dailyreport');

  loadSettings();
  // 跟随系统模式下，系统主题变化时通知所有窗口
  nativeTheme.on('updated', () => {
    if (settings.theme === 'auto') broadcastTheme();
  });

  createMainWindow();
  createTray();
  initHotkey();
  watchDisplayMetrics();
  applyLoginItem();

  if (Notification.isSupported() && settings.hotkey && !startHidden) {
    const n = new Notification({
      title: mainText('日报随手记已启动'),
      body: `${settings.locale === 'en-US' ? 'Press ' : settings.locale === 'ja-JP' ? '' : '按 '}${settings.hotkey}${settings.locale === 'en-US' ? ' to add an entry, or click the tray icon.' : settings.locale === 'ja-JP' ? ' で記録できます。トレイアイコンも使用できます。' : ' 随时记录一条，点击托盘图标也可以'}`,
      silent: true
    });
    n.on('click', () => showQuick());
    n.show();
  }

});

app.on('before-quit', () => {
  quitting = true;
  try { flushDB(); } catch (error) {
    console.error('[日报随手记] 退出前写入 data.json 失败', error);
  }
});

app.on('will-quit', () => {
  try { flushDB(); } catch (error) {
    console.error('[日报随手记] 退出时写入 data.json 失败', error);
  }
  globalShortcut.unregisterAll();
});
