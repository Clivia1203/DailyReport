const assert = require('node:assert/strict');
const test = require('node:test');
const { createClosureHistoryCache } = require('./closure-history-cache');

test('当前周期记录变化时复用未受影响的历史来源', () => {
  const cache = createClosureHistoryCache();
  let builds = 0;
  const first = cache.get('2026-09-01', () => ({ id: ++builds }));

  cache.invalidate(['2026-09-05']);
  assert.equal(cache.get('2026-09-01', () => ({ id: ++builds })), first);
  assert.equal(builds, 1);
});

test('历史日期变化时只淘汰受影响起始日期的缓存', () => {
  const cache = createClosureHistoryCache();
  let builds = 0;
  const early = cache.get('2026-09-01', () => ({ id: ++builds }));
  const late = cache.get('2026-09-10', () => ({ id: ++builds }));

  cache.invalidate(['2026-09-05']);
  assert.equal(cache.get('2026-09-01', () => ({ id: ++builds })), early);
  assert.notEqual(cache.get('2026-09-10', () => ({ id: ++builds })), late);
  assert.equal(builds, 3);
});

test('无日期上下文变化时清空缓存，并限制缓存数量', () => {
  const cache = createClosureHistoryCache({ maxEntries: 2 });
  cache.get('2026-09-01', () => 'a');
  cache.get('2026-09-02', () => 'b');
  cache.get('2026-09-03', () => 'c');
  assert.equal(cache.size(), 2);
  assert.equal(cache.get('2026-09-01', () => 'new-a'), 'new-a');

  cache.invalidate();
  assert.equal(cache.size(), 0);
});
