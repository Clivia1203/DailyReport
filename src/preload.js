const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 记录的增删改查
  list: () => ipcRenderer.invoke('entries:list'),
  add: (text, ts) => ipcRenderer.invoke('entries:add', { text, ts }),
  update: (id, patch) => ipcRenderer.invoke('entries:update', { id, patch }),
  remove: id => ipcRenderer.invoke('entries:delete', { id }),
  deleteMany: ids => ipcRenderer.invoke('entries:deleteMany', { ids }),

  // 设置
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),
  onNavigate: cb => {
    const h = (_e, view) => cb(view);
    ipcRenderer.on('ui:navigate', h);
    return () => ipcRenderer.removeListener('ui:navigate', h);
  },

  // 导出
  exportRange: (start, end, format) => ipcRenderer.invoke('export:run', { start, end, format }),

  // 快速记录条
  hideQuick: () => ipcRenderer.send('quick:hide'),

  // 主题（主进程统一管理，多窗口同步）
  getTheme: () => ipcRenderer.invoke('theme:get'),
  setTheme: pref => ipcRenderer.invoke('theme:set', pref),
  onThemeChanged: cb => {
    const h = (_e, t) => cb(t);
    ipcRenderer.on('theme:changed', h);
    return () => ipcRenderer.removeListener('theme:changed', h);
  },

  // 主进程主动推送（快速条新增记录时刷新主界面）
  onEntriesChanged: cb => {
    const h = () => cb();
    ipcRenderer.on('entries:changed', h);
    return () => ipcRenderer.removeListener('entries:changed', h);
  },

  // 快速条每次唤起时重置输入
  onQuickReset: cb => {
    const h = () => cb();
    ipcRenderer.on('quick:reset', h);
    return () => ipcRenderer.removeListener('quick:reset', h);
  }
});
