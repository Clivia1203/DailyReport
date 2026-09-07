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

  // 近 days 天逐日计数（活动图）。返回旧→新，末项为今天。
  function dayCounts(entries, now, days) {
    const today0 = startOfDay(now);
    const counts = [];
    const index = new Map();
    for (let i = 0; i < days; i++) {
      const day0 = today0 - (days - 1 - i) * DAY_MS;
      const date = new Date(day0);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      counts.push({ date: key, count: 0 });
      index.set(day0, i);
    }
    for (const e of entries) {
      const i = index.get(startOfDay(e.ts));
      if (i !== undefined) counts[i].count++;
    }
    return counts;
  }

  // GitHub 风格活动图：每列是一周，行顺序固定为周一到周日，最后一列是当前周。
  // 用日期字段推进而不是按毫秒累加，避免夏令时切换导致某个格子偏移。
  function heatmapWeeks(entries, now, weeks = 16) {
    const count = Math.max(1, Math.floor(Number(weeks) || 16));
    const first = new Date(weekStart(now || Date.now()));
    first.setDate(first.getDate() - (count - 1) * 7);
    const result = Array.from({ length: count }, () => []);
    const index = new Map();

    for (let column = 0; column < count; column += 1) {
      for (let row = 0; row < 7; row += 1) {
        const date = new Date(first);
        date.setDate(first.getDate() + column * 7 + row);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        const cell = { date: key, count: 0 };
        result[column].push(cell);
        index.set(key, cell);
      }
    }

    for (const entry of entries || []) {
      const date = new Date(entry.ts);
      if (Number.isNaN(date.getTime())) continue;
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const cell = index.get(key);
      if (cell) cell.count += 1;
    }

    return result;
  }

  // 五段时段问候（今日面板）
  function greeting(ts) {
    const h = new Date(ts).getHours();
    if (h >= 5 && h < 11) return '早上好';
    if (h >= 11 && h < 13) return '中午好';
    if (h >= 13 && h < 18) return '下午好';
    if (h >= 18 && h < 23) return '晚上好';
    return '夜深了';
  }

  return { weekStart, statsFor, filterByRange, rangeLabel, dayCounts, heatmapWeeks, greeting };
});
