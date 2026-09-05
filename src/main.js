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
  splitSources,
  buildPrompt,
  coveredRefs,
  auditSourceRecords,
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
    models: [],
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
        if (Array.isArray(s.ai.models)) settings.ai.models = [...new Set(s.ai.models.filter(x => typeof x === 'string' && x.trim()))];
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

function persistReportContent(report) {
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
  const fileName = reportContentFileName(report.id);
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

function apiKeyFromStorage() {
  if (!settings.ai.encryptedApiKey) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return '';
    return safeStorage.decryptString(Buffer.from(settings.ai.encryptedApiKey, 'base64'));
  } catch { return ''; }
}

function maskedApiKey() {
  const key = apiKeyFromStorage();
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}${'•'.repeat(Math.min(16, Math.max(8, key.length - 7)))}${key.slice(-4)}`;
}

function encryptApiKey(value) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Windows 安全存储暂不可用，请稍后重试');
  }
  return safeStorage.encryptString(value).toString('base64');
}

function aiPublicState(models = settings.ai.models) {
  return {
    configured: !!settings.ai.encryptedApiKey,
    maskedApiKey: maskedApiKey(),
    baseUrl: settings.ai.baseUrl,
    model: settings.ai.model,
    models: Array.isArray(models) ? models : [],
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

async function deepSeekStream(endpoint, apiKey, init = {}, onDelta = () => {}) {
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
    return { finishReason, usage };
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
  // 周期总结优先选择响应更快的 Flash；用户已选中的模型仍然保留。
  const preferred = ['deepseek-v4-flash', 'deepseek-v4-pro'];
  return preferred.find(x => models.includes(x)) || models[0];
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
  // 普通日报/周报以较低思考强度换取更快、更稳定的正文输出；长周期分段才提高到中等。
  return segmentCount > 1 ? 'medium' : 'low';
}

function canRetryWithSmallerOutput(error, receivedContent) {
  if (receivedContent) return false;
  const message = String(error?.message || '').toLowerCase();
  return /max[_ -]?tokens|maximum.{0,24}tokens|output.{0,24}tokens|token limit/.test(message);
}

function reportSystemPrompt() {
  return '你是一个严谨的工作总结整理助手。你只能基于用户提供的原始记录进行归纳和语言润色，不能编造、扩写或删除事实。总结正文必须覆盖每一条来源记录；如果多条记录属于同一事项，可以合并表达，但必须保留所有任务细节、结果、问题和时间线。最终正文只能输出一个版本，不要把分析过程、候选稿、自我检查或选择理由写进正文。';
}

function reportSegmentLabel(sources, index) {
  const first = sources[0]?.date;
  const last = sources[sources.length - 1]?.date;
  if (!first) return `分段 ${index + 1}`;
  return first === last ? first : `${first} 至 ${last}`;
}

function combineReportSegments(segments) {
  if (segments.length <= 1) return String(segments[0]?.content || '').trim();
  return segments.map((segment, index) => {
    const title = segment.label || `分段 ${index + 1}`;
    const content = String(segment.content || '').trim() || '本段未生成正文。';
    return `## ${title}\n\n${content}`;
  }).join('\n\n');
}

async function generateReportSegment({ key, model, prompt, segmentIndex, segmentCount, notify }) {
  const system = reportSystemPrompt();
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
      content: '上一次输出达到了单次长度上限或流式连接中断。请从上一次正文的最后一个完整位置继续，不要重复已经输出的标题、句子或事实；优先补齐本段尚未引用的来源编号。只输出 Markdown 正文，不要解释。'
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
    const thinkingEnabled = continuationCount === 0 || content.length > 0;
    try {
      const streamResult = await deepSeekStream('/chat/completions', key, {
        method: 'POST',
        body: JSON.stringify({
          model,
          messages,
          ...(thinkingEnabled
            ? { thinking: { type: 'enabled' }, reasoning_effort: continuationCount === 0 ? reasoningEffort : 'low' }
            : { thinking: { type: 'disabled' } }),
          stream: true,
          stream_options: { include_usage: true },
          max_tokens: maxTokens
        })
      }, delta => {
        if (delta.reasoning) {
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
    content: content.trim(),
    reasoningLength,
    continuationCount,
    finishReason,
    usage
  };
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

ipcMain.handle('ai:reveal', () => {
  const key = apiKeyFromStorage();
  return key ? { ok: true, apiKey: key } : { ok: false, error: '本机安全存储中没有可读取的 API Key' };
});

ipcMain.handle('ai:test', async (_e, { apiKey } = {}) => {
  const suppliedKey = String(apiKey || '').trim();
  const key = suppliedKey || apiKeyFromStorage();
  if (!key) return { ok: false, error: '请先填写 DeepSeek API Key' };
  try {
    const models = await fetchAvailableModels(key);
    const selected = chooseModel(models, settings.ai.model);
    const modelChanged = selected !== settings.ai.model;
    settings.ai.models = models;
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
  settings.ai.models = [];
  settings.ai.lastTestAt = 0;
  settings.ai.lastTestOk = false;
  settings.ai.lastError = '';
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
  return { ok: true, report: reportForClient(report) };
});

ipcMain.handle('report:generate', async (event, payload = {}) => {
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
  const catalogChanged = JSON.stringify(settings.ai.models) !== JSON.stringify(models);
  settings.ai.models = models;
  if (settings.ai.model !== model || !settings.ai.lastTestOk || catalogChanged) {
    settings.ai.model = model;
    settings.ai.lastTestAt = Date.now();
    settings.ai.lastTestOk = true;
    settings.ai.lastError = '';
    saveSettings();
  }
  const cacheParams = { start, end, periodType, model, sourceHashValue, templateHashValue };
  if (!force) {
    const cached = findCachedReport(loadDB(), cacheParams);
    if (cached) return { ok: true, cached: true, report: reportForClient(cached), models, modelChanged: previousModel !== model };
  }

  try {
    const notify = progress => {
      if (event.sender && !event.sender.isDestroyed()) event.sender.send('report:progress', progress);
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
        prompt: buildPrompt({
          start,
          end,
          periodLabel,
          template,
          sources: chunk,
          segmentIndex: index,
          segmentCount: sourceChunks.length
        }),
        notify
      });
      const chunkCovered = coveredRefs(segmentResult.content, chunk);
      segments.push({
        label: reportSegmentLabel(chunk, index),
        content: segmentResult.content,
        sourceCount: chunk.length,
        coveredCount: chunkCovered.length,
        continuationCount: segmentResult.continuationCount,
        finishReason: segmentResult.finishReason,
        reasoningLength: segmentResult.reasoningLength,
        usage: segmentResult.usage
      });
    }

    const aiContent = combineReportSegments(segments);
    if (!aiContent) throw new Error('AI 没有返回总结正文');
    const finalContent = appendRawRecords(aiContent, sources);
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
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    notify({ phase: 'saving', ...progressDetails });
    persistReportContent(report);
    db.reports.push(report);
    saveDB(db);
    notify({ phase: 'saved', ...progressDetails });
    return { ok: true, cached: false, report: reportForClient(report), models, modelChanged: previousModel !== model };
  } catch (error) {
    settings.ai.lastTestOk = false;
    settings.ai.lastError = error?.message || '生成总结失败';
    saveSettings();
    if (event.sender && !event.sender.isDestroyed()) {
      event.sender.send('report:progress', { phase: 'error', error: settings.ai.lastError });
    }
    return { ok: false, error: settings.ai.lastError };
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
  saveDB(db);
  return { ok: true, report: reportForClient(report) };
});

ipcMain.handle('report:export', async (_e, { id, format } = {}) => {
  const report = loadDB().reports.find(x => x.id === id);
  if (!report) return { ok: false, error: '总结不存在或已被清理' };
  const isText = format === 'txt';
  const ext = isText ? 'txt' : 'md';
  const reportContentText = readReportContent(report);
  const content = isText ? markdownToText(reportContentText) : reportContentText;
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
