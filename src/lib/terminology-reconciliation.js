/* 术语归并闸门：确定的重复项可以自动整理，不确定的关系必须交给用户选择。 */

const crypto = require('crypto');
const {
  terminologyKey,
  terminologyType,
  normalizeTerminology
} = require('./terminology');
const { sourceBundle } = require('./report-utils');

const MAX_TERMINOLOGY_PENDING = 120;
const MAX_TERMINOLOGY_RELATIONS = 240;
// separate=已确认是两件事；merge=已确认是同一件（已合并）；defer=暂缓，等依据变化再问。
// 三种决定都持久化：暂缓绝不能隐含“不是”，也不能把两侧写成两个词条。
const RELATION_DECISIONS = new Set(['separate', 'merge', 'defer']);

function clean(value, max = 240) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function cleanList(value, max = 12) {
  const values = Array.isArray(value)
    ? value
    : String(value || '').split(/[\n,，、;；]+/);
  const result = [];
  const seen = new Set();
  for (const item of values) {
    const text = clean(item);
    const key = terminologyKey(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(text);
    if (result.length >= max) break;
  }
  return result;
}

function mergeField(first, second, max) {
  const values = [first, second]
    .flatMap(value => String(value || '').split(/[；;]+/))
    .map(value => clean(value, max));
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const key = terminologyKey(value);
    if (!value || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result.join('；').slice(0, max);
}

function termSnapshot(value) {
  const source = value?.term && typeof value.term === 'object' ? value.term : (value || {});
  const canonicalName = clean(source.canonicalName || source.canonical_name || source.name, 120);
  if (!canonicalName) return null;
  const termId = clean(source.termId ?? source.term_id, 80);
  return {
    canonicalName,
    aliases: cleanList(source.aliases || source.alias || source.common_names || source.commonNames),
    scope: clean(source.scope, 120),
    note: clean(source.note, 240),
    ...(termId ? { termId } : {}),
    // 只在明确是人物时携带类型；缺省视为事项。
    ...(terminologyType(source.type) === 'person' ? { type: 'person' } : {})
  };
}

function terminologyRelationKey(left, right) {
  const leftName = typeof left === 'string' ? left : left?.canonicalName || left?.canonical_name;
  const rightName = typeof right === 'string' ? right : right?.canonicalName || right?.canonical_name;
  const leftKey = terminologyKey(leftName);
  const rightKey = terminologyKey(rightName);
  if (!leftKey || !rightKey || leftKey === rightKey) return '';
  return [leftKey, rightKey].sort().join('|');
}

function normalizeTerminologyRelation(value) {
  const source = value && typeof value === 'object' ? value : {};
  const left = termSnapshot(source.left || {
    canonicalName: source.leftCanonicalName || source.left_canonical_name,
    aliases: source.leftAliases || source.left_aliases,
    scope: source.leftScope || source.left_scope,
    note: source.leftNote || source.left_note,
    termId: source.leftTermId || source.left_term_id
  });
  const right = termSnapshot(source.right || {
    canonicalName: source.rightCanonicalName || source.right_canonical_name,
    aliases: source.rightAliases || source.right_aliases,
    scope: source.rightScope || source.right_scope,
    note: source.rightNote || source.right_note,
    termId: source.rightTermId || source.right_term_id
  });
  const key = terminologyRelationKey(left, right);
  if (!left || !right || !key) return null;
  const confidence = ['low', 'medium'].includes(String(source.confidence || '').toLowerCase())
    ? String(source.confidence).toLowerCase()
    : 'medium';
  return {
    key,
    left,
    right,
    reason: clean(source.reason || source.explanation, 360),
    confidence,
    refs: cleanList(source.refs || source.references || source.sourceRefs, 20),
    source: clean(source.source || 'ai', 40)
  };
}

function normalizeTerminologyRelations(items) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const relation = normalizeTerminologyRelation(item);
    const decision = String(item?.decision || '').trim().toLowerCase();
    if (!relation || !RELATION_DECISIONS.has(decision) || seen.has(relation.key)) continue;
    seen.add(relation.key);
    const record = {
      key: relation.key,
      leftCanonicalName: relation.left.canonicalName,
      leftAliases: relation.left.aliases,
      leftScope: relation.left.scope,
      leftTermId: relation.left.termId || '',
      rightCanonicalName: relation.right.canonicalName,
      rightAliases: relation.right.aliases,
      rightScope: relation.right.scope,
      rightTermId: relation.right.termId || '',
      decision
    };
    if (decision === 'defer') {
      // 暂缓记录必须保留完整快照和依据指纹：指纹变化时靠它原样回到待确认。
      record.reason = relation.reason;
      record.refs = relation.refs;
      record.confidence = relation.confidence;
      record.source = relation.source;
      record.basisHash = clean(item?.basisHash, 80);
      record.deferredAt = Number.isFinite(Number(item?.deferredAt)) ? Number(item.deferredAt) : 0;
    }
    result.push(record);
    if (result.length >= MAX_TERMINOLOGY_RELATIONS) break;
  }
  return result;
}

/* ---------- 关系身份匹配：AI 措辞会漂移，决定必须能对上同一件事 ---------- */

function sideNameKeys(side) {
  const keys = new Set();
  const canonicalKey = terminologyKey(side?.canonicalName);
  if (canonicalKey) keys.add(canonicalKey);
  for (const alias of Array.isArray(side?.aliases) ? side.aliases : []) {
    const aliasKey = terminologyKey(alias);
    if (aliasKey) keys.add(aliasKey);
  }
  return keys;
}

function decisionSides(record) {
  return {
    left: { canonicalName: record.leftCanonicalName, aliases: record.leftAliases, termId: record.leftTermId },
    right: { canonicalName: record.rightCanonicalName, aliases: record.rightAliases, termId: record.rightTermId }
  };
}

function relationSideMatches(decisionSide, relationSide) {
  if (!decisionSide || !relationSide) return false;
  if (decisionSide.termId && relationSide.termId && decisionSide.termId === relationSide.termId) return true;
  // 词典条目 id 不一致时退回按叫法比对：一侧锚点可能来自尚未入库的候选，id 本身不稳定。
  const decisionKeys = sideNameKeys(decisionSide);
  for (const key of sideNameKeys(relationSide)) {
    if (decisionKeys.has(key)) return true;
  }
  return false;
}

function relationMatchesDecision(relation, decision) {
  if (!relation || !decision) return false;
  const sides = decisionSides(decision);
  return (relationSideMatches(sides.left, relation.left) && relationSideMatches(sides.right, relation.right))
    || (relationSideMatches(sides.left, relation.right) && relationSideMatches(sides.right, relation.left));
}

function normalizeTerminologyPending(items, decisions = []) {
  const records = normalizeTerminologyRelations(decisions);
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const relation = normalizeTerminologyRelation(item);
    if (!relation || seen.has(relation.key)) continue;
    if (records.some(record => relationMatchesDecision(relation, record))) continue;
    seen.add(relation.key);
    result.push(relation);
    if (result.length >= MAX_TERMINOLOGY_PENDING) break;
  }
  return result;
}

function addTerminologyRelationDecision(items, relation, decision = 'separate', extras = {}) {
  if (!RELATION_DECISIONS.has(decision)) return normalizeTerminologyRelations(items);
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return normalizeTerminologyRelations(items);
  // 同一对关系的最新决定覆盖旧记录，避免换一种写法后留下双重结论。
  const rest = normalizeTerminologyRelations(items).filter(item => !relationMatchesDecision(normalized, item));
  return normalizeTerminologyRelations([
    ...rest,
    { ...normalized, ...extras, decision }
  ]);
}

function removeTerminologyRelationDecision(items, relation) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return normalizeTerminologyRelations(items);
  return normalizeTerminologyRelations(items).filter(item => !relationMatchesDecision(normalized, item));
}

function findTerm(terms, name) {
  const key = terminologyKey(name);
  if (!key) return undefined;
  return normalizeTerminology(terms).find(item =>
    terminologyKey(item.canonicalName) === key
    || item.aliases.some(alias => terminologyKey(alias) === key));
}

function enrichRelation(relation, availableTerms) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return null;
  const enrich = side => {
    const existing = findTerm(availableTerms, side.canonicalName);
    if (!existing) return side;
    // 吸附到词典条目并记下条目 id：之后 AI 换措辞、甚至词典改名，决定仍能对上同一条。
    const termId = clean(existing.id, 80);
    return {
      ...side,
      ...(termId ? { termId } : {}),
      ...(terminologyType(existing.type) === 'person' ? { type: 'person' } : {}),
      canonicalName: existing.canonicalName,
      aliases: existing.aliases,
      scope: existing.scope,
      note: existing.note
    };
  };
  const left = enrich(normalized.left);
  const right = enrich(normalized.right);
  if (left.termId && right.termId && left.termId === right.termId) return null;
  // 人物和事项之间不存在“是否同一事项”的问题：这类关系直接作废，不提问、不落盘。
  if (terminologyType(left.type) !== terminologyType(right.type)) return null;
  const key = terminologyRelationKey(left, right) || normalized.key;
  return { ...normalized, key, left, right };
}

function findTerminologyConflicts(items) {
  const terms = normalizeTerminology(items);
  const occurrences = new Map();
  const register = (term, value, role) => {
    const key = terminologyKey(value);
    if (!key) return;
    const list = occurrences.get(key) || [];
    if (!list.some(item => item.id === term.id)) list.push({ term, role, value: clean(value, 120) });
    occurrences.set(key, list);
  };
  for (const term of terms) {
    register(term, term.canonicalName, 'canonical');
    for (const alias of term.aliases) register(term, alias, 'alias');
  }

  const result = [];
  const seen = new Set();
  for (const [key, matches] of occurrences) {
    if (matches.length < 2) continue;
    for (let index = 0; index < matches.length; index += 1) {
      for (let next = index + 1; next < matches.length; next += 1) {
        const left = matches[index];
        const right = matches[next];
        // 人物和事项共用一个叫法是正常的（如“新人”既指人也出现在事项里），不算冲突。
        if (terminologyType(left.term.type) !== terminologyType(right.term.type)) continue;
        const relationKey = terminologyRelationKey(left.term, right.term);
        if (!relationKey || seen.has(relationKey)) continue;
        seen.add(relationKey);
        const reason = left.role === 'canonical' || right.role === 'canonical'
          ? `“${left.value || key}”同时出现在一个术语的规范名称和另一个术语的常用说法中，系统无法自动判断是否应合并。`
          : `“${left.value || key}”同时出现在多个术语组中，系统无法自动判断它应归属于哪一组。`;
        result.push({
          left: left.term,
          right: right.term,
          reason,
          confidence: 'low',
          source: 'dictionary'
        });
        if (result.length >= MAX_TERMINOLOGY_PENDING) return result;
      }
    }
  }
  return result;
}

function mergeTerminologyRecords(target, source) {
  const merged = {
    id: target.id || source.id || `term-${Date.now()}`,
    canonicalName: target.canonicalName,
    aliases: [
      ...(Array.isArray(target.aliases) ? target.aliases : []),
      source.canonicalName,
      ...(Array.isArray(source.aliases) ? source.aliases : [])
    ],
    scope: mergeField(target.scope, source.scope, 120),
    note: mergeField(target.note, source.note, 240),
    type: terminologyType(target.type) === 'person' || terminologyType(source.type) === 'person'
      ? 'person'
      : 'matter'
  };
  return merged;
}

function mergeTerminologyRelation(items, relation) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return { ok: false, error: '术语关系无效', terminology: normalizeTerminology(items) };
  const current = normalizeTerminology(items);
  const left = findTerm(current, normalized.left.canonicalName);
  const right = findTerm(current, normalized.right.canonicalName);
  // 两个叫法已经属于同一个词典条目（例如按别名吸附后命中同一条）时无需再合并。
  if (left && left === right) return { ok: true, terminology: current };
  const target = left || right || normalized.left;
  const source = left && right
    ? (target.id === left.id ? right : left)
    : (left ? normalized.right : (right ? normalized.left : normalized.right));
  const targetKey = terminologyKey(target.canonicalName);
  const sourceKey = terminologyKey(source.canonicalName);
  const remaining = current.filter(item => {
    const key = terminologyKey(item.canonicalName);
    return key !== targetKey && key !== sourceKey;
  });
  const merged = mergeTerminologyRecords(target, source);
  return { ok: true, terminology: normalizeTerminology([merged, ...remaining]) };
}

function applyTerminologyRelationDecision({
  terminology = [],
  pending = [],
  relations = [],
  relation,
  decision,
  basisHash = '',
  deferredAt = 0
} = {}) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return { ok: false, error: '术语关系无效' };
  if (decision === 'merge') {
    const merged = mergeTerminologyRelation(terminology, normalized);
    if (!merged.ok) return merged;
    // 合并也留决定记录：下次 AI 用另一种写法再提这层关系时，能被同一条结论压住。
    const nextRelations = addTerminologyRelationDecision(relations, normalized, 'merge');
    return {
      ok: true,
      terminology: merged.terminology,
      pending: normalizeTerminologyPending(pending, nextRelations),
      relations: nextRelations
    };
  }
  if (decision === 'separate') {
    const nextTerminology = normalizeTerminology([
      ...terminology,
      normalized.left,
      normalized.right
    ]);
    const nextRelations = addTerminologyRelationDecision(relations, normalized, 'separate');
    return {
      ok: true,
      terminology: nextTerminology,
      pending: normalizeTerminologyPending(pending, nextRelations),
      relations: nextRelations
    };
  }
  if (decision === 'defer') {
    // 暂缓只记录“依据变化前不再问”：不改词典、不把两侧当成已区分、不写排除表。
    const nextRelations = addTerminologyRelationDecision(relations, normalized, 'defer', {
      basisHash: clean(basisHash, 80),
      deferredAt: Number.isFinite(deferredAt) && deferredAt > 0 ? deferredAt : 0
    });
    return {
      ok: true,
      terminology: normalizeTerminology(terminology),
      pending: normalizeTerminologyPending(pending, nextRelations),
      relations: nextRelations
    };
  }
  return { ok: false, error: '术语关系处理方式无效' };
}

/* ---------- 暂缓依据指纹：只有相关日报变化才重新提醒 ---------- */

function relationSideNames(side) {
  return [side?.canonicalName, ...(Array.isArray(side?.aliases) ? side.aliases : [])]
    .map(value => clean(value, 120))
    .filter(Boolean);
}

function terminologyRelationBasis(relation, terminology = [], entries = []) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return '';
  const terms = normalizeTerminology(terminology);
  const enriched = enrichRelation(normalized, terms) || normalized;
  const names = new Map();
  for (const side of [normalized.left, normalized.right, enriched.left, enriched.right]) {
    for (const name of relationSideNames(side)) names.set(terminologyKey(name), name);
  }
  const sources = sourceBundle(Array.isArray(entries) ? entries : []);
  const matched = sources
    .filter(source => {
      const text = String(source.text || '');
      return text && [...names.values()].some(name => text.includes(name));
    })
    .map(source => `${source.id}|${source.date}|${source.time}|${source.text}`)
    .sort();
  return crypto.createHash('sha256').update(matched.join('\n')).digest('hex');
}

function deferRelationSnapshot(record) {
  return normalizeTerminologyRelation({
    left: { canonicalName: record.leftCanonicalName, aliases: record.leftAliases, scope: record.leftScope },
    right: { canonicalName: record.rightCanonicalName, aliases: record.rightAliases, scope: record.rightScope },
    reason: record.reason,
    refs: record.refs,
    confidence: record.confidence,
    source: record.source || 'ai'
  });
}

function recheckTerminologyDeferrals({
  relations = [],
  pending = [],
  terminology = [],
  entries = []
} = {}) {
  const records = normalizeTerminologyRelations(relations);
  const terms = normalizeTerminology(terminology);
  const revived = [];
  const kept = [];
  for (const record of records) {
    if (record.decision !== 'defer') {
      kept.push(record);
      continue;
    }
    const snapshot = deferRelationSnapshot(record);
    if (!snapshot) continue;
    const enriched = enrichRelation(snapshot, terms);
    if (!enriched) {
      // 两侧已归到同一个词典条目：问题已被合并解决，无需再问。
      continue;
    }
    if (!record.basisHash || terminologyRelationBasis(enriched, terms, entries) !== record.basisHash) {
      revived.push(enriched);
      continue;
    }
    kept.push(record);
  }
  return {
    relations: kept,
    pending: normalizeTerminologyPending([
      ...(Array.isArray(pending) ? pending : []),
      ...revived
    ], kept),
    changed: revived.length > 0 || kept.length !== records.length
  };
}

function reconcileTerminology({
  existing = [],
  discovered = [],
  uncertainRelations = [],
  pending = [],
  relations = []
} = {}) {
  const current = normalizeTerminology(existing);
  const discoveredTerms = normalizeTerminology(discovered);
  const decisions = normalizeTerminologyRelations(relations);
  const available = normalizeTerminology([...current, ...discoveredTerms]);
  const potentialConflicts = findTerminologyConflicts(available);
  const rawRelations = [
    ...(Array.isArray(pending) ? pending : []),
    ...(Array.isArray(uncertainRelations) ? uncertainRelations : []),
    ...potentialConflicts
  ]
    .map(item => enrichRelation(item, available))
    .filter(Boolean);
  const decisionFor = relation => decisions.find(record => relationMatchesDecision(relation, record));
  const unresolved = [];
  const separatelyResolved = [];
  for (const item of rawRelations) {
    const record = decisionFor(item);
    if (!record) unresolved.push(item);
    else if (record.decision === 'separate') separatelyResolved.push(item);
    // merge/defer 已有结论：不进待确认，也不触发“当成两件事写入词典”。
  }
  const blockedKeys = new Set();
  const blockSide = side => {
    for (const key of sideNameKeys(side)) blockedKeys.add(key);
  };
  for (const item of unresolved) {
    blockSide(item.left);
    blockSide(item.right);
  }
  // 暂缓=尚未决定：两侧叫法同样不能作为新词条自动入词典，防止同一件事被拆成两条。
  for (const record of decisions) {
    if (record.decision !== 'defer') continue;
    const sides = decisionSides(record);
    blockSide(sides.left);
    blockSide(sides.right);
  }
  const separatelyResolvedKeys = new Set();
  for (const item of separatelyResolved) {
    separatelyResolvedKeys.add(terminologyKey(item.left.canonicalName));
    separatelyResolvedKeys.add(terminologyKey(item.right.canonicalName));
  }
  const safeDiscovered = discoveredTerms.filter(item => {
    const key = terminologyKey(item.canonicalName);
    return !blockedKeys.has(key) || separatelyResolvedKeys.has(key) || current.some(term => terminologyKey(term.canonicalName) === key);
  });
  let nextTerminology = normalizeTerminology([...current, ...safeDiscovered]);
  for (const item of separatelyResolved) {
    nextTerminology = normalizeTerminology([
      ...nextTerminology,
      item.left,
      item.right
    ]);
  }
  const finalConflicts = findTerminologyConflicts(nextTerminology);
  const nextPending = normalizeTerminologyPending([
    ...unresolved,
    ...finalConflicts
  ], decisions);
  return {
    terminology: nextTerminology,
    pending: nextPending,
    relations: decisions,
    stats: {
      termCount: nextTerminology.length,
      pendingCount: nextPending.length,
      autoMergedCanonical: Math.max(0, current.length + discoveredTerms.length - nextTerminology.length)
    }
  };
}

module.exports = {
  MAX_TERMINOLOGY_PENDING,
  MAX_TERMINOLOGY_RELATIONS,
  RELATION_DECISIONS,
  terminologyRelationKey,
  normalizeTerminologyRelation,
  normalizeTerminologyPending,
  normalizeTerminologyRelations,
  relationMatchesDecision,
  addTerminologyRelationDecision,
  removeTerminologyRelationDecision,
  findTerminologyConflicts,
  mergeTerminologyRelation,
  applyTerminologyRelationDecision,
  terminologyRelationBasis,
  recheckTerminologyDeferrals,
  reconcileTerminology
};
