const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createBackupPayload,
  validateBackupPayload,
  restoreSettingsSnapshot,
  restoreDataSnapshot
} = require('./backup');

const defaults = {
  theme: 'auto',
  hotkey: 'Alt+Shift+D',
  openAtLogin: false,
  silentStart: false,
  ai: {
    baseUrl: 'https://api.deepseek.com',
    model: '',
    models: [],
    reasoningEffort: 'auto',
    encryptedApiKey: '',
    lastTestAt: 0,
    lastTestOk: false,
    lastError: ''
  },
  reportTemplates: { day: '日', week: '周', month: '月', custom: '自定义' },
  savedFilters: []
};

test('备份包含记录、总结和设置，但不带出 API Key', () => {
  const payload = createBackupPayload({
    settings: {
      ...defaults,
      theme: 'dark',
      ai: { ...defaults.ai, encryptedApiKey: 'secret-key', model: 'deepseek-v4-flash' },
      reportTemplates: { ...defaults.reportTemplates, week: '按主题整理' },
      savedFilters: [{ id: 'f1', name: '客户问题', text: '客户' }]
    },
    entries: [{ id: 'e1', text: '完成接口联调', ts: 1000, createdAt: 1000 }],
    reports: [{
      id: 'r1',
      contentFile: 'r1.md',
      thinkingFile: 'r1.thinking.json',
      content: '# 工作总结\n正文',
      thinking: { phase: 'done', text: '思考过程' }
    }],
    closureSummaries: [{ id: 'c1', start: '2026-09-01', end: '2026-09-07', completed_items: [] }],
    exportedAt: 1234
  });

  assert.equal(payload.format, 'daily-report-backup');
  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, 1234);
  assert.equal(payload.data.entries.length, 1);
  assert.equal(payload.data.reports[0].content, '# 工作总结\n正文');
  assert.equal(payload.data.reports[0].contentFile, undefined);
  assert.deepEqual(payload.data.reports[0].thinking, { phase: 'done', text: '思考过程' });
  assert.equal(payload.data.reports[0].thinkingFile, undefined);
  assert.equal(payload.settings.ai.encryptedApiKey, '');
  assert.equal(JSON.stringify(payload).includes('secret-key'), false);
  assert.equal(payload.settings.savedFilters[0].name, '客户问题');
  assert.equal(payload.data.closureSummaries[0].id, 'c1');
});

test('备份校验返回可展示的记录和总结数量', () => {
  const payload = createBackupPayload({ settings: defaults, entries: [{ id: 'e1', text: 'x', ts: 1 }], reports: [] });
  assert.deepEqual(validateBackupPayload(payload), {
    ok: true,
    summary: { entries: 1, reports: 0 }
  });
});

test('结构损坏或缺少数据区的文件会被拒绝', () => {
  assert.equal(validateBackupPayload(null).ok, false);
  assert.equal(validateBackupPayload({ format: 'other', version: 1, data: {} }).ok, false);
  assert.equal(validateBackupPayload({ format: 'daily-report-backup', version: 1, data: { entries: [], reports: 'bad' } }).ok, false);
  const wrongDataVersion = createBackupPayload({ settings: defaults });
  wrongDataVersion.data.version = 99;
  assert.equal(validateBackupPayload(wrongDataVersion).ok, false);
});

test('恢复设置时保留当前机器的 API Key，其他设置读取备份', () => {
  const restored = restoreSettingsSnapshot(
    { ...defaults, theme: 'light', ai: { ...defaults.ai, encryptedApiKey: 'local-key', model: 'old' } },
    { ...defaults, theme: 'dark', ai: { ...defaults.ai, encryptedApiKey: 'backup-key', model: 'new' }, reportTemplates: { ...defaults.reportTemplates, week: '备份模板' } },
    defaults
  );

  assert.equal(restored.theme, 'dark');
  assert.equal(restored.ai.model, 'new');
  assert.equal(restored.ai.encryptedApiKey, 'local-key');
  assert.equal(restored.reportTemplates.week, '备份模板');
});

test('恢复数据时规范化时间戳并移除旧的正文和思考过程文件路径', () => {
  const restored = restoreDataSnapshot({
    version: 2,
    entries: [{ id: 'e1', text: '记录', ts: '1000', createdAt: '900' }],
    reports: [{
      id: 'r1',
      contentFile: 'old.md',
      thinkingFile: 'old.thinking.json',
      content: '# 总结',
      thinking: { phase: 'done', text: '思考' }
    }],
    closureSummaries: [{ id: 'c1', completed_items: [] }]
  });

  assert.equal(restored.entries[0].ts, 1000);
  assert.equal(restored.entries[0].createdAt, 900);
  assert.equal(restored.reports[0].contentFile, undefined);
  assert.equal(restored.reports[0].content, '# 总结');
  assert.equal(restored.reports[0].thinkingFile, undefined);
  assert.deepEqual(restored.reports[0].thinking, { phase: 'done', text: '思考' });
  assert.equal(restored.closureSummaries[0].id, 'c1');
});
