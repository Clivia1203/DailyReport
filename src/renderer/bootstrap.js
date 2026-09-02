// 在首帧渲染前给出主题提示，避免深色模式下闪白。
// 权威主题由主进程通过 IPC 下发（见 app.js / quick.js），这里只是同步引导。
(function () {
  var t;
  try {
    t = localStorage.getItem('theme:cache') || localStorage.getItem('theme'); // 'theme' 为旧版键，兼容一次
  } catch (e) { /* 忽略 */ }
  if (t !== 'light' && t !== 'dark') {
    t = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = t;
})();
