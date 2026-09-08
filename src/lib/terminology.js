/* 术语规范：把用户随手记录中的不同叫法映射到统一的输出名称。 */

const MAX_TERMINOLOGY = 100;
const MAX_ALIASES_PER_TERM = 30;
const MAX_TERMINOLOGY_EXCLUSIONS = 200;
const MAX_TEXT_LENGTH = 120;

function text(value, max = MAX_TEXT_LENGTH) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function terminologyKey(value) {
  return text(value, 240)
    .toLocaleLowerCase()
    .replace(/[\s\-_.·•/\\，。、“”‘’「」【】()（）:：;；]+/g, '');
}

function uniqueStrings(values, excluded = '') {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const clean = text(value);
    const key = terminologyKey(clean);
    if (!clean || !key || key === terminologyKey(excluded) || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= MAX_ALIASES_PER_TERM) break;
  }
  return result;
}

function normalizeTerminology(items) {
  if (!Array.isArray(items)) return [];
  const result = [];
  const seenIds = new Set();
  const sameTerm = new Map();
  for (let index = 0; index < items.length && result.length < MAX_TERMINOLOGY; index += 1) {
    const item = items[index];
    if (!item || typeof item !== 'object') continue;
    const canonicalName = text(item.canonicalName || item.name);
    if (!canonicalName) continue;
    let id = text(item.id, 80) || `term-${index + 1}`;
    if (seenIds.has(id)) id = `term-${index + 1}`;
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    const aliases = uniqueStrings(item.aliases, canonicalName);
    const scope = text(item.scope, 120);
    const note = text(item.note, 240);
    const semanticKey = `${terminologyKey(canonicalName)}|${terminologyKey(scope)}`;
    const existingIndex = sameTerm.get(semanticKey);
    if (existingIndex !== undefined) {
      const existing = result[existingIndex];
      existing.aliases = uniqueStrings([...existing.aliases, ...aliases], existing.canonicalName);
      existing.note = existing.note || note;
      continue;
    }
    sameTerm.set(semanticKey, result.length);
    result.push({ id, canonicalName, aliases, scope, note });
  }
  return result;
}

function terminologyExclusionKey(canonicalName, alias) {
  const canonicalKey = terminologyKey(canonicalName);
  const aliasKey = terminologyKey(alias);
  return canonicalKey && aliasKey && canonicalKey !== aliasKey
    ? `${canonicalKey}|${aliasKey}`
    : '';
}

function normalizeTerminologyExclusions(items) {
  const result = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const canonicalName = text(item?.canonicalName || item?.canonical_name);
    const alias = text(item?.alias || item?.candidate_alias || item?.candidateAlias);
    const key = terminologyExclusionKey(canonicalName, alias);
    if (!canonicalName || !alias || !key || seen.has(key)) continue;
    seen.add(key);
    result.push({ canonicalName, alias });
    if (result.length >= MAX_TERMINOLOGY_EXCLUSIONS) break;
  }
  return result;
}

function addTerminologyExclusion(items, canonicalName, alias) {
  return normalizeTerminologyExclusions([
    ...(Array.isArray(items) ? items : []),
    { canonicalName, alias }
  ]);
}

function removeTerminologyExclusion(items, canonicalName, alias) {
  const target = terminologyExclusionKey(canonicalName, alias);
  if (!target) return normalizeTerminologyExclusions(items);
  return normalizeTerminologyExclusions(items)
    .filter(item => terminologyExclusionKey(item.canonicalName, item.alias) !== target);
}

function terminologySignature(items) {
  return normalizeTerminology(items).map(item => ({
    canonicalName: item.canonicalName,
    aliases: item.aliases,
    scope: item.scope,
    note: item.note
  }));
}

function upsertTerminology(items, draft = {}) {
  const current = normalizeTerminology(items);
  const canonicalName = text(draft.canonicalName || draft.name);
  if (!canonicalName) return current;
  const scope = text(draft.scope, 120);
  const same = current.find(item => (
    terminologyKey(item.canonicalName) === terminologyKey(canonicalName)
    && item.scope === scope
  ));
  const nextItem = {
    id: text(draft.id, 80) || same?.id || `term-${Date.now()}`,
    canonicalName,
    aliases: uniqueStrings(draft.aliases, canonicalName),
    scope,
    note: text(draft.note, 240)
  };
  const next = same
    ? current.map(item => item.id === same.id ? nextItem : item)
    : [nextItem, ...current];
  return normalizeTerminology(next);
}

function addTerminologyAlias(items, canonicalName, alias, scope = '') {
  const current = normalizeTerminology(items);
  const canonicalKey = terminologyKey(canonicalName);
  const aliasText = text(alias);
  if (!canonicalKey || !aliasText) return current;
  const target = current.find(item => (
    terminologyKey(item.canonicalName) === canonicalKey && item.scope === text(scope, 120)
  ));
  if (!target) {
    return upsertTerminology(current, {
      canonicalName: text(canonicalName),
      aliases: [aliasText],
      scope
    });
  }
  return current.map(item => item.id === target.id
    ? { ...item, aliases: uniqueStrings([...item.aliases, aliasText], item.canonicalName) }
    : item
  );
}

function removeTerminology(items, id) {
  const target = text(id, 80);
  return normalizeTerminology(items).filter(item => item.id !== target);
}

function findTerminologyCandidates(items, value, scope = '') {
  const key = terminologyKey(value);
  if (!key) return [];
  const requestedScope = text(scope, 120);
  return normalizeTerminology(items).filter(item => (
    (!requestedScope || !item.scope || item.scope === requestedScope)
    && (terminologyKey(item.canonicalName) === key || item.aliases.some(alias => terminologyKey(alias) === key))
  ));
}

module.exports = {
  MAX_TERMINOLOGY,
  MAX_ALIASES_PER_TERM,
  MAX_TERMINOLOGY_EXCLUSIONS,
  terminologyKey,
  terminologyExclusionKey,
  normalizeTerminology,
  normalizeTerminologyExclusions,
  terminologySignature,
  upsertTerminology,
  addTerminologyAlias,
  addTerminologyExclusion,
  removeTerminologyExclusion,
  removeTerminology,
  findTerminologyCandidates
};
