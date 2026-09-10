const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createRecoverableJsonFile } = require('./recoverable-json-file');

function withTempDirectory(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-report-json-'));
  try { return run(directory); }
  finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

function adapterFor(directory, events) {
  const file = path.join(directory, 'data.json');
  return {
    file,
    adapter: createRecoverableJsonFile({
      file,
      empty: () => ({ version: 2, entries: [] }),
      validate: value => !!value && Array.isArray(value.entries),
      recoveryDirectory: path.join(directory, 'backups'),
      now: () => new Date('2026-09-10T13:00:00.000Z'),
      idFactory: () => 'recovery-id',
      onEvent: event => events.push(event)
    })
  };
}

test('写入 JSON 前保留上一份完整文件，主文件损坏时自动恢复', () => withTempDirectory(directory => {
  const events = [];
  const { file, adapter } = adapterFor(directory, events);
  const oldValue = { version: 2, entries: [{ id: 'old' }] };
  const nextValue = { version: 2, entries: [{ id: 'new' }] };

  fs.writeFileSync(file, JSON.stringify(oldValue), 'utf8');
  adapter.write(nextValue);
  assert.deepEqual(JSON.parse(fs.readFileSync(`${file}.bak`, 'utf8')), oldValue);

  fs.writeFileSync(file, '{ damaged', 'utf8');
  assert.deepEqual(adapter.read(), oldValue);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), oldValue);
  assert.equal(events.some(event => event.type === 'recovered'), true);
  assert.equal(fs.readdirSync(path.join(directory, 'backups')).length, 1);
}));

test('没有可用备份时保留损坏文件并返回空数据，不抛出异常', () => withTempDirectory(directory => {
  const events = [];
  const { file, adapter } = adapterFor(directory, events);
  fs.writeFileSync(file, '{ damaged', 'utf8');

  assert.deepEqual(adapter.read(), { version: 2, entries: [] });
  assert.equal(events.some(event => event.type === 'unrecoverable'), true);
  assert.equal(fs.readdirSync(path.join(directory, 'backups')).length, 1);
}));

test('合法 JSON 但结构不完整时也会走备份恢复，而不是静默当成空库', () => withTempDirectory(directory => {
  const events = [];
  const { file, adapter } = adapterFor(directory, events);
  const oldValue = { version: 2, entries: [{ id: 'safe' }] };

  fs.writeFileSync(`${file}.bak`, JSON.stringify(oldValue), 'utf8');
  fs.writeFileSync(file, JSON.stringify({ version: 2, wrong: true }), 'utf8');

  assert.deepEqual(adapter.read(), oldValue);
  assert.equal(events.some(event => event.type === 'recovered'), true);
}));
