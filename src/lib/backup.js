/* 备份文件的数据边界：只处理可移植的数据，不把 Windows 安全存储里的 API Key 带出。 */

const BACKUP_FORMAT = 'daily-report-backup';
const BACKUP_VERSION = 1;

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeReport(report) {
  const { contentFile, ...rest } = report || {};
  return { ...clone(rest), content: String(report?.content || '') };
}

function createBackupPayload({ settings = {}, entries = [], reports = [], closureSummaries = [], exportedAt = Date.now() } = {}) {
  const safeSettings = clone(settings || {});
  if (isObject(safeSettings.ai)) {
    // encryptedApiKey 只能在当前 Windows 用户的安全存储中解密，不能随备份跨设备传播。
    safeSettings.ai = { ...safeSettings.ai, encryptedApiKey: '' };
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: '日报随手记',
    exportedAt,
    settings: safeSettings,
    data: {
      version: 2,
      entries: clone(Array.isArray(entries) ? entries : []),
      reports: (Array.isArray(reports) ? reports : []).map(safeReport),
      closureSummaries: clone(Array.isArray(closureSummaries) ? closureSummaries : [])
    }
  };
}

function invalid(error) {
  return { ok: false, error };
}

function validateBackupPayload(payload) {
  if (!isObject(payload)) return invalid('备份文件不是有效的 JSON 对象');
  if (payload.format !== BACKUP_FORMAT || payload.version !== BACKUP_VERSION) {
    return invalid('备份文件版本不受支持');
  }
  if (!isObject(payload.settings) || !isObject(payload.data)) {
    return invalid('备份文件缺少设置或数据');
  }
  if (payload.data.version !== 2) {
    return invalid('备份文件中的数据版本不受支持');
  }
  if (!Array.isArray(payload.data.entries) || !Array.isArray(payload.data.reports)) {
    return invalid('备份文件中的数据结构无效');
  }

  const invalidEntry = payload.data.entries.some(entry => (
    !isObject(entry)
    || typeof entry.id !== 'string'
    || !entry.id.trim()
    || typeof entry.text !== 'string'
    || !entry.text.trim()
    || !Number.isFinite(Number(entry.ts))
  ));
  if (invalidEntry) return invalid('备份文件包含无效的日报记录');

  const invalidReport = payload.data.reports.some(report => (
    !isObject(report)
    || typeof report.id !== 'string'
    || !report.id.trim()
    || typeof report.content !== 'string'
  ));
  if (invalidReport) return invalid('备份文件包含无效的周期总结');

  return {
    ok: true,
    summary: {
      entries: payload.data.entries.length,
      reports: payload.data.reports.length
    }
  };
}

function restoreSettingsSnapshot(current, incoming, defaults) {
  const base = clone(defaults || {});
  const currentSettings = isObject(current) ? clone(current) : {};
  const backupSettings = isObject(incoming) ? clone(incoming) : {};
  const currentKey = currentSettings.ai?.encryptedApiKey || base.ai?.encryptedApiKey || '';

  const next = {
    ...base,
    ...currentSettings,
    ...backupSettings,
    ai: {
      ...(base.ai || {}),
      ...(currentSettings.ai || {}),
      ...(backupSettings.ai || {}),
      encryptedApiKey: currentKey
    },
    reportTemplates: {
      ...(base.reportTemplates || {}),
      ...(currentSettings.reportTemplates || {}),
      ...(backupSettings.reportTemplates || {})
    },
    savedFilters: Array.isArray(backupSettings.savedFilters)
      ? backupSettings.savedFilters
      : (Array.isArray(currentSettings.savedFilters) ? currentSettings.savedFilters : [])
  };

  return next;
}

function restoreDataSnapshot(data) {
  const checked = validateBackupPayload({
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    settings: {},
    data
  });
  if (!checked.ok) throw new Error(checked.error);

  return {
    version: 2,
    entries: data.entries.map(entry => ({
      ...clone(entry),
      id: entry.id.trim(),
      ts: Number(entry.ts),
      createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Number(entry.ts)
    })),
    reports: data.reports.map(report => safeReport(report)),
    closureSummaries: Array.isArray(data.closureSummaries) ? clone(data.closureSummaries) : []
  };
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createBackupPayload,
  validateBackupPayload,
  restoreSettingsSnapshot,
  restoreDataSnapshot
};
