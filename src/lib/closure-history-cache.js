/* 闭环历史来源缓存：当前周期变化时复用未受影响的历史部分。 */

function createClosureHistoryCache({ maxEntries = 8 } = {}) {
  const limit = Math.max(1, Math.floor(Number(maxEntries) || 1));
  const values = new Map();

  function touch(key, value) {
    values.delete(key);
    values.set(key, value);
    while (values.size > limit) values.delete(values.keys().next().value);
  }

  function get(start, factory) {
    if (typeof factory !== 'function') throw new TypeError('历史缓存必须提供构造函数');
    const key = String(start || '');
    if (values.has(key)) {
      const value = values.get(key);
      touch(key, value);
      return value;
    }
    const value = factory();
    touch(key, value);
    return value;
  }

  function invalidate(changedDates) {
    const dates = [...new Set((Array.isArray(changedDates) ? changedDates : [])
      .map(value => String(value || ''))
      .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value)))];
    if (!dates.length) {
      values.clear();
      return;
    }
    for (const start of values.keys()) {
      if (dates.some(date => date < start)) values.delete(start);
    }
  }

  return {
    get,
    invalidate,
    clear: () => values.clear(),
    size: () => values.size
  };
}

module.exports = { createClosureHistoryCache };
