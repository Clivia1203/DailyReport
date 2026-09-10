const {
  sourceBundle,
  splitSources
} = require('./report-utils');
const {
  normalizeTerminology,
  terminologyType
} = require('./terminology');
const {
  normalizeTerminologyRelation
} = require('./terminology-reconciliation');
const { catalogFor } = require('./prompt-catalog');
const DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT = require('../prompts/zh-CN.json').terminologyDiscoveryPrompt;

const MAX_DISCOVERY_SOURCES = 60;
const MAX_DISCOVERY_CHARS = 18000;
const MAX_DISCOVERY_OUTPUT_TOKENS = 4096;
const MAX_DISCOVERY_CANDIDATES = 240;


function terminologyPromptRules(locale = 'zh-CN') {
  return catalogFor(locale).terminologyPromptRules || catalogFor('zh-CN').terminologyPromptRules;
}

function discoverySystemPrompt(locale = 'zh-CN') {
  return catalogFor(locale).terminologySystemPrompt;
}

function cleanSourceText(source) {
  return `[${source.ref}] ${source.date} ${source.time}  ${source.text}`;
}

function discoverySources(entries) {
  return sourceBundle(Array.isArray(entries) ? entries : []);
}

function splitDiscoverySources(sources, {
  maxSources = MAX_DISCOVERY_SOURCES,
  maxChars = MAX_DISCOVERY_CHARS
} = {}) {
  return splitSources(sources, { maxSources, maxChars });
}

function discoveryFormat(locale = 'zh-CN') {
  const rules = terminologyPromptRules(locale);
  return JSON.stringify({
    terms: [{
      canonical_name: rules.formatCanonical,
      aliases: [rules.formatAlias1, rules.formatAlias2],
      scope: rules.formatScope,
      note: rules.formatNote,
      type: rules.formatType
    }],
    uncertain_matches: [{
      left: {
        canonical_name: rules.formatRelationLeft,
        aliases: [rules.formatAlias1],
        scope: rules.formatScope,
        type: rules.formatType
      },
      right: {
        canonical_name: rules.formatRelationRight,
        aliases: [rules.formatAlias2],
        scope: rules.formatScope,
        type: rules.formatType
      },
      reason: rules.formatRelationReason,
      confidence: rules.formatConfidence
    }]
  }, null, 2);
}

function buildDiscoveryPrompt(sources, customPrompt, locale = 'zh-CN') {
  const rules = terminologyPromptRules(locale);
  const list = Array.isArray(sources) ? sources : [];
  const sourceText = list.length
    ? list.map(cleanSourceText).join('\n')
    : rules.noRecords;
  const prompt = String(customPrompt || catalogFor(locale).terminologyDiscoveryPrompt || DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT).trim();
  return [
    rules.task,
    prompt,
    '',
    rules.records,
    sourceText,
    '',
    rules.returnJson,
    discoveryFormat(locale),
    '',
    rules.constraints,
    rules.constraint1,
    rules.constraint2,
    rules.constraint3,
    rules.constraint4,
    rules.constraint5,
    rules.constraint6
  ].join('\n');
}

function formatTerminologyList(items, locale = 'zh-CN') {
  const rules = terminologyPromptRules(locale);
  const terms = normalizeTerminology(items);
  if (!terms.length) return rules.noExisting;
  return terms.map((term, index) => {
    const aliases = term.aliases.length ? term.aliases.join('、') : rules.noAliases;
    const scope = term.scope ? `${rules.scopeLabel}${term.scope}` : '';
    const note = term.note ? `${rules.noteLabel}${term.note}` : '';
    const type = terminologyType(term.type) === 'person' ? rules.personTypeLabel : '';
    return `${index + 1}. ${rules.canonical}${term.canonicalName}${rules.aliases}${aliases}${scope}${note}${type}`;
  }).join('\n');
}

function buildConsolidationPrompt(candidates, existing = [], customPrompt, locale = 'zh-CN') {
  const rules = terminologyPromptRules(locale);
  const list = normalizeTerminology(candidates).slice(0, MAX_DISCOVERY_CANDIDATES);
  const prompt = String(customPrompt || catalogFor(locale).terminologyDiscoveryPrompt || DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT).trim();
  return [
    rules.consolidate,
    '',
    rules.mergeRules,
    prompt,
    rules.uncertainMerge,
    '',
    rules.existing,
    formatTerminologyList(existing, locale),
    '',
    rules.candidates,
    formatTerminologyList(list, locale),
    '',
    rules.returnJson,
    discoveryFormat(locale),
    '',
    rules.aliasesOnly,
    rules.uncertainMatches,
    rules.constraint5
  ].join('\n');
}

function stripJsonFence(value) {
  return String(value || '')
    // 某些思考模型会把 <think>/<analysis> 直接混进最终 content；这些内容不是词典，
    // 而且里面经常会出现 JSON 示例。先删掉完整或未闭合的思考块，避免跨块拼接。
    .replace(/<(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(?:think|analysis|reasoning)\b[^>]*>[\s\S]*$/i, '')
    .trim();
}

// 从混入说明文字的响应中逐个找完整 JSON，而不是用第一个/最后一个括号硬截取。
// 这样思考示例、多个代码块、字符串中的大括号都不会互相污染。
function balancedJsonSlices(text) {
  const slices = [];
  for (let start = 0; start < text.length; start += 1) {
    if (text[start] !== '{' && text[start] !== '[') continue;
    const stack = [];
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') {
        inString = true;
        continue;
      }
      if (char === '{' || char === '[') {
        stack.push(char);
        continue;
      }
      if (char !== '}' && char !== ']') continue;
      const expected = char === '}' ? '{' : '[';
      if (stack.pop() !== expected) break;
      if (!stack.length) {
        slices.push(text.slice(start, index + 1));
        break;
      }
    }
  }
  return slices;
}

function jsonCandidates(text) {
  const candidates = [];
  const push = value => {
    const candidate = String(value || '').trim();
    if (candidate && !candidates.includes(candidate)) candidates.push(candidate);
  };
  push(text);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
  let match;
  while ((match = fenced.exec(text))) push(match[1]);
  for (const candidate of [...candidates]) {
    for (const slice of balancedJsonSlices(candidate)) push(slice);
  }
  return candidates;
}

function rawTerminologyItem(item) {
  return {
    id: item?.id,
    canonicalName: item?.canonicalName || item?.canonical_name || item?.name,
    type: item?.type,
    aliases: Array.isArray(item?.aliases)
      ? item.aliases
      : String(item?.alias || item?.common_names || item?.commonNames || '')
        .split(/[\n,，、;；]+/)
        .map(alias => alias.trim())
        .filter(Boolean),
    scope: item?.scope,
    note: item?.note
  };
}

function rawRelationSide(value) {
  return value && typeof value === 'object' ? value : {};
}

function rawUncertainRelation(item) {
  const source = item && typeof item === 'object' ? item : {};
  const left = source.left || {
    canonicalName: source.leftCanonicalName || source.left_canonical_name || source.existingName || source.existing_name,
    aliases: source.leftAliases || source.left_aliases || source.existingAliases || source.existing_aliases,
    scope: source.leftScope || source.left_scope || source.existingScope || source.existing_scope
  };
  const right = source.right || {
    canonicalName: source.rightCanonicalName || source.right_canonical_name || source.candidateName || source.candidate_name,
    aliases: source.rightAliases || source.right_aliases || source.candidateAliases || source.candidate_aliases,
    scope: source.rightScope || source.right_scope || source.candidateScope || source.candidate_scope
  };
  return normalizeTerminologyRelation({
    left: rawRelationSide(left, 'left'),
    right: rawRelationSide(right, 'right'),
    reason: source.reason || source.explanation,
    confidence: source.confidence,
    refs: source.refs || source.references || source.sourceRefs,
    source: 'ai'
  });
}

function parseTerminologyResponseDetailed(value) {
  const text = stripJsonFence(value);
  if (!text) return null;
  let bestResult = null;
  let bestScore = -1;
  // 优先尝试后出现的完整片段：模型常会先输出一个空示例或中间草稿，最终词典通常在后面。
  for (const candidate of jsonCandidates(text).reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      const items = Array.isArray(parsed) ? parsed : parsed?.terms;
      if (!Array.isArray(items)) continue;
      const result = normalizeTerminology(items.map(rawTerminologyItem));
      const uncertainRelations = (Array.isArray(parsed?.uncertain_matches)
        ? parsed.uncertain_matches
        : Array.isArray(parsed?.uncertainMatches) ? parsed.uncertainMatches : [])
        .map(rawUncertainRelation)
        .filter(Boolean);
      const detailed = { terms: result, uncertainRelations };
      const score = result.length + uncertainRelations.length;
      if (score > bestScore) {
        bestResult = detailed;
        bestScore = score;
      }
    } catch { /* 尝试下一个完整 JSON 片段 */ }
  }
  return bestResult;
}

function parseTerminologyResponse(value) {
  return parseTerminologyResponseDetailed(value)?.terms || null;
}

function mergeTerminologyResults(results) {
  return normalizeTerminology((Array.isArray(results) ? results : [])
    .flatMap(items => Array.isArray(items) ? items : []));
}

function normalizeDiscoveryState(value) {
  const state = value && typeof value === 'object' ? value : {};
  return {
    initialized: !!state.initialized,
    lastRunAt: Number.isFinite(Number(state.lastRunAt)) ? Number(state.lastRunAt) : 0,
    sourceHash: typeof state.sourceHash === 'string' ? state.sourceHash.trim() : '',
    model: typeof state.model === 'string' ? state.model.trim() : '',
    recordCount: Number.isFinite(Number(state.recordCount)) ? Math.max(0, Number(state.recordCount)) : 0,
    termCount: Number.isFinite(Number(state.termCount)) ? Math.max(0, Number(state.termCount)) : 0
  };
}

module.exports = {
  MAX_DISCOVERY_SOURCES,
  MAX_DISCOVERY_CHARS,
  MAX_DISCOVERY_OUTPUT_TOKENS,
  MAX_DISCOVERY_CANDIDATES,
  DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT,
  discoverySystemPrompt,
  discoverySources,
  splitDiscoverySources,
  buildDiscoveryPrompt,
  buildConsolidationPrompt,
  parseTerminologyResponse,
  parseTerminologyResponseDetailed,
  mergeTerminologyResults,
  normalizeDiscoveryState
};
