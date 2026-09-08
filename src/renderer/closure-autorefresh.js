(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRClosureAutoRefresh = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const DEFAULTS = Object.freeze({
    debounceMs: 60 * 1000,
    cooldownMs: 30 * 60 * 1000,
    startupDelayMs: 30 * 1000
  });

  function finiteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function createClosureAutoRefresh({
    onDue = () => {},
    now = () => Date.now(),
    setTimeout: scheduleTimer = setTimeout,
    clearTimeout: clearTimerFn = clearTimeout,
    debounceMs = DEFAULTS.debounceMs,
    cooldownMs = DEFAULTS.cooldownMs
  } = {}) {
    const config = {
      debounceMs: Math.max(0, finiteNumber(debounceMs, DEFAULTS.debounceMs)),
      cooldownMs: Math.max(0, finiteNumber(cooldownMs, DEFAULTS.cooldownMs))
    };
    let snapshot = {
      enabled: false,
      visible: false,
      hasRecentSources: false,
      cacheStatus: 'missing',
      periodKey: ''
    };
    let timer = null;
    let busy = false;
    let disposed = false;
    const lastAttemptAt = new Map();

    function clearTimer() {
      if (timer !== null) clearTimerFn(timer);
      timer = null;
    }

    function cooldownRemaining() {
      const key = snapshot.periodKey || 'default';
      const attemptedAt = lastAttemptAt.has(key) ? lastAttemptAt.get(key) : null;
      if (attemptedAt === null) return 0;
      return Math.max(0, attemptedAt + config.cooldownMs - now());
    }

    function isEligible() {
      return !disposed
        && !busy
        && snapshot.enabled
        && snapshot.visible
        && snapshot.hasRecentSources
        && snapshot.cacheStatus !== 'fresh';
    }

    function fire(reason) {
      if (!isEligible()) return false;
      const remaining = cooldownRemaining();
      if (remaining > 0) {
        timer = scheduleTimer(() => {
          timer = null;
          fire(reason);
        }, remaining);
        return false;
      }

      const key = snapshot.periodKey || 'default';
      lastAttemptAt.set(key, now());
      busy = true;
      onDue({ reason, periodKey: key });
      return true;
    }

    function update(next = {}) {
      if (disposed) return;
      const previous = snapshot;
      snapshot = { ...snapshot, ...next };
      if (
        !isEligible()
        || previous.periodKey !== snapshot.periodKey
        || (previous.visible && !snapshot.visible)
      ) {
        clearTimer();
      }
    }

    function request({ reason = 'source-change', delayMs = 0 } = {}) {
      if (disposed) return { scheduled: false, reason: 'disposed' };
      clearTimer();
      if (!isEligible()) return { scheduled: false, reason: 'not-eligible' };

      const delay = Math.max(0, finiteNumber(delayMs));
      const wait = Math.max(delay, cooldownRemaining());
      if (!wait) {
        return { scheduled: fire(reason), delayMs: 0 };
      }
      timer = scheduleTimer(() => {
        timer = null;
        fire(reason);
      }, wait);
      return { scheduled: true, delayMs: wait };
    }

    function beginAttempt(periodKey = snapshot.periodKey) {
      if (disposed) return;
      clearTimer();
      lastAttemptAt.set(periodKey || 'default', now());
      busy = true;
    }

    function endAttempt() {
      busy = false;
      if (!isEligible()) clearTimer();
    }

    function cancelPending() {
      clearTimer();
    }

    function dispose() {
      clearTimer();
      disposed = true;
      busy = false;
    }

    function getState() {
      return {
        ...snapshot,
        busy,
        cooldownRemaining: cooldownRemaining(),
        timerPending: timer !== null
      };
    }

    return {
      update,
      request,
      beginAttempt,
      endAttempt,
      cancel: cancelPending,
      dispose,
      getState
    };
  }

  return { DEFAULTS, createClosureAutoRefresh };
});
