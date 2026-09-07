'use strict';

function createQuickBlurController({
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  shouldDismiss = () => true,
  onDismiss = () => {}
} = {}) {
  let timer = null;

  function cancel() {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  }

  function handleBlur(ignoreUntil = 0) {
    cancel();
    const delay = Math.max(0, (Number(ignoreUntil) || 0) - now());
    if (delay > 0) {
      timer = setTimer(() => {
        timer = null;
        if (shouldDismiss()) onDismiss();
      }, delay);
      return { deferred: true, delay };
    }
    if (shouldDismiss()) onDismiss();
    return { deferred: false, delay: 0 };
  }

  return { handleBlur, cancel };
}

module.exports = { createQuickBlurController };
