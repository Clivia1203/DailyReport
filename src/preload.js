const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 记录的增删改查
  list: () => ipcRenderer.invoke('entries:list'),
  add: (text, ts) => ipcRenderer.invoke('entries:add', { text, ts }),
  update: (id, patch) => ipcRenderer.invoke('entries:update', { id, patch }),
  remove: id => ipcRenderer.invoke('entries:delete', { id }),
  deleteMany: ids => ipcRenderer.invoke('entries:deleteMany', { ids }),

  // 设置
  loadLocale: locale => ipcRenderer.invoke('locale:load', locale),
  getLocale: () => ipcRenderer.invoke('locale:get'),
  getAppInfo: () => ipcRenderer.invoke('app:info'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: patch => ipcRenderer.invoke('settings:set', patch),
  onLocaleChanged: cb => {
    const h = (_e, locale) => cb(locale);
    ipcRenderer.on('locale:changed', h);
    return () => ipcRenderer.removeListener('locale:changed', h);
  },
  openDataFolder: () => ipcRenderer.invoke('data:openFolder'),
  exportBackup: () => ipcRenderer.invoke('data:backup'),
  restoreBackup: () => ipcRenderer.invoke('data:restore'),
  setSavedFilters: filters => ipcRenderer.invoke('settings:setSavedFilters', { filters }),
  onNavigate: cb => {
    const h = (_e, view) => cb(view);
    ipcRenderer.on('ui:navigate', h);
    return () => ipcRenderer.removeListener('ui:navigate', h);
  },

  // 导出
  exportRange: (start, end, format) => ipcRenderer.invoke('export:run', { start, end, format }),

  // AI 平台与周期总结
  getAiStatus: () => ipcRenderer.invoke('ai:status'),
  revealAiKey: () => ipcRenderer.invoke('ai:reveal'),
  testAi: config => ipcRenderer.invoke('ai:test', typeof config === 'string' ? { apiKey: config } : (config || {})),
  cancelAiTest: () => ipcRenderer.send('ai:test:cancel'),
  saveAi: config => ipcRenderer.invoke('ai:save', typeof config === 'string' ? { apiKey: config } : (config || {})),
  clearAi: () => ipcRenderer.invoke('ai:clear'),
  setAiModel: model => ipcRenderer.invoke('ai:setModel', { model }),
  setAiClosureModel: model => ipcRenderer.invoke('ai:setClosureModel', { model }),
  setAiReasoningEffort: reasoningEffort => ipcRenderer.invoke('ai:setReasoningEffort', { reasoningEffort }),
  setAiClosureReasoningEffort: reasoningEffort => ipcRenderer.invoke('ai:setClosureReasoningEffort', { reasoningEffort }),
  setAiThinkingVisibility: showThinking => ipcRenderer.invoke('ai:setThinkingVisibility', { showThinking }),
  getCachedReport: params => ipcRenderer.invoke('report:getCached', params),
  generateReport: params => ipcRenderer.invoke('report:generate', params),
  saveReport: (id, content) => ipcRenderer.invoke('report:save', { id, content }),
  saveReportThinking: (id, thinking) => ipcRenderer.invoke('report:saveThinking', { id, thinking }),
  exportReport: (id, format) => ipcRenderer.invoke('report:export', { id, format }),
  setReportTemplate: (type, template) => ipcRenderer.invoke('settings:setReportTemplate', { type, template }),
  setClosurePrompt: prompt => ipcRenderer.invoke('settings:setClosurePrompt', { prompt }),
  setTerminologyDiscoveryPrompt: prompt => ipcRenderer.invoke('settings:setTerminologyDiscoveryPrompt', { prompt }),
  setTerminology: terminology => ipcRenderer.invoke('settings:setTerminology', { terminology }),
  addTerminologyAlias: (canonicalName, alias, scope) => ipcRenderer.invoke('settings:addTerminologyAlias', { canonicalName, alias, scope }),
  addTerminologyExclusion: (canonicalName, alias) => ipcRenderer.invoke('settings:addTerminologyExclusion', { canonicalName, alias }),
  discoverTerminology: options => ipcRenderer.invoke('terminology:discover', options),
  getCachedClosure: params => ipcRenderer.invoke('closure:getCached', params),
  generateRecentClosures: params => ipcRenderer.invoke('closure:generate', params),
  onReportProgress: cb => {
    const h = (_e, progress) => cb(progress);
    ipcRenderer.on('report:progress', h);
    return () => ipcRenderer.removeListener('report:progress', h);
  },
  onClosureProgress: cb => {
    const h = (_e, progress) => cb(progress);
    ipcRenderer.on('closure:progress', h);
    return () => ipcRenderer.removeListener('closure:progress', h);
  },
  onTerminologyProgress: cb => {
    const h = (_e, progress) => cb(progress);
    ipcRenderer.on('terminology:progress', h);
    return () => ipcRenderer.removeListener('terminology:progress', h);
  },

  // 快速记录条
  hideQuick: generation => ipcRenderer.send('quick:hide', generation),
  resizeQuick: height => ipcRenderer.send('quick:resize', height),

  // 主窗口自绘标题栏
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    getState: () => ipcRenderer.invoke('window:state:get'),
    onStateChanged: cb => {
      const h = (_e, state) => cb(state);
      ipcRenderer.on('window:state', h);
      return () => ipcRenderer.removeListener('window:state', h);
    }
  },

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
  quickResetReady: generation => ipcRenderer.send('quick:reset-ready', generation),
  onQuickReset: cb => {
    const h = (_e, generation) => cb(generation);
    ipcRenderer.on('quick:reset', h);
    return () => ipcRenderer.removeListener('quick:reset', h);
  },

  // 主进程发起的退出（失焦/热键切换）：页面播退出动画，隐藏时机由主进程计时
  onQuickOut: cb => {
    const h = (_e, generation) => cb(generation);
    ipcRenderer.on('quick:out', h);
    return () => ipcRenderer.removeListener('quick:out', h);
  }
});
