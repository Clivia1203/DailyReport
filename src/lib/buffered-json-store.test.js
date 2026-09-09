const assert = require('node:assert/strict');
const test = require('node:test');
const { createBufferedJsonStore } = require('./buffered-json-store');

function createTimerHarness() {
  let nextId = 0;
  const timers = new Map();
  return {
    schedule(callback, delay) {
      const id = ++nextId;
      timers.set(id, { callback, delay });
      return id;
    },
    cancel(id) {
      timers.delete(id);
    },
    runNext() {
      const item = timers.entries().next().value;
      if (!item) return false;
      const [id, timer] = item;
      timers.delete(id);
      timer.callback();
      return true;
    },
    get size() {
      return timers.size;
    },
    delays() {
      return [...timers.values()].map(timer => timer.delay);
    }
  };
}

test('缓冲 JSON 存储只读取一次，并合并短时间内的多次保存', () => {
  const timer = createTimerHarness();
  let disk = { version: 2, entries: [] };
  let signature = 'v1';
  let reads = 0;
  let writes = 0;
  const store = createBufferedJsonStore({
    read: () => { reads += 1; return structuredClone(disk); },
    write: next => { writes += 1; disk = structuredClone(next); signature = `v${writes + 1}`; },
    signature: () => signature,
    delay: 350,
    schedule: timer.schedule,
    cancel: timer.cancel
  });

  const first = store.load();
  assert.equal(store.load(), first);
  first.entries.push({ id: 'e1' });
  store.save(first);
  first.entries.push({ id: 'e2' });
  store.save(first);

  assert.equal(reads, 1);
  assert.equal(writes, 0);
  assert.equal(timer.size, 1);
  assert.deepEqual(timer.delays(), [350]);

  timer.runNext();
  assert.equal(writes, 1);
  assert.deepEqual(disk.entries.map(entry => entry.id), ['e1', 'e2']);
  assert.equal(store.isDirty(), false);
});

test('磁盘签名变化且没有本地待写数据时会重新读取外部修改', () => {
  const timer = createTimerHarness();
  let disk = { version: 2, entries: [{ id: 'old' }] };
  let signature = 'v1';
  let reads = 0;
  const store = createBufferedJsonStore({
    read: () => { reads += 1; return structuredClone(disk); },
    write: next => { disk = structuredClone(next); },
    signature: () => signature,
    schedule: timer.schedule,
    cancel: timer.cancel
  });

  assert.equal(store.load().entries[0].id, 'old');
  disk = { version: 2, entries: [{ id: 'external' }] };
  signature = 'v2';

  assert.equal(store.load().entries[0].id, 'external');
  assert.equal(reads, 2);
});

test('退出刷盘会取消待执行的防抖计时器并保持失败数据为 dirty', () => {
  const timer = createTimerHarness();
  let writes = 0;
  let failWrites = true;
  const store = createBufferedJsonStore({
    read: () => ({ version: 2, entries: [] }),
    write: () => {
      writes += 1;
      if (failWrites) throw new Error('disk unavailable');
    },
    signature: () => 'stable',
    schedule: timer.schedule,
    cancel: timer.cancel
  });

  const db = store.load();
  db.entries.push({ id: 'e1' });
  store.save(db);
  assert.throws(() => store.flush(), /disk unavailable/);
  assert.equal(store.isDirty(), true);
  assert.equal(writes, 1);
  assert.equal(timer.size, 0);

  failWrites = false;
  assert.equal(store.flush(), true);
  assert.equal(writes, 2);
  assert.equal(timer.size, 0);
  assert.equal(store.flush(), false);
});
