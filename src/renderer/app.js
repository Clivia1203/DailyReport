const $ = s => document.querySelector(s);

const state = {
  entries: [],
  filter: { year: 'all', month: 'all', text: '' },
  rangeFocus: { type: 'all' }, // 范围聚焦（ADR-0003）：与年/月下拉互斥，搜索叠加
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
    editing: false,
    loading: false
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
  span.textContent = msg;
  t.appendChild(span);
  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.onclick = () => { action.fn(); hideToast(); };
    t.appendChild(btn);
  }
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 4000 : 1800);
}
function hideToast() { $('#toast').classList.remove('show'); }

/* ---------- 视图切换 ---------- */

const viewMain = $('#view-main');
const viewSettings = $('#view-settings');
const viewReport = $('#view-report');

function showView(name) {
  viewMain.hidden = name !== 'main';
  viewSettings.hidden = name !== 'settings';
  viewReport.hidden = name !== 'report';
}

$('#btn-settings').addEventListener('click', () => { showView('settings'); loadSettingsUI(); });
$('#btn-back').addEventListener('click', () => showView('main'));
$('#btn-report-back').addEventListener('click', () => showView('main'));
window.api.onNavigate(v => showView(v));

/* ---------- 主题 ---------- */

const ICONS = {
  moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>'
};

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const themeButton = $('#btn-theme');
  if (themeButton) themeButton.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
  try { localStorage.setItem('theme:cache', theme); } catch { /* 忽略 */ }
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

window.api.onThemeChanged(t => { applyTheme(t); syncThemeSeg(); });

/* ---------- 今日面板 ---------- */

const todayPanel = $('#today-panel');

const WEEKDAY_NAMES = '日一二三四五六';

function renderTodayPanel() {
  const now = Date.now();
  todayPanel.innerHTML = '';
  const hi = document.createElement('span');
  hi.className = 'today-greet';
  hi.textContent = DR.greeting(now);
  const date = document.createElement('span');
  date.className = 'today-date';
  const d = new Date(now);
  date.textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 星期${WEEKDAY_NAMES[d.getDay()]}`;
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
    labelEl.textContent = label;
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

function growTextarea(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 240) + 'px';
}
composerText.addEventListener('input', () => growTextarea(composerText));

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
  syncModalCover();
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
    growTextarea(composerText);
    tsTouched = false;
    syncComposerTime();
    setComposerOpen(false);   // 保存后收起（宽屏下 CSS 强制常驻，不受影响）
    toast('已记录 ✓');
    refresh();
  }
}

/* ---------- 导出模态 ---------- */

const exportModal = $('#export-modal');
const reportModal = $('#report-modal');
const reportModalContent = $('#report-modal-content');
const reportModalMeta = $('#report-modal-meta');

function openExportModal() {
  exportModal.hidden = false;
  syncModalCover();
  renderExportPreview();
}

function closeExportModal() {
  exportModal.hidden = true;
  syncModalCover();
}

// 任一模窗打开时，请主进程把标题栏控制按钮区染成遮罩色（视觉遮盖）
function syncModalCover() {
  window.api.setModalCover(!composerModal.hidden || !exportModal.hidden || !reportModal.hidden);
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
  expPreview.append('将导出 ');
  const b = document.createElement('b');
  b.textContent = String(n);
  expPreview.appendChild(b);
  expPreview.append(' 条');
}

[expStart, expEnd, expFormat].forEach(el => el.addEventListener('change', renderExportPreview));

$('#btn-export').addEventListener('click', async () => {
  const s = expStart.value, e = expEnd.value;
  if (!s || !e) { toast('请先选择开始和结束日期'); return; }
  if (s > e) { toast('开始日期不能晚于结束日期'); return; }
  const res = await window.api.exportRange(s, e, expFormat.value);
  if (res.ok) { closeExportModal(); toast('已导出到 ' + res.filePath); }
  else if (res.error) toast(res.error);
});

/* ---------- 周期总结 ---------- */

const reportType = $('#report-type');
const reportPrev = $('#report-prev');
const reportNext = $('#report-next');
const reportStart = $('#report-start');
const reportEnd = $('#report-end');
const reportDates = $('#report-dates');
const reportFormat = $('#report-format');
const reportStatus = $('#report-status');
const reportTitle = $('#report-title');
const reportMeta = $('#report-meta');
const reportContent = $('#report-content');
const reportEditor = $('#report-editor');
const reportEdit = $('#report-edit');
const reportEditFoot = $('#report-edit-foot');
const reportEditCancel = $('#report-edit-cancel');
const reportEditSave = $('#report-edit-save');
const reportCompact = $('#report-compact');
const reportCompactMeta = $('#report-compact-meta');
const reportCount = $('#report-count');
const reportCoverage = $('#report-coverage');
const reportModel = $('#report-model');
const reportSourceList = $('#report-source-list');
const reportConnection = $('#report-connection');

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
  const bounds = start && end ? { start, end } : periodBounds(type);
  reportStart.value = bounds.start;
  reportEnd.value = bounds.end;
  state.report.type = type;
  state.report.start = bounds.start;
  state.report.end = bounds.end;
  state.report.periodLabel = reportPeriodLabel();
  reportDates.hidden = type !== 'custom';
  reportPrev.disabled = type === 'custom';
  reportNext.disabled = type === 'custom';
  reportTitle.textContent = reportPeriodLabel();
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
    pre.textContent = reportText(content);
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
    empty.textContent = '本周期没有记录';
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

function renderReportState(message) {
  const data = state.report.data;
  const incompleteCoverage = data && data.sourceCount > 0 && data.coveredCount < data.sourceCount;
  reportTitle.textContent = reportPeriodLabel();
  reportMeta.textContent = data
    ? `周期：${data.start} 至 ${data.end}　·　来源：${data.sourceCount} 条　·　AI 归纳覆盖：${data.coveredCount} / ${data.sourceCount}　·　模型：${data.model}`
    : '尚未生成本周期总结';
  reportCoverage.textContent = data ? `${data.coveredCount} / ${data.sourceCount}` : '--';
  reportModel.textContent = data?.model || state.settings?.ai?.model || '--';
  reportStatus.textContent = message || (incompleteCoverage
    ? 'AI 正文未逐条引用全部来源；完整原始记录明细已附在文末，请核对后再提交。'
    : data ? '总结正文与原始记录明细均已保留，可继续编辑或导出。' : '选择周期后点击“生成总结”。');
  reportStatus.className = `report-status${message ? ' active' : ''}`;
  reportEdit.hidden = !data;
  reportContent.hidden = state.report.editing;
  reportEditor.hidden = !data || !state.report.editing;
  reportEditFoot.hidden = !data || !state.report.editing;
  reportCompact.hidden = window.innerWidth >= 1200;
  $('#report-open-modal').disabled = !data;
  reportCompactMeta.textContent = data
    ? `已生成 · ${data.coveredCount} / ${data.sourceCount} 条记录已覆盖`
    : '尚未生成';
  if (data && !state.report.editing) {
    renderReportContent(reportContent, data.content);
    renderReportContent(reportModalContent, data.content);
    reportModalMeta.textContent = reportMeta.textContent;
  } else if (!data && !state.report.editing) {
    reportContent.innerHTML = '';
    const empty = document.createElement('div');
    empty.className = 'report-empty';
    empty.textContent = '尚未生成本周期总结，点击右上角“生成总结”开始。';
    reportContent.appendChild(empty);
  }
  renderReportSources();
}

function syncAiEntry() {
  const configured = !!state.settings?.ai?.configured;
  $('#btn-report').hidden = !configured;
  if (reportConnection) {
    reportConnection.textContent = configured
      ? (state.settings.ai.lastTestOk ? `AI 已连接 · ${state.settings.ai.model}` : 'AI 已配置，待测试')
      : '未配置 AI';
    reportConnection.classList.toggle('ok', configured && state.settings.ai.lastTestOk);
  }
}

async function loadCachedReport() {
  renderReportState();
  if (!state.settings?.ai?.configured) return;
  const res = await window.api.getCachedReport({
    start: state.report.start,
    end: state.report.end,
    periodType: state.report.type,
    template: state.settings.reportTemplates[state.report.type]
  });
  if (res.ok) state.report.data = res.report;
  renderReportState();
}

async function openReportView() {
  if (!state.settings) await loadSettingsUI();
  if (!state.settings?.ai?.configured) {
    showView('settings');
    toast('请先在设置中配置 DeepSeek API');
    return;
  }
  showView('report');
  state.report.data = null;
  state.report.editing = false;
  setReportPeriod('week');
  await loadCachedReport();
}

async function generateReport(force = false) {
  if (state.report.loading) return;
  state.report.loading = true;
  reportGenerate.disabled = true;
  renderReportState('正在连接 DeepSeek 并生成总结，请稍候…');
  const res = await window.api.generateReport({
    start: state.report.start,
    end: state.report.end,
    periodType: state.report.type,
    periodLabel: reportPeriodLabel(),
    template: state.settings?.reportTemplates?.[state.report.type],
    force
  });
  state.report.loading = false;
  reportGenerate.disabled = false;
  if (!res.ok) {
    renderReportState(res.error || '生成总结失败');
    toast(res.error || '生成总结失败');
    return;
  }
  state.report.data = res.report;
  if (state.settings?.ai) {
    state.settings.ai.model = res.report.model;
    state.settings.ai.lastTestOk = true;
    syncAiEntry();
  }
  const coverageNote = res.report.sourceCount > 0 && res.report.coveredCount < res.report.sourceCount
    ? 'AI 正文覆盖不完整，但全部原始记录已自动附在文末，请核对。'
    : '总结已生成，已保留全部原始记录。';
  renderReportState(res.modelChanged ? `当前模型已更新为 ${res.report.model}，${coverageNote}` : coverageNote);
}

function shiftReportPeriod(delta) {
  if (state.report.type === 'custom') return;
  if (state.report.type === 'day') {
    const next = shiftDateString(state.report.start, delta);
    setReportPeriod('day', next, next);
  } else if (state.report.type === 'week') {
    const nextStart = shiftDateString(state.report.start, delta * 7);
    setReportPeriod('week', nextStart, shiftDateString(nextStart, 6));
  } else {
    const first = localDateFromString(state.report.start);
    first.setMonth(first.getMonth() + delta, 1);
    const start = dateStringFromDate(first);
    const endDate = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    setReportPeriod('month', start, dateStringFromDate(endDate));
  }
  state.report.data = null;
  loadCachedReport();
}

$('#btn-report').addEventListener('click', openReportView);
reportType.addEventListener('change', () => {
  setReportPeriod(reportType.value);
  state.report.data = null;
  loadCachedReport();
});
reportStart.addEventListener('change', () => {
  if (reportType.value !== 'custom') return;
  state.report.start = reportStart.value;
  if (state.report.start > state.report.end) reportEnd.value = reportStart.value;
  state.report.end = reportEnd.value;
  state.report.periodLabel = reportPeriodLabel();
  state.report.data = null;
  loadCachedReport();
});
reportEnd.addEventListener('change', () => {
  if (reportType.value !== 'custom') return;
  if (reportEnd.value < reportStart.value) reportStart.value = reportEnd.value;
  state.report.start = reportStart.value;
  state.report.end = reportEnd.value;
  state.report.periodLabel = reportPeriodLabel();
  state.report.data = null;
  loadCachedReport();
});
reportPrev.addEventListener('click', () => shiftReportPeriod(-1));
reportNext.addEventListener('click', () => shiftReportPeriod(1));
reportFormat.addEventListener('change', () => { state.report.format = reportFormat.value; renderReportState(); });
const reportGenerate = $('#report-generate');
reportGenerate.addEventListener('click', () => generateReport(!!state.report.data));
$('#report-copy').addEventListener('click', async () => {
  if (!state.report.data) { toast('请先生成总结'); return; }
  const content = state.report.format === 'txt' ? reportText(state.report.data.content) : state.report.data.content;
  try { await navigator.clipboard.writeText(content); toast('总结已复制'); }
  catch { toast('复制失败，请使用编辑框手动复制'); }
});
$('#report-export').addEventListener('click', async () => {
  if (!state.report.data) { toast('请先生成总结'); return; }
  const res = await window.api.exportReport(state.report.data.id, state.report.format);
  if (res.ok) toast('总结已导出到 ' + res.filePath);
  else if (res.error) toast(res.error);
});
reportEdit.addEventListener('click', () => {
  if (!state.report.data) return;
  state.report.editing = true;
  reportEditor.value = state.report.data.content;
  renderReportState();
  reportEditor.focus();
});
reportEditCancel.addEventListener('click', () => { state.report.editing = false; renderReportState(); });
reportEditSave.addEventListener('click', async () => {
  if (!state.report.data) return;
  const res = await window.api.saveReport(state.report.data.id, reportEditor.value);
  if (!res.ok) { toast(res.error || '保存失败'); return; }
  state.report.data = res.report;
  state.report.editing = false;
  renderReportState('总结修改已保存。');
});
$('#report-open-modal').addEventListener('click', () => { reportModal.hidden = false; syncModalCover(); });
$('#report-modal-close').addEventListener('click', () => { reportModal.hidden = true; syncModalCover(); });
reportModal.addEventListener('click', e => { if (e.target === reportModal) { reportModal.hidden = true; syncModalCover(); } });

/* ---------- 列表筛选 ---------- */

const fYear = $('#f-year');
const fMonth = $('#f-month');
const fText = $('#f-text');
const fCount = $('#f-count');

function buildMonthOptions() {
  fMonth.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = '全部月份';
  fMonth.appendChild(all);
  for (let m = 1; m <= 12; m++) {
    const o = document.createElement('option');
    o.value = String(m); o.textContent = `${m} 月`;
    fMonth.appendChild(o);
  }
}

function populateYearOptions() {
  const years = [...new Set(state.entries.map(e => new Date(e.ts).getFullYear()))].sort((a, b) => b - a);
  const cur = fYear.value;
  fYear.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = '全部年份';
  fYear.appendChild(all);
  for (const y of years) {
    const o = document.createElement('option');
    o.value = String(y); o.textContent = `${y} 年`;
    fYear.appendChild(o);
  }
  if ([...fYear.options].some(o => o.value === cur)) fYear.value = cur;
}

function filteredEntries() {
  const { year, month, text } = state.filter;
  let list = window.DRStats.filterByRange(state.entries, state.rangeFocus, Date.now());
  if (year !== 'all') list = list.filter(x => new Date(x.ts).getFullYear() === Number(year));
  if (month !== 'all') list = list.filter(x => new Date(x.ts).getMonth() === Number(month) - 1);
  if (text) list = list.filter(x => x.text.toLowerCase().includes(text.toLowerCase()));
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
  renderList();
}));

fText.addEventListener('input', () => {
  state.filter.text = fText.value.trim();
  renderList();
});

/* ---------- 范围聚焦（统计卡点击，票02） ---------- */

const DR = window.DRStats;

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
    rangeChip.append(label + ' ');
    const x = document.createElement('span');
    x.className = 'chip-x';
    x.textContent = '×';
    rangeChip.appendChild(x);
  }
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

/* ---------- 活动图（近 14 天柱状，票03） ---------- */

const activityChart = $('#activity-chart');

function renderActivity() {
  const days = DR.dayCounts(state.entries, Date.now(), 14);
  const max = Math.max(1, ...days.map(d => d.count));
  const today = dateStr(Date.now());

  activityChart.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'activity-title';
  title.textContent = '近 14 天';

  const bars = document.createElement('div');
  bars.className = 'activity-bars';

  days.forEach(d => {
    const col = document.createElement('button');
    col.className = 'activity-col';
    col.title = `${d.date} · ${d.count} 条`;
    if (d.date === today) col.classList.add('today');

    const bar = document.createElement('span');
    bar.className = 'activity-bar';
    bar.style.height = d.count === 0 ? '' : `${Math.round((d.count / max) * 100)}%`;
    if (d.count === 0) bar.classList.add('zero');

    const n = document.createElement('span');
    n.className = 'activity-count';
    n.textContent = d.count ? String(d.count) : '';

    const lbl = document.createElement('span');
    lbl.className = 'activity-date';
    lbl.textContent = String(Number(d.date.slice(8)));

    col.append(n, bar, lbl);
    col.addEventListener('click', () => setRangeFocus({ type: 'day', day: d.date }));
    bars.appendChild(col);
  });

  activityChart.append(title, bars);
}

/* ---------- 历史列表 ---------- */

const listEl = $('#list-items');

function renderList() {
  const list = filteredEntries();
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
    tip.textContent = state.entries.length
      ? (isFiltering() ? '当前筛选范围内没有记录' : '还没有记录')
      : '还没有记录，按 Alt+Shift+D 或在上方输入第一条';
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
      r.textContent = rel;
      dateSpan.appendChild(r);
    }
    dateSpan.append(`${day} 星期${weekdayOf(day)}`);
    const count = document.createElement('span');
    count.className = 'day-count';
    count.textContent = `${items.length} 条`;
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
    btnEdit.title = '编辑';
    btnEdit.innerHTML = ICONS.pencil;
    btnEdit.onclick = () => startEdit(el, e);

    const btnDel = document.createElement('button');
    btnDel.className = 'mini-btn danger';
    btnDel.title = '删除';
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
  cancel.textContent = '取消';
  cancel.onclick = renderList;

  const save = document.createElement('button');
  save.className = 'btn small primary';
  save.textContent = '保存';
  save.onclick = async () => {
    const text = ta.value.trim();
    if (!text) { ta.focus(); return; }
    const ts = tsInput.value ? new Date(tsInput.value).getTime() : e.ts;
    await window.api.update(e.id, { text, ts });
    toast('已更新 ✓');
    refresh();
  };

  foot.append(tsInput, spacer, cancel, save);
  area.append(ta, foot);
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
  toast('已删除 1 条记录', {
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
  mgDelete.textContent = '删除选中';
}

mgDelete.addEventListener('click', async () => {
  const n = state.selected.size;
  if (!n) { toast('请先勾选要删除的记录'); return; }
  if (!mgDelete.classList.contains('armed')) {
    mgDelete.classList.add('armed');
    mgDelete.textContent = `确认删除 ${n} 条`;
    clearTimeout(armTimer);
    armTimer = setTimeout(disarmDelete, 3000);
    return;
  }
  clearTimeout(armTimer);
  const res = await window.api.deleteMany([...state.selected]);
  state.selected.clear();
  disarmDelete();
  toast(`已删除 ${res.removed} 条`);
  refresh();
});

function updateManageUI() {
  manageBar.hidden = !state.manage;
  $('#list-toolbar').style.display = state.manage ? 'none' : '';
  btnManage.hidden = state.manage;
  mgCount.textContent = `已选 ${state.selected.size} 条`;
  if (state.selected.size === 0) disarmDelete();
}

/* ---------- 设置界面 ---------- */

const hkDisplay = $('#hk-display');
const hkMsg = $('#hk-msg');
const themeSeg = $('#theme-seg');
const autoStart = $('#set-autostart');
const silentStart = $('#set-silent');
const rowSilent = $('#row-silentstart');
const aiKey = $('#ai-key');
const aiModel = $('#ai-model');
const aiStateBadge = $('#ai-state-badge');
const aiModelSub = $('#ai-model-sub');
const aiMsg = $('#ai-msg');
const templateSeg = $('#template-seg');
const templateText = $('#template-text');
const templateMsg = $('#template-msg');
let templateType = 'week';

const DEFAULT_TEMPLATES = {
  day: '请生成一份当天工作总结，按工作事项整理，说明完成内容、当前进展和需要关注的问题。语言简洁、事实准确，不要补充原始记录中没有的信息。',
  week: '请生成一份本周工作总结，优先按任务或工作主题归纳，包含本周完成、进行中事项、问题与风险、下一步计划。语言可以润色，但不得遗漏任何原始记录中的事实。',
  month: '请生成一份本月工作总结，按工作主题归纳主要进展、阶段性成果、问题与风险及下一阶段计划。保留具体任务细节，不要泛化或编造。',
  custom: '请按照用户指定的周期和模板生成工作总结。可以调整语言和结构，但必须保留所有原始记录中的事实、任务细节和时间线。'
};

function syncSilentRow() {
  // 常显 + 未开自启时置灰（避免"选项藏起来找不到"）
  rowSilent.classList.toggle('disabled', !autoStart.checked);
}

async function loadSettingsUI() {
  const s = await window.api.getSettings();
  state.settings = s;
  hkDisplay.textContent = s.hotkey || '未设置';
  $('#hotkey-tip').textContent = s.hotkey || '--';
  $('#set-datapath').textContent = s.dataFile;
  autoStart.checked = s.openAtLogin;
  silentStart.checked = !!s.silentStart;
  aiKey.value = '';
  syncAiSettingsUI(s.ai);
  syncTemplateUI();
  syncAiEntry();
  syncSilentRow();
  hkMsg.textContent = '';
  syncThemeSeg();
}

function syncAiModels(ai) {
  const models = Array.isArray(ai?.models) ? ai.models : [];
  aiModel.innerHTML = '';
  if (!models.length) {
    const o = document.createElement('option');
    o.value = ai?.model || '';
    o.textContent = ai?.model || '请先测试连接';
    aiModel.appendChild(o);
  } else {
    for (const model of models) {
      const o = document.createElement('option');
      o.value = model;
      o.textContent = model;
      aiModel.appendChild(o);
    }
  }
  aiModel.value = ai?.model || '';
  aiModel.disabled = !ai?.configured && !models.length;
}

function syncAiSettingsUI(ai = state.settings?.ai) {
  const configured = !!ai?.configured;
  aiStateBadge.textContent = !configured ? '未配置' : (ai.lastTestOk ? '已连接' : '已配置');
  aiStateBadge.classList.toggle('ok', configured && !!ai.lastTestOk);
  aiModelSub.textContent = ai?.lastError || (ai?.lastTestAt ? `最近测试：${new Date(ai.lastTestAt).toLocaleString()}` : '点击测试连接后自动读取当前可用模型');
  syncAiModels(ai);
  aiMsg.textContent = '';
}

function syncTemplateUI() {
  const templates = state.settings?.reportTemplates || DEFAULT_TEMPLATES;
  for (const b of templateSeg.querySelectorAll('button[data-v]')) b.classList.toggle('active', b.dataset.v === templateType);
  templateText.value = templates[templateType] || DEFAULT_TEMPLATES[templateType];
  templateMsg.textContent = '';
}

function syncThemeSeg() {
  const active = state.settings ? state.settings.theme : 'auto';
  for (const b of themeSeg.querySelectorAll('button')) {
    b.classList.toggle('active', b.dataset.v === active);
  }
}

themeSeg.addEventListener('click', async ev => {
  const btn = ev.target.closest('button[data-v]');
  if (!btn) return;
  const res = await window.api.setSettings({ theme: btn.dataset.v });
  if (res.ok && state.settings) state.settings.theme = btn.dataset.v;
  syncThemeSeg();
});

autoStart.addEventListener('change', async () => {
  const res = await window.api.setSettings({ openAtLogin: autoStart.checked });
  if (!res.ok) { autoStart.checked = !autoStart.checked; toast(res.error || '设置失败'); }
  else {
    toast(autoStart.checked ? '将在开机时自动启动' : '已关闭开机自启');
    syncSilentRow();
  }
});

silentStart.addEventListener('change', async () => {
  const res = await window.api.setSettings({ silentStart: silentStart.checked });
  if (!res.ok) { silentStart.checked = !silentStart.checked; toast(res.error || '设置失败'); }
  else toast(silentStart.checked ? '开机将静默驻留托盘' : '开机将显示主窗口');
});

$('#set-openfolder').addEventListener('click', () => window.api.openDataFolder());

$('#ai-test').addEventListener('click', async () => {
  const button = $('#ai-test');
  button.disabled = true;
  aiMsg.className = 'set-msg';
  aiMsg.textContent = '正在测试连接并读取模型…';
  const res = await window.api.testAi(aiKey.value.trim());
  button.disabled = false;
  if (!res.ok) {
    aiMsg.textContent = res.error || '连接失败';
    if (state.settings?.ai) state.settings.ai = res.ai || state.settings.ai;
    syncAiSettingsUI(state.settings?.ai);
    syncAiEntry();
    return;
  }
  state.settings.ai = res.ai;
  aiKey.value = '';
  syncAiSettingsUI(res.ai);
  syncAiEntry();
  aiMsg.className = 'set-msg success';
  aiMsg.textContent = res.modelChanged ? `连接成功，模型已更新为 ${res.ai.model}` : `连接成功，发现 ${res.ai.models.length} 个可用模型`;
  toast('DeepSeek 已连接');
});

aiModel.addEventListener('change', async () => {
  if (!aiModel.value || !state.settings?.ai) return;
  const res = await window.api.setAiModel(aiModel.value);
  if (res.ok) {
    state.settings.ai = res.ai;
    syncAiSettingsUI(res.ai);
    syncAiEntry();
    aiMsg.textContent = '模型已更换，请重新测试连接';
  } else aiMsg.textContent = res.error || '模型更新失败';
});

$('#ai-clear').addEventListener('click', async () => {
  if (!state.settings?.ai?.configured || !confirm('清除 DeepSeek 配置后，AI 总结功能将隐藏。确定继续吗？')) return;
  const res = await window.api.clearAi();
  if (res.ok) {
    state.settings.ai = res.ai;
    syncAiSettingsUI(res.ai);
    syncAiEntry();
    toast('AI 配置已清除');
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
  if (!res.ok) { templateMsg.textContent = res.error || '模板保存失败'; return; }
  state.settings.reportTemplates[templateType] = value;
  templateMsg.className = 'set-msg success';
  templateMsg.textContent = '模板已保存';
  toast('总结模板已保存');
});

$('#template-reset').addEventListener('click', async () => {
  const value = DEFAULT_TEMPLATES[templateType];
  const res = await window.api.setReportTemplate(templateType, value);
  if (!res.ok) { templateMsg.textContent = res.error || '恢复失败'; return; }
  state.settings.reportTemplates[templateType] = value;
  syncTemplateUI();
  toast('已恢复默认模板');
});

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
  hkDisplay.textContent = (state.settings && state.settings.hotkey) || '未设置';
  if (!ok) hkMsg.textContent = '';
}

$('#hk-record').addEventListener('click', () => {
  state.recording = true;
  hkDisplay.classList.add('recording');
  hkDisplay.textContent = '请按下组合键…';
  hkMsg.textContent = 'Esc 取消';
});

$('#hk-reset').addEventListener('click', async () => {
  if (!state.settings) return;
  const res = await window.api.setSettings({ hotkey: state.settings.defaultHotkey });
  if (res.ok) {
    state.settings.hotkey = res.settings.hotkey;
    exitRecording(true);
    hkMsg.textContent = '';
    $('#hotkey-tip').textContent = res.settings.hotkey;
    toast('已恢复默认快捷键');
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
    if (!mods.length && !e.metaKey) { hkMsg.textContent = '需包含 Ctrl / Alt / Shift 中至少一个修饰键'; return; }
    const key = normKey(e);
    if (!key) { hkMsg.textContent = '请再按一个字母 / 数字 / F1-F12 键'; return; }
    const accel = [...mods, key].join('+');
    const res = await window.api.setSettings({ hotkey: accel });
    if (res.ok) {
      state.settings.hotkey = res.settings.hotkey;
      exitRecording(true);
      hkMsg.textContent = '';
      $('#hotkey-tip').textContent = res.settings.hotkey;
      toast(`快捷键已更新为 ${res.settings.hotkey}`);
    } else {
      hkDisplay.textContent = '请按下组合键…';
      hkMsg.textContent = `${res.error}，请重试`;
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

/* ---------- 初始化 ---------- */

async function refresh() {
  state.entries = await window.api.list();
  renderTodayPanel();
  renderStats();
  renderActivity();
  populateYearOptions();
  renderList();
  renderExportPreview();
  if (typeof updateListThumb === 'function') updateListThumb();
}

(function init() {
  window.api.getTheme().then(applyTheme);
  syncComposerTime();
  defaultRange();
  buildMonthOptions();
  $('#list-toolbar').insertBefore(rangeChip, $('#f-count'));
  renderRangeChip();
  window.api.onEntriesChanged(refresh);
  loadSettingsUI();
  refresh();
  composerText.focus();
})();
