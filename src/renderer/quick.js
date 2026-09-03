const input = document.getElementById('quick-input');
const status = document.getElementById('quick-status');
const dt = document.getElementById('quick-dt');

/* 主题跟随主窗口（主进程下发） */
const applyTheme = t => { document.documentElement.dataset.theme = t; };
window.api.getTheme().then(applyTheme);
window.api.onThemeChanged(applyTheme);

const pad = n => String(n).padStart(2, '0');

function renderNow() {
  const d = new Date();
  const weekdays = '日一二三四五六';
  dt.textContent =
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    ` 星期${weekdays[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

let hiding = false;

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
  playOut();
  setTimeout(() => window.api.hideQuick(), 150);
}

// 主进程发起的退出：只播动画
window.api.onQuickOut(playOut);

async function commit() {
  const text = input.value.trim();
  if (!text) { requestHide(); return; }
  await window.api.add(text, Date.now());
  input.value = '';
  status.classList.add('show');
  setTimeout(() => {
    status.classList.remove('show');
    requestHide();
  }, 550);
}

input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.isComposing) commit();
  if (e.key === 'Escape') requestHide();
});

window.api.onQuickReset(() => {
  const bar = document.querySelector('.quickbar');
  hiding = false;             // 新一轮唤起，退出态复位
  bar.classList.remove('out');
  bar.classList.remove('in'); // 重触发入场动画
  void bar.offsetWidth;
  bar.classList.add('in');
  input.value = '';
  status.classList.remove('show');
  renderNow();
  input.focus();
});

renderNow();
setInterval(renderNow, 15000);
