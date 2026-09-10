/* 术语归并闸门：确定的重复项可以自动整理，不确定的关系必须交给用户选择。 */

const {
  terminologyKey,
  normalizeTerminology
} = require('./terminology');

const MAX_TERMINOLOGY_PENDING = 120;
const MAX_TERMINOLOGY_RELATIONS = 240;
const RELATION_DECISIONS = new Set(['separate']);

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
  return {
    canonicalName,
    aliases: cleanList(source.aliases || source.alias || source.common_names || source.commonNames),
    scope: clean(source.scope, 120),
    note: clean(source.note, 240)
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
    note: source.leftNote || source.left_note
  });
  const right = termSnapshot(source.right || {
    canonicalName: source.rightCanonicalName || source.right_canonical_name,
    aliases: source.rightAliases || source.right_aliases,
    scope: source.rightScope || source.right_scope,
    note: source.rightNote || source.right_note
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
    result.push({
      key: relation.key,
      leftCanonicalName: relation.left.canonicalName,
      leftScope: relation.left.scope,
      rightCanonicalName: relation.right.canonicalName,
      rightScope: relation.right.scope,
      decision
    });
    if (result.length >= MAX_TERMINOLOGY_RELATIONS) break;
  }
  return result;
}

function normalizeTerminologyPending(items, decisions = []) {
  const decisionKeys = new Set(normalizeTerminologyRelations(decisions).map(item => item.key));
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const relation = normalizeTerminologyRelation(item);
    if (!relation || decisionKeys.has(relation.key) || seen.has(relation.key)) continue;
    seen.add(relation.key);
    result.push(relation);
    if (result.length >= MAX_TERMINOLOGY_PENDING) break;
  }
  return result;
}

function addTerminologyRelationDecision(items, relation, decision = 'separate') {
  if (!RELATION_DECISIONS.has(decision)) return normalizeTerminologyRelations(items);
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return normalizeTerminologyRelations(items);
  return normalizeTerminologyRelations([
    ...(Array.isArray(items) ? items : []),
    { ...normalized, decision }
  ]);
}

function removeTerminologyRelationDecision(items, relation) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return normalizeTerminologyRelations(items);
  return normalizeTerminologyRelations(items).filter(item => item.key !== normalized.key);
}

function findTerm(terms, canonicalName) {
  const key = terminologyKey(canonicalName);
  return normalizeTerminology(terms).find(item => terminologyKey(item.canonicalName) === key);
}

function enrichRelation(relation, availableTerms) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return null;
  const enrich = side => {
    const existing = findTerm(availableTerms, side.canonicalName);
    return existing
      ? {
        canonicalName: existing.canonicalName,
        aliases: existing.aliases,
        scope: existing.scope,
        note: existing.note
      }
      : side;
  };
  return {
    ...normalized,
    left: enrich(normalized.left),
    right: enrich(normalized.right)
  };
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
    note: mergeField(target.note, source.note, 240)
  };
  return merged;
}

function mergeTerminologyRelation(items, relation) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return { ok: false, error: '术语关系无效', terminology: normalizeTerminology(items) };
  const current = normalizeTerminology(items);
  const left = findTerm(current, normalized.left.canonicalName);
  const right = findTerm(current, normalized.right.canonicalName);
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
  decision
} = {}) {
  const normalized = normalizeTerminologyRelation(relation);
  if (!normalized) return { ok: false, error: '术语关系无效' };
  if (decision === 'merge') {
    const merged = mergeTerminologyRelation(terminology, normalized);
    if (!merged.ok) return merged;
    return {
      ok: true,
      terminology: merged.terminology,
      pending: normalizeTerminologyPending(
        normalizeTerminologyPending(pending).filter(item => item.key !== normalized.key),
        removeTerminologyRelationDecision(relations, normalized)
      ),
      relations: removeTerminologyRelationDecision(relations, normalized)
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
      pending: normalizeTerminologyPending(
        normalizeTerminologyPending(pending).filter(item => item.key !== normalized.key),
        nextRelations
      ),
      relations: nextRelations
    };
  }
  return { ok: false, error: '术语关系处理方式无效' };
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
  const unresolved = normalizeTerminologyPending(rawRelations, decisions);
  const blockedKeys = new Set();
  for (const item of unresolved) {
    blockedKeys.add(terminologyKey(item.left.canonicalName));
    blockedKeys.add(terminologyKey(item.right.canonicalName));
  }
  const decisionMap = new Map(decisions.map(item => [item.key, item]));
  const separatelyResolvedKeys = new Set();
  for (const item of rawRelations) {
    if (decisionMap.has(item.key)) {
      separatelyResolvedKeys.add(terminologyKey(item.left.canonicalName));
      separatelyResolvedKeys.add(terminologyKey(item.right.canonicalName));
    }
  }
  const safeDiscovered = discoveredTerms.filter(item => {
    const key = terminologyKey(item.canonicalName);
    return !blockedKeys.has(key) || separatelyResolvedKeys.has(key) || current.some(term => terminologyKey(term.canonicalName) === key);
  });
  let nextTerminology = normalizeTerminology([...current, ...safeDiscovered]);
  for (const item of rawRelations) {
    if (!decisionMap.has(item.key)) continue;
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
  terminologyRelationKey,
  normalizeTerminologyRelation,
  normalizeTerminologyPending,
  normalizeTerminologyRelations,
  addTerminologyRelationDecision,
  removeTerminologyRelationDecision,
  findTerminologyConflicts,
  mergeTerminologyRelation,
  applyTerminologyRelationDecision,
  reconcileTerminology
};
