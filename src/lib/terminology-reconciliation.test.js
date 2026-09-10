const { test } = require('node:test');
const assert = require('node:assert/strict');
const terminologyReconciliation = require('./terminology-reconciliation');
const {
  terminologyRelationKey,
  normalizeTerminologyPending,
  normalizeTerminologyRelations,
  relationMatchesDecision,
  findTerminologyConflicts,
  mergeTerminologyRelation,
  applyTerminologyRelationDecision,
  terminologyRelationBasis,
  recheckTerminologyDeferrals,
  reconcileTerminology
} = require('./terminology-reconciliation');

// main.js 逐名解构导入；任何漏导出都会让 IPC 处理器在运行时抛错，这里静态兜底。
test('主进程依赖的归并函数全部真实导出', () => {
  for (const name of [
    'normalizeTerminologyPending',
    'normalizeTerminologyRelations',
    'normalizeTerminologyRelation',
    'enrichRelation',
    'removeTerminologyRelationDecision',
    'terminologyRelationBasis',
    'recheckTerminologyDeferrals',
    'reconcileTerminology',
    'applyTerminologyRelationDecision'
  ]) {
    assert.equal(typeof terminologyReconciliation[name], 'function', `${name} 应为导出的函数`);
  }
});

const entry = (id, text, ts = Date.parse('2026-09-01T09:00:00')) => ({ id, ts, text });

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

test('“不是”会持久化，并压住之后换措辞、左右互换的同一件事', () => {
  const relation = {
    left: { canonicalName: '铭工现场售前问题', aliases: ['铭工售前'] },
    right: { canonicalName: '铭工现场问题', aliases: ['铭工现场'] },
    reason: '范围不明确'
  };
  const separate = applyTerminologyRelationDecision({
    terminology: [],
    pending: [relation],
    relations: [],
    relation,
    decision: 'separate'
  });
  assert.equal(separate.ok, true);
  assert.equal(separate.terminology.length, 2);
  assert.equal(separate.pending.length, 0);
  assert.equal(normalizeTerminologyRelations(separate.relations).length, 1);

  // 下次扫描 AI 换了措辞，且左右顺序对调：旧决定仍应压住同一件事。
  const drifted = {
    left: { canonicalName: '铭工现场', aliases: [] },
    right: { canonicalName: '铭工售前', aliases: [] },
    reason: '再次识别'
  };
  assert.equal(
    relationMatchesDecision(drifted, normalizeTerminologyRelations(separate.relations)[0]),
    true
  );
  assert.equal(normalizeTerminologyPending([drifted], separate.relations).length, 0);
  const rescan = reconcileTerminology({
    existing: separate.terminology,
    uncertainRelations: [drifted],
    relations: separate.relations
  });
  assert.equal(rescan.pending.length, 0);
});

test('“是”合并后留有决定记录，换措辞再现时不再追问', () => {
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
  const decision = applyTerminologyRelationDecision({
    terminology: terms,
    pending: [relation],
    relations: [],
    relation,
    decision: 'merge'
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.pending.length, 0);
  assert.equal(normalizeTerminologyRelations(decision.relations)[0].decision, 'merge');
  // 合并后词典只剩一组；AI 再拿这两个名字提问时直接被吸附成同一词条，不再出现待确认。
  const rescan = reconcileTerminology({
    existing: decision.terminology,
    uncertainRelations: [relation],
    relations: decision.relations
  });
  assert.equal(rescan.pending.length, 0);
});

test('合并后的名字成为别名：两侧吸附到同一词条时关系自动作废', () => {
  const terms = [{ id: 'a', canonicalName: '双轴驱动器', aliases: ['DP3C-X2'] }];
  const relation = {
    left: { canonicalName: '双轴驱动器' },
    right: { canonicalName: 'DP3C-X2' }
  };
  const rescan = reconcileTerminology({
    existing: terms,
    uncertainRelations: [relation]
  });
  assert.equal(rescan.pending.length, 0);
  // 用别名再次请求合并也不会拆出新词条。
  const merged = mergeTerminologyRelation(terms, relation);
  assert.equal(merged.ok, true);
  assert.equal(merged.terminology.length, 1);
});

test('“不处理”=持久暂缓：不入词典、不算已区分、依据不变不再问', () => {
  const entries = [
    entry('e1', '处理铭工现场问题，客户反馈复位异常'),
    entry('e2', '跟进铭工现场售前问题的报价')
  ];
  const relation = {
    left: { canonicalName: '铭工现场售前问题', aliases: ['铭工售前'] },
    right: { canonicalName: '铭工现场问题', aliases: [] },
    reason: '无法确认是否同一事项'
  };
  const basisHash = terminologyRelationBasis(relation, [], entries);
  const deferred = applyTerminologyRelationDecision({
    terminology: [],
    pending: [relation],
    relations: [],
    relation,
    decision: 'defer',
    basisHash,
    deferredAt: 123
  });
  assert.equal(deferred.ok, true);
  // 暂缓不给词典下任何结论：不新增词条。
  assert.equal(deferred.terminology.length, 0);
  assert.equal(deferred.pending.length, 0);
  const records = normalizeTerminologyRelations(deferred.relations);
  assert.equal(records.length, 1);
  assert.equal(records[0].decision, 'defer');
  assert.equal(records[0].basisHash, basisHash);
  assert.equal(records[0].deferredAt, 123);
  assert.equal(records[0].reason, '无法确认是否同一事项');

  // 依据指纹只随相关日报变化：新增无关日报保持沉默。
  const unrelated = recheckTerminologyDeferrals({
    relations: deferred.relations,
    pending: [],
    terminology: [],
    entries: [...entries, entry('e3', '参加部门例会，同步平台迁移进度')]
  });
  assert.equal(unrelated.changed, false);
  assert.equal(unrelated.relations.length, 1);
  assert.equal(unrelated.pending.length, 0);

  // 相关日报新增证据：原样回到待确认。
  const revived = recheckTerminologyDeferrals({
    relations: deferred.relations,
    pending: [],
    terminology: [],
    entries: [...entries, entry('e4', '铭工现场问题完成整改并关闭')]
  });
  assert.equal(revived.changed, true);
  assert.equal(revived.relations.length, 0);
  assert.equal(revived.pending.length, 1);
  assert.equal(revived.pending[0].left.canonicalName, '铭工现场售前问题');
});

test('暂缓期间用户已把两侧合并成同一词条时，复核直接清理暂缓记录', () => {
  const entries = [entry('e1', '双轴驱动器完成标定，DP3C-X2 出货')];
  const relation = {
    left: { canonicalName: '双轴驱动器' },
    right: { canonicalName: 'DP3C-X2' }
  };
  const basisHash = terminologyRelationBasis(relation, [], entries);
  const deferred = applyTerminologyRelationDecision({
    terminology: [],
    pending: [relation],
    relations: [],
    relation,
    decision: 'defer',
    basisHash
  });
  const terms = [{ id: 'a', canonicalName: '双轴驱动器', aliases: ['DP3C-X2'] }];
  const result = recheckTerminologyDeferrals({
    relations: deferred.relations,
    pending: [],
    terminology: terms,
    entries
  });
  assert.equal(result.changed, true);
  assert.equal(result.relations.length, 0);
  // 问题已被合并解决，不应重新打扰用户。
  assert.equal(result.pending.length, 0);
});

test('暂缓的两侧不会被当作新词条自动写入词典', () => {
  const entries = [entry('e1', 'DP3S-705-MQ 模切行业定制机硬件问题处理')];
  const relation = {
    left: { canonicalName: 'DP3S-705-MQ' },
    right: { canonicalName: 'DP3S-705-MQ 模切行业定制机硬件问题处理' }
  };
  const basisHash = terminologyRelationBasis(relation, [], entries);
  const deferred = applyTerminologyRelationDecision({
    terminology: [],
    pending: [relation],
    relations: [],
    relation,
    decision: 'defer',
    basisHash
  });
  const rescan = reconcileTerminology({
    existing: [],
    discovered: [
      { canonicalName: 'DP3S-705-MQ' },
      { canonicalName: 'DP3S-705-MQ 模切行业定制机硬件问题处理' }
    ],
    relations: deferred.relations
  });
  assert.equal(rescan.terminology.length, 0);
  assert.equal(rescan.pending.length, 0);
});

test('暂缓与“不是”互相覆盖：同一件事只保留最新决定', () => {
  const relation = {
    left: { canonicalName: 'A事项' },
    right: { canonicalName: 'B事项' }
  };
  const deferred = applyTerminologyRelationDecision({
    terminology: [],
    pending: [relation],
    relations: [],
    relation,
    decision: 'defer',
    basisHash: 'x'
  });
  const separated = applyTerminologyRelationDecision({
    terminology: [],
    pending: [],
    relations: deferred.relations,
    relation,
    decision: 'separate'
  });
  const records = normalizeTerminologyRelations(separated.relations);
  assert.equal(records.length, 1);
  assert.equal(records[0].decision, 'separate');
  assert.equal(records[0].basisHash, undefined);
});

test('normalizeTerminologyRelations 保留暂缓快照并过滤未知决定', () => {
  const records = normalizeTerminologyRelations([
    { decision: 'later', leftCanonicalName: 'A', rightCanonicalName: 'B' },
    {
      decision: 'defer',
      leftCanonicalName: 'A事项',
      leftAliases: ['A'],
      rightCanonicalName: 'B事项',
      rightAliases: ['B'],
      reason: '证据不足',
      refs: ['R001'],
      basisHash: 'hash-1',
      deferredAt: 456
    }
  ]);
  assert.equal(records.length, 1);
  assert.equal(records[0].decision, 'defer');
  assert.deepEqual(records[0].leftAliases, ['A']);
  assert.equal(records[0].reason, '证据不足');
  assert.equal(records[0].basisHash, 'hash-1');
  assert.equal(records[0].deferredAt, 456);
});

test('依据指纹：完全相同的原始记录集合得到相同指纹', () => {
  const entries = [
    entry('e1', '处理铭工现场问题'),
    entry('e2', '跟进铭工现场售前问题')
  ];
  const a = terminologyRelationBasis(
    { left: { canonicalName: '铭工现场售前问题' }, right: { canonicalName: '铭工现场问题' } },
    [],
    entries
  );
  const b = terminologyRelationBasis(
    { left: { canonicalName: '铭工现场问题' }, right: { canonicalName: '铭工现场售前问题' } },
    [],
    [...entries].reverse()
  );
  assert.equal(a, b);
  assert.notEqual(a, '');
});

test('人物和事项之间不生成待确认：共享叫法与 AI 提问两条路都堵住', () => {
  // 用户实例：陆永波（人物）与“新人陆永波入组与上手培养”（事项）共用叫法“新人”。
  const terms = [
    { id: 'p1', canonicalName: '陆永波', aliases: ['新人陆永波', '新人'], type: 'person' },
    { id: 'm1', canonicalName: '新人陆永波入组与上手培养', aliases: ['新人', '新人陆永波进组后'] }
  ];
  assert.equal(findTerminologyConflicts(terms).length, 0);
  const rescan = reconcileTerminology({ existing: terms });
  assert.equal(rescan.pending.length, 0);

  // AI 仍然把人和事配成一条不确定关系时，本地闸门直接作废，不进待确认。
  const aiPair = reconcileTerminology({
    existing: terms,
    uncertainRelations: [{
      left: { canonicalName: '陆永波', type: 'person' },
      right: { canonicalName: '新人陆永波入组与上手培养' },
      reason: '包含同一人名'
    }]
  });
  assert.equal(aiPair.pending.length, 0);

  // 同类型之间（两个事项）的冲突照常提醒，不受影响。
  const matters = [
    { id: 'a', canonicalName: 'DP3C-X2', aliases: ['双轴'] },
    { id: 'b', canonicalName: '另一个项目', aliases: ['双轴'] }
  ];
  assert.equal(findTerminologyConflicts(matters).length, 1);
});

test('人物词条与人物词条之间的叫法冲突仍会提醒', () => {
  const people = [
    { id: 'p1', canonicalName: '陆永波', aliases: ['新人'], type: 'person' },
    { id: 'p2', canonicalName: '王工', aliases: ['新人'], type: 'person' }
  ];
  assert.equal(findTerminologyConflicts(people).length, 1);
});

test('合并两侧词条时人物标记保留', () => {
  const merged = mergeTerminologyRelation(
    [{ id: 'p1', canonicalName: '陆永波', aliases: ['新人陆永波'], type: 'person' }],
    { left: { canonicalName: '陆永波' }, right: { canonicalName: '新人陆永波' } }
  );
  assert.equal(merged.ok, true);
  assert.equal(merged.terminology[0].type, 'person');
});
