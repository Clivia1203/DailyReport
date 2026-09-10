const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createReportStorage } = require('./report-storage');

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-report-storage-'));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('旧版内嵌报告正文和 AI 思考可以自动外置，且原对象不被破坏', () => withTempDirectory(directory => {
  const storage = createReportStorage({ directory, idFactory: () => 'temp-file' });
  const thinking = { phase: 'done', text: '思考内容', content: '输出内容' };
  const legacy = {
    id: 'report-1',
    title: '旧报告',
    content: '# 报告正文',
    thinking
  };

  const result = storage.migrateReports([legacy]);
  const migrated = result.reports[0];

  assert.equal(legacy.content, '# 报告正文');
  assert.deepEqual(legacy.thinking, thinking);
  assert.equal(migrated.content, undefined);
  assert.equal(migrated.thinking, undefined);
  assert.equal(migrated.contentFile, 'report-1.md');
  assert.equal(migrated.thinkingFile, 'report-1.thinking.json');
  assert.equal(result.migratedReports, 1);
  assert.equal(result.migratedContent, 1);
  assert.equal(result.migratedThinking, 1);
  assert.equal(storage.readContent(migrated), '# 报告正文');
  assert.deepEqual(storage.readThinking(migrated), thinking);
  assert.equal(fs.readFileSync(path.join(directory, 'report-1.md'), 'utf8'), '# 报告正文');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(directory, 'report-1.thinking.json'), 'utf8')), thinking);
}));

test('外置文件缺失时仍回退读取旧版内嵌内容', () => withTempDirectory(directory => {
  const storage = createReportStorage({ directory });
  const report = {
    id: 'legacy-fallback',
    contentFile: 'missing.md',
    thinkingFile: 'missing.thinking.json',
    content: '旧正文',
    thinking: { phase: 'done', text: '旧思考' }
  };

  assert.equal(storage.readContent(report), '旧正文');
  assert.deepEqual(storage.readThinking(report), report.thinking);
}));

test('持久化新报告后不再把正文和思考过程留在 data.json 对象中', () => withTempDirectory(directory => {
  const storage = createReportStorage({ directory, idFactory: () => 'temp-file' });
  const report = {
    id: 'new-report',
    content: '正文',
    thinking: { phase: 'done', text: '过程' }
  };

  storage.persist(report);

  assert.equal(report.content, undefined);
  assert.equal(report.thinking, undefined);
  assert.equal(storage.forClient(report).content, '正文');
  assert.deepEqual(storage.forClient(report).thinking, { phase: 'done', text: '过程' });
  assert.equal(storage.forClient(report).contentFile, undefined);
  assert.equal(storage.forClient(report).thinkingFile, undefined);
}));

test('备份视图会恢复完整正文和思考过程，但不暴露外置文件路径', () => withTempDirectory(directory => {
  const storage = createReportStorage({ directory, idFactory: () => 'temp-file' });
  const report = { id: 'backup-report', content: '正文', thinking: { phase: 'done' } };
  storage.persist(report);

  const backup = storage.forBackup(report);

  assert.equal(backup.content, '正文');
  assert.deepEqual(backup.thinking, { phase: 'done' });
  assert.equal(backup.contentFile, undefined);
  assert.equal(backup.thinkingFile, undefined);
}));
