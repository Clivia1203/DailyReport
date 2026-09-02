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

// 先播 CSS 退出动画，动画结束后再隐藏窗口（主进程 quick:hide）
function requestHide() {
  if (hiding) return;
  hiding = true;
  document.querySelector('.quickbar').classList.add('out');
  setTimeout(() => {
    hiding = false;
    window.api.hideQuick();
  }, 150);
}

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
  bar.classList.remove('out');
  bar.classList.remove('in');      // 重触发入场动画
  void bar.offsetWidth;
  bar.classList.add('in');
  input.value = '';
  status.classList.remove('show');
  renderNow();
  input.focus();
});

renderNow();
setInterval(renderNow, 15000);
