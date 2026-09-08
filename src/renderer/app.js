const $ = s => document.querySelector(s);
const thinkingState = window.DRThinkingState;
const thinkingSnapshot = window.DRThinkingSnapshot;
const customSelect = window.DRCustomSelect;
const reportPeriodRules = window.DRReportPeriod;

// 所有由应用生成的界面文案都从本地化层取值；日报原文、用户自定义提示词和 AI 正文不经过这里改写。
function uiText(value) {
  const source = String(value ?? '');
  return window.DRI18n?.t ? window.DRI18n.t(source) : source;
}

function uiLocale() {
  return window.DRI18n?.locale || 'zh-CN';
}

function thinkingTextMatchesLocale(thinking) {
  if (!thinking?.text && !thinking?.content) return true;
  const locale = uiLocale();
  // 旧快照没有语言标记：中文界面可以继续查看，切到其他语言时隐藏，避免把旧中文/英文思考过程混入当前界面。
  return !thinking.locale ? locale === 'zh-CN' : thinking.locale === locale;
}

function syncCustomSelect(select) {
  customSelect?.sync(select);
}

function syncAllCustomSelects() {
  document.querySelectorAll('select').forEach(syncCustomSelect);
}

function createClosureThinking(visible = false) {
  const thinking = thinkingState.createThinkingState({
    visible,
    phase: visible ? 'segment' : ''
  });
  thinking.locale = uiLocale();
  return thinking;
}

function createTerminologyThinking(visible = false) {
  const thinking = thinkingState.createThinkingState({
    visible,
    phase: visible ? 'segment' : ''
  });
  thinking.locale = uiLocale();
  return thinking;
}

const state = {
  entries: [],
  filter: { year: 'all', month: 'all', text: '' },
  rangeFocus: { type: 'all' }, // 范围聚焦（ADR-0003）：与年/月下拉互斥，搜索叠加
  savedFilters: [],
  manage: false,
  selected: new Set(),
  settings: null,
  recording: false,
  report: {
    type: 'week',
    start: '',
    end: '',
    periodLabel: '',
    format: 'md',
    data: null,
    cacheStatus: 'missing',
    editing: false,
    draftMarkdown: '',
    thinking: {
      visible: false,
      open: false,
      phase: 'thinking',
      text: '',
      content: '',
      segment: 0,
      totalSegments: 0,
      continuation: 0,
      maxContinuations: 0,
      progressNote: '',
      locale: '',
      reasoningLength: 0,
      contentLength: 0,
      sourceCount: 0,
      coveredCount: 0,
      rawRecordCount: 0,
      finishReason: '',
      startedAt: 0,
      finishedAt: 0
    }
  },
  terminologyDiscovery: {
    running: false,
    note: '',
    error: '',
    thinking: createTerminologyThinking()
  },
  workbench: {
    closure: {
      data: null,
      cacheStatus: 'missing',
      recentCount: 0,
      historicalCount: 0,
      periodKey: '',
      loading: false,
      generating: false,
      progressNote: '',
      error: '',
      thinking: createClosureThinking(),
      dismissedSuggestions: new Set()
    }
  }
};

/* ---------- 工具 ---------- */

const pad = n => String(n).padStart(2, '0');

function dateStr(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStr(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toLocalInputValue(ts) {
  const d = new Date(ts);
  return `${dateStr(ts)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function weekdayOf(ds) {
  return '日一二三四五六'[new Date(ds + 'T00:00:00').getDay()];
}

function localizedWeekday(indexOrDate) {
  const value = typeof indexOrDate === 'number'
    ? new Date(2026, 8, 7 + indexOrDate)
    : new Date(`${indexOrDate}T00:00:00`);
  return new Intl.DateTimeFormat(uiLocale(), { weekday: 'short' }).format(value);
}

function localizedMonth(month) {
  return new Intl.DateTimeFormat(uiLocale(), { month: 'short' }).format(new Date(2026, Number(month) - 1, 1));
}

function relDayLabel(ds) {
  const today = dateStr(Date.now());
  const yesterday = dateStr(Date.now() - 86400000);
  if (ds === today) return '今天';
  if (ds === yesterday) return '昨天';
  return '';
}

let toastTimer = null;
function toast(msg, action) {
  const t = $('#toast');
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = uiText(msg);
  t.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = uiText(action.label);
    btn.onclick = () => { action.fn(); hideToast(); };
    t.appendChild(btn);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 4000 : 1800);
}
function hideToast() { $('#toast').classList.remove('show'); }

/* ---------- 自绘窗口标题栏 ---------- */

const windowControls = window.api.windowControls;
const appTopbar = $('#app-topbar');
const windowMinimize = $('#window-minimize');
const windowMaximize = $('#window-maximize');
const windowClose = $('#window-close');

function renderWindowState(next = {}) {
  const maximized = Boolean(next.maximized);
  if (!windowMaximize) return;
  windowMaximize.classList.toggle('is-maximized', maximized);
  windowMaximize.setAttribute('aria-pressed', String(maximized));
  const label = uiText(maximized ? '还原' : '最大化');
  windowMaximize.setAttribute('title', label);
  windowMaximize.setAttribute('aria-label', label);
}

windowMinimize?.addEventListener('click', () => windowControls?.minimize());
windowMaximize?.addEventListener('click', () => windowControls?.toggleMaximize());
windowClose?.addEventListener('click', () => windowControls?.close());
appTopbar?.addEventListener('dblclick', event => {
  if (event.target.closest?.('.topbar-actions')) return;
  windowControls?.toggleMaximize();
});
windowControls?.onStateChanged?.(renderWindowState);
Promise.resolve(windowControls?.getState?.()).then(renderWindowState).catch(() => {});

/* ---------- 视图切换 ---------- */

const viewMain = $('#view-main');
const viewSettings = $('#view-settings');
const viewAiSettings = $('#view-ai-settings');
const viewReport = $('#view-report');
const btnSettings = $('#btn-settings');

function showView(name) {
  viewMain.hidden = name !== 'main';
  viewSettings.hidden = name !== 'settings';
  viewAiSettings.hidden = name !== 'ai-settings';
  viewReport.hidden = name !== 'report';
  btnSettings.hidden = name === 'settings' || name === 'ai-settings';
  if (typeof syncWeeklyWorkbenchViewport === 'function') syncWeeklyWorkbenchViewport();
}

btnSettings.addEventListener('click', () => { showView('settings'); loadSettingsUI(); });
$('#btn-back').addEventListener('click', () => showView('main'));
$('#btn-ai-settings').addEventListener('click', () => {
  showView('ai-settings');
  setAiSettingsPanel('service');
});
$('#btn-ai-settings-back').addEventListener('click', () => showView('settings'));
$('#btn-report-back').addEventListener('click', () => showView('main'));
window.api.onNavigate(v => showView(v));

const aboutVersion = $('#about-version');
Promise.resolve(window.api.getAppInfo?.()).then(info => {
  if (info?.version && aboutVersion) aboutVersion.textContent = `v${info.version}`;
}).catch(() => {
  // 版本信息读取失败时保留 HTML 中的安全回退值，不影响设置页使用。
});

/* ---------- 主题 ---------- */

const ICONS = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
};

function normalizeThemeState(theme) {
  const cachedFamily = document.documentElement.dataset.themeFamily || 'gold';
  const cachedMode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  if (theme && typeof theme === 'object') {
    return {
      family: ['gold', 'sky', 'mint', 'violet'].includes(theme.family) ? theme.family : cachedFamily,
      mode: ['light', 'dark'].includes(theme.mode) ? theme.mode : cachedMode
    };
  }
  return {
    family: cachedFamily,
    mode: theme === 'dark' ? 'dark' : 'light'
  };
}

function applyTheme(theme) {
  const next = normalizeThemeState(theme);
  document.documentElement.dataset.theme = next.mode;
  document.documentElement.dataset.themeFamily = next.family;
  const themeButton = $('#btn-theme');
  if (themeButton) themeButton.innerHTML = next.mode === 'dark' ? ICONS.sun : ICONS.moon;
  try { localStorage.setItem('theme:cache', `${next.family}|${next.mode}`); } catch { /* 忽略 */ }
}

const themeButton = $('#btn-theme');
if (themeButton) themeButton.addEventListener('click', async () => {
  const cur = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = cur === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  await window.api.setTheme(next);
  if (state.settings) state.settings.theme = next; // 同步偏好缓存，设置页分段控件才能跟上
  syncThemeSeg();
});

window.api.onThemeChanged(t => { applyTheme(t); syncThemeSeg(); syncThemeFamilySelect(); });

/* ---------- 今日面板 ---------- */

const todayPanel = $('#today-panel');

const WEEKDAY_NAMES = '日一二三四五六';

function localizedTodayDate(date) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = new Intl.DateTimeFormat(uiLocale(), { weekday: 'short' }).format(date);
  if (uiLocale() === 'en-US') return `${month}/${day} ${weekday}`;
  if (uiLocale() === 'ja-JP') return `${month}月${day}日（${weekday.replace(/曜日$/, '')}）`;
  return `${month} 月 ${day} 日 星期${WEEKDAY_NAMES[date.getDay()]}`;
}

function renderTodayPanel() {
  const now = Date.now();
  todayPanel.innerHTML = '';
  const hi = document.createElement('span');
  hi.className = 'today-greet';
  hi.textContent = uiText(DR.greeting(now));
  const date = document.createElement('span');
  date.className = 'today-date';
  const d = new Date(now);
  date.textContent = localizedTodayDate(d);
  todayPanel.append(hi, date);
}

/* ---------- 统计条 ---------- */

const statsStrip = $('#stats-strip');

function renderStats() {
  const stats = window.DRStats.statsFor(state.entries, Date.now());
  statsStrip.innerHTML = '';
  const defs = [
    ['今日', stats.today],
    ['本周', stats.week],
    ['累计', stats.total]
  ];
  for (const [label, value] of defs) {
    const card = document.createElement('div');
    card.className = 'stat-card';
    const valueEl = document.createElement('div');
    valueEl.className = 'stat-value';
    valueEl.textContent = String(value);
    const labelEl = document.createElement('div');
    labelEl.className = 'stat-label';
    labelEl.textContent = uiText(label);
    card.append(valueEl, labelEl);
    statsStrip.appendChild(card);
  }
  bindStatCardClicks();
}

/* ---------- 录入（时间自动跟随当前） ---------- */

const composerText = $('#composer-text');
const composerTs = $('#composer-ts');
let tsTouched = false;    // 用户真正修改过时间后停止自动跟随，保存/点"此刻"后恢复
let lastAutoTime = '';    // 最近一次自动写入的值，用于排除"点开控件但没改值"的 input 事件

function syncComposerTime() {
  if (tsTouched) return;
  lastAutoTime = toLocalInputValue(Date.now());
  composerTs.value = lastAutoTime;
}

composerTs.addEventListener('input', () => {
  // datetime-local 被点开/聚焦也会触发 input，只有值真正偏离自动值才算手动修改
  if (composerTs.value !== lastAutoTime) tsTouched = true;
});

$('#btn-now').addEventListener('click', () => { tsTouched = false; syncComposerTime(); });

// 周期/焦点恢复时的公共校准：录入时间跟随 + 统计数字（跨零点翻卡）
function recalibrate() {
  syncComposerTime();
  renderTodayPanel();
  renderStats();
}
setInterval(recalibrate, 30000);
// 窗口从托盘恢复/重新获得焦点时立即校准（隐藏状态下定时器会被节流）
document.addEventListener('visibilitychange', () => { if (!document.hidden) recalibrate(); });
window.addEventListener('focus', recalibrate);

function syncTextareaResizerVisibility(textarea) {
  const shell = textarea?.parentElement?.classList.contains('textarea-resize-shell')
    ? textarea.parentElement
    : null;
  if (shell) shell.hidden = textarea.hidden;
}

// Chromium 的原生 textarea 缩放手柄在 Windows 下可能带白色底，改为应用内绘制并保留垂直拖动。
function installTextareaResizer(textarea) {
  if (!textarea || textarea.dataset.resizable !== 'true') return null;
  if (textarea.parentElement?.classList.contains('textarea-resize-shell')) {
    return textarea.parentElement;
  }

  const shell = document.createElement('div');
  shell.className = 'textarea-resize-shell';
  if (textarea.classList.contains('report-editor')) shell.classList.add('report-editor-shell');
  textarea.parentNode.insertBefore(shell, textarea);
  shell.appendChild(textarea);

  const handle = document.createElement('span');
  handle.className = 'textarea-resize-handle';
  handle.setAttribute('aria-hidden', 'true');
  handle.title = uiText('拖动调整文本框高度');
  handle.innerHTML = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 13 L13 4 L13 13 Z"/></svg>';
  shell.appendChild(handle);

  syncTextareaResizerVisibility(textarea);

  let resizing = false;
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || resizing) return;
    event.preventDefault();
    event.stopPropagation();
    resizing = true;

    const startY = event.clientY;
    const startHeight = textarea.getBoundingClientRect().height;
    const computed = getComputedStyle(textarea);
    const minHeight = Math.max(0, parseFloat(computed.minHeight) || 0);
    const parsedMaxHeight = parseFloat(computed.maxHeight);
    const maxHeight = Number.isFinite(parsedMaxHeight) && parsedMaxHeight > 0
      ? parsedMaxHeight
      : Infinity;

    const onMove = moveEvent => {
      const nextHeight = Math.min(
        maxHeight,
        Math.max(minHeight, startHeight + moveEvent.clientY - startY)
      );
      textarea.style.height = `${Math.round(nextHeight)}px`;
    };
    const onUp = () => {
      resizing = false;
      document.body.classList.remove('textarea-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    document.body.classList.add('textarea-resizing');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    handle.setPointerCapture?.(event.pointerId);
  });

  return shell;
}

composerText.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) saveComposer();
  if (e.key === 'Escape') setComposerOpen(false);
});

$('#btn-save').addEventListener('click', saveComposer);

/* ---------- 录入开合（窄屏收纳） ---------- */

const composerModal = $('#composer-modal');
const btnComposer = $('#btn-composer');

function setComposerOpen(open) {
  composerModal.hidden = !open;
  if (open) {
    composerText.focus();
    tsTouched = false;      // 打开时校准时间，避免久置后带旧时刻
    syncComposerTime();
  }
}

function toggleComposer() {
  setComposerOpen(composerModal.hidden);
}

btnComposer.addEventListener('click', toggleComposer);

// 点击弹窗外的遮罩区域即关闭（用户定义的"失焦"），不绑定整个窗口的失焦
composerModal.addEventListener('click', e => {
  if (e.target === composerModal) setComposerOpen(false);
});

document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
    if (!viewMain.hidden && !state.recording) {
      e.preventDefault();
      setComposerOpen(true);
    }
  }
});

async function saveComposer() {
  const text = composerText.value.trim();
  if (!text) { composerText.focus(); return; }
  const ts = composerTs.value ? new Date(composerTs.value).getTime() : Date.now();
  const res = await window.api.add(text, ts);
  if (res.ok) {
    composerText.value = '';
    tsTouched = false;
    syncComposerTime();
    setComposerOpen(false);   // 保存后收起（宽屏下 CSS 强制常驻，不受影响）
    toast(uiText('已记录 ✓'));
    refresh();
  }
}

/* ---------- 导出模态 ---------- */

const exportModal = $('#export-modal');
const closureModal = $('#closure-modal');
const closureModalClose = $('#closure-close');
const closureModalNote = $('#closure-modal-note');
const closureModalContent = $('#closure-modal-content');

const filterNameModal = $('#filter-name-modal');
const filterNameInput = $('#filter-name');
const filterNameMsg = $('#filter-name-msg');
const filterNameConfirm = $('#filter-name-confirm');
const filterNameCancel = $('#filter-name-cancel');
const filterNameClose = $('#filter-name-close');
let filterNameResolver = null;

const confirmModal = $('#confirm-modal');
const confirmTitle = $('#confirm-title');
const confirmMessage = $('#confirm-message');
const confirmOk = $('#confirm-ok');
const confirmCancel = $('#confirm-cancel');
const confirmClose = $('#confirm-close');
let confirmResolver = null;

function closeFilterNameModal(value = null) {
  const resolve = filterNameResolver;
  filterNameResolver = null;
  filterNameModal.hidden = true;
  if (resolve) resolve(value);
}

function confirmFilterName() {
  const name = filterNameInput.value.trim();
  if (!name) {
    filterNameMsg.textContent = uiText('请输入筛选名称');
    filterNameInput.focus();
    return;
  }
  closeFilterNameModal(name);
}

function askFilterName(defaultName) {
  return new Promise(resolve => {
    filterNameResolver = resolve;
    filterNameInput.value = defaultName;
    filterNameMsg.textContent = '';
    filterNameModal.hidden = false;
    requestAnimationFrame(() => {
      filterNameInput.focus();
      filterNameInput.select();
    });
  });
}

function closeConfirmModal(value = false) {
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmModal.hidden = true;
  confirmOk.classList.remove('confirm-danger');
  if (resolve) resolve(value);
}

function askConfirmation(message, options = {}) {
  const {
    title = '确认操作',
    confirmLabel = '确定',
    cancelLabel = '取消',
    danger = false
  } = options;
  return new Promise(resolve => {
    if (confirmResolver) confirmResolver(false);
    confirmResolver = resolve;
    confirmTitle.textContent = uiText(title);
    confirmMessage.textContent = uiText(message);
    confirmOk.textContent = uiText(confirmLabel);
    confirmCancel.textContent = uiText(cancelLabel);
    confirmOk.classList.toggle('confirm-danger', danger);
    confirmModal.hidden = false;
    requestAnimationFrame(() => confirmOk.focus());
  });
}

filterNameConfirm.addEventListener('click', confirmFilterName);
filterNameCancel.addEventListener('click', () => closeFilterNameModal());
filterNameClose.addEventListener('click', () => closeFilterNameModal());
filterNameModal.addEventListener('click', event => {
  if (event.target === filterNameModal) closeFilterNameModal();
});
filterNameInput.addEventListener('input', () => { filterNameMsg.textContent = ''; });
filterNameInput.addEventListener('keydown', event => {
  if (event.key === 'Enter') {
    event.preventDefault();
    confirmFilterName();
  }
  if (event.key === 'Escape') closeFilterNameModal();
});

confirmOk.addEventListener('click', () => closeConfirmModal(true));
confirmCancel.addEventListener('click', () => closeConfirmModal(false));
confirmClose.addEventListener('click', () => closeConfirmModal(false));
confirmModal.addEventListener('click', event => {
  if (event.target === confirmModal) closeConfirmModal(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !confirmModal.hidden) closeConfirmModal(false);
});

function openExportModal() {
  closeMoreMenu();
  exportModal.hidden = false;
  renderExportPreview();
}

function closeExportModal() {
  exportModal.hidden = true;
}

$('#btn-export-open').addEventListener('click', openExportModal);
$('#export-close').addEventListener('click', closeExportModal);
$('#export-cancel').addEventListener('click', closeExportModal);
exportModal.addEventListener('click', e => { if (e.target === exportModal) closeExportModal(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !exportModal.hidden) closeExportModal();
});

/* ---------- 导出 ---------- */

const expStart = $('#exp-start');
const expEnd = $('#exp-end');
const expFormat = $('#exp-format');
const expPreview = $('#exp-preview');

function defaultRange() {
  expStart.value = dateStr(Date.now() - 6 * 86400000);
  expEnd.value = dateStr(Date.now());
}

function renderExportPreview() {
  const s = expStart.value, e = expEnd.value;
  expPreview.innerHTML = '';
  if (!s || !e) return;
  const n = state.entries.filter(x => {
    const d = dateStr(x.ts);
    return d >= s && d <= e;
  }).length;
  expPreview.append(`${uiText('将导出')} `);
  const b = document.createElement('b');
  b.textContent = String(n);
  expPreview.appendChild(b);
  expPreview.append(` ${uiText('条')}`);
}

[expStart, expEnd, expFormat].forEach(el => el.addEventListener('change', renderExportPreview));

$('#btn-export').addEventListener('click', async () => {
  const s = expStart.value, e = expEnd.value;
  if (!s || !e) { toast(uiText('请先选择开始和结束日期')); return; }
  if (s > e) { toast(uiText('开始日期不能晚于结束日期')); return; }
  const res = await window.api.exportRange(s, e, expFormat.value);
  if (res.ok) { closeExportModal(); toast(uiText(`已导出到 ${res.filePath}`)); }
  else if (res.error) toast(uiText(res.error));
});

/* ---------- 周期总结 ---------- */

const reportType = $('#report-type');
const reportPrev = $('#report-prev');
const reportNext = $('#report-next');
const reportJump = $('#report-jump');
const reportCalendarTrigger = $('#report-calendar-trigger');
const reportCalendar = $('#report-calendar');
const reportCalendarLabel = $('#report-calendar-label');
const reportCalendarPrev = $('#report-calendar-prev');
const reportCalendarNext = $('#report-calendar-next');
const reportCalendarToday = $('#report-calendar-today');
const reportCalendarMonthTitle = $('#report-calendar-month');
const reportCalendarWeekdays = $('#report-calendar-weekdays');
const reportCalendarGrid = $('#report-calendar-grid');
const reportCalendarPeriodNote = $('#report-calendar-period-note');
let reportCalendarOpen = false;
let reportCalendarCursor = 0;
const reportStart = $('#report-start');
const reportEnd = $('#report-end');
const reportDates = $('#report-dates');
const reportFormat = $('#report-format');
const reportStatus = $('#report-status');
const reportThinking = $('#report-thinking');
const reportThinkingStatus = $('#report-thinking-status');
const reportThinkingToggle = $('#report-thinking-toggle');
const reportThinkingContent = $('#report-thinking-content');
const reportThinkingNote = $('#report-thinking-note');
const reportTitle = $('#report-title');
const reportMeta = $('#report-meta');
const reportContent = $('#report-content');
const reportGenerate = $('#report-generate');
const reportEditor = $('#report-editor');
const reportFull = $('#report-full');
const reportEdit = $('#report-edit');
const reportEditFoot = $('#report-edit-foot');
const reportEditCancel = $('#report-edit-cancel');
const reportEditSave = $('#report-edit-save');
const reportCount = $('#report-count');
const reportCoverage = $('#report-coverage');
const reportModel = $('#report-model');
const reportSourceList = $('#report-source-list');
const reportConnection = $('#report-connection');
const reportLayout = $('#report-layout');
const reportResizer = $('#report-resizer');
const reportLifecycle = window.DRReportLifecycle;
const reportThinkingCache = reportLifecycle.createReportThinkingCache();
const reportGeneration = window.DRReportGeneration;
const reportGenerationManager = reportGeneration.createReportGenerationManager({
  // 同时生成多周时保留有限并发，避免一次打开过多流式请求。
  maxConcurrent: 2,
  run: ({ jobId, payload }) => window.api.generateReport({ ...payload, jobId }).then(res => {
    if (res?.ok) return res;
    const error = new Error(res?.error || '生成总结失败');
    error.reportResponse = res;
    throw error;
  })
});

function localDateFromString(value) { return new Date(value + 'T00:00:00'); }

function dateStringFromDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDateString(value, days) {
  const d = localDateFromString(value);
  d.setDate(d.getDate() + days);
  return dateStringFromDate(d);
}

function periodBounds(type, anchor = Date.now()) {
  const now = new Date(anchor);
  if (type === 'day') {
    const day = dateStr(anchor);
    return { start: day, end: day, label: day };
  }
  if (type === 'month') {
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: dateStringFromDate(first), end: dateStringFromDate(next), label: `${now.getFullYear()} 年 ${now.getMonth() + 1} 月` };
  }
  if (type === 'custom') return { start: dateStr(anchor), end: dateStr(anchor), label: dateStr(anchor) };
  const monday = new Date(DR.weekStart(anchor));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: dateStringFromDate(monday), end: dateStringFromDate(sunday), label: `${dateStringFromDate(monday)} 至 ${dateStringFromDate(sunday)}` };
}

function reportPeriodForAnchor(value) {
  if (!value) return null;
  const date = localDateFromString(value);
  if (Number.isNaN(date.getTime())) return null;
  const bounds = periodBounds(state.report.type, localDateFromString(value).getTime());
  return { type: state.report.type, start: bounds.start, end: bounds.end };
}

function calendarMonthStart(value) {
  const date = typeof value === 'number' ? new Date(value) : localDateFromString(value);
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function reportCalendarTriggerText() {
  if (!state.report.start) return uiText('选择周期');
  if (state.report.type === 'day') {
    return new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(localDateFromString(state.report.start));
  }
  if (state.report.type === 'month') {
    return new Intl.DateTimeFormat(uiLocale(), { year: 'numeric', month: 'short' })
      .format(localDateFromString(state.report.start));
  }
  const format = value => new Intl.DateTimeFormat(uiLocale(), { month: '2-digit', day: '2-digit' })
    .format(localDateFromString(value));
  return `${format(state.report.start)} – ${format(state.report.end)}`;
}

function reportCalendarEntryCounts() {
  const counts = new Map();
  state.entries.forEach(entry => {
    const day = dateStr(entry.ts);
    counts.set(day, (counts.get(day) || 0) + 1);
  });
  return counts;
}

function reportCalendarNote() {
  if (state.report.type === 'day') return '点击日期选择当天';
  if (state.report.type === 'month') return '点击日期选择整月';
  return '点击日期选择整周';
}

function renderReportCalendar() {
  if (!reportCalendarGrid || !state.report.start) return;
  const month = calendarMonthStart(reportCalendarCursor || state.report.start);
  const first = new Date(month);
  first.setDate(1 - ((first.getDay() + 6) % 7));
  const counts = reportCalendarEntryCounts();
  const selectedPeriod = currentReportPeriod();
  reportCalendarMonthTitle.textContent = new Intl.DateTimeFormat(uiLocale(), {
    year: 'numeric',
    month: 'long'
  }).format(month);
  reportCalendarWeekdays.replaceChildren();
  for (let index = 0; index < 7; index += 1) {
    const weekday = new Date(2026, 8, 7 + index);
    const label = document.createElement('span');
    label.textContent = new Intl.DateTimeFormat(uiLocale(), { weekday: 'short' }).format(weekday);
    reportCalendarWeekdays.appendChild(label);
  }
  reportCalendarGrid.replaceChildren();

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const week = document.createElement('div');
    week.className = 'report-calendar-week';
    const weekStart = new Date(first);
    weekStart.setDate(first.getDate() + weekIndex * 7);
    const weekStartKey = dateStringFromDate(weekStart);
    const weekDays = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + dayIndex);
      weekDays.push({ date, key: dateStringFromDate(date) });
    }
    const weekHasRecords = weekDays.some(day => counts.has(day.key));
    const selectedWeek = state.report.type === 'week' && weekStartKey === selectedPeriod.start;
    if (weekHasRecords) week.classList.add('has-records');
    if (selectedWeek) week.classList.add('selected-week');

    weekDays.forEach(({ date, key }) => {
      const count = counts.get(key) || 0;
      const target = periodBounds(state.report.type, date.getTime());
      const canView = canViewReportPeriod(target);
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'report-calendar-day';
      cell.disabled = !canView;
      if (date.getMonth() !== month.getMonth()) cell.classList.add('outside');
      if (key === dateStr(Date.now())) cell.classList.add('today');
      if (count) cell.classList.add('has-entry');
      if (state.report.type === 'day' && key === selectedPeriod.start) cell.classList.add('selected-day');
      if (state.report.type === 'month' && key >= selectedPeriod.start && key <= selectedPeriod.end) {
        cell.classList.add('selected-month');
      }
      const title = count ? `${key} · ${count} ${uiText('有日报')}` : key;
      cell.title = canView ? title : `${title} · ${uiText('未来空周期没有日报记录，无法查看。')}`;
      cell.setAttribute('aria-label', cell.title);

      const number = document.createElement('span');
      number.className = 'report-calendar-day-number';
      number.textContent = String(date.getDate());
      const dot = document.createElement('i');
      dot.className = 'report-calendar-record-dot';
      dot.hidden = !count;
      dot.setAttribute('aria-hidden', 'true');
      cell.append(number, dot);
      cell.addEventListener('click', () => selectReportCalendarDate(key));
      week.appendChild(cell);
    });
    reportCalendarGrid.appendChild(week);
  }
  reportCalendarPeriodNote.textContent = uiText(reportCalendarNote());
}

function setReportCalendarOpen(open) {
  if (open && state.report.start) reportCalendarCursor = calendarMonthStart(state.report.start).getTime();
  reportCalendarOpen = !!open && state.report.type !== 'custom' && !state.report.editing;
  reportCalendar.hidden = !reportCalendarOpen;
  reportCalendarTrigger.setAttribute('aria-expanded', String(reportCalendarOpen));
  if (reportCalendarOpen) renderReportCalendar();
}

function closeReportCalendar() {
  if (reportCalendarOpen) setReportCalendarOpen(false);
}

function shiftReportCalendarMonth(delta) {
  const month = calendarMonthStart(reportCalendarCursor || state.report.start || Date.now());
  month.setMonth(month.getMonth() + delta, 1);
  reportCalendarCursor = month.getTime();
  renderReportCalendar();
}

function selectReportCalendarDate(value) {
  if (state.report.editing || state.report.type === 'custom') return;
  const bounds = reportPeriodForAnchor(value);
  if (!bounds) return;
  if (!canViewReportPeriod(bounds)) {
    toast(uiText('未来空周期没有日报记录，无法查看。'));
    return;
  }
  reportCalendarCursor = calendarMonthStart(bounds.start).getTime();
  setReportPeriod(bounds.type, bounds.start, bounds.end);
  closeReportCalendar();
  reloadReportContent();
}

function syncReportCalendar() {
  const custom = state.report.type === 'custom';
  reportJump.hidden = custom;
  reportCalendarTrigger.disabled = state.report.editing || custom;
  reportCalendarTrigger.title = uiText('选择周期');
  reportCalendarTrigger.setAttribute('aria-label', reportCalendarTrigger.title);
  reportCalendarLabel.textContent = reportCalendarTriggerText();
  if (custom) reportCalendarOpen = false;
  reportCalendar.hidden = !reportCalendarOpen;
  reportCalendarTrigger.setAttribute('aria-expanded', String(reportCalendarOpen));
  if (reportCalendarOpen) renderReportCalendar();
}

function reportPeriodLabel() {
  const type = reportType.value;
  if (type === 'day') return `${reportStart.value} 工作总结`;
  if (type === 'month') {
    const d = localDateFromString(reportStart.value);
    return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月工作总结`;
  }
  return `${reportStart.value} 至 ${reportEnd.value} 工作总结`;
}

function setReportPeriod(type, start, end) {
  reportType.value = type;
  syncCustomSelect(reportType);
  const bounds = start && end ? { start, end } : periodBounds(type);
  reportStart.value = bounds.start;
  reportEnd.value = bounds.end;
  state.report.type = type;
  state.report.start = bounds.start;
  state.report.end = bounds.end;
  state.report.periodLabel = reportPeriodLabel();
  syncReportThinkingForPeriod();
  reportDates.hidden = type !== 'custom';
  reportTitle.textContent = uiText(reportPeriodLabel());
  rememberReportPeriod();
  syncReportControls();
}

function currentReportPeriod() {
  return {
    type: state.report.type,
    start: state.report.start,
    end: state.report.end
  };
}

function canViewReportPeriod(period) {
  return reportPeriodRules.canNavigateToPeriod(period, state.entries, dateStr(Date.now()));
}

function isFutureEmptyReportPeriod(period) {
  return reportPeriodRules.isFutureEmptyPeriod(period, state.entries, dateStr(Date.now()));
}

function shiftedReportPeriod(delta) {
  if (state.report.type === 'custom' || !state.report.start) return null;
  if (state.report.type === 'day') {
    const next = shiftDateString(state.report.start, delta);
    return { type: 'day', start: next, end: next };
  }
  if (state.report.type === 'week') {
    const nextStart = shiftDateString(state.report.start, delta * 7);
    return { type: 'week', start: nextStart, end: shiftDateString(nextStart, 6) };
  }
  const first = localDateFromString(state.report.start);
  first.setMonth(first.getMonth() + delta, 1);
  const start = dateStringFromDate(first);
  const endDate = new Date(first.getFullYear(), first.getMonth() + 1, 0);
  return { type: 'month', start, end: dateStringFromDate(endDate) };
}

function syncReportThinkingForPeriod() {
  const period = currentReportPeriod();
  let cached = reportThinkingCache.read(period);
  if (cached?.phase === 'incomplete') {
    // 兼容当前会话中由旧代码生成的快照；已保存的报告统一恢复为稳定完成态。
    cached = thinkingState.finalizeThinkingState({
      ...cached,
      open: false,
      progressNote: '总结已生成，已保留全部原始记录。'
    }, 'done', cached.finishedAt);
    reportThinkingCache.write(period, cached);
  }
  const job = currentReportJob();
  if (cached && (!reportJobIsActive(job) || cached.jobId === job.id)) {
    state.report.thinking = cached;
    return cached;
  }
  if (reportJobIsActive(job)) return beginReportThinking(job, job.status);
  const fresh = thinkingState.createThinkingState();
  reportThinkingCache.write(period, fresh);
  state.report.thinking = fresh;
  return fresh;
}

function sameReportPeriod(left, right) {
  return !!left && !!right
    && left.type === right.type
    && left.start === right.start
    && left.end === right.end;
}

function currentReportJob() {
  return reportGenerationManager.getForPeriod(currentReportPeriod());
}

function reportJobIsActive(job) {
  return reportGeneration.isReportJobActive(job);
}

function reportJobMessage(job) {
  if (!job) return '';
  if (job.status === 'queued') {
    const pending = reportGenerationManager.pendingCount();
    return pending > 1
      ? `已加入生成队列，前面还有 ${pending - 1} 个任务。`
      : '已加入生成队列，等待可用的 AI 请求…';
  }
  return '正在连接 DeepSeek 并生成总结，请稍候…';
}

function syncReportControls() {
  const job = currentReportJob();
  const busy = reportJobIsActive(job);
  const editing = state.report.editing;
  const nextPeriod = shiftedReportPeriod(1);
  const nextPeriodBlocked = !!nextPeriod && !canViewReportPeriod(nextPeriod);
  // 编辑态锁住整个报告周期，避免页面切到新周期而编辑框仍保留旧草稿。
  reportType.disabled = editing;
  reportStart.disabled = editing;
  reportEnd.disabled = editing;
  reportPrev.disabled = editing || state.report.type === 'custom';
  reportNext.disabled = editing || state.report.type === 'custom' || nextPeriodBlocked;
  reportNext.title = uiText(nextPeriodBlocked ? '未来空周期没有日报记录，无法查看。' : '下一周期');
  reportNext.setAttribute('aria-label', reportNext.title);
  reportGenerate.disabled = busy;
  syncReportCalendar();
  syncCustomSelect(reportType);
  reportGenerate.textContent = uiText(busy
    ? (job.status === 'queued' ? '排队中…' : '生成中…')
    : (state.report.data ? '重新生成' : '生成总结'));
}

const REPORT_PERIOD_STORAGE_KEY = 'report-period-selection';

function readReportPeriod() {
  try {
    const saved = JSON.parse(localStorage.getItem(REPORT_PERIOD_STORAGE_KEY) || 'null');
    const validType = ['day', 'week', 'month', 'custom'].includes(saved?.type);
    const validDates = /^\d{4}-\d{2}-\d{2}$/.test(saved?.start || '')
      && /^\d{4}-\d{2}-\d{2}$/.test(saved?.end || '')
      && saved.start <= saved.end;
    return validType && validDates ? saved : null;
  } catch {
    return null;
  }
}

function normalizeSavedReportPeriod(saved) {
  if (!saved || !isFutureEmptyReportPeriod(saved)) return saved;
  const fallbackType = ['day', 'month'].includes(saved.type) ? saved.type : 'week';
  const fallback = periodBounds(fallbackType);
  return { type: fallbackType, start: fallback.start, end: fallback.end };
}

function rememberReportPeriod() {
  if (!state.report.start || !state.report.end) return;
  try {
    localStorage.setItem(REPORT_PERIOD_STORAGE_KEY, JSON.stringify({
      type: state.report.type,
      start: state.report.start,
      end: state.report.end
    }));
  } catch { /* 忽略 */ }
}

function reportEntries() {
  return state.entries.filter(entry => {
    const day = dateStr(entry.ts);
    return day >= state.report.start && day <= state.report.end;
  }).sort((a, b) => a.ts - b.ts || (a.createdAt || 0) - (b.createdAt || 0));
}

function reportText(content) {
  return String(content || '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/^[ \t]*\d+\.[ \t]+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[ \t]*---[ \t]*$/gm, '────────────────')
    .trim();
}

function reportContentForFormat(content, format = state.report.format) {
  return format === 'txt' ? reportText(content) : String(content || '');
}

function reportTextToMarkdown(content) {
  return String(content || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*•[ \t]+/gm, '- ')
    .replace(/^[ \t]*────────────────[ \t]*$/gm, '---')
    .trim();
}

function reportEditorToMarkdown(content, format = state.report.format) {
  return format === 'txt' ? reportTextToMarkdown(content) : String(content || '').trim();
}

function currentReportDraftMarkdown(format = state.report.format) {
  const draft = String(state.report.draftMarkdown || '');
  const expected = reportContentForFormat(draft, format);
  return reportEditor.value === expected
    ? draft
    : reportEditorToMarkdown(reportEditor.value, format);
}

function scrollProgress(element) {
  if (!element) return 0;
  const max = Math.max(0, element.scrollHeight - element.clientHeight);
  return max ? Math.max(0, Math.min(1, element.scrollTop / max)) : 0;
}

function captureReportEditScroll() {
  const card = state.report.editing ? reportEditor : reportContent;
  return {
    card: scrollProgress(card),
    view: scrollProgress(viewReport)
  };
}

function restoreReportViewScroll(position) {
  const snapshot = position || { card: 0, view: 0 };
  const apply = () => {
    const cardMax = Math.max(0, reportContent.scrollHeight - reportContent.clientHeight);
    reportContent.scrollTop = cardMax * snapshot.card;
    const viewMax = Math.max(0, viewReport.scrollHeight - viewReport.clientHeight);
    viewReport.scrollTop = viewMax * snapshot.view;
  };

  requestAnimationFrame(() => {
    apply();
    // 查看态正文重新渲染后高度可能在下一帧才稳定，再校准一次避免回到顶部。
    requestAnimationFrame(apply);
  });
}

function restoreReportEditScroll(position) {
  const snapshot = position || { card: 0, view: 0 };
  const apply = () => {
    // 编辑态由 textarea 自己滚动；报告卡片只保留标题和底部操作栏的位置。
    reportFull.scrollTop = 0;
    const editorMax = Math.max(0, reportEditor.scrollHeight - reportEditor.clientHeight);
    reportEditor.scrollTop = editorMax * snapshot.card;
    const viewMax = Math.max(0, viewReport.scrollHeight - viewReport.clientHeight);
    viewReport.scrollTop = viewMax * snapshot.view;
  };

  requestAnimationFrame(() => {
    try { reportEditor.focus({ preventScroll: true }); }
    catch { reportEditor.focus(); }
    apply();
    // 让 textarea 完成首次布局后再校准一次，避免 focus 的默认滚动覆盖位置。
    requestAnimationFrame(apply);
  });
}

// 仅渲染标题、列表和段落，AI 返回内容一律使用 textContent，避免把远程内容当 HTML 执行。
function renderMarkdown(target, markdown) {
  target.innerHTML = '';
  let list = null;
  for (const raw of String(markdown || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { list = null; continue; }
    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      list = null;
      const el = document.createElement(`h${Math.min(6, heading[1].length)}`);
      el.textContent = heading[2];
      target.appendChild(el);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    if (bullet) {
      if (!list || list.tagName !== 'UL') { list = document.createElement('ul'); target.appendChild(list); }
      const li = document.createElement('li');
      li.textContent = bullet[1];
      list.appendChild(li);
      continue;
    }
    if (/^---+$/.test(line)) { list = null; target.appendChild(document.createElement('hr')); continue; }
    list = null;
    const p = document.createElement('p');
    p.textContent = line;
    target.appendChild(p);
  }
}

function renderReportContent(target, content) {
  if (state.report.format === 'txt') {
    target.innerHTML = '';
    const pre = document.createElement('pre');
    pre.className = 'report-plain';
    pre.textContent = reportContentForFormat(content, 'txt');
    target.appendChild(pre);
  } else renderMarkdown(target, content);
}

function renderReportSources() {
  reportSourceList.innerHTML = '';
  const entries = reportEntries();
  reportCount.textContent = String(entries.length);
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'report-source-empty';
    empty.textContent = uiText('本周期没有记录');
    reportSourceList.appendChild(empty);
    return;
  }
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'report-source-entry';
    const time = document.createElement('span');
    time.className = 'entry-time';
    time.textContent = `${dateStr(entry.ts)} ${timeStr(entry.ts)}`;
    const text = document.createElement('span');
    text.textContent = entry.text;
    row.append(time, text);
    reportSourceList.appendChild(row);
  }
}

let reportThinkingTimer = null;

function renderReportThinking() {
  const thinking = state.report.thinking || thinkingState.createThinkingState();
  reportThinking.hidden = !thinking.visible;
  reportThinkingContent.hidden = !thinking.open;
  reportThinkingToggle.textContent = uiText(thinking.open ? '收起详细过程' : '查看详细过程');
  reportThinkingToggle.setAttribute('aria-expanded', String(thinking.open));
  if (reportThinkingNote) {
    reportThinkingNote.textContent = uiText(thinking.progressNote || '实时状态代表实际生成进度；详细过程仅用于查看，不会写入总结或导出文件。');
  }
  const elapsed = thinkingState.elapsedSeconds(thinking);
  const segmentLabel = thinking.totalSegments > 1 && thinking.segment
    ? ` · 第 ${thinking.segment}/${thinking.totalSegments} 段`
    : '';
  const outputLength = thinking.contentLength || thinking.content.length;
  const outputLabel = outputLength > 0 ? ` · 已收到 ${outputLength} 字` : '';
  if (thinking.phase === 'queued') reportThinkingStatus.textContent = uiText(`等待生成${segmentLabel} · ${elapsed}s`);
  else if (thinking.phase === 'segment') reportThinkingStatus.textContent = uiText(`准备生成总结${segmentLabel} · ${elapsed}s`);
  else if (thinking.phase === 'thinking') reportThinkingStatus.textContent = uiText(`AI 正在思考${segmentLabel} · ${elapsed}s`);
  else if (thinking.phase === 'writing') reportThinkingStatus.textContent = uiText(`正在输出总结${segmentLabel}${outputLabel} · ${elapsed}s`);
  else if (thinking.phase === 'continuing') reportThinkingStatus.textContent = uiText(`正在续写第 ${thinking.continuation}/${thinking.maxContinuations} 次${segmentLabel} · ${elapsed}s`);
  else if (thinking.phase === 'recovering') reportThinkingStatus.textContent = uiText(`正在恢复流式输出${segmentLabel} · ${elapsed}s`);
  else if (thinking.phase === 'fallback') reportThinkingStatus.textContent = uiText(`正在切换兼容输出模式${segmentLabel} · ${elapsed}s`);
  else if (thinking.phase === 'stream-done') reportThinkingStatus.textContent = uiText(`正文输出完成，准备保存 · ${elapsed}s`);
  else if (thinking.phase === 'saving') reportThinkingStatus.textContent = uiText(`正在保存完整报告 · ${elapsed}s`);
  else if (thinking.phase === 'saved') reportThinkingStatus.textContent = uiText(`报告已保存 · ${elapsed}s`);
  else if (thinking.phase === 'done') reportThinkingStatus.textContent = uiText(`已完成 · ${elapsed}s`);
  // 兼容修复前已经存在于当前会话内的快照；报告已保存时统一按完成态展示。
  else if (thinking.phase === 'incomplete') reportThinkingStatus.textContent = uiText(`已完成 · ${elapsed}s`);
  else if (thinking.phase === 'error') reportThinkingStatus.textContent = uiText('生成失败');
  else reportThinkingStatus.textContent = uiText(`AI 正在处理${segmentLabel} · ${elapsed}s`);
  const blocks = [];
  if (thinking.progressNote) blocks.push(`${uiText('进度：')}${uiText(thinking.progressNote)}`);
  if (thinkingTextMatchesLocale(thinking) && thinking.text) blocks.push(`${uiText('思考过程：')}\n${thinking.text}`);
  if (thinkingTextMatchesLocale(thinking) && thinking.content) blocks.push(`${uiText('总结输出：')}\n${thinking.content}`);
  if (thinking.text && !thinkingTextMatchesLocale(thinking)) {
    blocks.push(uiText('当前语言与本次 AI 过程的生成语言不同，已隐藏原始思考文本。'));
  }
  reportThinkingContent.textContent = blocks.join('\n\n');
  if (thinking.open) reportThinkingContent.scrollTop = reportThinkingContent.scrollHeight;
}

function saveReportThinking(period, thinking) {
  reportThinkingCache.write(period, thinking);
  if (sameReportPeriod(period, currentReportPeriod())) {
    state.report.thinking = thinking;
    renderReportThinking();
  }
  return thinking;
}

function restoreReportThinkingFromReport(report) {
  const snapshot = thinkingSnapshot?.extractReportThinking(report);
  if (!snapshot) return false;
  const period = currentReportPeriod();
  reportThinkingCache.write(period, snapshot);
  state.report.thinking = snapshot;
  return true;
}

function persistReportThinkingForCurrentReport(thinking) {
  const report = state.report.data;
  const snapshot = thinkingSnapshot?.normalizeThinkingSnapshot(thinking);
  if (!report?.id || !snapshot || reportJobIsActive(currentReportJob())) return;
  window.api.saveReportThinking(report.id, snapshot).catch(() => {
    // 思考过程属于辅助展示；持久化失败不能影响已生成的总结正文。
  });
}

function beginReportThinking() {
  const job = arguments[0] || null;
  const status = arguments[1] || job?.status || 'running';
  const period = job?.period || currentReportPeriod();
  const thinking = thinkingState.createThinkingState({
    visible: true,
    phase: status === 'queued' ? 'queued' : 'thinking'
  });
  thinking.locale = uiLocale();
  thinking.jobId = job?.id || '';
  thinking.progressNote = status === 'queued'
    ? '已加入生成队列，等待可用的 AI 请求…'
    : '正在连接 DeepSeek，准备分析原始记录…';
  saveReportThinking(period, thinking);
  syncReportThinkingTimer();
  return thinking;
}

function reportThinkingForJob(job) {
  const cached = reportThinkingCache.read(job.period);
  if (cached && cached.jobId === job.id) return cached;
  return beginReportThinking(job, job.status === 'queued' ? 'queued' : 'running');
}

function markReportJobStarted(job) {
  const current = reportThinkingForJob(job);
  const thinking = {
    ...current,
    visible: true,
    phase: 'thinking',
    progressNote: '正在连接 DeepSeek，准备分析原始记录…'
  };
  thinking.locale = current.locale || uiLocale();
  saveReportThinking(job.period, thinking);
  syncReportThinkingTimer();
}

function finishReportThinking(phase = 'done', job, note) {
  const targetJob = job || currentReportJob();
  const period = targetJob?.period || currentReportPeriod();
  const current = targetJob ? reportThinkingForJob(targetJob) : state.report.thinking;
  const thinking = thinkingState.finalizeThinkingState({
    ...current,
    visible: true,
    open: phase === 'error',
    progressNote: note || current.progressNote
  }, phase === 'incomplete' ? 'done' : phase);
  saveReportThinking(period, thinking);
  syncReportThinkingTimer();
  return thinking;
}

function hideReportThinking() {
  if (!reportGenerationManager.hasActiveJobs()) {
    clearInterval(reportThinkingTimer);
    reportThinkingTimer = null;
  }
  state.report.thinking = {
    ...state.report.thinking,
    visible: false,
    open: false
  };
  reportThinking.hidden = true;
}

function syncReportThinkingTimer() {
  if (reportGenerationManager.hasActiveJobs()) {
    if (!reportThinkingTimer) reportThinkingTimer = setInterval(() => {
      if (!viewReport.hidden) renderReportThinking();
    }, 1000);
    return;
  }
  clearInterval(reportThinkingTimer);
  reportThinkingTimer = null;
}

function updateReportThinkingFromProgress(job, progress) {
  if (!progress) return;
  let thinking = reportThinkingForJob(job);
  thinking = thinkingState.appendThinkingProgress(thinking, progress);
  if (progress.text && !['writing', 'thinking'].includes(progress.phase)) {
    thinking.progressNote = progress.text;
  }
  if (progress.phase === 'segment') {
    thinking.progressNote = `正在分析第 ${progress.segment || 1}/${progress.totalSegments || 1} 段原始记录…`;
  } else if (progress.phase === 'thinking') {
    thinking.progressNote = `AI 正在分析第 ${progress.segment || 1}/${progress.totalSegments || 1} 段记录…`;
  } else if (progress.phase === 'writing') {
    thinking.progressNote = `正在接收总结正文，已收到 ${thinking.content.length} 字…`;
  } else if (progress.phase === 'continuing') {
    thinking.progressNote = `正在继续整理总结正文（第 ${progress.continuation || 1} 次）…`;
  } else if (progress.phase === 'recovering') {
    thinking.progressNote = '正在继续整理总结正文…';
  } else if (progress.phase === 'fallback') {
    thinking.progressNote = '正在继续生成总结…';
  } else if (progress.phase === 'stream-done') {
    thinking.progressNote = '正文流式输出完成，准备保存完整报告…';
  } else if (progress.phase === 'saving') {
    thinking.progressNote = '正在保存报告正文、完整性清单和原始记录明细…';
  } else if (progress.phase === 'saved') {
    thinking.progressNote = '报告已保存，可以查看、编辑或导出。';
  } else if (progress.phase === 'done') {
    // 兼容旧版主进程发送的 done 事件；新版会继续发送 saved。
    thinking = {
      ...thinking,
      phase: 'done',
      progressNote: '正文已生成，正在保存完整报告。'
    };
  } else if (progress.phase === 'error') {
    thinking = {
      ...thinking,
      phase: 'error',
      progressNote: progress.error || '生成过程中发生错误。'
    };
  }
  saveReportThinking(job.period, thinking);
}

function reportCoverageMessage(report) {
  if (!report) return '';
  const sourceCount = Number(report.sourceCount) || 0;
  const rawRecordCount = Number(report.rawRecordCount) || 0;
  // complete/sourceAudit 是内部质量元数据；只要报告已保存且原始记录仍在，
  // 用户看到的是可用结果，不把模型协议细节变成难以理解的错误提示。
  return sourceCount > 0 && rawRecordCount < sourceCount
    ? '总结已生成，日报原文仍已保留；可以重新生成以补齐报告。'
    : '总结已生成，已保留全部原始记录。';
}

function handleReportGenerationEvent(event) {
  const job = event?.job;
  if (!job) return;
  if (event.type === 'queued') {
    beginReportThinking(job, 'queued');
  } else if (event.type === 'started') {
    markReportJobStarted(job);
  } else if (event.type === 'progress') {
    updateReportThinkingFromProgress(job, event.progress);
  } else if (event.type === 'completed') {
    const result = event.result;
    const report = result?.report;
    if (!report) {
      handleReportGenerationFailure(job, new Error('AI 没有返回有效的总结结果'));
      return;
    }
    if (state.settings?.ai) {
      state.settings.ai.model = report.model;
      state.settings.ai.lastTestOk = true;
      syncAiEntry();
    }
    finishReportThinking('done', job, reportCoverageMessage(report));
    if (sameReportPeriod(job.period, currentReportPeriod())) {
      state.report.data = report;
      state.report.cacheStatus = result.cacheStatus || 'fresh';
      renderReportState(result.modelChanged
        ? `当前模型已更新为 ${report.model}，${reportCoverageMessage(report)}`
        : reportCoverageMessage(report));
    } else {
      toast(uiText(`${job.period.start} 至 ${job.period.end} 的总结已生成`));
    }
  } else if (event.type === 'failed') {
    handleReportGenerationFailure(job, event.error);
  }
  syncReportControls();
  syncReportThinkingTimer();
}

function handleReportGenerationFailure(job, error) {
  const message = error?.message || String(error || '生成总结失败');
  finishReportThinking('error', job, message);
  if (sameReportPeriod(job.period, currentReportPeriod())) {
    renderReportState(message);
    toast(message);
  } else {
    toast(uiText(`${job.period.start} 至 ${job.period.end} 总结失败：${message}`));
  }
}

reportGenerationManager.subscribe(handleReportGenerationEvent);

window.api.onReportProgress(progress => {
  if (!progress?.jobId) return;
  const job = reportGenerationManager.get(progress.jobId);
  if (!job) return;
  reportGenerationManager.updateProgress(progress.jobId, progress);
});

function renderReportMeta(data, rawRecordLabel) {
  reportMeta.replaceChildren();
  if (!data) {
    reportMeta.textContent = uiText('尚未生成本周期总结');
    return;
  }

  const fields = [
    `来源：${data.sourceCount} 条`,
    `模型：${data.model || '--'}`
  ];
  const rawRecordCount = Number(data.rawRecordCount);
  if (data.sourceCount > 0 && Number.isFinite(rawRecordCount) && rawRecordCount < Number(data.sourceCount)) {
    fields.push(`原始明细：${rawRecordLabel}`);
  }
  fields.forEach((text, index) => {
    if (index > 0) reportMeta.appendChild(document.createTextNode('　·　'));
    const item = document.createElement('span');
    item.className = 'report-meta-item';
    item.textContent = uiText(text);
    reportMeta.appendChild(item);
  });
}

function renderReportState(message) {
  const data = state.report.data;
  const staleCache = !!data && !['fresh', 'missing'].includes(state.report.cacheStatus);
  const cacheStatusMessage = {
    'source-changed': '原始记录已变化，当前显示上一次生成的报告；点击“重新生成”即可更新。',
    'template-changed': '报告模板已变化，当前显示上一次生成的报告；点击“重新生成”即可更新。',
    'source-and-template-changed': '原始记录和报告模板都已变化，当前显示上一次生成的报告；点击“重新生成”即可更新。',
    'terminology-changed': '术语词典已变化，当前显示上一次生成的报告；点击“重新生成”即可应用新的规范名称。',
    'source-and-terminology-changed': '原始记录和术语词典都已变化，当前显示上一次生成的报告；点击“重新生成”即可更新。',
    'template-and-terminology-changed': '报告模板和术语词典都已变化，当前显示上一次生成的报告；点击“重新生成”即可更新。',
    'source-template-and-terminology-changed': '原始记录、模板和术语词典都已变化，当前显示上一次生成的报告；点击“重新生成”即可更新。',
    unknown: '当前显示历史报告，无法确认其原始记录版本；建议重新生成。'
  }[state.report.cacheStatus] || '当前显示历史报告，建议重新生成。';
  const rawRecordsIncomplete = !!data
    && data.sourceCount > 0
    && Number(data.rawRecordCount) < Number(data.sourceCount);
  const incomplete = staleCache || rawRecordsIncomplete;
  const rawRecordsMessage = rawRecordsIncomplete
    ? '总结已生成，日报原文仍已保留；可以重新生成以补齐报告。'
    : '';
  const rawRecordLabel = data
    ? (Number.isFinite(data.rawRecordCount) ? `${data.rawRecordCount} / ${data.sourceCount}` : '已附加')
    : '--';
  reportTitle.textContent = uiText(reportPeriodLabel());
  renderReportMeta(data, rawRecordLabel);
  reportCoverage.textContent = data ? `${data.coveredCount} / ${data.sourceCount}` : '--';
  reportModel.textContent = data?.model || state.settings?.ai?.model || '--';
  reportStatus.textContent = uiText(message || (staleCache
    ? cacheStatusMessage
    : rawRecordsMessage
    ? rawRecordsMessage
    : data ? '总结已生成，已保留全部原始记录。' : '选择周期后点击“生成总结”。'));
  reportStatus.className = `report-status${message ? ' active' : ''}${incomplete ? ' incomplete' : ''}`;
  reportEdit.hidden = !data;
  reportFull.classList.toggle('editing', state.report.editing);
  reportContent.hidden = state.report.editing;
  reportEditor.hidden = !data || !state.report.editing;
  reportEditFoot.hidden = !data || !state.report.editing;
  syncTextareaResizerVisibility(reportEditor);
  if (data && !state.report.editing) {
    renderReportContent(reportContent, data.content);
  } else if (!data && !state.report.editing) {
    reportContent.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'report-empty';
    empty.textContent = uiText('尚未生成本周期总结，点击右上角“生成总结”开始。');
    reportContent.appendChild(empty);
  }
  renderReportSources();
  syncReportControls();
}

function syncAiEntry() {
  const ai = state.settings?.ai;
  const configured = !!ai?.configured;
  $('#btn-report').hidden = !configured;
  if (reportConnection) {
    let label = '未配置 AI';
    if (configured) {
      if (aiConnectionChecking) label = 'AI 正在检查连接…';
      else if (ai.lastTestOk) label = `AI 已连接 · ${ai.model}`;
      else if (ai.lastError) label = 'AI 连接失败';
      else label = 'AI 已配置';
    }
    reportConnection.textContent = uiText(label);
    reportConnection.classList.toggle('ok', configured && ai.lastTestOk);
  }
}

function autoTestAiOnStartup() {
  if (aiStartupCheckPromise) return aiStartupCheckPromise;
  if (aiStartupCheckCompleted || !state.settings?.ai?.configured) return Promise.resolve(null);

  aiConnectionChecking = true;
  syncAiSettingsUI(state.settings.ai);
  syncAiEntry();
  const epoch = aiStartupCheckEpoch;
  aiStartupCheckPromise = Promise.resolve()
    .then(() => window.api.testAi(''))
    .then(res => {
      if (epoch !== aiStartupCheckEpoch || !state.settings?.ai) return res;
      const configured = !!state.settings.ai.configured;
      state.settings.ai = {
        ...state.settings.ai,
        ...(res?.ai || {}),
        configured: configured || !!res?.ai?.configured
      };
      if (!res?.ok && !res?.ai) {
        state.settings.ai.lastTestAt = Date.now();
        state.settings.ai.lastTestOk = false;
        state.settings.ai.lastError = res?.error || '连接失败';
      }
      return res;
    })
    .catch(error => {
      const message = error?.message || 'AI 连接检查失败';
      if (epoch === aiStartupCheckEpoch && state.settings?.ai) {
        state.settings.ai.lastTestAt = Date.now();
        state.settings.ai.lastTestOk = false;
        state.settings.ai.lastError = message;
      }
      return { ok: false, error: message };
    })
    .finally(() => {
      if (epoch !== aiStartupCheckEpoch) return;
      aiConnectionChecking = false;
      aiStartupCheckCompleted = true;
      syncAiSettingsUI(state.settings?.ai);
      syncAiEntry();
    });
  return aiStartupCheckPromise;
}

let reportCacheRequestId = 0;

async function loadCachedReport() {
  const requestId = ++reportCacheRequestId;
  state.report.cacheStatus = 'missing';
  renderReportState();
  if (!state.settings?.ai?.configured) return;
  const res = await window.api.getCachedReport({
    start: state.report.start,
    end: state.report.end,
    periodType: state.report.type,
    template: state.settings.reportTemplates[state.report.type]
  });
  if (requestId !== reportCacheRequestId) return;
  if (res.ok) {
    state.report.data = res.report;
    state.report.cacheStatus = res.cacheStatus || (res.report ? 'unknown' : 'missing');
    if (!reportJobIsActive(currentReportJob())) restoreReportThinkingFromReport(res.report);
  } else {
    state.report.data = null;
    state.report.cacheStatus = 'missing';
  }
  renderReportState();
  renderReportThinking();
}

function reloadReportContent() {
  syncReportThinkingForPeriod();
  state.report.data = null;
  state.report.cacheStatus = 'missing';
  renderReportThinking();
  syncReportControls();
  loadCachedReport();
}

async function openReportView() {
  if (!state.settings) await loadSettingsUI();
  if (!state.settings?.ai?.configured) {
    showView('settings');
    toast(uiText('请先在设置中配置 DeepSeek API'));
    return;
  }
  showView('report');
  const savedPeriod = normalizeSavedReportPeriod(readReportPeriod());
  if (savedPeriod) setReportPeriod(savedPeriod.type, savedPeriod.start, savedPeriod.end);
  else if (!state.report.start) setReportPeriod('week');
  state.report.data = null;
  state.report.cacheStatus = 'missing';
  state.report.editing = false;
  renderReportThinking();
  await loadCachedReport();
  const job = currentReportJob();
  if (reportJobIsActive(job)) renderReportState(reportJobMessage(job));
  syncReportControls();
}

function generateReport(force = false) {
  const period = currentReportPeriod();
  if (!reportEntries().length) {
    const message = '本周期没有日报记录，无法生成总结。';
    // 旧的空报告或已经失效的历史报告不应继续伪装成当前周期结果。
    state.report.data = null;
    state.report.cacheStatus = 'missing';
    renderReportState(message);
    toast(message);
    syncReportControls();
    return Promise.resolve({ accepted: false, reason: 'empty', completion: Promise.resolve({ ok: false, code: 'NO_SOURCES', error: message }) });
  }
  const result = reportGenerationManager.enqueue({
    period,
    payload: {
      start: period.start,
      end: period.end,
      periodType: period.type,
      periodLabel: reportPeriodLabel(),
      template: state.settings?.reportTemplates?.[period.type],
      force
    }
  });
  if (!result.accepted) {
    toast(uiText('本周期总结正在生成，请稍候。'));
    return result.completion;
  }
  const job = reportGenerationManager.get(result.job.id);
  if (sameReportPeriod(period, currentReportPeriod())) {
    renderReportState(reportJobMessage(job));
  }
  syncReportControls();
  return result.completion;
}

function shiftReportPeriod(delta) {
  if (state.report.editing || state.report.type === 'custom') return;
  const nextPeriod = shiftedReportPeriod(delta);
  if (!nextPeriod || !canViewReportPeriod(nextPeriod)) return;
  closeReportCalendar();
  setReportPeriod(nextPeriod.type, nextPeriod.start, nextPeriod.end);
  reloadReportContent();
}

$('#btn-report').addEventListener('click', openReportView);
reportType.addEventListener('change', () => {
  if (state.report.editing) return;
  closeReportCalendar();
  setReportPeriod(reportType.value);
  reloadReportContent();
});
reportCalendarTrigger.addEventListener('click', event => {
  event.stopPropagation();
  setReportCalendarOpen(!reportCalendarOpen);
});
reportCalendarPrev.addEventListener('click', event => {
  event.stopPropagation();
  shiftReportCalendarMonth(-1);
});
reportCalendarNext.addEventListener('click', event => {
  event.stopPropagation();
  shiftReportCalendarMonth(1);
});
reportCalendarToday.addEventListener('click', event => {
  event.stopPropagation();
  reportCalendarCursor = calendarMonthStart(Date.now()).getTime();
  renderReportCalendar();
});
document.addEventListener('click', event => {
  if (!reportJump.contains(event.target)) closeReportCalendar();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && reportCalendarOpen) {
    closeReportCalendar();
    reportCalendarTrigger.focus();
  }
});
reportStart.addEventListener('change', () => {
  if (state.report.editing || reportType.value !== 'custom') return;
  closeReportCalendar();
  const previousPeriod = currentReportPeriod();
  state.report.start = reportStart.value;
  if (state.report.start > state.report.end) reportEnd.value = reportStart.value;
  state.report.end = reportEnd.value;
  state.report.periodLabel = reportPeriodLabel();
  if (isFutureEmptyReportPeriod(currentReportPeriod())) {
    setReportPeriod('custom', previousPeriod.start, previousPeriod.end);
    toast(uiText('未来空周期没有日报记录，无法查看。'));
    return;
  }
  rememberReportPeriod();
  reloadReportContent();
});
reportEnd.addEventListener('change', () => {
  if (state.report.editing || reportType.value !== 'custom') return;
  closeReportCalendar();
  const previousPeriod = currentReportPeriod();
  if (reportEnd.value < reportStart.value) reportStart.value = reportEnd.value;
  state.report.start = reportStart.value;
  state.report.end = reportEnd.value;
  state.report.periodLabel = reportPeriodLabel();
  if (isFutureEmptyReportPeriod(currentReportPeriod())) {
    setReportPeriod('custom', previousPeriod.start, previousPeriod.end);
    toast(uiText('未来空周期没有日报记录，无法查看。'));
    return;
  }
  rememberReportPeriod();
  reloadReportContent();
});
reportPrev.addEventListener('click', () => shiftReportPeriod(-1));
reportNext.addEventListener('click', () => shiftReportPeriod(1));
reportFormat.addEventListener('change', () => {
  const previousFormat = state.report.format;
  const nextFormat = reportFormat.value;
  if (state.report.editing) {
    state.report.draftMarkdown = currentReportDraftMarkdown(previousFormat);
    state.report.format = nextFormat;
    reportEditor.value = reportContentForFormat(state.report.draftMarkdown, nextFormat);
  } else {
    state.report.format = nextFormat;
  }
  renderReportState();
  if (state.report.editing) reportEditor.focus();
});
reportGenerate.addEventListener('click', () => generateReport(!!state.report.data));
$('#report-copy').addEventListener('click', async () => {
  if (!state.report.data) { toast(uiText('请先生成总结')); return; }
  const content = state.report.format === 'txt' ? reportText(state.report.data.content) : state.report.data.content;
  try { await navigator.clipboard.writeText(content); toast(uiText('总结已复制')); }
  catch { toast(uiText('复制失败，请使用编辑框手动复制')); }
});
$('#report-export').addEventListener('click', async () => {
  if (!state.report.data) { toast(uiText('请先生成总结')); return; }
  const res = await window.api.exportReport(state.report.data.id, state.report.format);
  if (res.ok) toast(uiText(`总结已导出到 ${res.filePath}`));
  else if (res.error) toast(uiText(res.error));
});
reportEdit.addEventListener('click', () => {
  if (!state.report.data) return;
  const scrollPosition = captureReportEditScroll();
  state.report.editing = true;
  state.report.draftMarkdown = String(state.report.data.content || '');
  reportEditor.value = reportContentForFormat(state.report.draftMarkdown, state.report.format);
  renderReportState();
  restoreReportEditScroll(scrollPosition);
});
reportEditCancel.addEventListener('click', () => {
  const scrollPosition = captureReportEditScroll();
  state.report.editing = false;
  state.report.draftMarkdown = '';
  renderReportState();
  restoreReportViewScroll(scrollPosition);
});
reportEditSave.addEventListener('click', async () => {
  if (!state.report.data) return;
  const scrollPosition = captureReportEditScroll();
  const content = currentReportDraftMarkdown();
  const res = await window.api.saveReport(state.report.data.id, content);
  if (!res.ok) { toast(uiText(res.error || '保存失败')); return; }
  state.report.data = res.report;
  state.report.editing = false;
  state.report.draftMarkdown = '';
  renderReportState('总结修改已保存。');
  restoreReportViewScroll(scrollPosition);
});
reportThinkingToggle.addEventListener('click', () => {
  state.report.thinking = thinkingState.toggleThinking(state.report.thinking);
  reportThinkingCache.write(currentReportPeriod(), state.report.thinking);
  persistReportThinkingForCurrentReport(state.report.thinking);
  renderReportThinking();
});

function setReportSideWidth(width) {
  const value = Math.max(220, Math.min(520, Math.round(Number(width) || 280)));
  reportLayout.style.setProperty('--report-side-width', `${value}px`);
  try { localStorage.setItem('report-side-width', String(value)); } catch { /* 忽略 */ }
}

try {
  const savedSideWidth = Number(localStorage.getItem('report-side-width'));
  if (savedSideWidth) setReportSideWidth(savedSideWidth);
} catch { /* 忽略 */ }

reportResizer.addEventListener('pointerdown', event => {
  if (window.innerWidth < 1200) return;
  event.preventDefault();
  reportResizer.classList.add('dragging');
  reportResizer.setPointerCapture?.(event.pointerId);
  const startX = event.clientX;
  const startWidth = parseFloat(getComputedStyle(reportLayout).getPropertyValue('--report-side-width')) || 280;
  const onMove = moveEvent => setReportSideWidth(startWidth + startX - moveEvent.clientX);
  const onUp = upEvent => {
    reportResizer.classList.remove('dragging');
    reportResizer.releasePointerCapture?.(upEvent.pointerId);
    reportResizer.removeEventListener('pointermove', onMove);
    reportResizer.removeEventListener('pointerup', onUp);
    reportResizer.removeEventListener('pointercancel', onUp);
  };
  reportResizer.addEventListener('pointermove', onMove);
  reportResizer.addEventListener('pointerup', onUp);
  reportResizer.addEventListener('pointercancel', onUp);
});

reportResizer.addEventListener('dblclick', () => setReportSideWidth(280));

/* ---------- 列表筛选 ---------- */

const fYear = $('#f-year');
const fMonth = $('#f-month');
const fText = $('#f-text');
const fCount = $('#f-count');
const fSaved = $('#f-saved');
const fSaveFilter = $('#f-save-filter');
const fDeleteFilter = $('#f-delete-filter');
const fClearFilter = $('#f-clear-filter');
const dateFilterGroup = $('#date-filter-group');
const dateFilterToggle = $('#date-filter-toggle');
const dateFilterLabel = $('#date-filter-label');
const dateFilterPopover = $('#date-filter-popover');
const dateFilterClose = $('#date-filter-close');
const moreGroup = $('#more-group');
const moreToggle = $('#btn-more');
const moreMenu = $('#more-menu');

function setDateFilterOpen(open) {
  dateFilterPopover.hidden = !open;
  dateFilterToggle.setAttribute('aria-expanded', String(open));
}

function closeMoreMenu() {
  moreMenu.hidden = true;
  moreToggle.setAttribute('aria-expanded', 'false');
}

function setMoreMenuOpen(open) {
  moreMenu.hidden = !open;
  moreToggle.setAttribute('aria-expanded', String(open));
}

dateFilterToggle.addEventListener('click', event => {
  event.stopPropagation();
  setDateFilterOpen(dateFilterPopover.hidden);
  closeMoreMenu();
});
dateFilterClose.addEventListener('click', () => setDateFilterOpen(false));
moreToggle.addEventListener('click', event => {
  event.stopPropagation();
  setMoreMenuOpen(moreMenu.hidden);
  setDateFilterOpen(false);
});
document.addEventListener('click', event => {
  const customOwner = customSelect?.ownerForTarget(event.target);
  const inDateFilter = dateFilterGroup.contains(event.target)
    || (!!customOwner?.wrapper && dateFilterGroup.contains(customOwner.wrapper));
  if (!inDateFilter) setDateFilterOpen(false);
  if (!moreGroup.contains(event.target)) closeMoreMenu();
});

function buildMonthOptions() {
  fMonth.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = uiText('全部月份');
  fMonth.appendChild(all);
  for (let m = 1; m <= 12; m++) {
    const o = document.createElement('option');
    o.value = String(m); o.textContent = uiText(`${m} 月`);
    fMonth.appendChild(o);
  }
  syncCustomSelect(fMonth);
}

function populateYearOptions() {
  const years = [...new Set(state.entries.map(e => new Date(e.ts).getFullYear()))].sort((a, b) => b - a);
  const cur = fYear.value;
  fYear.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = uiText('全部年份');
  fYear.appendChild(all);
  for (const y of years) {
    const o = document.createElement('option');
    o.value = String(y); o.textContent = uiText(`${y} 年`);
    fYear.appendChild(o);
  }
  if (cur !== 'all' && /^\d{4}$/.test(cur) && !years.includes(Number(cur))) {
    const o = document.createElement('option');
    o.value = cur; o.textContent = uiText(`${cur} 年`);
    fYear.appendChild(o);
  }
  if ([...fYear.options].some(o => o.value === cur)) fYear.value = cur;
  syncCustomSelect(fYear);
}

function currentFilterSnapshot() {
  return window.DRFilterPresets.normalizeFilterSnapshot({
    ...state.filter,
    rangeFocus: state.rangeFocus
  });
}

function renderSavedFilterOptions() {
  const model = window.DRFilterPresets.savedFilterSelectModel(state.savedFilters);
  fSaved.innerHTML = '';
  for (const item of model.options) {
    const option = document.createElement('option');
    option.value = item.value;
    // 空值项是程序内置状态文案；用户保存的筛选名称必须原样保留。
    option.textContent = item.value ? item.label : uiText(item.label);
    fSaved.appendChild(option);
  }
  fSaved.disabled = model.disabled;
  syncCustomSelect(fSaved);
}

function syncFilterControls(filteredCount = filteredEntries().length) {
  const snapshot = currentFilterSnapshot();
  const signature = window.DRFilterPresets.filterSignature(snapshot);
  const active = isFiltering();
  const matched = state.savedFilters.find(item => window.DRFilterPresets.filterSignature(item) === signature);
  fSaved.value = matched?.id || '';
  syncCustomSelect(fSaved);
  fSaveFilter.disabled = !active;
  fDeleteFilter.hidden = !matched;
  fClearFilter.hidden = !active;
  fCount.textContent = uiText(active
    ? `显示 ${filteredCount} / ${state.entries.length} 条`
    : `${state.entries.length} 条记录`);
}

function resetFilters() {
  state.filter = { year: 'all', month: 'all', text: '' };
  state.rangeFocus = { type: 'all' };
  fYear.value = 'all';
  fMonth.value = 'all';
  syncCustomSelect(fYear);
  syncCustomSelect(fMonth);
  fText.value = '';
  renderRangeChip();
  renderList();
}

function applyFilterSnapshot(filter) {
  const snapshot = window.DRFilterPresets.normalizeFilterSnapshot(filter);
  state.filter = { year: snapshot.year, month: snapshot.month, text: snapshot.text };
  state.rangeFocus = snapshot.rangeFocus;
  fYear.value = snapshot.year;
  fMonth.value = snapshot.month;
  syncCustomSelect(fYear);
  syncCustomSelect(fMonth);
  fText.value = snapshot.text;
  renderRangeChip();
  renderList();
}

function syncDateFilterButton() {
  const parts = [];
  if (fYear.value !== 'all') parts.push(`${fYear.value}年`);
  if (fMonth.value !== 'all') parts.push(`${fMonth.value}月`);
  const rangeLabel = state.rangeFocus.type !== 'all' ? DR.rangeLabel(state.rangeFocus) : '';
  dateFilterLabel.textContent = uiText(rangeLabel || (parts.length ? parts.join(' · ') : '日期筛选'));
  const active = !!rangeLabel || parts.length > 0;
  dateFilterToggle.classList.toggle('active', active);
  dateFilterToggle.title = uiText(active
    ? `当前日期筛选：${rangeLabel || parts.join(' · ')}`
    : '按年份或月份筛选');
}

function filteredEntries() {
  const { year, month, text } = state.filter;
  let list = window.DRStats.filterByRange(state.entries, state.rangeFocus, Date.now());
  if (year !== 'all') list = list.filter(x => new Date(x.ts).getFullYear() === Number(year));
  if (month !== 'all') list = list.filter(x => new Date(x.ts).getMonth() === Number(month) - 1);
  if (text) list = list.filter(x => window.DRTextSearch.matchesSearch(x.text, text));
  return list;
}

function isFiltering() {
  const { year, month, text } = state.filter;
  return state.rangeFocus.type !== 'all' || year !== 'all' || month !== 'all' || !!text;
}

[fYear, fMonth].forEach(el => el.addEventListener('change', () => {
  state.filter.year = fYear.value;
  state.filter.month = fMonth.value;
  // 互斥（ADR-0003）：手动改年/月时摘除范围聚焦
  if (state.rangeFocus.type !== 'all') {
    state.rangeFocus = { type: 'all' };
    renderRangeChip();
  }
  syncDateFilterButton();
  renderList();
}));

fText.addEventListener('input', () => {
  state.filter.text = fText.value.trim();
  renderList();
});

fSaved.addEventListener('change', () => {
  const preset = state.savedFilters.find(item => item.id === fSaved.value);
  if (preset) {
    applyFilterSnapshot(preset);
    toast(uiText(`已加载筛选：${preset.name}`));
  }
});

fClearFilter.addEventListener('click', () => {
  closeMoreMenu();
  resetFilters();
});

fDeleteFilter.addEventListener('click', async () => {
  closeMoreMenu();
  const selected = state.savedFilters.find(item => item.id === fSaved.value);
  if (!selected) return;
  const confirmed = await askConfirmation(`删除保存的筛选“${selected.name}”？`, {
    title: '删除保存的筛选',
    confirmLabel: '删除',
    danger: true
  });
  if (!confirmed) return;
  fDeleteFilter.disabled = true;
  try {
    const res = await window.api.setSavedFilters(state.savedFilters.filter(item => item.id !== selected.id));
    if (!res?.ok) { toast(uiText(res?.error || '筛选删除失败')); return; }
    state.savedFilters = Array.isArray(res.savedFilters) ? res.savedFilters : [];
    renderSavedFilterOptions();
    syncFilterControls();
    toast(uiText('已删除保存的筛选'));
  } catch (error) {
    toast(uiText(`筛选删除失败：${error?.message || '无法保存设置'}`));
  } finally {
    fDeleteFilter.disabled = false;
  }
});

fSaveFilter.addEventListener('click', async () => {
  if (!isFiltering()) {
    toast(uiText('请先设置关键词或日期筛选'));
    return;
  }
  const snapshot = currentFilterSnapshot();
  const defaultName = snapshot.text ? `搜索：${snapshot.text.slice(0, 16)}` : (DR.rangeLabel(snapshot.rangeFocus) || '我的筛选');
  const name = await askFilterName(defaultName);
  if (!name?.trim()) return;
  const existing = state.savedFilters.find(item => window.DRFilterPresets.filterSignature(item) === window.DRFilterPresets.filterSignature(snapshot));
  const next = window.DRFilterPresets.upsertSavedFilter(
    state.savedFilters,
    snapshot,
    name,
    existing?.id || globalThis.crypto?.randomUUID?.() || `filter-${Date.now()}`
  );
  fSaveFilter.disabled = true;
  try {
    const res = await window.api.setSavedFilters(next);
    if (!res?.ok) { toast(uiText(res?.error || '筛选保存失败')); return; }
    state.savedFilters = Array.isArray(res.savedFilters) ? res.savedFilters : next;
    renderSavedFilterOptions();
    syncFilterControls();
    toast(uiText(existing ? '已更新保存的筛选' : '筛选已保存'));
  } catch (error) {
    toast(uiText(`筛选保存失败：${error?.message || '无法保存设置'}`));
  } finally {
    syncFilterControls();
  }
});

/* ---------- 范围聚焦（统计卡点击，票02） ---------- */

const DR = window.DRStats;

/* ---------- 近期总结（仅宽屏） ---------- */

const weeklyWorkbench = $('#recent-summary-panel');
let updateWorkbenchThumb = () => false;
let closureThinkingTimer = null;

// 事件委托绑定在稳定的父节点上，卡片刷新时不会丢失展开/收起操作。
weeklyWorkbench.addEventListener('click', event => {
  const toggle = event.target?.closest?.('.closure-thinking-toggle');
  if (!toggle || !weeklyWorkbench.contains(toggle)) return;
  const thinking = state.workbench.closure.thinking;
  if (!thinking?.visible) return;
  thinking.open = !thinking.open;
  renderWeeklyWorkbench();
});

function wbNode(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function workbenchWeekBounds(now = Date.now()) {
  const monday = new Date(DR.weekStart(now));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return { start: dateStringFromDate(monday), end: dateStringFromDate(sunday) };
}

const closureAutoRefreshApi = window.DRClosureAutoRefresh;
const closureAutoRefreshDefaults = closureAutoRefreshApi.DEFAULTS;

function closurePeriodKey(bounds = workbenchWeekBounds()) {
  return `week|${bounds.start}|${bounds.end}`;
}

function isClosureWorkbenchVisible() {
  const focused = typeof document.hasFocus !== 'function' || document.hasFocus();
  return !!weeklyWorkbench
    && !weeklyWorkbench.hidden
    && !viewMain.hidden
    && document.visibilityState !== 'hidden'
    && !document.hidden
    && focused;
}

const closureAutoRefresh = closureAutoRefreshApi.createClosureAutoRefresh({
  onDue: () => {
    // 可见性可能在定时器触发前已经改变，最后一层保护避免后台启动新请求。
    if (isClosureWorkbenchVisible()) generateWorkbenchClosure(false, { automatic: true });
  }
});

function syncClosureAutoRefresh(reason = 'source-change', schedule = true) {
  const closure = state.workbench.closure;
  const bounds = workbenchWeekBounds();
  const periodKey = closurePeriodKey(bounds);
  closure.periodKey = periodKey;
  closureAutoRefresh.update({
    enabled: !!state.settings?.ai?.configured
      && !state.terminologyDiscovery.running
      && !aiConnectionChecking,
    visible: isClosureWorkbenchVisible(),
    hasRecentSources: closure.recentCount > 0,
    cacheStatus: closure.cacheStatus,
    periodKey
  });
  if (!schedule) {
    closureAutoRefresh.cancel();
    return;
  }
  const delayByReason = {
    startup: closureAutoRefreshDefaults.startupDelayMs,
    'source-change': closureAutoRefreshDefaults.debounceMs,
    'configuration-change': closureAutoRefreshDefaults.debounceMs,
    visible: 0,
    'period-change': 0,
    retry: 0,
    'post-generation': 0
  };
  closureAutoRefresh.request({
    reason,
    delayMs: delayByReason[reason] ?? closureAutoRefreshDefaults.debounceMs
  });
}

function workbenchHeader(kicker, title, reportInfo) {
  const head = wbNode('div', 'wb-head');
  const copy = wbNode('div', 'wb-head-copy');
  copy.append(wbNode('div', 'wb-kicker', uiText(kicker)), wbNode('div', 'wb-title', uiText(title)));
  const status = wbNode('span', `wb-status${reportInfo.className ? ` ${reportInfo.className}` : ''}`, uiText(reportInfo.label));
  head.append(copy, status);
  return head;
}

function closureSuggestionKey(item) {
  return `${String(item?.canonical_name || '').trim().toLocaleLowerCase()}|${String(item?.alias || '').trim().toLocaleLowerCase()}`;
}

function closureItems(data = state.workbench.closure.data) {
  if (!data) return [];
  const completed = Array.isArray(data.completed_items)
    ? data.completed_items.map(item => ({ ...item, kind: 'closed' }))
    : [];
  const direct = Array.isArray(data.recent_explicit_completions)
    ? data.recent_explicit_completions.map(item => ({ ...item, kind: 'recent' }))
    : [];
  return [...completed, ...direct];
}

function closureWorkbenchInfo() {
  const closure = state.workbench.closure;
  if (closure.generating) return { label: '正在分析', className: '', detail: closure.progressNote || '正在对照历史记录和本期记录…' };
  if (!state.settings?.ai?.configured) return { label: '未配置 AI', className: 'muted', detail: '配置 AI 后，这里可以识别近期出现的工作闭环。' };
  if (closure.loading) return { label: '正在读取', className: '', detail: '正在读取本周已经保存的闭环结果…' };
  if (closure.error) return { label: '分析失败', className: 'warn', detail: closure.error };
  if (!closure.data) return { label: '尚未整理', className: 'muted', detail: '只对照近期记录和历史记录，不代表整个项目的完整进度。' };
  const status = closure.cacheStatus;
  if (status === 'fresh') return { label: '闭环已同步', className: 'ok', detail: '当前周期记录、术语和闭环提示词未变化。' };
  const statusText = {
    'source-changed': '当前周期或历史记录发生变化，建议更新近期闭环。',
    'terminology-changed': '术语规范已变化，建议更新近期闭环。',
    'prompt-changed': '闭环提示词已变化，建议更新近期闭环。',
    unknown: '这是历史闭环结果，建议重新分析确认。'
  }[status] || '当前显示历史闭环结果，建议更新。';
  return { label: '待更新', className: 'warn', detail: statusText };
}

function closureThinkingStatus(thinking) {
  const elapsed = thinking.startedAt
    ? ` · ${thinkingState.elapsedSeconds(thinking)}s`
    : '';
  const segment = thinking.totalSegments > 1 && thinking.segment
    ? ` · 第 ${thinking.segment}/${thinking.totalSegments} 批`
    : '';
  const received = thinking.reasoningLength > 0 ? ` · 已收到 ${thinking.reasoningLength} 字` : '';
  if (thinking.phase === 'segment') return uiText(`准备分析${segment}${elapsed}`);
  if (thinking.phase === 'thinking') return uiText(`AI 正在思考${segment}${received}${elapsed}`);
  if (thinking.phase === 'writing') return uiText(`正在整理结果${segment}${elapsed}`);
  if (thinking.phase === 'continuing') return uiText(`正在续写结构化结果${segment}${elapsed}`);
  if (thinking.phase === 'recovering') return uiText(`正在恢复流式输出${segment}${elapsed}`);
  if (thinking.phase === 'fallback') return uiText(`正在切换兼容模式${segment}${elapsed}`);
  if (thinking.phase === 'segment-done') return uiText(`已完成批次对照${segment}${elapsed}`);
  if (thinking.phase === 'saved' || thinking.phase === 'done') return uiText(`已完成${elapsed}`);
  if (thinking.phase === 'error') return uiText('分析失败');
  return uiText(`AI 正在处理${segment}${elapsed}`);
}

function syncClosureThinkingNode(box) {
  if (!box) return false;
  const closure = state.workbench.closure;
  const thinking = closure.thinking;
  const toggle = box.querySelector('.closure-thinking-toggle');
  const status = box.querySelector('.report-thinking-status');
  const note = box.querySelector('.report-thinking-note');
  const content = box.querySelector('.report-thinking-content');
  if (!thinking?.visible || !toggle || !status || !note || !content) return false;

  toggle.textContent = uiText(thinking.open ? '收起详细过程' : '查看详细过程');
  toggle.setAttribute('aria-expanded', String(thinking.open));
  status.textContent = closureThinkingStatus(thinking);
  note.textContent = uiText(thinking.progressNote
    || '实时状态代表实际生成进度；详细过程仅用于查看，不会写入总结或导出文件。');
  content.hidden = !thinking.open;

  const blocks = [];
  if (thinking.progressNote) blocks.push(`${uiText('进度：')}${uiText(thinking.progressNote)}`);
  if (thinkingTextMatchesLocale(thinking) && thinking.text) blocks.push(`${uiText('思考过程：')}\n${thinking.text}`);
  if (thinking.text && !thinkingTextMatchesLocale(thinking)) {
    blocks.push(uiText('当前语言与本次 AI 过程的生成语言不同，已隐藏原始思考文本。'));
  }
  if (!thinking.text && !closure.generating && ['saved', 'done'].includes(thinking.phase)) {
    blocks.push(uiText('本次分析没有返回可展示的思考文本；结果仍按记录对照生成。'));
  }
  content.textContent = blocks.join('\n\n');
  if (thinking.open) {
    requestAnimationFrame(() => {
      if (content.isConnected) content.scrollTop = content.scrollHeight;
    });
  }
  return true;
}

function renderClosureThinking() {
  const closure = state.workbench.closure;
  const thinking = closure.thinking;
  if (!thinking?.visible) return null;

  const box = wbNode('div', 'wb-closure-thinking');
  const head = wbNode('div', 'report-thinking-head');
  const title = wbNode('span', 'report-thinking-title', uiText('AI 工作过程'));
  const status = wbNode('span', 'report-thinking-status', closureThinkingStatus(thinking));
  const toggle = wbNode('button', 'link-btn closure-thinking-toggle', uiText(thinking.open ? '收起详细过程' : '查看详细过程'));
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', String(thinking.open));
  head.append(title, status, toggle);

  const note = wbNode('div', 'report-thinking-note');
  const content = wbNode('pre', 'report-thinking-content');
  box.append(head, note, content);
  syncClosureThinkingNode(box);
  return box;
}

function appendClosureEvidence(parent, evidence, label, limit = 2) {
  const list = Array.isArray(evidence) ? evidence.slice(0, limit) : [];
  if (!list.length) return;
  const box = wbNode('div', 'wb-closure-evidence');
  box.appendChild(wbNode('div', 'wb-closure-evidence-label', label));
  for (const source of list) {
    const row = wbNode('div', 'wb-closure-evidence-row');
    const when = [source.date, source.time].filter(Boolean).join(' ');
    row.append(wbNode('span', 'wb-closure-evidence-time', when || uiText('记录')), wbNode('span', 'wb-closure-evidence-text', source.text || ''));
    box.appendChild(row);
  }
  parent.appendChild(box);
}

function renderClosureItem(item, compact = true) {
  const row = wbNode('article', `wb-closure-item${item.kind === 'recent' ? ' recent' : ''}`);
  const head = wbNode('div', 'wb-closure-item-head');
  head.appendChild(wbNode('div', 'wb-closure-item-title', item.title));
  head.appendChild(wbNode('span', 'wb-confidence', uiText(item.confidence === 'high' ? '较确定' : '需谨慎')));
  row.appendChild(head);
  row.appendChild(wbNode('div', 'wb-closure-item-summary', item.summary));
  const beforeCount = Array.isArray(item.before_evidence) ? item.before_evidence.length : (item.before_refs || []).length;
  const recentEvidence = item.recent_evidence || item.evidence;
  const recentCount = Array.isArray(recentEvidence) ? recentEvidence.length : (item.recent_refs || []).length;
  if (beforeCount || recentCount) {
    const counts = [];
    if (beforeCount) counts.push(uiText(`历史记录 ${beforeCount} 条`));
    if (recentCount) counts.push(uiText(`本期记录 ${recentCount} 条`));
    row.appendChild(wbNode('div', 'wb-closure-item-meta', counts.join(' · ')));
  }
  if (item.note) row.appendChild(wbNode('div', 'wb-closure-item-note', item.note));
  if (!compact) {
    appendClosureEvidence(row, item.before_evidence, uiText('历史记录'));
    appendClosureEvidence(row, recentEvidence, uiText('本期记录'));
  }
  return row;
}

function appendClosureSuggestions(parent, data, compact = true, withHeading = true) {
  const suggestions = (Array.isArray(data?.needs_confirmation) ? data.needs_confirmation : [])
    .filter(item => !state.workbench.closure.dismissedSuggestions.has(closureSuggestionKey(item)));
  if (!suggestions.length) return;
  const section = wbNode('div', 'wb-closure-suggestions');
  if (withHeading) section.appendChild(wbNode('div', 'wb-closure-section-title', uiText('待确认的叫法关联')));
  if (compact) {
    const note = wbNode('div', 'wb-closure-suggestion-note', uiText('AI 只在无法确定时提示，不会自动写入术语。'));
    section.appendChild(note);
  }
  for (const suggestion of suggestions.slice(0, compact ? 2 : 20)) {
    const box = wbNode('div', 'wb-closure-suggestion');
    const copy = wbNode('div', 'wb-closure-suggestion-copy');
    copy.appendChild(wbNode('div', 'wb-closure-suggestion-title', `${suggestion.alias} 可能对应 ${suggestion.canonical_name}`));
    copy.appendChild(wbNode('div', 'wb-closure-suggestion-reason', suggestion.reason));
    const actions = wbNode('div', 'wb-closure-suggestion-actions');
    const confirm = wbNode('button', 'link-btn', uiText('确认并记住'));
    confirm.type = 'button';
    confirm.addEventListener('click', () => confirmClosureSuggestion(suggestion));
    const dismiss = wbNode('button', 'link-btn', uiText('暂不处理'));
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => dismissClosureSuggestion(suggestion));
    actions.append(confirm, dismiss);
    box.append(copy, actions);
    section.appendChild(box);
  }
  parent.appendChild(section);
}

function renderWorkbenchClosureCard() {
  const info = closureWorkbenchInfo();
  const card = wbNode('section', 'wb-card wb-closure-card');
  card.append(workbenchHeader('近期总结', '最近完成了什么', info));
  card.appendChild(wbNode('div', 'wb-summary', uiText('只把历史记录中的待处理事项，与当前周期记录中的完成或阶段性结果做对照；未记录不等于未完成。')));

  const data = state.workbench.closure.data;
  const items = closureItems(data);
  const metrics = wbNode('div', 'wb-closure-metrics');
  metrics.append(
    wbNode('span', '', uiText(`识别 ${items.length} 项`))
  );
  card.appendChild(metrics);

  const thinking = renderClosureThinking();
  if (thinking) card.appendChild(thinking);

  if (state.workbench.closure.generating) {
    const progress = wbNode('div', 'wb-closure-progress');
    progress.appendChild(wbNode('span', 'wb-closure-spinner'));
    progress.appendChild(wbNode('span', '', uiText(state.workbench.closure.progressNote || '正在分析记录…')));
    card.appendChild(progress);
  } else if (items.length) {
    const list = wbNode('div', 'wb-closure-list');
    items.slice(0, 4).forEach(item => list.appendChild(renderClosureItem(item, true)));
    if (items.length > 4) list.appendChild(wbNode('div', 'wb-closure-more', uiText(`还有 ${items.length - 4} 项，打开完整结果查看`)));
    card.appendChild(list);
  } else {
    card.appendChild(wbNode('div', 'wb-empty', uiText(data ? '当前记录中暂未识别出明确的近期闭环。可以重新分析，或继续保持自然记录。' : '生成后会显示“历史提及过、近期又出现完成结果”的事项。')));
  }
  const actions = wbNode('div', 'wb-closure-actions');
  const generate = wbNode('button', `wb-action${data && info.className !== 'warn' ? '' : ' primary'}`, uiText(data ? (info.className === 'warn' ? '更新近期闭环' : '重新分析闭环') : '分析近期闭环'));
  generate.type = 'button';
  generate.disabled = !state.settings?.ai?.configured || state.workbench.closure.generating;
  generate.addEventListener('click', () => generateWorkbenchClosure(info.className !== 'warn' && !!data));
  actions.appendChild(generate);
  if (data) {
    const view = wbNode('button', 'wb-action', uiText('查看完整结果'));
    view.type = 'button';
    view.addEventListener('click', openClosureModal);
    actions.appendChild(view);
  }
  card.appendChild(actions);
  return card;
}

function renderWeeklyWorkbench({ force = false } = {}) {
  if (!weeklyWorkbench) return;
  const closure = state.workbench.closure;
  const card = weeklyWorkbench.querySelector('.wb-closure-card');
  const livePlan = reportLifecycle.liveRenderStrategy({
    generating: closure.generating,
    hasExistingCard: !!card,
    hasThinking: !!card?.querySelector('.wb-closure-thinking'),
    hasProgress: !!card?.querySelector('.wb-closure-progress')
  });
  if (!force && livePlan === 'patch') {
    const thinkingPatched = syncClosureThinkingNode(card.querySelector('.wb-closure-thinking'));
    const progressText = card.querySelector('.wb-closure-progress')?.children?.[1];
    if (progressText) progressText.textContent = uiText(closure.progressNote || '正在分析记录…');
    if (thinkingPatched) {
      updateWorkbenchThumb();
      return;
    }
  }
  weeklyWorkbench.innerHTML = '';
  weeklyWorkbench.appendChild(renderWorkbenchClosureCard());
  updateWorkbenchThumb();
}

function syncWeeklyWorkbenchViewport() {
  const wasVisible = isClosureWorkbenchVisible();
  const wide = window.matchMedia('(min-width: 1200px)').matches;
  const visible = wide && !viewMain.hidden;
  weeklyWorkbench.hidden = !visible;
  updateWorkbenchThumb();
  const visibleNow = isClosureWorkbenchVisible();
  closureAutoRefresh.update({ visible: visibleNow });
  if (visibleNow && !wasVisible) resumeVisibleClosureAutomation('visible');
}

window.addEventListener('resize', syncWeeklyWorkbenchViewport);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) closureAutoRefresh.update({ visible: false });
  else resumeVisibleClosureAutomation('visible');
});
window.addEventListener('blur', () => closureAutoRefresh.update({ visible: false }));
window.addEventListener('focus', () => resumeVisibleClosureAutomation('visible'));

let workbenchClosureRequestId = 0;

async function loadWorkbenchClosure({
  preserveThinking = true,
  autoReason = 'source-change',
  schedule = true
} = {}) {
  const requestId = ++workbenchClosureRequestId;
  const closure = state.workbench.closure;
  if (closure.generating) return;
  closureAutoRefresh.cancel();
  closure.thinking = preserveThinking
    ? thinkingState.preserveThinking(closure.thinking)
    : createClosureThinking();
  if (!state.settings?.ai?.configured) {
    closure.data = null;
    closure.cacheStatus = 'missing';
    closure.recentCount = 0;
    closure.historicalCount = 0;
    closure.loading = false;
    closure.error = '';
    closure.progressNote = '';
    syncClosureAutoRefresh(autoReason, false);
    renderTerminologyUI();
    renderWeeklyWorkbench();
    return;
  }
  const bounds = workbenchWeekBounds();
  closure.periodKey = closurePeriodKey(bounds);
  closure.loading = true;
  closure.error = '';
  renderWeeklyWorkbench();
  let loaded = false;
  try {
    const res = await window.api.getCachedClosure({
      start: bounds.start,
      end: bounds.end,
      periodType: 'week'
    });
    if (requestId !== workbenchClosureRequestId) return;
    if (!res.ok) throw new Error(res.error || '无法读取近期闭环');
    closure.data = res.summary || null;
    closure.cacheStatus = res.cacheStatus || 'missing';
    closure.recentCount = Number(res.recentCount) || 0;
    closure.historicalCount = Number(res.historicalCount) || 0;
    closure.progressNote = '';
    loaded = true;
  } catch (error) {
    if (requestId !== workbenchClosureRequestId) return;
    closure.data = null;
    closure.cacheStatus = 'missing';
    closure.recentCount = 0;
    closure.historicalCount = 0;
    closure.error = error?.message || '无法读取近期闭环';
  } finally {
    if (requestId === workbenchClosureRequestId) {
      closure.loading = false;
      renderTerminologyUI();
      renderWeeklyWorkbench();
      syncClosureAutoRefresh(loaded ? autoReason : 'load-error', loaded && schedule);
    }
  }
}

async function generateWorkbenchClosure(force = false, { automatic = false } = {}) {
  const closure = state.workbench.closure;
  if (closure.generating) return;
  if (automatic && !isClosureWorkbenchVisible()) return;
  if (!state.settings?.ai?.configured) {
    if (!automatic) toast(uiText('请先到设置中连接 AI'));
    return;
  }
  const bounds = workbenchWeekBounds();
  closureAutoRefresh.beginAttempt(closurePeriodKey(bounds));
  closure.generating = true;
  closure.error = '';
  closure.progressNote = '正在连接 AI，准备对照历史记录…';
  closure.thinking = createClosureThinking(true);
  closure.thinking.progressNote = closure.progressNote;
  clearInterval(closureThinkingTimer);
  closureThinkingTimer = setInterval(() => renderWeeklyWorkbench(), 1000);
  renderWeeklyWorkbench();
  let completed = false;
  try {
    const res = await window.api.generateRecentClosures({
      start: bounds.start,
      end: bounds.end,
      periodType: 'week',
      force
    });
    if (!res.ok) throw new Error(res.error || '近期闭环生成失败');
    closure.data = res.summary || null;
    closure.cacheStatus = res.cacheStatus || 'fresh';
    closure.error = '';
    closure.progressNote = '近期闭环已保存。';
    closure.thinking = thinkingState.finalizeThinkingState(closure.thinking, 'saved');
    closure.thinking.progressNote = '近期闭环已保存；详细过程默认收起。';
    completed = true;
    if (!automatic) toast(uiText(res.cached ? '已读取已保存的近期闭环' : '近期闭环已生成'));
  } catch (error) {
    closure.error = error?.message || '近期闭环生成失败';
    closure.thinking = thinkingState.finalizeThinkingState(closure.thinking, 'error');
    closure.thinking.progressNote = closure.error;
    if (!automatic) toast(uiText(closure.error));
  } finally {
    clearInterval(closureThinkingTimer);
    closureThinkingTimer = null;
    closure.generating = false;
    closureAutoRefresh.endAttempt();
    renderWeeklyWorkbench();
    if (completed) {
      await loadWorkbenchClosure({ preserveThinking: true, autoReason: 'post-generation' });
    } else {
      syncClosureAutoRefresh('retry');
    }
  }
}

let visibleClosureAutomationRequest = null;

function resumeVisibleClosureAutomation(reason = 'visible') {
  if (!state.settings || !isClosureWorkbenchVisible()) return Promise.resolve(null);
  if (visibleClosureAutomationRequest) return visibleClosureAutomationRequest;

  const request = Promise.resolve()
    .then(() => ensureTerminologyDiscovery())
    .then(discovery => discovery || null)
    .then(() => {
      if (!isClosureWorkbenchVisible()) return null;
      return loadWorkbenchClosure({
        preserveThinking: true,
        autoReason: reason,
        schedule: true
      });
    })
    .finally(() => {
      if (visibleClosureAutomationRequest === request) visibleClosureAutomationRequest = null;
    });
  visibleClosureAutomationRequest = request;
  return request;
}

function renderClosureModal() {
  const data = state.workbench.closure.data;
  if (!data) return;
  closureModalNote.textContent = uiText(`只基于 ${data.start} 至 ${data.end} 的本期记录和历史记录做前后对照；历史记录不完整时不会推断项目整体状态。`);
  closureModalContent.innerHTML = '';
  const items = closureItems(data);
  if (items.length) {
    const title = wbNode('div', 'closure-modal-section-title', uiText(`识别到 ${items.length} 项近期完成或阶段性闭环`));
    closureModalContent.appendChild(title);
    items.forEach(item => closureModalContent.appendChild(renderClosureItem(item, false)));
  } else {
    closureModalContent.appendChild(wbNode('div', 'wb-empty', uiText('当前记录中暂未识别出明确的近期闭环。')));
  }
}

function openClosureModal() {
  if (!state.workbench.closure.data) return;
  renderClosureModal();
  closureModal.hidden = false;
}

function closeClosureModal() {
  closureModal.hidden = true;
}

function confirmClosureSuggestion(suggestion) {
  return (async () => {
    const term = (state.settings?.terminology || []).find(item => item.canonicalName === suggestion.canonical_name);
    const res = await window.api.addTerminologyAlias(
      suggestion.canonical_name,
      suggestion.alias,
      term?.scope || ''
    );
    if (!res.ok) { toast(uiText(res.error || '术语别名保存失败')); return; }
    if (state.settings) {
      state.settings.terminology = res.terminology || [];
      if (state.settings.terminologyDiscovery) state.settings.terminologyDiscovery.termCount = state.settings.terminology.length;
    }
    if (state.workbench.closure.data) {
      state.workbench.closure.data = {
        ...state.workbench.closure.data,
        needs_confirmation: (state.workbench.closure.data.needs_confirmation || [])
          .filter(item => closureSuggestionKey(item) !== closureSuggestionKey(suggestion))
      };
    }
    state.workbench.closure.cacheStatus = 'terminology-changed';
    state.workbench.closure.dismissedSuggestions.delete(closureSuggestionKey(suggestion));
    renderTerminologyUI();
    if (!closureModal.hidden) renderClosureModal();
    renderWeeklyWorkbench();
    toast(uiText(`已记住：${suggestion.alias} → ${suggestion.canonical_name}`));
  })();
}

function dismissClosureSuggestion(suggestion) {
  state.workbench.closure.dismissedSuggestions.add(closureSuggestionKey(suggestion));
  renderTerminologyUI();
  if (!closureModal.hidden) renderClosureModal();
  renderWeeklyWorkbench();
}

closureModalClose.addEventListener('click', closeClosureModal);
closureModal.addEventListener('click', event => {
  if (event.target === closureModal) closeClosureModal();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !closureModal.hidden) closeClosureModal();
});

window.api.onClosureProgress(progress => {
  const closure = state.workbench.closure;
  if (!closure.generating || !progress) return;
  let thinking = closure.thinking || createClosureThinking(true);
  if (!thinking.visible) thinking.visible = true;
  if (progress.phase === 'segment') {
    thinking.phase = 'segment';
    closure.progressNote = `正在分析历史记录第 ${progress.segment || 1}/${progress.totalSegments || 1} 批…`;
  } else if (progress.phase === 'thinking') {
    thinking.phase = 'thinking';
    closure.progressNote = `AI 正在判断历史记录与本期记录的语义关系（第 ${progress.segment || 1}/${progress.totalSegments || 1} 批）…`;
  } else if (progress.phase === 'writing') {
    thinking.phase = 'writing';
    closure.progressNote = `正在整理第 ${progress.segment || 1}/${progress.totalSegments || 1} 批结构化结果…`;
  } else if (progress.phase === 'continuing' || progress.phase === 'recovering') {
    thinking.phase = progress.phase;
    closure.progressNote = '正在继续整理闭环结果…';
  } else if (progress.phase === 'fallback') {
    thinking.phase = 'fallback';
    closure.progressNote = '正在继续分析闭环结果…';
  } else if (progress.phase === 'segment-done') {
    thinking.phase = 'segment-done';
    closure.progressNote = `已完成第 ${progress.segment || 1}/${progress.totalSegments || 1} 批历史对照…`;
  } else if (progress.phase === 'saved') {
    thinking.phase = 'saved';
    closure.progressNote = '近期闭环已保存。';
  } else if (progress.phase === 'error') {
    thinking.phase = 'error';
    closure.error = progress.error || '近期闭环生成失败';
    closure.progressNote = closure.error;
  }
  closure.thinking = thinkingState.appendThinkingProgress(thinking, {
    ...progress,
    text: progress.phase === 'thinking' ? progress.text : ''
  });
  closure.thinking.progressNote = closure.progressNote;
  renderWeeklyWorkbench();
});

syncWeeklyWorkbenchViewport();

// range 为 null 表示切换/取消当前聚焦
function setRangeFocus(range) {
  const same = JSON.stringify(state.rangeFocus) === JSON.stringify(range);
  state.rangeFocus = same ? { type: 'all' } : range;
  // 互斥（ADR-0003）：聚焦时复位年/月下拉
  if (state.rangeFocus.type !== 'all') {
    state.filter.year = 'all';
    state.filter.month = 'all';
    fYear.value = 'all';
    fMonth.value = 'all';
    syncCustomSelect(fYear);
    syncCustomSelect(fMonth);
  }
  renderRangeChip();
  renderList();
}

const rangeChip = document.createElement('button');
rangeChip.className = 'range-chip';
rangeChip.style.display = 'none';
rangeChip.addEventListener('click', () => setRangeFocus({ type: 'all' }));

function renderRangeChip() {
  const label = DR.rangeLabel(state.rangeFocus);
  rangeChip.style.display = label ? '' : 'none';
  rangeChip.innerHTML = '';
  if (label) {
  rangeChip.append(uiText(label) + ' ');
    const x = document.createElement('span');
    x.className = 'chip-x';
    x.textContent = '×';
    rangeChip.appendChild(x);
  }
  syncDateFilterButton();
}

// 统计卡点击：今日/本周聚焦，累计=清除聚焦
function bindStatCardClicks() {
  const cards = statsStrip.querySelectorAll('.stat-card');
  const ranges = [{ type: 'day', day: null }, { type: 'week' }, { type: 'all' }];
  cards.forEach((card, i) => {
    card.classList.add('clickable');
    card.addEventListener('click', () => {
      const r = ranges[i];
      if (r.type === 'day') {
        setRangeFocus({ type: 'day', day: dateStr(Date.now()) });
      } else {
        setRangeFocus(r);
      }
    });
  });
}

/* ---------- 活动图（GitHub 风格工作量热力图） ---------- */

const activityChart = $('#activity-chart');

function heatmapLevel(count, max) {
  if (!count) return 0;
  if (max <= 1) return 4;
  return Math.max(1, Math.min(4, Math.ceil(count / max * 4)));
}

function renderHeatmapPanel(weeks) {
  const cells = weeks.flat();
  const max = Math.max(1, ...cells.map(cell => cell.count));
  const total = cells.reduce((sum, cell) => sum + cell.count, 0);
  const panel = document.createElement('section');
  panel.className = 'activity-panel heatmap-panel';

  const head = document.createElement('div');
  head.className = 'activity-head';
  const title = document.createElement('div');
  title.className = 'activity-title';
  title.textContent = uiText('工作量 · 近 26 周');
  const summary = document.createElement('span');
  summary.className = 'activity-summary';
  summary.textContent = uiText(`${total} 条记录`);
  const headMeta = document.createElement('div');
  headMeta.className = 'activity-head-meta';
  headMeta.appendChild(summary);
  head.append(title, headMeta);

  const body = document.createElement('div');
  body.className = 'activity-heatmap-body';
  const labels = document.createElement('div');
  labels.className = 'heatmap-weekdays';
  [0, 1, 2, 3, 4, 5, 6].forEach((dayIndex, index) => {
    const item = document.createElement('span');
    item.textContent = index % 2 === 0 ? localizedWeekday(dayIndex) : '';
    labels.appendChild(item);
  });

  const chart = document.createElement('div');
  chart.className = 'heatmap-chart';
  chart.style.setProperty('--heatmap-columns', String(weeks.length));
  const months = document.createElement('div');
  months.className = 'heatmap-months';
  months.style.setProperty('--heatmap-columns', String(weeks.length));
  let previousMonth = '';
  weeks.forEach((week, column) => {
    const label = document.createElement('span');
    const month = week[0].date.slice(0, 7);
    if (column === 0 || month !== previousMonth) label.textContent = localizedMonth(Number(month.slice(5)));
    previousMonth = month;
    months.appendChild(label);
  });

  const grid = document.createElement('div');
  grid.className = 'heatmap-grid';
  grid.style.setProperty('--heatmap-columns', String(weeks.length));
  const today = dateStr(Date.now());
  for (let row = 0; row < 7; row += 1) {
    for (let column = 0; column < weeks.length; column += 1) {
      const cell = weeks[column][row];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `heatmap-cell level-${heatmapLevel(cell.count, max)}`;
      button.title = `${cell.date} · ${uiText(`${cell.count} 条记录`)}`;
      button.setAttribute('aria-label', button.title);
      if (cell.date === today) button.classList.add('today');
      button.addEventListener('click', () => setRangeFocus({ type: 'day', day: cell.date }));
      grid.appendChild(button);
    }
  }
  chart.append(months, grid);
  body.append(labels, chart);

  const legend = document.createElement('div');
  legend.className = 'heatmap-legend';
  legend.append(uiText('少'));
  for (let level = 0; level <= 4; level += 1) {
    const sample = document.createElement('span');
    sample.className = `heatmap-cell level-${level}`;
    legend.appendChild(sample);
  }
  legend.append(uiText('多'));
  headMeta.prepend(legend);
  panel.append(head, body);
  return panel;
}

function renderHistogramPanel(days) {
  const max = Math.max(1, ...days.map(day => day.count));
  const total = days.reduce((sum, day) => sum + day.count, 0);
  const today = dateStr(Date.now());
  const panel = document.createElement('section');
  panel.className = 'activity-panel histogram-panel';

  const head = document.createElement('div');
  head.className = 'activity-head';
  const title = document.createElement('div');
  title.className = 'activity-title';
  title.textContent = uiText('趋势 · 近 14 天');
  const summary = document.createElement('span');
  summary.className = 'activity-summary';
  summary.textContent = uiText(`${total} 条记录`);
  head.append(title, summary);

  const bars = document.createElement('div');
  bars.className = 'activity-bars';
  days.forEach(day => {
    const column = document.createElement('button');
    column.type = 'button';
    column.className = 'activity-col';
    column.title = `${day.date} · ${uiText(`${day.count} 条`)}`;
    column.setAttribute('aria-label', column.title);
    if (day.date === today) column.classList.add('today');

    const bar = document.createElement('span');
    bar.className = 'activity-bar';
    bar.style.height = day.count === 0 ? '' : `${Math.round((day.count / max) * 100)}%`;
    if (day.count === 0) bar.classList.add('zero');

    const count = document.createElement('span');
    count.className = 'activity-count';
    count.textContent = day.count ? String(day.count) : '';

    const label = document.createElement('span');
    label.className = 'activity-date';
    label.textContent = String(Number(day.date.slice(8)));

    column.append(count, bar, label);
    column.addEventListener('click', () => setRangeFocus({ type: 'day', day: day.date }));
    bars.appendChild(column);
  });

  panel.append(head, bars);
  return panel;
}

function renderActivity() {
  const weeks = DR.heatmapWeeks(state.entries, Date.now(), 26);
  const days = DR.dayCounts(state.entries, Date.now(), 14);
  const panels = document.createElement('div');
  panels.className = 'activity-panels';
  panels.append(renderHeatmapPanel(weeks), renderHistogramPanel(days));
  activityChart.innerHTML = '';
  activityChart.appendChild(panels);
}

/* ---------- 历史列表 ---------- */

const listEl = $('#list-items');

function renderList() {
  const list = filteredEntries();
  syncFilterControls(list.length);
  listEl.innerHTML = '';
  listEl.classList.toggle('manage', state.manage);
  updateManageUI(list);

  if (!list.length) {
    const div = document.createElement('div');
    div.className = 'empty';
    const em = document.createElement('span');
    em.className = 'emoji';
    em.textContent = '📝';
    const tip = document.createElement('div');
    tip.className = 'tip';
    tip.textContent = uiText(state.entries.length
      ? (isFiltering() ? '当前筛选范围内没有记录' : '还没有记录')
      : '还没有记录，按 Alt+Shift+D 或在上方输入第一条');
    div.append(em, tip);
    listEl.appendChild(div);
    return;
  }

  const groups = new Map();
  for (const e of list) {
    const d = dateStr(e.ts);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(e);
  }
  const days = [...groups.keys()].sort((a, b) => b.localeCompare(a));
  for (const glist of groups.values()) glist.sort((a, b) => b.ts - a.ts || b.createdAt - a.createdAt);

  for (const day of days) {
    const items = groups.get(day);

    const dayEl = document.createElement('div');
    dayEl.className = 'day';

    const head = document.createElement('div');
    head.className = 'day-head';
    const dateSpan = document.createElement('span');
    dateSpan.className = 'day-date';
    const rel = relDayLabel(day);
    if (rel) {
      const r = document.createElement('span');
      r.className = 'rel';
      r.textContent = uiText(rel);
      dateSpan.appendChild(r);
    }
    dateSpan.append(`${day} ${localizedWeekday(day)}`);
    const count = document.createElement('span');
    count.className = 'day-count';
    count.textContent = uiText(`${items.length} 条`);
    head.append(dateSpan, count);

    const wrap = document.createElement('div');
    wrap.className = 'day-items';
    for (const e of items) wrap.appendChild(buildEntryEl(e));

    dayEl.append(head, wrap);
    listEl.appendChild(dayEl);
  }
}

function buildEntryEl(e) {
  const el = document.createElement('div');
  el.className = 'entry';
  el.dataset.id = e.id;

  if (state.manage) {
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'entry-check';
    check.checked = state.selected.has(e.id);
    check.addEventListener('change', () => {
      if (check.checked) state.selected.add(e.id);
      else state.selected.delete(e.id);
      updateManageUI();
    });
    el.appendChild(check);
  }

  const time = document.createElement('span');
  time.className = 'entry-time';
  time.textContent = timeStr(e.ts);

  const text = document.createElement('div');
  text.className = 'entry-text';
  text.textContent = e.text;

  el.append(time, text);

  if (!state.manage) {
    const actions = document.createElement('div');
    actions.className = 'entry-actions';

    const btnEdit = document.createElement('button');
    btnEdit.className = 'mini-btn';
    btnEdit.title = uiText('编辑');
    btnEdit.innerHTML = ICONS.pencil;
    btnEdit.onclick = () => startEdit(el, e);

    const btnDel = document.createElement('button');
    btnDel.className = 'mini-btn danger';
    btnDel.title = uiText('删除');
    btnDel.innerHTML = ICONS.trash;
    btnDel.onclick = () => removeEntry(e);

    actions.append(btnEdit, btnDel);
    el.appendChild(actions);
  }
  return el;
}

function startEdit(el, e) {
  el.classList.add('edit');
  el.innerHTML = '';

  const area = document.createElement('div');
  area.className = 'edit-area';

  const ta = document.createElement('textarea');
  ta.dataset.resizable = 'true';
  ta.value = e.text;

  const foot = document.createElement('div');
  foot.className = 'edit-foot';

  const tsInput = document.createElement('input');
  tsInput.type = 'datetime-local';
  tsInput.value = toLocalInputValue(e.ts);

  const spacer = document.createElement('span');
  spacer.className = 'spacer';

  const cancel = document.createElement('button');
  cancel.className = 'btn small';
  cancel.textContent = uiText('取消');
  cancel.onclick = renderList;

  const save = document.createElement('button');
  save.className = 'btn small primary';
  save.textContent = uiText('保存');
  save.onclick = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const ts = tsInput.value ? new Date(tsInput.value).getTime() : e.ts;
    await window.api.update(e.id, { text, ts });
    toast(uiText('已更新 ✓'));
    refresh();
  };

  foot.append(tsInput, spacer, cancel, save);
  area.append(ta, foot);
  installTextareaResizer(ta);
  el.appendChild(area);
  ta.focus();
  ta.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) save.click();
    if (ev.key === 'Escape') cancel.click();
  });
}

async function removeEntry(e) {
  await window.api.remove(e.id);
  refresh();
  toast(uiText('已删除 1 条记录'), {
    label: '撤销',
    fn: async () => { await window.api.add(e.text, e.ts); refresh(); }
  });
}

/* ---------- 批量管理 ---------- */

const btnManage = $('#btn-manage');
const manageBar = $('#manage-bar');
const mgCount = $('#mg-count');
const mgDelete = $('#mg-delete');
let armTimer = null;

btnManage.addEventListener('click', () => {
  closeMoreMenu();
  state.manage = true;
  state.selected.clear();
  renderList();
});

$('#mg-done').addEventListener('click', () => {
  state.manage = false;
  state.selected.clear();
  renderList();
});

$('#mg-selectall').addEventListener('click', () => {
  const ids = filteredEntries().map(e => e.id);
  const all = ids.length > 0 && ids.every(id => state.selected.has(id));
  if (all) ids.forEach(id => state.selected.delete(id));
  else ids.forEach(id => state.selected.add(id));
  renderList();
});

function disarmDelete() {
  mgDelete.classList.remove('armed');
  mgDelete.textContent = uiText('删除选中');
}

mgDelete.addEventListener('click', async () => {
  const n = state.selected.size;
  if (!n) { toast(uiText('请先勾选要删除的记录')); return; }
  if (!mgDelete.classList.contains('armed')) {
    mgDelete.classList.add('armed');
    mgDelete.textContent = uiText(`确认删除 ${n} 条`);
    clearTimeout(armTimer);
    armTimer = setTimeout(disarmDelete, 3000);
    return;
  }
  clearTimeout(armTimer);
  const res = await window.api.deleteMany([...state.selected]);
  state.selected.clear();
  disarmDelete();
  toast(uiText(`已删除 ${res.removed} 条`));
  refresh();
});

function updateManageUI() {
  manageBar.hidden = !state.manage;
  $('#list-toolbar').style.display = state.manage ? 'none' : '';
  btnManage.hidden = state.manage;
  mgCount.textContent = uiText(`已选 ${state.selected.size} 条`);
  if (state.selected.size === 0) disarmDelete();
}

/* ---------- 设置界面 ---------- */

const hkDisplay = $('#hk-display');
const hkMsg = $('#hk-msg');
const themeSeg = $('#theme-seg');
const themeFamilySelect = $('#theme-family-select');
const localeSelect = $('#set-locale');
const autoStart = $('#set-autostart');
const silentStart = $('#set-silent');
const rowSilent = $('#row-silentstart');
const aiKey = $('#ai-key');
const aiKeyToggle = $('#ai-key-toggle');
const aiModel = $('#ai-model');
const aiClosureModel = $('#ai-closure-model');
const aiReasoningEffort = $('#ai-reasoning-effort');
const aiClosureReasoningEffort = $('#ai-closure-reasoning-effort');
const aiStateBadge = $('#ai-state-badge');
const aiModelSub = $('#ai-model-sub');
const aiClosureModelSub = $('#ai-closure-model-sub');
const aiReasoningSub = $('#ai-reasoning-sub');
const aiClosureReasoningSub = $('#ai-closure-reasoning-sub');
const aiMsg = $('#ai-msg');
const aiSave = $('#ai-save');
const aiTest = $('#ai-test');
const aiEntryState = $('#ai-entry-state');
const templateSeg = $('#template-seg');
const templateText = $('#template-text');
const templateMsg = $('#template-msg');
const closurePromptText = $('#closure-prompt-text');
const closurePromptMsg = $('#closure-prompt-msg');
const terminologyPromptText = $('#terminology-prompt-text');
const terminologyPromptMsg = $('#terminology-prompt-msg');
const terminologyPromptSave = $('#terminology-prompt-save');
const terminologyPromptReset = $('#terminology-prompt-reset');
const terminologyDiscoveryStatus = $('#terminology-discovery-status');
const terminologyDiscover = $('#terminology-discover');
const terminologyThinking = $('#terminology-thinking');
const terminologyThinkingStatus = $('#terminology-thinking-status');
const terminologyThinkingToggle = $('#terminology-thinking-toggle');
const terminologyThinkingNote = $('#terminology-thinking-note');
const terminologyThinkingContent = $('#terminology-thinking-content');
const terminologyPending = $('#terminology-pending');
const terminologyPendingCount = $('#terminology-pending-count');
const terminologyPendingList = $('#terminology-pending-list');
const terminologyList = $('#terminology-list');
const terminologyListCount = $('#terminology-list-count');
const terminologySearch = $('#terminology-search');
const terminologySearchClear = $('#terminology-search-clear');
const terminologyEditorTitle = $('#terminology-editor-title');
const termCanonical = $('#term-canonical');
const termScope = $('#term-scope');
const termAliases = $('#term-aliases');
const termNote = $('#term-note');
const termMsg = $('#term-msg');
const termSave = $('#term-save');
const termCancel = $('#term-cancel');
let editingTerminologyId = '';
let templateType = 'week';
let terminologyDiscoveryRequest = null;
let terminologyThinkingTimer = null;
let aiStartupCheckPromise = null;
let aiStartupCheckCompleted = false;
let aiStartupCheckEpoch = 0;
let aiConnectionChecking = false;

const DEFAULT_TEMPLATES = {
  day: '请生成一份当天工作总结，按工作事项整理，说明完成内容、当前进展和需要关注的问题。语言简洁、事实准确，不要补充原始记录中没有的信息。',
  week: '请生成一份本周工作总结，优先按任务或工作主题归纳，包含本周完成、进行中事项、问题与风险、下一步计划。语言可以润色，但不得遗漏任何原始记录中的事实。',
  month: '请生成一份本月工作总结，按工作主题归纳主要进展、阶段性成果、问题与风险及下一阶段计划。保留具体任务细节，不要泛化或编造。',
  custom: '请按照用户指定的周期和模板生成工作总结。可以调整语言和结构，但必须保留所有原始记录中的事实、任务细节和时间线。'
};

const DEFAULT_CLOSURE_PROMPT = '请整理当前周期内近期完成或取得阶段性进展的工作闭环。优先把历史记录中的问题、测试或待处理事项，与当前周期记录中的解决、完成或验证结果对应起来。名称尽量使用术语规范中的规范名称；细分信息不明确时使用宏观表述。输出应简洁、事实准确，并保留历史依据和近期依据。';
const DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT = [
  '请从日报原文中识别“可能指向同一件事情”的不同叫法，并建立可供后续报告使用的术语对照。',
  '规范输出名称应当是记录中有证据支持、稳定且简洁的名称；常用说法必须保留用户在日报里实际使用过的原话、简称、口语、缩写、错写或新造词。',
  '只有在结合完整记录、产品上下文和任务动作后能够合理判断为同一事项时才合并，不能只因为字面相似就合并。',
  '同一个产品可能存在不同功率段、版本或子任务；如果细分信息没有被稳定、明确地记录，使用产品族或更宏观的规范名称，不要猜测具体功率段。',
  '不要总结项目进度，不要补充日报之外的背景，不要把仅仅相关但不是同一事项的词语放进同一组。',
  '如果没有足够证据形成可靠对照，可以返回空数组。'
].join('\n');

const EYE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/></svg>';
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 5.1A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.3 18.3 0 0 1-3.1 3.8"/><path d="M6.2 6.2C3.5 8.1 2 12 2 12s3.5 7 10 7a9.8 9.8 0 0 0 3.4-.6"/></svg>';

function renderAiKeyToggle(visible) {
  aiKeyToggle.innerHTML = visible ? EYE_OFF_ICON : EYE_ICON;
  aiKeyToggle.title = uiText(visible ? '隐藏 API Key' : '显示 API Key');
  aiKeyToggle.setAttribute('aria-label', aiKeyToggle.title);
}

function setMaskedAiKey(ai) {
  const configured = !!ai?.configured && !!ai?.maskedApiKey;
  aiKey.type = 'password';
  aiKey.value = configured ? ai.maskedApiKey : '';
  aiKey.dataset.masked = String(configured);
  aiKey.dataset.saved = String(configured);
  renderAiKeyToggle(false);
}

aiKey.addEventListener('focus', () => {
  if (aiKey.dataset.masked !== 'true') return;
  aiKey.value = '';
  aiKey.dataset.masked = 'false';
  aiKey.dataset.saved = 'true';
  renderAiKeyToggle(false);
});

aiKey.addEventListener('input', () => {
  aiKey.dataset.masked = 'false';
  aiKey.dataset.saved = 'false';
});

aiKey.addEventListener('blur', () => {
  if (!aiKey.value.trim() && state.settings?.ai?.configured) setMaskedAiKey(state.settings.ai);
});

aiKeyToggle.addEventListener('click', async () => {
  if (aiKey.dataset.masked === 'true' || (!aiKey.value && state.settings?.ai?.configured)) {
    const res = await window.api.revealAiKey();
    if (!res.ok) { toast(uiText(res.error || '无法读取 API Key')); return; }
    aiKey.value = res.apiKey;
    aiKey.type = 'text';
    aiKey.dataset.masked = 'false';
    aiKey.dataset.saved = 'true';
    renderAiKeyToggle(true);
    return;
  }
  const visible = aiKey.type !== 'password';
  aiKey.type = visible ? 'password' : 'text';
  renderAiKeyToggle(!visible);
});

function syncSilentRow() {
  // 常显 + 未开自启时置灰（避免"选项藏起来找不到"）
  rowSilent.classList.toggle('disabled', !autoStart.checked);
}

async function loadSettingsUI() {
  const s = await window.api.getSettings();
  if (window.DRI18n && s.locale) {
    // 即使当前 locale 值相同，也要等待外置语言包加载完成，避免首次启动时只显示内置回退文案。
    await window.DRI18n.setLocale(s.locale);
  }
  state.terminologyDiscovery.thinking = thinkingState.preserveThinking(state.terminologyDiscovery.thinking);
  state.settings = s;
  state.savedFilters = Array.isArray(s.savedFilters) ? s.savedFilters : [];
  renderSavedFilterOptions();
  hkDisplay.textContent = s.hotkey || uiText('未设置');
  $('#hotkey-tip').textContent = s.hotkey || '--';
  $('#set-datapath').textContent = s.dataFile;
  autoStart.checked = s.openAtLogin;
  silentStart.checked = !!s.silentStart;
  setMaskedAiKey(s.ai);
  syncAiSettingsUI(s.ai);
  syncTemplateUI();
  syncClosurePromptUI();
  syncTerminologyPromptUI();
  renderTerminologyUI();
  renderTerminologyDiscoveryUI();
  syncAiEntry();
  syncSilentRow();
  hkMsg.textContent = '';
  syncThemeSeg();
  syncThemeFamilySelect();
  if (localeSelect) {
    localeSelect.value = s.locale || 'zh-CN';
    syncCustomSelect(localeSelect);
  }
  refreshLocalizedViews();
  renderWeeklyWorkbench();
  loadWorkbenchClosure({ autoReason: 'startup', schedule: false });
  autoTestAiOnStartup().finally(() => {
    // 首次启动的连接检查结束后，只在近期闭环实际可见时启动后续 AI 任务。
    resumeVisibleClosureAutomation('startup');
  });
}

function refreshLocalizedViews() {
  const editingEntry = listEl?.querySelector('.entry.edit');
  renderTodayPanel();
  renderStats();
  renderActivity();
  buildMonthOptions();
  populateYearOptions();
  renderSavedFilterOptions();
  renderRangeChip();
  if (!editingEntry) renderList();
  else syncFilterControls();
  renderExportPreview();
  renderReportState();
  renderReportThinking();
  renderTerminologyUI();
  renderTerminologyDiscoveryUI();
  renderWeeklyWorkbench({ force: true });
  syncAiSettingsUI(state.settings?.ai);
  syncAiEntry();
  syncThemeSeg();
  syncThemeFamilySelect();
  syncSilentRow();
  window.DRI18n?.applyDocument();
  syncAllCustomSelects();
}

localeSelect?.addEventListener('change', async () => {
  const next = localeSelect.value;
  const res = await window.api.setSettings({ locale: next });
  if (!res?.ok) {
    toast(uiText(res?.error || '语言设置失败'));
    if (state.settings?.locale) {
      localeSelect.value = state.settings.locale;
      syncCustomSelect(localeSelect);
    }
    return;
  }
  if (res.settings) state.settings = res.settings;
});

window.api.onLocaleChanged?.(locale => {
  if (!locale || !window.DRI18n) return;
  window.DRI18n.setLocale(locale).then(() => {
    return window.api.getSettings().then(localizedSettings => {
      if (localizedSettings?.locale === locale) state.settings = localizedSettings;
      if (localeSelect) localeSelect.value = locale;
      // 语言包先更新原生选项，再刷新自定义下拉框的触发按钮和菜单文字。
      syncAllCustomSelects();
      // AI 提示词也按当前语言重新读取；这里只刷新当前语言的视图，
      // 不会把旧语言的用户自定义内容写到新语言中。
      syncTemplateUI();
      syncClosurePromptUI();
      syncTerminologyPromptUI();
      refreshLocalizedViews();
    });
  }).catch(() => {
    // 语言包读取失败时保留当前界面，不让切换语言影响主页面内容。
  });
});

function fillAiModelSelect(select, ai, selected) {
  const models = Array.isArray(ai?.models) ? ai.models : [];
  select.innerHTML = '';
  if (!models.length) {
    const o = document.createElement('option');
    o.value = selected || '';
    o.textContent = selected || uiText('请先测试连接');
    select.appendChild(o);
  } else {
    for (const model of models) {
      const o = document.createElement('option');
      o.value = model;
      o.textContent = model;
      select.appendChild(o);
    }
  }
  select.value = selected || '';
  select.disabled = !ai?.configured || !models.length;
  syncCustomSelect(select);
}

function syncAiModels(ai) {
  fillAiModelSelect(aiModel, ai, ai?.model || '');
  fillAiModelSelect(aiClosureModel, ai, ai?.closureModel || '');
}

function syncAiSettingsUI(ai = state.settings?.ai) {
  const configured = !!ai?.configured;
  const reasoningEffort = ['auto', 'low', 'high', 'max'].includes(ai?.reasoningEffort)
    ? ai.reasoningEffort
    : 'auto';
  const reasoningNotes = {
    auto: '自动：普通周期优先快速处理，长周期分段时自动提高；修改后仅影响下一次重新生成。',
    low: '快速：优先响应速度，适合简短日报；修改后仅影响下一次重新生成。',
    high: '标准：更适合周报、月报和需要归类的复杂总结；修改后仅影响下一次重新生成。',
    max: '深度：适合复杂总结，可能更慢、消耗更多；修改后仅影响下一次重新生成。'
  };
  const closureReasoningEffort = ['auto', 'low', 'high', 'max'].includes(ai?.closureReasoningEffort)
    ? ai.closureReasoningEffort
    : 'auto';
  const closureReasoningNotes = {
    auto: '自动：优先判断历史与近期记录的语义关系；仅影响下一次近期闭环生成。',
    low: '快速：适合记录较少的周期；仅影响下一次近期闭环生成。',
    high: '标准：适合叫法不一致、需要前后对照的闭环分析。',
    max: '深度：适合关系复杂的记录，可能更慢、消耗更多。'
  };
  const connectionLabel = !configured
    ? '未配置'
    : aiConnectionChecking
    ? '正在检查…'
    : ai.lastTestOk
    ? '已连接'
    : ai.lastError
    ? '连接失败'
    : '已配置';
  aiStateBadge.textContent = uiText(connectionLabel);
  aiStateBadge.classList.toggle('ok', configured && !!ai.lastTestOk);
  if (aiEntryState) {
    aiEntryState.textContent = uiText(connectionLabel);
    aiEntryState.classList.toggle('ok', configured && !!ai.lastTestOk);
  }
  aiModelSub.textContent = uiText(aiConnectionChecking
    ? '正在自动检查连接并读取当前可用模型…'
    : ai?.lastError
    || (ai?.lastTestAt
      ? `最近测试：${new Date(ai.lastTestAt).toLocaleString()}`
      : configured
      ? '已保存配置，软件启动时会自动检查连接'
      : '点击测试连接后自动读取当前可用模型'));
  aiClosureModelSub.textContent = uiText(ai?.closureModel
    ? `当前用于近期闭环；与周期报告模型独立。`
    : '测试连接后会自动选择更适合语义判断的模型；也可单独切换。');
  aiReasoningEffort.value = reasoningEffort;
  syncCustomSelect(aiReasoningEffort);
  aiReasoningSub.textContent = uiText(reasoningNotes[reasoningEffort]);
  aiClosureReasoningEffort.value = closureReasoningEffort;
  syncCustomSelect(aiClosureReasoningEffort);
  aiClosureReasoningSub.textContent = uiText(closureReasoningNotes[closureReasoningEffort]);
  syncAiModels(ai);
  if (aiTest) aiTest.disabled = aiConnectionChecking;
  aiMsg.textContent = '';
}

const aiNavItems = [...document.querySelectorAll('.ai-nav-item')];
const aiSettingsPanels = [...document.querySelectorAll('.ai-settings-panel')];

function setAiSettingsPanel(name) {
  for (const item of aiNavItems) {
    const active = item.dataset.aiPanel === name;
    item.classList.toggle('active', active);
    item.setAttribute('aria-selected', String(active));
  }
  for (const panel of aiSettingsPanels) panel.hidden = panel.dataset.aiPanel !== name;
}

for (const item of aiNavItems) {
  item.addEventListener('click', () => setAiSettingsPanel(item.dataset.aiPanel));
}

function syncTemplateUI() {
  const templates = state.settings?.reportTemplates || DEFAULT_TEMPLATES;
  for (const b of templateSeg.querySelectorAll('button[data-v]')) b.classList.toggle('active', b.dataset.v === templateType);
  templateText.value = templates[templateType] || DEFAULT_TEMPLATES[templateType];
  templateMsg.textContent = '';
}

function syncClosurePromptUI() {
  closurePromptText.value = state.settings?.closurePrompt || state.settings?.closurePromptDefault || DEFAULT_CLOSURE_PROMPT;
  closurePromptMsg.textContent = '';
  closurePromptMsg.className = 'set-msg';
}

function syncTerminologyPromptUI() {
  if (!terminologyPromptText) return;
  terminologyPromptText.value = state.settings?.terminologyDiscoveryPrompt
    || state.settings?.terminologyDiscoveryPromptDefault
    || DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT;
  terminologyPromptMsg.textContent = '';
  terminologyPromptMsg.className = 'set-msg';
}

function renderTerminologyThinking() {
  if (!terminologyThinking || !terminologyThinkingStatus || !terminologyThinkingToggle || !terminologyThinkingContent) return;
  const thinking = state.terminologyDiscovery.thinking || createTerminologyThinking();
  terminologyThinking.hidden = !thinking.visible;
  terminologyThinkingContent.hidden = !thinking.open;
  terminologyThinkingToggle.textContent = uiText(thinking.open ? '收起详细过程' : '查看详细过程');
  terminologyThinkingToggle.setAttribute('aria-expanded', String(thinking.open));
  terminologyThinkingNote.textContent = uiText(thinking.progressNote
    || '实时状态代表术语识别进度；详细过程默认收起，不会修改原始日报。');

  const elapsed = thinkingState.elapsedSeconds(thinking);
  const batchLabel = thinking.totalSegments > 1 && thinking.segment
    ? ` · 第 ${thinking.segment}/${thinking.totalSegments} 批`
    : '';
  const outputLength = thinking.content.length || thinking.contentLength;
  const outputLabel = outputLength > 0 ? ` · 已收到 ${outputLength} 字` : '';
  if (thinking.phase === 'segment') terminologyThinkingStatus.textContent = uiText(`准备识别日报${batchLabel} · ${elapsed}s`);
  else if (thinking.phase === 'thinking') terminologyThinkingStatus.textContent = uiText(`AI 正在思考${batchLabel} · ${elapsed}s`);
  else if (thinking.phase === 'writing') terminologyThinkingStatus.textContent = uiText(`正在整理 AI 输出${batchLabel}${outputLabel} · ${elapsed}s`);
  else if (thinking.phase === 'segment-done') terminologyThinkingStatus.textContent = uiText(`第 ${thinking.segment || 1} 批识别完成 · ${elapsed}s`);
  else if (thinking.phase === 'saved') terminologyThinkingStatus.textContent = uiText(`术语词典已保存 · ${elapsed}s`);
  else if (thinking.phase === 'error') terminologyThinkingStatus.textContent = uiText('识别失败');
  else terminologyThinkingStatus.textContent = uiText(`AI 正在处理${batchLabel} · ${elapsed}s`);

  const blocks = [];
  if (thinkingTextMatchesLocale(thinking) && thinking.text) blocks.push(`${uiText('思考过程：')}\n${thinking.text}`);
  if (thinkingTextMatchesLocale(thinking) && thinking.content) blocks.push(`${uiText('AI 输出：')}\n${thinking.content}`);
  if (thinking.text && !thinkingTextMatchesLocale(thinking)) {
    blocks.push(uiText('当前语言与本次 AI 过程的生成语言不同，已隐藏原始思考文本。'));
  }
  if (!blocks.length) {
    const waiting = ['segment', 'thinking', 'writing', 'continuing', 'recovering', 'fallback'].includes(thinking.phase);
    blocks.push(uiText(waiting
      ? '正在等待 AI 返回内容；返回后会在这里实时显示。'
      : thinking.phase === 'error'
        ? '本次未收到可展示的 AI 输出。'
        : '本次没有可展示的 AI 输出。'));
  }
  terminologyThinkingContent.textContent = blocks.join('\n\n');
  if (thinking.open) terminologyThinkingContent.scrollTop = terminologyThinkingContent.scrollHeight;
}

function renderTerminologyDiscoveryUI() {
  renderTerminologyThinking();
  if (!terminologyDiscoveryStatus || !terminologyDiscover) return;
  const discovery = state.settings?.terminologyDiscovery || {};
  const ui = state.terminologyDiscovery;
  const configured = !!state.settings?.ai?.configured;
  terminologyDiscover.disabled = !configured || ui.running;
  terminologyDiscover.textContent = uiText(discovery.initialized ? '重新识别并合并' : '识别全部日报');

  if (ui.running) {
    terminologyDiscoveryStatus.textContent = uiText(terminologyDiscoveryStatus.textContent);
    terminologyDiscoveryStatus.textContent = ui.note || '正在读取全部日报；不会修改原始记录。';
    terminologyDiscoveryStatus.textContent = uiText(terminologyDiscoveryStatus.textContent);
    return;
  }
  if (ui.error) {
    terminologyDiscoveryStatus.textContent = uiText(ui.error);
    return;
  }
  if (!configured) {
    terminologyDiscoveryStatus.textContent = '连接 AI 后自动开始；不会修改任何原始记录。';
    terminologyDiscoveryStatus.textContent = uiText(terminologyDiscoveryStatus.textContent);
    return;
  }
  if (discovery.initialized) {
    const when = discovery.lastRunAt ? new Date(discovery.lastRunAt).toLocaleString() : '已完成';
    terminologyDiscoveryStatus.textContent = `已读取 ${discovery.recordCount || 0} 条日报，形成 ${discovery.termCount || 0} 组术语；上次识别：${when}。可再次识别并合并。`;
    terminologyDiscoveryStatus.textContent = uiText(terminologyDiscoveryStatus.textContent);
    return;
  }
  terminologyDiscoveryStatus.textContent = uiText('连接已就绪，首次识别会读取全部日报；不会修改任何原始记录。');
}

async function discoverTerminology(force = false, { silent = false } = {}) {
  if (terminologyDiscoveryRequest) return terminologyDiscoveryRequest;
  if (!state.settings?.ai?.configured) return null;

  clearInterval(terminologyThinkingTimer);
  state.terminologyDiscovery.thinking = createTerminologyThinking(true);
  state.terminologyDiscovery.running = true;
  state.terminologyDiscovery.error = '';
  state.terminologyDiscovery.note = force ? '正在重新读取全部日报…' : '正在读取全部日报…';
  state.terminologyDiscovery.thinking.progressNote = state.terminologyDiscovery.note;
  renderTerminologyDiscoveryUI();
  terminologyThinkingTimer = setInterval(renderTerminologyThinking, 1000);

  const request = window.api.discoverTerminology({ force });
  terminologyDiscoveryRequest = request.then(res => {
    if (!res.ok) {
      state.terminologyDiscovery.error = res.error || '术语识别失败';
      state.terminologyDiscovery.note = '';
      state.terminologyDiscovery.thinking = thinkingState.finalizeThinkingState(
        state.terminologyDiscovery.thinking,
        'error'
      );
      state.terminologyDiscovery.thinking.progressNote = state.terminologyDiscovery.error;
      if (!silent) toast(uiText(state.terminologyDiscovery.error));
      return res;
    }
    if (state.settings) {
      if (res.ai) state.settings.ai = res.ai;
      state.settings.terminology = Array.isArray(res.terminology) ? res.terminology : [];
      state.settings.terminologyDiscovery = res.discovery || state.settings.terminologyDiscovery;
    }
    state.terminologyDiscovery.error = '';
    state.terminologyDiscovery.note = res.skipped
      ? '词典已经初始化，继续使用已保存的对照关系。'
      : `已完成全部日报识别，共形成 ${res.terminology?.length || 0} 组术语。`;
    state.terminologyDiscovery.thinking = thinkingState.finalizeThinkingState(
      state.terminologyDiscovery.thinking,
      'saved'
    );
    state.terminologyDiscovery.thinking.progressNote = res.skipped
      ? '词典已经初始化，继续使用已保存的对照关系；详细过程默认收起。'
      : '术语词典已保存；详细过程默认收起。';
    if (res.ai) {
      syncAiSettingsUI(res.ai);
      syncAiEntry();
    }
    renderTerminologyUI();
    renderTerminologyDiscoveryUI();
    if (!silent && !res.skipped) {
      toast(uiText(res.stats?.consolidationFallback
        ? '术语已识别；归并阶段暂未完成，候选结果已保留，可再次识别并合并'
        : `术语词典已更新，共 ${res.terminology?.length || 0} 组`));
    }
    return res;
  }).catch(error => {
    state.terminologyDiscovery.error = error?.message || '术语识别失败';
    state.terminologyDiscovery.note = '';
    state.terminologyDiscovery.thinking = thinkingState.finalizeThinkingState(
      state.terminologyDiscovery.thinking,
      'error'
    );
    state.terminologyDiscovery.thinking.progressNote = state.terminologyDiscovery.error;
    if (!silent) toast(uiText(state.terminologyDiscovery.error));
    return { ok: false, error: state.terminologyDiscovery.error };
  }).finally(() => {
    clearInterval(terminologyThinkingTimer);
    terminologyThinkingTimer = null;
    state.terminologyDiscovery.running = false;
    renderTerminologyDiscoveryUI();
    terminologyDiscoveryRequest = null;
  });
  return terminologyDiscoveryRequest;
}

function ensureTerminologyDiscovery() {
  if (
    !state.settings?.ai?.configured
    || state.settings?.terminologyDiscovery?.initialized
    || !isClosureWorkbenchVisible()
  ) {
    renderTerminologyDiscoveryUI();
    return null;
  }
  return discoverTerminology(false, { silent: true });
}

window.api.onTerminologyProgress(progress => {
  if (!state.terminologyDiscovery.running || !progress) return;
  const mappedPhase = {
    started: 'segment',
    extracting: 'segment',
    thinking: 'thinking',
    writing: 'writing',
    'batch-done': 'segment-done',
    consolidating: 'thinking',
    saved: 'saved',
    error: 'error'
  }[progress.phase] || progress.phase;
  let thinking = state.terminologyDiscovery.thinking || createTerminologyThinking(true);
  thinking = thinkingState.appendThinkingProgress(thinking, { ...progress, phase: mappedPhase });
  if (progress.phase === 'started') {
    state.terminologyDiscovery.note = `开始扫描全部 ${progress.recordCount || 0} 条日报…`;
  } else if (progress.phase === 'extracting') {
    state.terminologyDiscovery.note = `正在识别第 ${progress.batch || 1}/${progress.totalBatches || 1} 批日报…`;
  } else if (progress.phase === 'thinking') {
    state.terminologyDiscovery.note = `AI 正在分析第 ${progress.batch || 1}/${progress.totalBatches || 1} 批日报…`;
  } else if (progress.phase === 'writing') {
    state.terminologyDiscovery.note = `正在整理第 ${progress.batch || 1}/${progress.totalBatches || 1} 批 AI 输出…`;
  } else if (progress.phase === 'batch-done') {
    state.terminologyDiscovery.note = `已完成第 ${progress.batch || 1}/${progress.totalBatches || 1} 批，正在保留候选术语…`;
  } else if (progress.phase === 'consolidating') {
    state.terminologyDiscovery.note = '正在合并跨批次的同义叫法…';
  } else if (progress.phase === 'saved') {
    state.terminologyDiscovery.note = `词典已保存，共 ${progress.termCount || 0} 组术语。`;
  } else if (progress.phase === 'error') {
    state.terminologyDiscovery.error = progress.error || '术语识别失败';
  }
  thinking.reasoningLength = thinking.text.length;
  thinking.contentLength = thinking.content.length;
  thinking.progressNote = state.terminologyDiscovery.error || state.terminologyDiscovery.note;
  state.terminologyDiscovery.thinking = thinking;
  renderTerminologyDiscoveryUI();
});

function syncThemeSeg() {
  const active = state.settings ? state.settings.theme : 'auto';
  for (const b of themeSeg.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.v === active);
  }
}

function syncThemeFamilySelect() {
  const active = state.settings?.themeFamily || 'gold';
  if (!themeFamilySelect) return;
  themeFamilySelect.value = active;
  syncCustomSelect(themeFamilySelect);
}

themeSeg.addEventListener('click', async ev => {
  const btn = ev.target.closest('button[data-v]');
  if (!btn) return;
  const res = await window.api.setSettings({ theme: btn.dataset.v });
  if (res.ok && state.settings) state.settings.theme = btn.dataset.v;
  syncThemeSeg();
});

themeFamilySelect.addEventListener('change', async () => {
  const nextFamily = themeFamilySelect.value;
  const res = await window.api.setSettings({ themeFamily: nextFamily });
  if (res.ok && state.settings) state.settings.themeFamily = nextFamily;
  syncThemeFamilySelect();
});

autoStart.addEventListener('change', async () => {
  const res = await window.api.setSettings({ openAtLogin: autoStart.checked });
  if (!res.ok) { autoStart.checked = !autoStart.checked; toast(uiText(res.error || '设置失败')); }
  else {
    toast(uiText(autoStart.checked ? '将在开机时自动启动' : '已关闭开机自启'));
    syncSilentRow();
  }
});

silentStart.addEventListener('change', async () => {
  const res = await window.api.setSettings({ silentStart: silentStart.checked });
  if (!res.ok) { silentStart.checked = !silentStart.checked; toast(uiText(res.error || '设置失败')); }
  else toast(uiText(silentStart.checked ? '开机将静默驻留托盘' : '开机将显示主窗口'));
});

$('#set-openfolder').addEventListener('click', () => window.api.openDataFolder());

const dataMsg = $('#data-msg');
const dataBackup = $('#set-backup');
const dataRestore = $('#set-restore');

dataBackup.addEventListener('click', async () => {
  if (dataBackup.disabled) return;
  dataBackup.disabled = true;
  dataMsg.className = 'set-msg';
  dataMsg.textContent = uiText('正在整理日报、总结和设置…');
  try {
    const res = await window.api.exportBackup();
    if (!res.ok) {
      dataMsg.textContent = res.canceled ? '' : uiText(res.error || '备份导出失败');
      return;
    }
    dataMsg.className = 'set-msg success';
    dataMsg.textContent = uiText(`备份已导出：${res.summary.entries} 条记录，${res.summary.reports} 份总结，${res.summary.closureSummaries || 0} 份闭环结果`);
    toast(uiText('完整备份已导出'));
  } catch (error) {
    dataMsg.textContent = uiText(`备份导出失败：${error?.message || '无法连接本地数据服务'}`);
  } finally {
    dataBackup.disabled = false;
  }
});

dataRestore.addEventListener('click', async () => {
  if (dataRestore.disabled) return;
  if (reportGenerationManager.hasActiveJobs()) {
    dataMsg.textContent = uiText('AI 总结正在生成，请完成后再恢复备份。');
    return;
  }
  const confirmed = await askConfirmation(
    '恢复备份会替换当前日报、周期总结、近期闭环、模板、术语和筛选配置。恢复前软件会自动生成一份安全备份，确定继续吗？',
    { title: '恢复备份', confirmLabel: '继续恢复', danger: true }
  );
  if (!confirmed) return;
  dataRestore.disabled = true;
  dataMsg.className = 'set-msg';
  dataMsg.textContent = uiText('正在校验并恢复备份…');
  try {
    const res = await window.api.restoreBackup();
    if (!res.ok) {
      dataMsg.textContent = res.canceled ? '' : uiText(res.error || '备份恢复失败');
      return;
    }
    state.manage = false;
    state.selected.clear();
    state.report.data = null;
    state.report.cacheStatus = 'missing';
    state.report.editing = false;
    reportGenerationManager.reset();
    reportThinkingCache.clear();
    hideReportThinking();
    state.workbench.closure.data = null;
    state.workbench.closure.cacheStatus = 'missing';
    state.workbench.closure.error = '';
    state.workbench.closure.progressNote = '';
    state.workbench.closure.thinking = createClosureThinking();
    state.workbench.closure.dismissedSuggestions.clear();
    clearInterval(terminologyThinkingTimer);
    terminologyThinkingTimer = null;
    state.terminologyDiscovery.thinking = createTerminologyThinking();
    resetFilters();
    await loadSettingsUI();
    await refresh();
    dataMsg.className = 'set-msg success';
    dataMsg.textContent = uiText(`恢复完成：${res.summary.entries} 条记录，${res.summary.reports} 份总结；恢复前安全备份已自动保留。`);
    toast(uiText('备份已恢复'));
  } catch (error) {
    dataMsg.textContent = uiText(`备份恢复失败：${error?.message || '无法连接本地数据服务'}`);
  } finally {
    dataRestore.disabled = false;
  }
});

$('#ai-test').addEventListener('click', async () => {
  const button = $('#ai-test');
  button.disabled = true;
  aiMsg.className = 'set-msg';
  aiMsg.textContent = uiText('正在测试连接并读取模型…');
  const enteredKey = aiKey.dataset.masked === 'true' ? '' : aiKey.value.trim();
  const res = await window.api.testAi(enteredKey);
  button.disabled = false;
  if (!res.ok) {
    aiMsg.textContent = uiText(res.error || '连接失败');
    if (state.settings?.ai) state.settings.ai = res.ai || state.settings.ai;
    syncAiSettingsUI(state.settings?.ai);
    if (!aiKey.value.trim() || aiKey.dataset.masked === 'true') setMaskedAiKey(state.settings?.ai);
    syncAiEntry();
    return;
  }
  // 测试结果先留在当前页面，明确等用户点击“保存配置”后再落盘。
  state.settings.ai = { ...res.ai, configured: true };
  syncAiSettingsUI(state.settings.ai);
  syncAiEntry();
  loadWorkbenchClosure({ autoReason: 'configuration-change' });
  ensureTerminologyDiscovery();
  aiMsg.className = 'set-msg success';
  aiMsg.textContent = uiText(res.modelChanged || res.closureModelChanged
    ? `连接成功，周期报告模型：${res.ai.model}；闭环模型：${res.ai.closureModel}，请保存配置`
    : `连接成功，发现 ${res.ai.models.length} 个可用模型，请保存配置`);
  toast(uiText('连接成功，请保存配置'));
});

aiSave.addEventListener('click', async () => {
  aiSave.disabled = true;
  aiMsg.className = 'set-msg';
  aiMsg.textContent = uiText('正在保存 AI 配置…');
  const enteredKey = aiKey.dataset.masked === 'true' ? '' : aiKey.value.trim();
  const res = await window.api.saveAi(enteredKey);
  aiSave.disabled = false;
  if (!res.ok) {
    aiMsg.textContent = uiText(res.error || 'AI 配置保存失败');
    return;
  }
  state.settings.ai = res.ai;
  setMaskedAiKey(res.ai);
  syncAiSettingsUI(res.ai);
  syncAiEntry();
  loadWorkbenchClosure({ autoReason: 'configuration-change' });
  ensureTerminologyDiscovery();
  aiMsg.className = 'set-msg success';
  aiMsg.textContent = uiText('AI 配置已保存');
  toast(uiText('AI 配置已保存'));
});

aiModel.addEventListener('change', async () => {
  if (!aiModel.value || !state.settings?.ai) return;
  const res = await window.api.setAiModel(aiModel.value);
  if (res.ok) {
    state.settings.ai = res.ai;
    syncAiSettingsUI(res.ai);
    syncAiEntry();
    aiMsg.textContent = uiText('模型已更换，请重新测试连接');
  } else aiMsg.textContent = uiText(res.error || '模型更新失败');
});

aiClosureModel.addEventListener('change', async () => {
  if (!aiClosureModel.value || !state.settings?.ai) return;
  const res = await window.api.setAiClosureModel(aiClosureModel.value);
  if (res.ok) {
    state.settings.ai = res.ai;
    syncAiSettingsUI(res.ai);
    syncAiEntry();
    aiMsg.textContent = uiText('闭环模型已更换，请重新测试连接');
  } else aiMsg.textContent = uiText(res.error || '闭环模型更新失败');
});

aiReasoningEffort.addEventListener('change', async () => {
  if (!state.settings?.ai) return;
  const previous = ['auto', 'low', 'high', 'max'].includes(state.settings.ai.reasoningEffort)
    ? state.settings.ai.reasoningEffort
    : 'auto';
  const next = aiReasoningEffort.value;
  aiReasoningEffort.disabled = true;
  syncCustomSelect(aiReasoningEffort);
  const res = await window.api.setAiReasoningEffort(next);
  aiReasoningEffort.disabled = false;
  syncCustomSelect(aiReasoningEffort);
  if (!res.ok) {
    aiReasoningEffort.value = previous;
    syncCustomSelect(aiReasoningEffort);
    aiMsg.textContent = uiText(res.error || '思考强度保存失败');
    return;
  }
  state.settings.ai = res.ai;
  syncAiSettingsUI(res.ai);
  toast(uiText('思考强度已保存，仅影响下一次重新生成'));
});

aiClosureReasoningEffort.addEventListener('change', async () => {
  if (!state.settings?.ai) return;
  const previous = ['auto', 'low', 'high', 'max'].includes(state.settings.ai.closureReasoningEffort)
    ? state.settings.ai.closureReasoningEffort
    : 'auto';
  const next = aiClosureReasoningEffort.value;
  aiClosureReasoningEffort.disabled = true;
  syncCustomSelect(aiClosureReasoningEffort);
  const res = await window.api.setAiClosureReasoningEffort(next);
  aiClosureReasoningEffort.disabled = false;
  syncCustomSelect(aiClosureReasoningEffort);
  if (!res.ok) {
    aiClosureReasoningEffort.value = previous;
    syncCustomSelect(aiClosureReasoningEffort);
    aiMsg.textContent = uiText(res.error || '闭环思考强度保存失败');
    return;
  }
  state.settings.ai = res.ai;
  syncAiSettingsUI(res.ai);
  toast(uiText('闭环思考强度已保存，仅影响下一次近期闭环生成'));
});

$('#ai-clear').addEventListener('click', async () => {
  if (!state.settings?.ai?.configured) return;
  const confirmed = await askConfirmation('清除 DeepSeek 配置后，AI 总结功能将隐藏。确定继续吗？', {
    title: '清除 AI 配置',
    confirmLabel: '清除配置',
    danger: true
  });
  if (!confirmed) return;
  const res = await window.api.clearAi();
  if (res.ok) {
    aiStartupCheckEpoch += 1;
    aiStartupCheckPromise = null;
    aiStartupCheckCompleted = false;
    aiConnectionChecking = false;
    state.settings.ai = res.ai;
    syncAiSettingsUI(res.ai);
    setMaskedAiKey(res.ai);
    syncAiEntry();
    clearInterval(terminologyThinkingTimer);
    terminologyThinkingTimer = null;
    state.terminologyDiscovery.thinking = createTerminologyThinking();
    renderTerminologyDiscoveryUI();
    loadWorkbenchClosure({ preserveThinking: false, autoReason: 'configuration-change' });
    toast(uiText('AI 配置已清除'));
  }
});

templateSeg.addEventListener('click', ev => {
  const btn = ev.target.closest('button[data-v]');
  if (!btn) return;
  templateType = btn.dataset.v;
  syncTemplateUI();
});

$('#template-save').addEventListener('click', async () => {
  const value = templateText.value.trim();
  const res = await window.api.setReportTemplate(templateType, value);
  if (!res.ok) { templateMsg.textContent = uiText(res.error || '模板保存失败'); return; }
  state.settings.reportTemplates[templateType] = value;
  templateMsg.className = 'set-msg success';
  templateMsg.textContent = uiText('模板已保存');
  toast(uiText('总结模板已保存'));
});

$('#template-reset').addEventListener('click', async () => {
  const value = state.settings?.reportTemplateDefaults?.[templateType] || DEFAULT_TEMPLATES[templateType];
  const res = await window.api.setReportTemplate(templateType, value);
  if (!res.ok) { templateMsg.textContent = uiText(res.error || '恢复失败'); return; }
  state.settings.reportTemplates[templateType] = value;
  syncTemplateUI();
  toast(uiText('已恢复默认模板'));
});

$('#closure-prompt-save').addEventListener('click', async () => {
  const value = closurePromptText.value.trim();
  const res = await window.api.setClosurePrompt(value);
  if (!res.ok) {
    closurePromptMsg.textContent = uiText(res.error || '闭环提示词保存失败');
    return;
  }
  state.settings.closurePrompt = res.prompt;
  closurePromptMsg.className = 'set-msg success';
  closurePromptMsg.textContent = uiText('闭环提示词已保存');
  await loadWorkbenchClosure({ autoReason: 'configuration-change' });
  toast(uiText('近期闭环提示词已保存'));
});

$('#closure-prompt-reset').addEventListener('click', async () => {
  const value = state.settings?.closurePromptDefault || DEFAULT_CLOSURE_PROMPT;
  const res = await window.api.setClosurePrompt(value);
  if (!res.ok) {
    closurePromptMsg.textContent = uiText(res.error || '恢复默认提示词失败');
    return;
  }
  state.settings.closurePrompt = res.prompt;
  state.settings.closurePromptSource = res.source;
  syncClosurePromptUI();
  await loadWorkbenchClosure({ autoReason: 'configuration-change' });
  toast(uiText('近期闭环提示词已恢复默认'));
});

terminologyPromptSave.addEventListener('click', async () => {
  const value = terminologyPromptText.value.trim();
  const res = await window.api.setTerminologyDiscoveryPrompt(value);
  if (!res.ok) {
    terminologyPromptMsg.textContent = uiText(res.error || '术语识别提示词保存失败');
    return;
  }
  state.settings.terminologyDiscoveryPrompt = res.prompt;
  terminologyPromptMsg.className = 'set-msg success';
  terminologyPromptMsg.textContent = uiText('术语识别提示词已保存');
  toast(uiText('术语识别提示词已保存'));
});

terminologyPromptReset.addEventListener('click', async () => {
  const value = state.settings?.terminologyDiscoveryPromptDefault || DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT;
  const res = await window.api.setTerminologyDiscoveryPrompt(value);
  if (!res.ok) {
    terminologyPromptMsg.textContent = uiText(res.error || '恢复默认提示词失败');
    return;
  }
  state.settings.terminologyDiscoveryPrompt = res.prompt;
  state.settings.terminologyDiscoveryPromptSource = res.source;
  syncTerminologyPromptUI();
  toast(uiText('术语识别提示词已恢复默认'));
});

terminologyDiscover.addEventListener('click', () => {
  discoverTerminology(true);
});

terminologyThinkingToggle?.addEventListener('click', () => {
  const thinking = state.terminologyDiscovery.thinking;
  if (!thinking?.visible) return;
  state.terminologyDiscovery.thinking = thinkingState.toggleThinking(thinking);
  renderTerminologyThinking();
});

function resetTerminologyForm() {
  editingTerminologyId = '';
  termCanonical.value = '';
  termScope.value = '';
  termAliases.value = '';
  termNote.value = '';
  termMsg.textContent = '';
  termMsg.className = 'set-msg';
  termSave.textContent = uiText('添加术语');
  termCancel.hidden = true;
  if (terminologyEditorTitle) terminologyEditorTitle.textContent = uiText('新增术语');
}

function renderTerminologyPending() {
  if (!terminologyPending || !terminologyPendingList) return;
  const data = state.workbench?.closure?.data;
  const dismissed = state.workbench?.closure?.dismissedSuggestions || new Set();
  const suggestions = (Array.isArray(data?.needs_confirmation) ? data.needs_confirmation : [])
    .filter(item => !dismissed.has(closureSuggestionKey(item)));

  terminologyPending.hidden = !suggestions.length;
  terminologyPendingList.innerHTML = '';
  if (terminologyPendingCount) terminologyPendingCount.textContent = suggestions.length ? uiText(`${suggestions.length} 项`) : '';
  if (suggestions.length) {
    appendClosureSuggestions(terminologyPendingList, { needs_confirmation: suggestions }, false, false);
  }
}

function renderTerminologyUI() {
  renderTerminologyPending();
  if (!terminologyList) return;
  terminologyList.innerHTML = '';
  const allTerms = Array.isArray(state.settings?.terminology) ? state.settings.terminology : [];
  const query = terminologySearch?.value?.trim() || '';
  const terms = query
    ? allTerms.filter(term => window.DRTextSearch.matchesSearch([
      term.canonicalName,
      ...(Array.isArray(term.aliases) ? term.aliases : []),
      term.scope,
      term.note
    ].filter(Boolean).join(' '), query))
    : allTerms;
  if (terminologyListCount) {
    terminologyListCount.textContent = uiText(query
      ? `匹配 ${terms.length} / ${allTerms.length} 组术语`
      : `${allTerms.length} 组术语`);
  }
  if (terminologySearchClear) terminologySearchClear.hidden = !query;
  if (!allTerms.length) {
    terminologyList.appendChild(wbNode('div', 'terminology-empty', uiText('还没有可用的术语对照；首次识别完成后会显示在这里，也可以手动添加。')));
    return;
  }
  if (!terms.length) {
    terminologyList.appendChild(wbNode('div', 'terminology-empty', uiText(`没有找到与“${query}”匹配的术语；可以直接在上方新增术语。`)));
    return;
  }
  for (const term of terms) {
    const row = document.createElement('div');
    row.className = 'terminology-item';
    const copy = document.createElement('div');
    copy.className = 'terminology-copy';
    const name = document.createElement('div');
    name.className = 'terminology-name';
    name.textContent = term.canonicalName;
    const aliases = document.createElement('div');
    aliases.className = 'terminology-aliases';
    aliases.textContent = uiText(term.aliases?.length ? `常用说法：${term.aliases.join('、')}` : '尚未添加常用说法');
    copy.append(name, aliases);
    if (term.scope || term.note) {
      const note = document.createElement('div');
      note.className = 'terminology-note';
      note.textContent = uiText([term.scope ? `范围：${term.scope}` : '', term.note || ''].filter(Boolean).join(' · '));
      copy.appendChild(note);
    }
    const actions = document.createElement('div');
    actions.className = 'terminology-item-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'link-btn';
    edit.textContent = uiText('编辑');
    edit.addEventListener('click', () => {
      editingTerminologyId = term.id;
      termCanonical.value = term.canonicalName;
      termScope.value = term.scope || '';
      termAliases.value = (term.aliases || []).join('\n');
      termNote.value = term.note || '';
      termSave.textContent = uiText('保存修改');
      termCancel.hidden = false;
      termMsg.textContent = '';
      if (terminologyEditorTitle) terminologyEditorTitle.textContent = uiText('编辑术语');
      termCanonical.focus();
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'link-btn danger-link';
    remove.textContent = uiText('删除');
    remove.addEventListener('click', async () => {
      const confirmed = await askConfirmation(`删除术语“${term.canonicalName}”？之后 AI 不再优先使用这组规范。`, {
        title: '删除术语',
        confirmLabel: '删除',
        danger: true
      });
      if (!confirmed) return;
      const res = await window.api.setTerminology(allTerms.filter(item => item.id !== term.id));
      if (!res.ok) { termMsg.textContent = uiText(res.error || '术语删除失败'); return; }
      state.settings.terminology = res.terminology;
      if (state.settings.terminologyDiscovery) state.settings.terminologyDiscovery.termCount = state.settings.terminology.length;
      if (editingTerminologyId === term.id) resetTerminologyForm();
      renderTerminologyUI();
      await loadWorkbenchClosure({ autoReason: 'configuration-change' });
      toast(uiText('术语已删除'));
    });
    actions.append(edit, remove);
    row.append(copy, actions);
    terminologyList.appendChild(row);
  }
}

terminologySearch?.addEventListener('input', renderTerminologyUI);
terminologySearchClear?.addEventListener('click', () => {
  terminologySearch.value = '';
  renderTerminologyUI();
  terminologySearch.focus();
});

function parseTerminologyAliases(value) {
  return String(value || '').split(/[\n,，、;；]+/).map(item => item.trim()).filter(Boolean);
}

termSave.addEventListener('click', async () => {
  const canonicalName = termCanonical.value.trim();
  const aliases = parseTerminologyAliases(termAliases.value);
  if (!canonicalName) { termMsg.textContent = uiText('请填写规范输出名称'); termCanonical.focus(); return; }
  if (!aliases.length) { termMsg.textContent = uiText('请至少填写一个常用说法'); termAliases.focus(); return; }
  const current = Array.isArray(state.settings?.terminology) ? state.settings.terminology : [];
  const draft = {
    id: editingTerminologyId || `term-${Date.now()}`,
    canonicalName,
    aliases,
    scope: termScope.value.trim(),
    note: termNote.value.trim()
  };
  const next = editingTerminologyId
    ? current.map(item => item.id === editingTerminologyId ? draft : item)
    : [draft, ...current];
  const wasEditing = !!editingTerminologyId;
  const res = await window.api.setTerminology(next);
  if (!res.ok) { termMsg.textContent = uiText(res.error || '术语保存失败'); return; }
  state.settings.terminology = res.terminology;
  if (state.settings.terminologyDiscovery) state.settings.terminologyDiscovery.termCount = state.settings.terminology.length;
  resetTerminologyForm();
  renderTerminologyUI();
  await loadWorkbenchClosure({ autoReason: 'configuration-change' });
  toast(uiText(wasEditing ? '术语已更新' : '术语已添加'));
});

termCancel.addEventListener('click', resetTerminologyForm);

/* ---------- 快捷键录制（带冲突检测） ---------- */

function normKey(e) {
  const k = e.key;
  if (/^[a-z]$/i.test(k)) return k.toUpperCase();
  if (/^[0-9]$/.test(k)) return k;
  const m = /^F([1-9]|1[0-2])$/i.exec(k);
  if (m) return 'F' + m[1];
  return null;
}

function exitRecording(ok) {
  state.recording = false;
  hkDisplay.classList.remove('recording');
  hkDisplay.textContent = (state.settings && state.settings.hotkey) || uiText('未设置');
  if (!ok) hkMsg.textContent = '';
}

$('#hk-record').addEventListener('click', () => {
  state.recording = true;
  hkDisplay.classList.add('recording');
  hkDisplay.textContent = uiText('请按下组合键…');
  hkMsg.textContent = uiText('Esc 取消');
});

$('#hk-reset').addEventListener('click', async () => {
  if (!state.settings) return;
  const res = await window.api.setSettings({ hotkey: state.settings.defaultHotkey });
  if (res.ok) {
    state.settings.hotkey = res.settings.hotkey;
    exitRecording(true);
    hkMsg.textContent = '';
    $('#hotkey-tip').textContent = res.settings.hotkey;
    toast(uiText('已恢复默认快捷键'));
  } else {
    hkMsg.textContent = res.error;
  }
});

// 捕获阶段监听，录制时拦截一切按键
document.addEventListener('keydown', async e => {
  if (state.recording) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') { exitRecording(false); return; }
    const mods = [];
    if (e.ctrlKey) mods.push('Ctrl');
    if (e.altKey) mods.push('Alt');
    if (e.shiftKey) mods.push('Shift');
    if (!mods.length && !e.metaKey) { hkMsg.textContent = uiText('需包含 Ctrl / Alt / Shift 中至少一个修饰键'); return; }
    const key = normKey(e);
    if (!key) { hkMsg.textContent = uiText('请再按一个字母 / 数字 / F1-F12 键'); return; }
    const accel = [...mods, key].join('+');
    const res = await window.api.setSettings({ hotkey: accel });
    if (res.ok) {
      state.settings.hotkey = res.settings.hotkey;
      exitRecording(true);
      hkMsg.textContent = '';
      $('#hotkey-tip').textContent = res.settings.hotkey;
      toast(uiText(`快捷键已更新为 ${res.settings.hotkey}`));
    } else {
      hkDisplay.textContent = uiText('请按下组合键…');
      hkMsg.textContent = uiText(`${res.error}，请重试`);
    }
    return;
  }
  // 设置页按 Esc 返回主界面（输入控件内除外）
  if (e.key === 'Escape' && !viewSettings.hidden && !e.target.closest('input, textarea, select')) {
    showView('main');
  }
}, true);

/* ---------- 自定义覆盖式滚动条 ---------- */

// 给滚动容器装一个自绘 thumb：滚动时浮现于内容右缘，静止 0.7s 隐去，可拖拽。
// 原生滚动条已隐藏（CSS），任何状态下都不占布局空间。
function attachOverlayScrollbar(scroller, thumb) {
  let hideTimer = null;
  let dragging = false;

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => thumb.classList.remove('show'), 700);
  }

  function update() {
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    // 24px 容差吸收容器底部留白：视觉上一屏放得下就不显示
    if (scrollHeight <= clientHeight + 24) {
      thumb.classList.remove('show');
      return false;
    }
    const rect = scroller.getBoundingClientRect();
    const trackH = rect.height - 8;
    const h = Math.max(28, clientHeight / scrollHeight * trackH);
    const maxTop = scrollHeight - clientHeight;
    const y = rect.top + 4 + (maxTop ? scrollTop / maxTop : 0) * (trackH - h);
    // 水平位置：贴内容列右缘外侧，不与内容重叠
    thumb.style.left = Math.round(rect.right + 5) + 'px';
    thumb.style.top = Math.round(y) + 'px';
    thumb.style.height = Math.round(h) + 'px';
    return true;
  }

  // 滚动/悬停可滚动区域时显示，静止或移开后隐去
  function reveal() {
    if (update()) {
      thumb.classList.add('show');
      scheduleHide();
    }
  }

  scroller.addEventListener('scroll', () => { if (!dragging) reveal(); });
  scroller.addEventListener('mouseenter', () => {
    if (dragging) return;
    clearTimeout(hideTimer);            // 悬停期间保持可见
    if (update()) thumb.classList.add('show');
  });
  scroller.addEventListener('mouseleave', () => {
    if (!dragging) scheduleHide();
  });
  window.addEventListener('resize', update);
  thumb.addEventListener('mousedown', e => {
    e.preventDefault();
    dragging = true;
    thumb.classList.add('dragging');
    const startY = e.clientY;
    const startScrollTop = scroller.scrollTop;
    const ratio = scroller.scrollHeight / scroller.clientHeight;
    const onMove = ev => {
      scroller.scrollTop = startScrollTop + (ev.clientY - startY) * ratio;
      update();
    };
    const onUp = () => {
      dragging = false;
      thumb.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      scheduleHide();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

  update();
  return update;
}

const updateListThumb = attachOverlayScrollbar($('#list'), $('#list-thumb'));
attachOverlayScrollbar($('.settings-scroll'), $('#settings-thumb'));
updateWorkbenchThumb = attachOverlayScrollbar(weeklyWorkbench, $('#recent-summary-thumb'));
document.querySelectorAll('textarea[data-resizable="true"]').forEach(installTextareaResizer);

/* ---------- 初始化 ---------- */

customSelect?.enhanceAll(document);

async function refresh({ autoReason = 'source-change', schedule = true } = {}) {
  state.entries = await window.api.list();
  renderTodayPanel();
  renderStats();
  renderActivity();
  populateYearOptions();
  renderList();
  renderWeeklyWorkbench();
  if (state.settings?.ai?.configured) {
    loadWorkbenchClosure({ autoReason, schedule });
  }
  renderExportPreview();
  if (state.report.start) syncReportControls();
  if (typeof updateListThumb === 'function') updateListThumb();
}

(async function init() {
  window.api.getTheme().then(applyTheme);
  syncComposerTime();
  defaultRange();
  buildMonthOptions();
  dateFilterPopover.append(rangeChip);
  renderRangeChip();
  window.api.onEntriesChanged(refresh);
  syncWeeklyWorkbenchViewport();
  // 先加载设置和外置语言包，再做首轮页面渲染，避免英文/日文界面首帧短暂出现中文。
  await loadSettingsUI();
  await refresh({ autoReason: 'startup', schedule: false });
  composerText.focus();
})();
