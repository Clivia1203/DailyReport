/*
 * 本地 JSON 存储的运行时缓存。
 *
 * 读操作共享同一个对象，写操作在短时间内合并并延后落盘；文件签名
 * 变化且没有本地待写内容时，会重新读取磁盘，保留用户手动编辑数据文件
 * 后的可见性。
 */

function createBufferedJsonStore({
  read,
  write,
  signature = () => '',
  delay = 350,
  schedule = setTimeout,
  cancel = clearTimeout,
  onError = () => {}
} = {}) {
  if (typeof read !== 'function') throw new TypeError('JSON 存储必须提供 read 函数');
  if (typeof write !== 'function') throw new TypeError('JSON 存储必须提供 write 函数');

  let value = null;
  let loadedSignature;
  let dirty = false;
  let timer = null;
  let lastError = null;

  function currentSignature() {
    try { return signature(); }
    catch { return null; }
  }

  function clearTimer() {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function flush() {
    clearTimer();
    if (!dirty || value === null) return false;
    write(value);
    dirty = false;
    loadedSignature = currentSignature();
    lastError = null;
    return true;
  }

  function runScheduledFlush() {
    timer = null;
    try {
      flush();
    } catch (error) {
      // 保留 dirty 状态；下一次保存或退出时仍会尝试写入，且不丢失内存中的数据。
      lastError = error;
      try { onError(error); } catch { /* 观察者异常不能破坏存储状态 */ }
    }
  }

  function scheduleFlush() {
    if (timer !== null) return;
    timer = schedule(runScheduledFlush, delay);
    // 防止一个未完成的延迟写入阻止进程退出；will-quit 会主动 flush。
    timer?.unref?.();
  }

  function load() {
    const nextSignature = currentSignature();
    if (value === null || (!dirty && nextSignature !== loadedSignature)) {
      value = read();
      loadedSignature = nextSignature;
      dirty = false;
      lastError = null;
    }
    return value;
  }

  function save(next = value, { immediate = false } = {}) {
    if (next === null || next === undefined) return false;
    value = next;
    dirty = true;
    if (immediate) flush();
    else scheduleFlush();
    return true;
  }

  return {
    load,
    save,
    flush,
    isDirty: () => dirty,
    pending: () => timer !== null,
    lastError: () => lastError
  };
}

module.exports = { createBufferedJsonStore };
