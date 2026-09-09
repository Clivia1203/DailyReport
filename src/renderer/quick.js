const input = document.getElementById('quick-input');
const status = document.getElementById('quick-status');
const dt = document.getElementById('quick-dt');

const QUICK_WINDOW_BASE_HEIGHT = 176;
const QUICK_INPUT_MAX_HEIGHT = 160;
let quickInputBaseHeight = 0;
let lastQuickWindowHeight = QUICK_WINDOW_BASE_HEIGHT;
let quickClockTimer = null;

function syncQuickInputLayout() {
  if (!input?.style) return;

  input.style.height = 'auto';
  const naturalHeight = Math.max(input.scrollHeight || 0, 30);
  if (!quickInputBaseHeight || !input.value) quickInputBaseHeight = naturalHeight;

  const nextHeight = Math.min(naturalHeight, QUICK_INPUT_MAX_HEIGHT);
  input.style.height = `${nextHeight}px`;
  input.style.overflowY = naturalHeight > QUICK_INPUT_MAX_HEIGHT ? 'auto' : 'hidden';

  const targetWindowHeight = QUICK_WINDOW_BASE_HEIGHT + Math.max(0, nextHeight - quickInputBaseHeight);
  // 高度没有变化时不要重复走 IPC 和原生窗口动画；连续输入时主进程会复用同一段动画。
  if (targetWindowHeight !== lastQuickWindowHeight) {
    lastQuickWindowHeight = targetWindowHeight;
    window.api.resizeQuick?.(targetWindowHeight);
  }
}

const uiText = value => window.DRI18n?.t ? window.DRI18n.t(String(value ?? '')) : String(value ?? '');

let localeSyncSerial = 0;

async function syncLocale(locale) {
  if (!locale || !window.DRI18n) return;
  const serial = ++localeSyncSerial;
  try {
    await window.DRI18n.setLocale(locale);
  } catch {
    // 语言包读取失败时保留当前快速记录条，不中断记录输入。
  }
  if (serial === localeSyncSerial) renderNow();
}

input.addEventListener('input', syncQuickInputLayout);

/* 主题跟随主窗口（主进程下发） */
const applyTheme = t => {
  const fallbackFamily = document.documentElement.dataset.themeFamily || 'gold';
  const fallbackMode = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  const next = t && typeof t === 'object'
    ? {
      family: ['gold', 'sky', 'mint', 'violet', 'navy', 'graphite', 'pine', 'amber', 'indigo', 'steel'].includes(t.family) ? t.family : fallbackFamily,
      mode: ['light', 'dark'].includes(t.mode) ? t.mode : fallbackMode
    }
    : { family: fallbackFamily, mode: t === 'dark' ? 'dark' : 'light' };
  document.documentElement.dataset.theme = next.mode;
  document.documentElement.dataset.themeFamily = next.family;
};
window.api.getTheme().then(applyTheme);
window.api.onThemeChanged(applyTheme);
window.api.onLocaleChanged?.(locale => {
  syncLocale(locale);
});

// 语言广播可能发生在快速记录条脚本注册监听器之前（首次启动或小窗重建），
// 因此启动时主动向主进程读取一次当前语言，避免沿用旧的 localStorage 缓存。
window.api.getLocale?.().then(locale => {
  if (localeSyncSerial === 0) syncLocale(locale);
}).catch(() => {
  // 主进程读取失败时保留当前快速记录条，不中断记录输入。
});

const pad = n => String(n).padStart(2, '0');

function renderNow() {
  const d = new Date();
  const weekdays = '日一二三四五六';
  dt.textContent = uiText(
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` 星期${weekdays[d.getDay()]}`
  ) + ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let hiding = false;
let quickSession = 0;
let hideTimer = null;
let commitHideTimer = null;

function clearPendingHideTimers() {
  if (hideTimer !== null) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (commitHideTimer !== null) {
    clearTimeout(commitHideTimer);
    commitHideTimer = null;
  }
}

// 播放退出动画。隐藏窗口由两条路径各自负责：
// Esc/保存走 requestHide（页面计时后调 api.hideQuick）；
// 失焦/热键切换走主进程 hideQuickAnimated（主进程计时后自行 hide）。
function playOut() {
  if (hiding) return;
  hiding = true;
  document.querySelector('.quickbar').classList.add('out');
}

function requestHide() {
  if (hiding) return;
  const session = quickSession;
  playOut();
  hideTimer = setTimeout(() => {
    hideTimer = null;
    if (session !== quickSession) return;
    window.api.hideQuick(session);
  }, 150);
}

// 主进程发起的退出（失焦/热键切换）：同样走完整动画后回执隐藏
window.api.onQuickOut(generation => {
  if (Number.isInteger(generation)) {
    // 首次唤起时 reset 可能早于页面监听器到达；当前代次的退出事件仍应
    // 被接受，只有明确属于更早一轮的事件才需要丢弃。
    if (generation < quickSession) return;
    quickSession = generation;
  }
  if (!hiding) requestHide();
});

async function commit() {
  const text = input.value.trim();
  if (!text) { requestHide(); return; }
  const session = quickSession;
  await window.api.add(text, Date.now());
  if (session !== quickSession) return;
  input.value = '';
  syncQuickInputLayout();
  status.classList.add('show');
  commitHideTimer = setTimeout(() => {
    commitHideTimer = null;
    if (session !== quickSession) return;
    status.classList.remove('show');
    requestHide();
  }, 550);
}

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) commit();
  if (e.key === 'Escape') requestHide();
});

window.api.onQuickReset(generation => {
  const bar = document.querySelector('.quickbar');
  if (Number.isInteger(generation)) {
    if (generation < quickSession) return;
    quickSession = generation;
  } else {
    quickSession += 1;
  }
  clearPendingHideTimers();
  hiding = false;             // 新一轮唤起，退出态复位
  bar.classList.remove('out');
  bar.classList.remove('in'); // 重触发入场动画
  void bar.offsetWidth;
  bar.classList.add('in');
  input.value = '';
  syncQuickInputLayout();
  status.classList.remove('show');
  renderNow();
  input.focus();
  // 主进程等页面完成退场态清理后再显示原生窗口，避免先显示上一轮透明残帧。
  if (Number.isInteger(generation) && typeof window.api.quickResetReady === 'function') {
    window.api.quickResetReady(generation);
  }
});

function scheduleQuickClock() {
  if (quickClockTimer !== null) {
    if (typeof clearInterval === 'function') clearInterval(quickClockTimer);
    quickClockTimer = null;
  }
  if (document.hidden) return;
  renderNow();
  quickClockTimer = setInterval(() => {
    if (document.hidden) {
      if (typeof clearInterval === 'function') clearInterval(quickClockTimer);
      quickClockTimer = null;
      return;
    }
    renderNow();
  }, 15000);
}

document.addEventListener?.('visibilitychange', scheduleQuickClock);
renderNow();
syncQuickInputLayout();
scheduleQuickClock();
