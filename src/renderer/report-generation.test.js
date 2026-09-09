const assert = require('node:assert/strict');
const test = require('node:test');

const {
  createReportGenerationManager,
  isReportJobActive
} = require('./report-generation');

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

test('报告生成任务按并发上限运行，超出的周期进入队列', async () => {
  const running = [];
  const resolvers = new Map();
  let nextId = 0;
  const manager = createReportGenerationManager({
    maxConcurrent: 2,
    idFactory: () => `job-${++nextId}`,
    run: ({ jobId, period }) => new Promise(resolve => {
      running.push({ jobId, period });
      resolvers.set(jobId, resolve);
    })
  });
  const period = index => ({
    type: 'week',
    start: `2026-08-${String(index).padStart(2, '0')}`,
    end: `2026-08-${String(index + 6).padStart(2, '0')}`
  });

  const first = manager.enqueue({ period: period(3), payload: { start: 'a' } });
  const second = manager.enqueue({ period: period(10), payload: { start: 'b' } });
  const third = manager.enqueue({ period: period(17), payload: { start: 'c' } });
  await tick();

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.equal(third.accepted, true);
  assert.equal(running.length, 2);
  assert.equal(manager.get(first.job.id).status, 'running');
  assert.equal(manager.get(second.job.id).status, 'running');
  assert.equal(manager.get(third.job.id).status, 'queued');
  assert.equal(isReportJobActive(manager.get(third.job.id)), true);

  resolvers.get(first.job.id)({ ok: true, report: { id: 'r1' } });
  await tick();
  assert.equal(manager.get(third.job.id).status, 'running');
  assert.equal(running.length, 3);

  resolvers.get(second.job.id)({ ok: true, report: { id: 'r2' } });
  resolvers.get(third.job.id)({ ok: true, report: { id: 'r3' } });
  await Promise.all([first.completion, second.completion, third.completion]);
  assert.equal(manager.hasActiveJobs(), false);
});

test('同一报告周期不会重复生成，任务周期快照不会被外部修改', async () => {
  let resolveRun;
  const manager = createReportGenerationManager({
    idFactory: () => 'job-1',
    run: ({ period }) => new Promise(resolve => {
      resolveRun = resolve;
      assert.equal(period.start, '2026-08-17');
    })
  });
  const period = { type: 'week', start: '2026-08-17', end: '2026-08-23' };
  const first = manager.enqueue({ period, payload: { force: true } });
  period.start = '2026-08-24';
  const duplicate = manager.enqueue({
    period: { type: 'week', start: '2026-08-17', end: '2026-08-23' },
    payload: { force: true }
  });
  await tick();

  assert.equal(first.accepted, true);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.job.id, first.job.id);
  assert.equal(manager.get(first.job.id).period.start, '2026-08-17');

  resolveRun({ ok: true });
  await first.completion;
  assert.equal(isReportJobActive(manager.get(first.job.id)), false);
});

test('进度事件绑定任务 ID 和周期，切周不会改变事件归属', async () => {
  let resolveRun;
  const events = [];
  const manager = createReportGenerationManager({
    idFactory: () => 'job-a',
    run: () => new Promise(resolve => { resolveRun = resolve; })
  });
  manager.subscribe(event => events.push(event));
  const period = { type: 'week', start: '2026-08-17', end: '2026-08-23' };
  const task = manager.enqueue({ period, payload: { start: period.start } });
  await tick();

  assert.equal(manager.updateProgress(task.job.id, { phase: 'thinking', text: '正在分析' }), true);
  const progressEvent = events.find(event => event.type === 'progress');
  assert.equal(progressEvent.job.id, task.job.id);
  assert.deepEqual(progressEvent.job.period, period);
  assert.equal(progressEvent.progress.text, '正在分析');

  resolveRun({ ok: true });
  await task.completion;
});

test('已完成任务只保留有限元数据，不长期持有完整报告正文', async () => {
  let nextId = 0;
  const manager = createReportGenerationManager({
    maxConcurrent: 1,
    idFactory: () => `job-${++nextId}`,
    run: ({ jobId }) => Promise.resolve({
      ok: true,
      report: { id: `report-${jobId}`, content: 'x'.repeat(10000) }
    })
  });
  const tasks = Array.from({ length: 10 }, (_value, index) => manager.enqueue({
    period: { type: 'week', start: `2026-09-${String(index + 1).padStart(2, '0')}`, end: `2026-09-${String(index + 7).padStart(2, '0')}` }
  }));
  await Promise.all(tasks.map(task => task.completion));

  assert.equal(manager.get('job-1'), null);
  const recent = manager.get('job-10');
  assert.equal(recent.status, 'succeeded');
  assert.equal(recent.result.report.content, undefined);
  assert.equal(recent.result.report.id, 'report-job-10');
});
