/* 近期工作闭环的输入编排、结果解析和缓存指纹。AI 只做语义判断，原始记录仍是证据来源。 */

const crypto = require('crypto');
const { catalogFor } = require('./prompt-catalog');
const DEFAULT_CLOSURE_PROMPT = require('../prompts/zh-CN.json').closurePrompt;

const DEFAULT_CLOSURE_MAX_HISTORY_SOURCES = 36;
const DEFAULT_CLOSURE_MAX_HISTORY_CHARS = 16000;

function pad(value, width = 2) { return String(value).padStart(width, '0'); }

function localDateStr(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimeStr(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cleanText(value, max = 240) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cleanPrompt(value, max = 2400) {
  return String(value || '').normalize('NFKC').replace(/\r\n?/g, '\n').trim().slice(0, max);
}

function key(value) {
  return cleanText(value, 400).toLocaleLowerCase().replace(/[\s\-_.·•/\\，。、“”‘’「」【】()（）:：;；]+/g, '');
}

function closureSourceBundle(entries, prefix) {
  const marker = String(prefix || 'R').slice(0, 1).toUpperCase();
  return (Array.isArray(entries) ? entries : [])
    .slice()
    .sort((a, b) => Number(a.ts) - Number(b.ts) || (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0))
    .map((entry, index) => ({
      ref: `${marker}${pad(index + 1, 3)}`,
      id: String(entry.id || ''),
      date: localDateStr(entry.ts),
      time: localTimeStr(entry.ts),
      text: String(entry.text || '')
    }));
}

function sourceLine(source) {
  return `[${source.ref}] ${source.date} ${source.time}  ${source.text}`;
}

function splitClosureHistory(sources, {
  maxSources = DEFAULT_CLOSURE_MAX_HISTORY_SOURCES,
  maxChars = DEFAULT_CLOSURE_MAX_HISTORY_CHARS
} = {}) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return [[]];
  const chunks = [];
  let chunk = [];
  let chars = 0;
  for (const source of list) {
    const lineLength = sourceLine(source).length + 1;
    const overflow = chunk.length > 0 && (chunk.length >= maxSources || chars + lineLength > maxChars);
    if (overflow) {
      chunks.push(chunk);
      chunk = [];
      chars = 0;
    }
    chunk.push(source);
    chars += lineLength;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

function fillPrompt(value, replacements = {}) {
  return String(value || '').replace(/\{(\w+)\}/g, (_match, key) => String(replacements[key] ?? ''));
}

function closurePromptRules(locale = 'zh-CN') {
  return catalogFor(locale).closurePromptRules || catalogFor('zh-CN').closurePromptRules;
}

function terminologyPrompt(terms, locale = 'zh-CN') {
  const rules = catalogFor(locale).reportPromptRules || catalogFor('zh-CN').reportPromptRules;
  const list = Array.isArray(terms) ? terms : [];
  if (!list.length) return closurePromptRules(locale).noTerminology;
  return list.map((item, index) => {
    const aliases = Array.isArray(item.aliases) && item.aliases.length ? item.aliases.join('、') : rules.noAliases;
    const scope = item.scope ? `${rules.scope}${item.scope}` : '';
    const note = item.note ? `${rules.note}${item.note}` : '';
    return `${index + 1}. ${rules.canonical}${item.canonicalName}${rules.aliases}${aliases}${scope}${note}`;
  }).join('\n');
}

function buildClosurePrompt({
  start,
  end,
  recentSources = [],
  historicalSources = [],
  terminology = [],
  customPrompt,
  segmentIndex = 0,
  segmentCount = 1,
  locale = 'zh-CN'
} = {}) {
  const rules = closurePromptRules(locale);
  const recentText = recentSources.length
    ? recentSources.map(sourceLine).join('\n')
    : rules.noRecent;
  const historyText = historicalSources.length
    ? historicalSources.map(sourceLine).join('\n')
    : rules.noHistory;
  const prompt = String(customPrompt || catalogFor(locale).closurePrompt || DEFAULT_CLOSURE_PROMPT).trim();
  return [
    rules.role,
    fillPrompt(rules.period, { start, end }),
    fillPrompt(rules.batch, { index: segmentIndex + 1, total: segmentCount }),
    '',
    rules.userPrompt,
    cleanPrompt(prompt),
    '',
    rules.task,
    rules.task1,
    rules.task2,
    rules.task3,
    rules.task4,
    '',
    rules.naming,
    rules.naming1,
    rules.naming2,
    rules.naming3,
    rules.naming4,
    rules.naming5,
    '',
    rules.facts,
    rules.facts1,
    rules.facts2,
    rules.facts3,
    rules.facts4,
    '',
    rules.terminology,
    terminologyPrompt(terminology, locale),
    '',
    rules.recentRecords,
    recentText,
    '',
    rules.historicalRecords,
    historyText,
    '',
    rules.returnJson,
    JSON.stringify({
      completed_items: [{
        title: rules.sampleCompletedTitle,
        summary: rules.sampleCompletedSummary,
        scope: rules.sampleScope,
        status: rules.sampleStatus,
        confidence: rules.sampleConfidence,
        before_refs: ['H001'],
        recent_refs: ['N001'],
        note: rules.sampleCompletedNote
      }],
      recent_explicit_completions: [{
        title: rules.sampleRecentTitle,
        summary: rules.sampleRecentSummary,
        confidence: rules.sampleConfidence,
        recent_refs: ['N002']
      }],
      needs_confirmation: [{
        alias: rules.sampleAlias,
        canonical_name: rules.sampleCanonical,
        reason: rules.sampleReason,
        before_refs: ['H002'],
        recent_refs: ['N003']
      }]
    }, null, 2)
  ].join('\n');
}

function cleanRefs(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const ref = cleanText(value, 16).toUpperCase();
    if (!/^[HN]\d{3}$/.test(ref) || seen.has(ref)) continue;
    seen.add(ref);
    result.push(ref);
  }
  return result;
}

function normalizeConfidence(value) {
  const clean = cleanText(value, 20).toLowerCase();
  return ['high', 'medium', 'low'].includes(clean) ? clean : 'medium';
}

function normalizeClosureResult(raw = {}) {
  const itemList = Array.isArray(raw.completed_items) ? raw.completed_items : (Array.isArray(raw.completedItems) ? raw.completedItems : []);
  const directList = Array.isArray(raw.recent_explicit_completions)
    ? raw.recent_explicit_completions
    : (Array.isArray(raw.recentExplicitCompletions) ? raw.recentExplicitCompletions : []);
  const confirmList = Array.isArray(raw.needs_confirmation)
    ? raw.needs_confirmation
    : (Array.isArray(raw.needsConfirmation) ? raw.needsConfirmation : []);
  const items = itemList.map(item => ({
    title: cleanText(item?.title || item?.canonical_name || item?.canonicalName),
    summary: cleanText(item?.summary || item?.description, 480),
    scope: ['macro', 'specific'].includes(cleanText(item?.scope, 20)) ? cleanText(item.scope, 20) : 'macro',
    status: item?.status === 'completed' ? 'completed' : 'stage_completed',
    confidence: normalizeConfidence(item?.confidence),
    before_refs: cleanRefs(item?.before_refs || item?.beforeRefs),
    recent_refs: cleanRefs(item?.recent_refs || item?.recentRefs),
    note: cleanText(item?.note, 240)
  })).filter(item => item.title && item.summary && item.recent_refs.length).slice(0, 30);
  const direct = directList.map(item => ({
    title: cleanText(item?.title || item?.canonical_name || item?.canonicalName),
    summary: cleanText(item?.summary || item?.description, 480),
    confidence: normalizeConfidence(item?.confidence),
    recent_refs: cleanRefs(item?.recent_refs || item?.recentRefs)
  })).filter(item => item.title && item.summary && item.recent_refs.length).slice(0, 30);
  const needsConfirmation = confirmList.map(item => ({
    alias: cleanText(item?.alias || item?.candidate_alias || item?.candidateAlias, 120),
    canonical_name: cleanText(item?.canonical_name || item?.canonicalName || item?.title, 120),
    reason: cleanText(item?.reason || item?.summary, 360),
    before_refs: cleanRefs(item?.before_refs || item?.beforeRefs),
    recent_refs: cleanRefs(item?.recent_refs || item?.recentRefs)
  })).filter(item => item.alias && item.canonical_name && item.reason && item.recent_refs.length).slice(0, 20);
  return { completed_items: items, recent_explicit_completions: direct, needs_confirmation: needsConfirmation };
}

function filterResolvedClosureSuggestions(summary, terminology = []) {
  if (!summary) return null;

  const resolved = new Set();
  for (const term of Array.isArray(terminology) ? terminology : []) {
    const canonical = key(term?.canonicalName || term?.canonical_name);
    if (!canonical) continue;
    for (const alias of Array.isArray(term?.aliases) ? term.aliases : []) {
      const aliasKey = key(alias);
      if (aliasKey) resolved.add(`${canonical}|${aliasKey}`);
    }
  }

  const suggestions = Array.isArray(summary.needs_confirmation) ? summary.needs_confirmation : [];
  return {
    ...summary,
    needs_confirmation: suggestions.filter(item => {
      const suggestionKey = `${key(item?.canonical_name || item?.canonicalName)}|${key(item?.alias)}`;
      return !resolved.has(suggestionKey);
    })
  };
}

function parseClosureResponse(value) {
  const text = String(value || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  if (!text) return null;
  const candidates = [text];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const candidate of candidates) {
    try { return normalizeClosureResult(JSON.parse(candidate)); } catch { /* 尝试下一个 JSON 片段 */ }
  }
  return null;
}

function mergeEvidenceRefs(a, b) {
  return [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])].sort();
}

function mergeClosureResults(results) {
  const merged = new Map();
  const direct = new Map();
  const confirmations = new Map();
  for (const result of Array.isArray(results) ? results : []) {
    const normalized = normalizeClosureResult(result);
    for (const item of normalized.completed_items) {
      // 分批请求中同一事项的说明很容易出现措辞差异；标题是 AI 已经归一化后的事项边界，
      // 用标题合并可以避免同一闭环因为每批 summary 略有不同而重复显示。
      const itemKey = key(item.title);
      const previous = merged.get(itemKey);
      merged.set(itemKey, previous ? {
        ...previous,
        confidence: previous.confidence === 'high' || item.confidence === 'high' ? 'high' : 'medium',
        before_refs: mergeEvidenceRefs(previous.before_refs, item.before_refs),
        recent_refs: mergeEvidenceRefs(previous.recent_refs, item.recent_refs),
        note: previous.note || item.note
      } : item);
    }
    for (const item of normalized.recent_explicit_completions) {
      const itemKey = key(item.title);
      const previous = direct.get(itemKey);
      direct.set(itemKey, previous ? {
        ...previous,
        confidence: previous.confidence === 'high' || item.confidence === 'high' ? 'high' : 'medium',
        recent_refs: mergeEvidenceRefs(previous.recent_refs, item.recent_refs)
      } : item);
    }
    for (const item of normalized.needs_confirmation) {
      const itemKey = `${key(item.alias)}|${key(item.canonical_name)}`;
      const previous = confirmations.get(itemKey);
      confirmations.set(itemKey, previous ? {
        ...previous,
        before_refs: mergeEvidenceRefs(previous.before_refs, item.before_refs),
        recent_refs: mergeEvidenceRefs(previous.recent_refs, item.recent_refs)
      } : item);
    }
  }
  return {
    completed_items: [...merged.values()].slice(0, 30),
    recent_explicit_completions: [...direct.values()].slice(0, 30),
    needs_confirmation: [...confirmations.values()].slice(0, 20)
  };
}

function closureInputHash(recentSources, historicalSources, terminology = []) {
  const sourceText = [...(recentSources || []), ...(historicalSources || [])]
    .map(source => `${source.id}|${source.date}|${source.time}|${source.text}`)
    .join('\n');
  const termsText = JSON.stringify(terminology || []);
  return crypto.createHash('sha256').update(`${sourceText}\n--TERMS--\n${termsText}`).digest('hex');
}

function closureCacheKey({ start, end, periodType = 'week', inputHash, terminologyHash = '', promptHash = '' } = {}) {
  return [periodType, start, end, inputHash, terminologyHash, promptHash].join('|');
}

function closureTimestamp(summary) {
  return Number(summary?.updatedAt || summary?.createdAt) || 0;
}

function sameClosurePeriod(summary, params = {}) {
  return !!summary
    && summary.periodType === (params.periodType || 'week')
    && summary.start === params.start
    && summary.end === params.end;
}

function newestClosure(summaries) {
  return (Array.isArray(summaries) ? summaries : [])
    .map((summary, index) => ({ summary, index }))
    .sort((a, b) => closureTimestamp(a.summary) - closureTimestamp(b.summary) || a.index - b.index)
    .at(-1)?.summary || null;
}

function findCachedClosure(summaries, params = {}) {
  return newestClosure((Array.isArray(summaries) ? summaries : []).filter(summary => (
    sameClosurePeriod(summary, params) && summary.cacheKey === params.cacheKey
  )));
}

function findLatestClosure(summaries, params = {}) {
  return newestClosure((Array.isArray(summaries) ? summaries : []).filter(summary => sameClosurePeriod(summary, params)));
}

function closureCacheStatus(summary, params = {}) {
  if (!summary || !sameClosurePeriod(summary, params)) return 'missing';
  if (summary.cacheKey && params.cacheKey && summary.cacheKey === params.cacheKey) return 'fresh';
  if (summary.inputHash && params.inputHash && summary.inputHash !== params.inputHash) return 'source-changed';
  if (summary.terminologyHash && params.terminologyHash && summary.terminologyHash !== params.terminologyHash) return 'terminology-changed';
  if (summary.promptHash && params.promptHash && summary.promptHash !== params.promptHash) return 'prompt-changed';
  return 'unknown';
}

function hydrateClosureResult(result, sourceMap = new Map()) {
  const validRefs = refs => [...new Set((Array.isArray(refs) ? refs : []).filter(ref => sourceMap.has(ref)))];
  const hydrateRefs = refs => validRefs(refs)
    .map(ref => sourceMap.get(ref))
    .filter(Boolean);
  const normalized = normalizeClosureResult(result);
  return {
    ...normalized,
    completed_items: normalized.completed_items.map(item => ({
      ...item,
      before_refs: validRefs(item.before_refs),
      recent_refs: validRefs(item.recent_refs),
      before_evidence: hydrateRefs(item.before_refs),
      recent_evidence: hydrateRefs(item.recent_refs)
    })).filter(item => item.recent_refs.length),
    recent_explicit_completions: normalized.recent_explicit_completions.map(item => ({
      ...item,
      recent_refs: validRefs(item.recent_refs),
      evidence: hydrateRefs(item.recent_refs)
    })).filter(item => item.recent_refs.length),
    needs_confirmation: normalized.needs_confirmation.map(item => ({
      ...item,
      before_refs: validRefs(item.before_refs),
      recent_refs: validRefs(item.recent_refs),
      before_evidence: hydrateRefs(item.before_refs),
      recent_evidence: hydrateRefs(item.recent_refs)
    })).filter(item => item.recent_refs.length)
  };
}

module.exports = {
  DEFAULT_CLOSURE_MAX_HISTORY_SOURCES,
  DEFAULT_CLOSURE_MAX_HISTORY_CHARS,
  DEFAULT_CLOSURE_PROMPT,
  localDateStr,
  localTimeStr,
  closureSourceBundle,
  splitClosureHistory,
  buildClosurePrompt,
  normalizeClosureResult,
  filterResolvedClosureSuggestions,
  parseClosureResponse,
  mergeClosureResults,
  closureInputHash,
  closureCacheKey,
  findCachedClosure,
  findLatestClosure,
  closureCacheStatus,
  hydrateClosureResult
};
