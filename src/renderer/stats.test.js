const { test } = require('node:test');
const assert = require('node:assert/strict');
const { statsFor, weekStart, filterByRange, rangeLabel, dayCounts, heatmapWeeks, greeting } = require('./stats.js');

/* 时间口径说明：全部用本地时间构造，与产品口径一致（用户所在时区）。
   2026-09-01 是周二；2026-08-31 是周一；2026-08-30 是周日。 */

const day = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const entry = ts => ({ id: String(ts), text: 'x', ts, createdAt: ts });

/* ---------- weekStart：本周一零点 ---------- */

test('weekStart: 周二 -> 本周一', () => {
  assert.equal(weekStart(day(2026, 9, 1, 10)), day(2026, 8, 31));
});

test('weekStart: 周一 00:00:00 整 -> 当天即本周一', () => {
  assert.equal(weekStart(day(2026, 8, 31)), day(2026, 8, 31));
});

test('weekStart: 周日深夜 -> 本周一（6 天前）', () => {
  assert.equal(weekStart(day(2026, 9, 6, 23, 59)), day(2026, 8, 31));
});

test('weekStart: 跨年的周（2027-01-01 周五 -> 2026-12-28 周一）', () => {
  assert.equal(weekStart(day(2027, 1, 1)), day(2026, 12, 28));
});

/* ---------- filterByRange / rangeLabel：范围聚焦（ADR-0003） ---------- */

/* range 形态：{ type: 'all' } | { type: 'day', day: 'YYYY-MM-DD' } | { type: 'week', start: ts } */

test('filterByRange: all 返回全部', () => {
  const now = day(2026, 9, 1, 12);
  const entries = [entry(day(2026, 8, 1)), entry(day(2026, 9, 1))];
  assert.equal(filterByRange(entries, { type: 'all' }, now).length, 2);
});

test('filterByRange: day 聚焦只留当天', () => {
  const now = day(2026, 9, 1, 12);
  const entries = [
    entry(day(2026, 8, 31, 23, 59)),
    entry(day(2026, 9, 1, 0, 0)),
    entry(day(2026, 9, 1, 22)),
    entry(day(2026, 9, 2, 8))
  ];
  const got = filterByRange(entries, { type: 'day', day: '2026-09-01' }, now);
  assert.deepEqual(got.map(e => e.ts), [day(2026, 9, 1, 0, 0), day(2026, 9, 1, 22)]);
});

test('filterByRange: week 聚焦留整个自然周（周一~周日）', () => {
  const now = day(2026, 9, 2, 12); // 周三
  const entries = [
    entry(day(2026, 8, 30, 12)),  // 上周日 -> 排除
    entry(day(2026, 8, 31, 0, 1)),// 本周一 -> 包含
    entry(day(2026, 9, 2, 12)),   // 本周三 -> 包含
    entry(day(2026, 9, 6, 23, 59)),// 本周日 -> 包含
    entry(day(2026, 9, 7, 0, 1))  // 下周一 -> 排除
  ];
  const got = filterByRange(entries, { type: 'week' }, now);
  assert.equal(got.length, 3);
});

test('rangeLabel: day 聚焦显示具体日期，week 显示"本周"，all 为空', () => {
  assert.equal(rangeLabel({ type: 'day', day: '2026-09-01' }), '9 月 1 日');
  assert.equal(rangeLabel({ type: 'week' }), '本周');
  assert.equal(rangeLabel({ type: 'all' }), '');
});

/* ---------- greeting：五段时段问候 ---------- */

test('greeting: 五段时段切分', () => {
  const g = (h, m = 0) => greeting(new Date(2026, 8, 2, h, m).getTime());
  assert.equal(g(5, 0), '早上好');    // 5 点起
  assert.equal(g(10, 59), '早上好');
  assert.equal(g(11, 0), '中午好');   // 11 点起
  assert.equal(g(12, 59), '中午好');
  assert.equal(g(13, 0), '下午好');   // 13 点起
  assert.equal(g(17, 59), '下午好');
  assert.equal(g(18, 0), '晚上好');   // 18 点起
  assert.equal(g(22, 59), '晚上好');
  assert.equal(g(23, 0), '夜深了');   // 23 点起
  assert.equal(g(4, 59), '夜深了');   // 到凌晨 4:59
});

/* ---------- dayCounts：近 N 天逐日计数（活动图） ---------- */

/* 返回 [{ date: 'YYYY-MM-DD', count: n }, ...]，旧→新，最后一项是今天 */

test('dayCounts: 14 天窗口、旧到新、末位是今天', () => {
  const now = day(2026, 9, 2, 12);
  const days = dayCounts([], now, 14);
  assert.equal(days.length, 14);
  assert.equal(days[0].date, '2026-08-20');
  assert.equal(days[13].date, '2026-09-02');
  assert.ok(days.every(d => d.count === 0));
});

test('dayCounts: 同日多条合并、窗口外不计、跨月正确', () => {
  const now = day(2026, 9, 2, 20);
  const entries = [
    entry(day(2026, 9, 2, 9)),
    entry(day(2026, 9, 2, 21)),   // 同日第二条
    entry(day(2026, 9, 1, 12)),
    entry(day(2026, 8, 20, 8)),   // 窗口首日(8/20) -> 计入
    entry(day(2026, 8, 19, 8))    // 窗口前一天 -> 排除
  ];
  const days = dayCounts(entries, now, 14);
  const byDate = Object.fromEntries(days.map(d => [d.date, d.count]));
  assert.equal(byDate['2026-09-02'], 2);
  assert.equal(byDate['2026-09-01'], 1);
  assert.equal(byDate['2026-08-20'], 1);
  assert.equal(days[0].date, '2026-08-20');
});

/* ---------- heatmapWeeks：按周列出工作量 ---------- */

test('heatmapWeeks: 每列从周一到周日，并覆盖当前未结束的一周', () => {
  const now = day(2026, 9, 1, 12); // 周二
  const entries = [
    entry(day(2026, 8, 24, 9)),
    entry(day(2026, 9, 1, 9)),
    entry(day(2026, 9, 1, 18)),
    entry(day(2026, 9, 7, 9)) // 当前周之后，不应出现在两周窗口
  ];
  const weeks = heatmapWeeks(entries, now, 2);

  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].length, 7);
  assert.equal(weeks[0][0].date, '2026-08-24');
  assert.equal(weeks[0][6].date, '2026-08-30');
  assert.equal(weeks[1][0].date, '2026-08-31');
  assert.equal(weeks[1][1].date, '2026-09-01');
  assert.equal(weeks[0][0].count, 1);
  assert.equal(weeks[1][1].count, 2);
  assert.equal(weeks[1][6].count, 0);
});

/* ---------- statsFor：今日 / 本周 / 累计 ---------- */

test('statsFor: 空库全为零', () => {
  assert.deepEqual(statsFor([], day(2026, 9, 1, 12)), { today: 0, week: 0, total: 0 });
});

test('statsFor: 今天、本周早些天、上周、上周末各一条', () => {
  const now = day(2026, 9, 1, 15); // 周二
  const entries = [
    entry(day(2026, 9, 1, 9)),    // 今天上午 -> today + week + total
    entry(day(2026, 8, 31, 16)),  // 昨天(周一) -> week + total
    entry(day(2026, 8, 27, 10)),  // 上周四 -> total
    entry(day(2026, 8, 30, 23))   // 上周日 23 点 -> total（本周前一刻）
  ];
  assert.deepEqual(statsFor(entries, now), { today: 1, week: 2, total: 4 });
});

test('statsFor: 23:59 与 00:01 的今日边界', () => {
  const now = day(2026, 9, 1, 0, 1);
  const entries = [entry(day(2026, 8, 31, 23, 59)), entry(day(2026, 9, 1, 0, 0))];
  // 昨晚那条：不算今天；2026-08-31 是周一，属于本周 -> week 计 2
  assert.deepEqual(statsFor(entries, now), { today: 1, week: 2, total: 2 });
});

test('statsFor: 周日（本周最后一天）的记录仍计入本周', () => {
  const now = day(2026, 9, 6, 20); // 周日晚上
  const entries = [
    entry(day(2026, 8, 31, 9)),  // 本周一
    entry(day(2026, 9, 6, 12)),  // 今天（周日）
    entry(day(2026, 9, 7, 9))    // 下周一 -> 仅 total
  ];
  assert.deepEqual(statsFor(entries, now), { today: 1, week: 2, total: 3 });
});

test('statsFor: 跨年周——1 月 1 日的记录计入上一年 12 月末开市的周', () => {
  const now = day(2027, 1, 1, 12); // 2027-01-01 周五
  const entries = [
    entry(day(2027, 1, 1, 9)),    // 今天 -> today + week
    entry(day(2026, 12, 29, 9)),  // 周一（属 2026 年但属本周）
    entry(day(2026, 12, 27, 9))   // 上周日
  ];
  assert.deepEqual(statsFor(entries, now), { today: 1, week: 2, total: 3 });
});
