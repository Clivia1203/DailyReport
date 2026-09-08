/* 报告周期访问规则：未来日期只有在已经存在日报记录时才允许进入。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRReportPeriod = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

  function dateKeyFromTimestamp(ts) {
    const value = typeof ts === 'number' ? ts : Number(ts);
    if (!Number.isFinite(value)) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const pad = number => String(number).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function normalizeToday(today) {
    if (typeof today === 'string' && DATE_KEY.test(today)) return today;
    return dateKeyFromTimestamp(today ?? Date.now());
  }

  function hasEntriesInPeriod(entries, period) {
    if (!Array.isArray(entries) || !DATE_KEY.test(period?.start || '') || !DATE_KEY.test(period?.end || '')) {
      return false;
    }
    return entries.some(entry => {
      const day = dateKeyFromTimestamp(entry?.ts);
      return day && day >= period.start && day <= period.end;
    });
  }

  function isFutureEmptyPeriod(period, entries, today) {
    if (!period || !DATE_KEY.test(period.start || '') || !DATE_KEY.test(period.end || '')) return false;
    return period.start > normalizeToday(today) && !hasEntriesInPeriod(entries, period);
  }

  function canNavigateToPeriod(period, entries, today) {
    return !isFutureEmptyPeriod(period, entries, today);
  }

  return {
    hasEntriesInPeriod,
    isFutureEmptyPeriod,
    canNavigateToPeriod
  };
});
