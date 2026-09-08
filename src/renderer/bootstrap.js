// 在首帧渲染前给出主题提示，避免切换主题时闪白。
// 权威主题由主进程通过 IPC 下发（见 app.js / quick.js），这里只是同步引导。
(function () {
  var t;
  var family = 'gold';
  var mode = 'light';
  try {
    t = localStorage.getItem('theme:cache') || localStorage.getItem('theme'); // 'theme' 为旧版键，兼容一次
  } catch (e) { /* 忽略 */ }
  if (typeof t === 'string' && t.includes('|')) {
    var parts = t.split('|');
    if (['gold', 'sky', 'mint', 'violet', 'navy', 'graphite', 'pine', 'amber', 'indigo', 'steel'].includes(parts[0])) family = parts[0];
    if (parts[1] === 'light' || parts[1] === 'dark') mode = parts[1];
  } else if (t === 'light' || t === 'dark') {
    mode = t;
  } else {
    mode = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = mode;
  document.documentElement.dataset.themeFamily = family;
})();
