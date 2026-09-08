const assert = require('node:assert/strict');
const test = require('node:test');

const {
  hasEntriesInPeriod,
  isFutureEmptyPeriod,
  canNavigateToPeriod
} = require('./report-period');

function localTs(year, month, day, hour = 9) {
  return new Date(year, month - 1, day, hour).getTime();
}

test('未来空周期不可进入，但有日报记录的未来周期可以进入', () => {
  const period = { type: 'week', start: '2026-09-14', end: '2026-09-20' };
  const futureEntry = [{ ts: localTs(2026, 9, 15) }];

  assert.equal(isFutureEmptyPeriod(period, [], '2026-09-08'), true);
  assert.equal(canNavigateToPeriod(period, [], '2026-09-08'), false);
  assert.equal(hasEntriesInPeriod(futureEntry, period), true);
  assert.equal(canNavigateToPeriod(period, futureEntry, '2026-09-08'), true);
});

test('包含今天的周期不算未来空周期，即使周期结束日期在未来', () => {
  const currentWeek = { type: 'week', start: '2026-09-07', end: '2026-09-13' };

  assert.equal(isFutureEmptyPeriod(currentWeek, [], '2026-09-08'), false);
  assert.equal(canNavigateToPeriod(currentWeek, [], '2026-09-08'), true);
});

test('周期边界按自然日包含，周期外记录不会解锁未来周期', () => {
  const period = { type: 'month', start: '2026-09-01', end: '2026-09-30' };
  const entries = [
    { ts: localTs(2026, 8, 31) },
    { ts: localTs(2026, 9, 30) },
    { ts: 'not-a-date' }
  ];

  assert.equal(hasEntriesInPeriod(entries, period), true);
  assert.equal(hasEntriesInPeriod(entries.slice(0, 1), period), false);
});
