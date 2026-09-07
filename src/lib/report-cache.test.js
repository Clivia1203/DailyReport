const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  reportCacheKey,
  findCachedReport,
  findLatestReport,
  reportCacheStatus
} = require('./report-cache');

const params = {
  periodType: 'week',
  start: '2026-08-31',
  end: '2026-09-06',
  sourceHashValue: 'source-current',
  templateHashValue: 'template-current'
};

function report(overrides = {}) {
  return {
    id: 'report',
    periodType: params.periodType,
    start: params.start,
    end: params.end,
    model: 'deepseek-v4-flash',
    createdAt: 1,
    updatedAt: 1,
    ...overrides
  };
}

test('reportCacheKey: 数据和模板指纹决定缓存，不包含当前模型', () => {
  const key = reportCacheKey(params);
  assert.equal(key, 'week|2026-08-31|2026-09-06|source-current|template-current');
  assert.equal(key, reportCacheKey({ ...params, reasoningEffort: 'max' }));
  assert.notEqual(key, reportCacheKey({ ...params, sourceHashValue: 'source-changed' }));
  assert.notEqual(key, reportCacheKey({ ...params, templateHashValue: 'template-changed' }));
});

test('reportCacheKey: 术语词典指纹变化会生成新的缓存快照', () => {
  const withoutTerms = reportCacheKey(params);
  const withTerms = reportCacheKey({ ...params, terminologyHashValue: 'terms-current' });
  assert.equal(withTerms, `${withoutTerms}|terms-current`);
  assert.notEqual(withTerms, reportCacheKey({ ...params, terminologyHashValue: 'terms-changed' }));
});

test('findCachedReport: 模型变化不影响命中，并返回同一快照的最新版本', () => {
  const cached = findCachedReport([
    report({ id: 'old', model: 'deepseek-v3', sourceHash: params.sourceHashValue, templateHash: params.templateHashValue, updatedAt: 2 }),
    report({ id: 'new', model: 'deepseek-v4-flash', sourceHash: params.sourceHashValue, templateHash: params.templateHashValue, updatedAt: 3 })
  ], params);
  assert.equal(cached.id, 'new');
  assert.equal(reportCacheStatus(cached, { ...params, currentModel: 'deepseek-v4-pro' }), 'fresh');
});

test('findCachedReport: 兼容旧版包含模型的缓存键', () => {
  const legacyKey = `week|${params.start}|${params.end}|deepseek-v4-pro|${params.sourceHashValue}|${params.templateHashValue}`;
  const cached = findCachedReport([report({ id: 'legacy', cacheKey: legacyKey, updatedAt: 4 })], params);
  assert.equal(cached.id, 'legacy');
});

test('findLatestReport: 原始记录变化时仍返回该周期上一次报告', () => {
  const latest = findLatestReport([
    report({ id: 'other-period', start: '2026-08-24', end: '2026-08-30', updatedAt: 9 }),
    report({ id: 'previous', sourceHash: 'source-previous', templateHash: params.templateHashValue, updatedAt: 8 })
  ], params);
  assert.equal(latest.id, 'previous');
  assert.equal(reportCacheStatus(latest, params), 'source-changed');
});

test('reportCacheStatus: 词典变化会标记旧报告待更新，空词典兼容旧报告', () => {
  const current = { ...params, terminologyHashValue: 'terms-current' };
  const old = report({
    sourceHash: params.sourceHashValue,
    templateHash: params.templateHashValue,
    terminologyHash: 'terms-old'
  });
  assert.equal(reportCacheStatus(old, current), 'terminology-changed');
  assert.equal(reportCacheStatus(report({ sourceHash: params.sourceHashValue, templateHash: params.templateHashValue }), {
    ...params,
    terminologyHashValue: ''
  }), 'fresh');
});
