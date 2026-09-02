const { test } = require('node:test');
const assert = require('node:assert/strict');
const { statsFor, weekStart } = require('./stats.js');

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
