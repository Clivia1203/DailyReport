/* 统计条数据模块：看板数据逻辑的唯一收口（测试接缝）。
   口径见 CONTEXT.md：本周 = 周一 00:00 起的自然周。
   UMD 包装：Node 侧供 node --test require，渲染页经 <script> 挂到 window.DRStats。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRStats = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DAY_MS = 86400000;

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  // 本周一 00:00（本地时间）。用日期运算而非毫秒减法，避免夏令时切换日偏移。
  function weekStart(ts) {
    const d = new Date(startOfDay(ts));
    const back = (d.getDay() + 6) % 7; // 周一=0 … 周日=6
    d.setDate(d.getDate() - back);
    return d.getTime();
  }

  // 今日 / 本周 / 累计。按"自然日相等"判定今日，未来时间戳的记录不会永久计入。
  function statsFor(entries, now) {
    const today0 = startOfDay(now);
    const week0 = weekStart(now);
    const weekEnd = week0 + 7 * DAY_MS;
    let today = 0, week = 0;
    for (const e of entries) {
      if (startOfDay(e.ts) === today0) today++;
      if (e.ts >= week0 && e.ts < weekEnd) week++;
    }
    return { today, week, total: entries.length };
  }

  // 范围聚焦筛选（ADR-0003）。range: {type:'all'} | {type:'day',day:'YYYY-MM-DD'} | {type:'week'}
  function filterByRange(entries, range, now) {
    if (!range || range.type === 'all') return entries.slice();
    if (range.type === 'day') {
      const day0 = startOfDay(new Date(range.day + 'T00:00:00').getTime());
      return entries.filter(e => startOfDay(e.ts) === day0);
    }
    if (range.type === 'week') {
      const week0 = weekStart(now || Date.now());
      const weekEnd = week0 + 7 * DAY_MS;
      return entries.filter(e => e.ts >= week0 && e.ts < weekEnd);
    }
    return entries.slice();
  }

  // 范围芯片文案。空串表示无聚焦（all）。
  function rangeLabel(range) {
    if (!range || range.type === 'all') return '';
    if (range.type === 'day') {
      const d = new Date(range.day + 'T00:00:00');
      return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
    }
    if (range.type === 'week') return '本周';
    return '';
  }

  return { weekStart, statsFor, filterByRange, rangeLabel };
});
