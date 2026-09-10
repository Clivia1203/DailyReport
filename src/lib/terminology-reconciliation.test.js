const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  terminologyRelationKey,
  normalizeTerminologyPending,
  normalizeTerminologyRelations,
  findTerminologyConflicts,
  mergeTerminologyRelation,
  applyTerminologyRelationDecision,
  reconcileTerminology
} = require('./terminology-reconciliation');

test('规范名完全相同的重复项可以自动整理，但不同规范名不会被猜测合并', () => {
  const result = reconcileTerminology({
    existing: [{ id: 'a', canonicalName: 'DP3C-X2', aliases: ['双轴'], scope: '产品族' }],
    discovered: [{ id: 'b', canonicalName: 'DP3C-X2', aliases: ['双轴问题'], scope: '量产前测试' }]
  });
  assert.equal(result.terminology.length, 1);
  assert.deepEqual(result.terminology[0].aliases, ['双轴', '双轴问题']);
  assert.equal(result.terminology[0].scope, '产品族；量产前测试');
  assert.equal(result.pending.length, 0);

  const uncertain = reconcileTerminology({
    existing: [{ id: 'a', canonicalName: 'DP3C-X2', aliases: ['双轴'] }],
    discovered: [{ id: 'b', canonicalName: 'DP3C-X2量产前整改', aliases: ['双轴问题'] }],
    uncertainRelations: [{
      left: { canonicalName: 'DP3C-X2', aliases: ['双轴'] },
      right: { canonicalName: 'DP3C-X2量产前整改', aliases: ['双轴问题'] },
      reason: '记录没有明确说明两者范围是否相同'
    }]
  });
  assert.equal(uncertain.terminology.length, 1);
  assert.equal(uncertain.terminology[0].canonicalName, 'DP3C-X2');
  assert.equal(uncertain.pending.length, 1);
  assert.equal(uncertain.pending[0].right.canonicalName, 'DP3C-X2量产前整改');
});

test('叫法同时出现在多个术语组时只生成待确认关系，不删除任何一组', () => {
  const terms = [
    { id: 'a', canonicalName: 'DP3C-X2', aliases: ['双轴'] },
    { id: 'b', canonicalName: '另一个项目', aliases: ['双轴'] }
  ];
  const conflicts = findTerminologyConflicts(terms);
  assert.equal(conflicts.length, 1);
  assert.match(conflicts[0].reason, /双轴/);
  const result = reconcileTerminology({ existing: terms });
  assert.equal(result.terminology.length, 2);
  assert.equal(result.pending.length, 1);
});

test('待确认关系的“不是”会持久化，而“不处理”不会写入结论', () => {
  const relation = {
    left: { canonicalName: '双轴', aliases: ['DP3C-X2'] },
    right: { canonicalName: '双轴问题', aliases: ['DP3C-X2量产前整改'] },
    reason: '范围不明确'
  };
  const key = terminologyRelationKey(relation.left, relation.right);
  const pending = normalizeTerminologyPending([relation]);
  assert.equal(pending[0].key, key);
  const separate = applyTerminologyRelationDecision({
    terminology: [],
    pending,
    relations: [],
    relation,
    decision: 'separate'
  });
  assert.equal(separate.ok, true);
  assert.equal(separate.terminology.length, 2);
  assert.equal(separate.pending.length, 0);
  assert.equal(normalizeTerminologyRelations(separate.relations).length, 1);
  assert.deepEqual(normalizeTerminologyRelations([]), []);
});

test('用户确认“是”后才合并两组术语，并保留来源叫法', () => {
  const terms = [
    { id: 'a', canonicalName: 'DP3C-X2', aliases: ['双轴'] },
    { id: 'b', canonicalName: '双轴量产前整改', aliases: ['双轴问题'] }
  ];
  const relation = {
    left: { canonicalName: 'DP3C-X2' },
    right: { canonicalName: '双轴量产前整改' }
  };
  const merged = mergeTerminologyRelation(terms, relation);
  assert.equal(merged.ok, true);
  assert.equal(merged.terminology.length, 1);
  assert.deepEqual(merged.terminology[0].aliases, ['双轴', '双轴量产前整改', '双轴问题']);
  assert.equal(applyTerminologyRelationDecision({
    terminology: terms,
    pending: [relation],
    relations: [],
    relation,
    decision: 'merge'
  }).pending.length, 0);
});
