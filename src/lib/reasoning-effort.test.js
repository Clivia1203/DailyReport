const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeReasoningEffort,
  resolveReasoningEffort
} = require('./reasoning-effort');

test('思考强度缺省或无效时回到自动', () => {
  assert.equal(normalizeReasoningEffort(undefined), 'auto');
  assert.equal(normalizeReasoningEffort('unknown'), 'auto');
  assert.equal(normalizeReasoningEffort(' HIGH '), 'high');
});

test('自动模式对普通报告使用快速强度', () => {
  assert.equal(resolveReasoningEffort('auto', 1), 'low');
});

test('自动模式对分段长周期使用标准强度', () => {
  assert.equal(resolveReasoningEffort('auto', 2), 'high');
});

test('用户选择的思考强度不受报告分段数量影响', () => {
  for (const effort of ['low', 'high', 'max']) {
    assert.equal(resolveReasoningEffort(effort, 1), effort);
    assert.equal(resolveReasoningEffort(effort, 3), effort);
  }
});
