/* 保存筛选条件的数据规则，与渲染层和设置持久化共用。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRFilterPresets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

const MAX_SAVED_FILTERS = 20;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function normalizedRangeFocus(range) {
  if (range?.type === 'day' && DATE_KEY.test(String(range.day || ''))) {
    return { type: 'day', day: String(range.day) };
  }
  if (range?.type === 'week') return { type: 'week' };
  return { type: 'all' };
}

function normalizeFilterSnapshot(filter = {}) {
  const rangeFocus = normalizedRangeFocus(filter.rangeFocus);
  const hasRangeFocus = rangeFocus.type !== 'all';
  const yearValue = String(filter.year ?? 'all');
  const monthValue = String(filter.month ?? 'all');
  const year = !hasRangeFocus && /^\d{4}$/.test(yearValue) ? yearValue : 'all';
  const monthNumber = Number(monthValue);
  const month = !hasRangeFocus && Number.isInteger(monthNumber) && monthNumber >= 1 && monthNumber <= 12
    ? String(monthNumber)
    : 'all';

  return {
    year,
    month,
    text: String(filter.text || '').trim().slice(0, 160),
    rangeFocus
  };
}

function filterSignature(filter) {
  return JSON.stringify(normalizeFilterSnapshot(filter));
}

function normalizeSavedFilters(filters) {
  if (!Array.isArray(filters)) return [];
  const seen = new Set();
  const result = [];
  for (let index = 0; index < filters.length && result.length < MAX_SAVED_FILTERS; index += 1) {
    const item = filters[index];
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim().slice(0, 40);
    if (!name) continue;

    let id = String(item.id || `filter-${index + 1}`).trim().slice(0, 80);
    if (!id || seen.has(id)) id = `filter-${index + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);

    result.push({ id, name, ...normalizeFilterSnapshot(item) });
  }
  return result;
}

function upsertSavedFilter(filters, snapshot, name, id = '') {
  const normalizedFilters = normalizeSavedFilters(filters);
  const cleanName = String(name || '').trim().slice(0, 40);
  if (!cleanName) return normalizedFilters;

  const normalizedSnapshot = normalizeFilterSnapshot(snapshot);
  const signature = filterSignature(normalizedSnapshot);
  const existing = normalizedFilters.find(item => filterSignature(item) === signature);
  const generatedId = String(id || `filter-${Date.now()}`).trim().slice(0, 80);
  const item = {
    id: existing?.id || generatedId || `filter-${Date.now()}`,
    name: cleanName,
    ...normalizedSnapshot
  };
  const next = existing
    ? normalizedFilters.map(item0 => item0.id === existing.id ? item : item0)
    : [item, ...normalizedFilters];
  return normalizeSavedFilters(next);
}

// 下拉框即使暂时没有保存项也保持可打开，让用户能看到明确的空状态；
// 有保存项时返回稳定的展示模型，避免渲染层自行决定 disabled 状态。
function savedFilterSelectModel(filters) {
  const normalized = normalizeSavedFilters(filters);
  return {
    disabled: false,
    options: [
      { value: '', label: normalized.length ? '已保存筛选' : '暂无保存筛选' },
      ...normalized.map(item => ({ value: item.id, label: item.name }))
    ]
  };
}

return {
  MAX_SAVED_FILTERS,
  normalizedRangeFocus,
  normalizeFilterSnapshot,
  filterSignature,
  normalizeSavedFilters,
  upsertSavedFilter,
  savedFilterSelectModel
};
});
