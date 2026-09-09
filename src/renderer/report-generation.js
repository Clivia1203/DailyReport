/* 报告生成任务队列：把并发控制、周期归属和进度事件集中在一个小模块里。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRReportGeneration = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ACTIVE_STATUSES = new Set(['queued', 'running']);

  function reportPeriodKey({ type = '', start = '', end = '' } = {}) {
    return [type, start, end].map(value => String(value || '')).join('|');
  }

  function isReportJobActive(job) {
    return !!job && ACTIVE_STATUSES.has(job.status);
  }

  function compactJobResult(result) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    const compact = { ...result };
    if (typeof compact.content === 'string') delete compact.content;
    if (typeof compact.thinking === 'string') delete compact.thinking;
    if (compact.report && typeof compact.report === 'object' && !Array.isArray(compact.report)) {
      const { content, thinking, ...report } = compact.report;
      compact.report = report;
    }
    return compact;
  }

  function createReportGenerationManager({ maxConcurrent = 2, maxCompletedJobs = 8, run, idFactory } = {}) {
    if (typeof run !== 'function') {
      throw new TypeError('报告生成任务必须提供 run 函数');
    }

    const limit = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
    const completedLimit = Math.max(1, Math.floor(Number(maxCompletedJobs) || 1));
    const jobs = new Map();
    const periodJobs = new Map();
    const completedOrder = [];
    const queue = [];
    const listeners = new Set();
    let activeCount = 0;
    let sequence = 0;

    function publicJob(job) {
      return {
        id: job.id,
        period: { ...job.period },
        payload: { ...job.payload },
        status: job.status,
        queuedAt: job.queuedAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        progress: job.progress ? { ...job.progress } : null,
        result: job.result,
        error: job.error ? String(job.error.message || job.error) : ''
      };
    }

    function emit(event) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (_error) {
          // 单个界面订阅者异常不能影响其他任务继续运行。
        }
      }
    }

    function get(jobId) {
      const job = jobs.get(String(jobId));
      return job ? publicJob(job) : null;
    }

    function getForPeriod(period) {
      const jobId = periodJobs.get(reportPeriodKey(period));
      return jobId ? get(jobId) : null;
    }

    function settle(job, status, result, error) {
      job.status = status;
      const completionResult = result || null;
      job.result = compactJobResult(completionResult);
      job.error = error || null;
      job.finishedAt = Date.now();

      const snapshot = publicJob(job);
      emit({
        type: status === 'succeeded' ? 'completed' : 'failed',
        job: snapshot,
        result: completionResult,
        error
      });
      job.resolve({ job: snapshot, result: completionResult, error });

      completedOrder.push(job.id);
      while (completedOrder.length > completedLimit) {
        const oldId = completedOrder.shift();
        const old = jobs.get(oldId);
        if (!old || isReportJobActive(old)) continue;
        jobs.delete(oldId);
        const key = reportPeriodKey(old.period);
        if (periodJobs.get(key) === oldId) periodJobs.delete(key);
      }
    }

    function pump() {
      while (activeCount < limit && queue.length > 0) {
        const jobId = queue.shift();
        const job = jobs.get(jobId);
        if (!job || job.status !== 'queued') continue;

        job.status = 'running';
        job.startedAt = Date.now();
        activeCount += 1;
        emit({ type: 'started', job: publicJob(job) });

        Promise.resolve()
          .then(() => run({
            jobId: job.id,
            id: job.id,
            period: { ...job.period },
            payload: { ...job.payload }
          }))
          .then(result => settle(job, 'succeeded', result, null))
          .catch(error => settle(job, 'failed', null, error))
          .finally(() => {
            activeCount -= 1;
            pump();
          });
      }
    }

    function enqueue({ period = {}, payload = {} } = {}) {
      const key = reportPeriodKey(period);
      const existingId = periodJobs.get(key);
      const existing = jobs.get(existingId);
      if (isReportJobActive(existing)) {
        return {
          accepted: false,
          reason: 'duplicate',
          job: publicJob(existing),
          completion: existing.completion
        };
      }

      const generatedId = idFactory ? idFactory() : `report-${Date.now()}-${++sequence}`;
      const job = {
        id: String(generatedId),
        period: { ...period },
        payload: { ...payload },
        status: 'queued',
        queuedAt: Date.now(),
        startedAt: 0,
        finishedAt: 0,
        progress: null,
        result: null,
        error: null,
        resolve: null,
        completion: null
      };
      job.completion = new Promise(resolve => {
        job.resolve = resolve;
      });

      jobs.set(job.id, job);
      periodJobs.set(key, job.id);
      queue.push(job.id);
      emit({ type: 'queued', job: publicJob(job) });
      pump();

      return {
        accepted: true,
        job: publicJob(job),
        completion: job.completion
      };
    }

    function updateProgress(jobId, progress = {}) {
      const job = jobs.get(String(jobId));
      if (!isReportJobActive(job)) return false;

      job.progress = { ...progress };
      emit({
        type: 'progress',
        job: publicJob(job),
        progress: { ...progress }
      });
      return true;
    }

    function reset() {
      if (Array.from(jobs.values()).some(isReportJobActive)) return false;
      jobs.clear();
      periodJobs.clear();
      completedOrder.length = 0;
      queue.length = 0;
      return true;
    }

    return {
      enqueue,
      get,
      getForPeriod,
      updateProgress,
      reset,
      subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      hasActiveJobs() {
        return Array.from(jobs.values()).some(isReportJobActive);
      },
      activeCount() {
        return activeCount;
      },
      pendingCount() {
        return queue.filter(jobId => jobs.get(jobId)?.status === 'queued').length;
      },
      maxConcurrent: limit,
      maxCompletedJobs: completedLimit
    };
  }

  return {
    createReportGenerationManager,
    isReportJobActive,
    reportPeriodKey
  };
});
