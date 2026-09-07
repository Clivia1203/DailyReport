/* 近期工作闭环的输入编排、结果解析和缓存指纹。AI 只做语义判断，原始记录仍是证据来源。 */

const crypto = require('crypto');

const DEFAULT_CLOSURE_MAX_HISTORY_SOURCES = 36;
const DEFAULT_CLOSURE_MAX_HISTORY_CHARS = 16000;
const DEFAULT_CLOSURE_PROMPT = '请整理当前周期内近期完成或取得阶段性进展的工作闭环。优先把历史记录中的问题、测试或待处理事项，与当前周期记录中的解决、完成或验证结果对应起来。名称尽量使用术语规范中的规范名称；细分信息不明确时使用宏观表述。输出应简洁、事实准确，并保留历史依据和近期依据。';

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

function terminologyPrompt(terms) {
  const list = Array.isArray(terms) ? terms : [];
  if (!list.length) return '（用户尚未配置术语规范；请根据上下文判断，但不要强行建立永久别名。）';
  return list.map((item, index) => {
    const aliases = Array.isArray(item.aliases) && item.aliases.length ? item.aliases.join('、') : '无';
    const scope = item.scope ? `；适用范围：${item.scope}` : '';
    const note = item.note ? `；说明：${item.note}` : '';
    return `${index + 1}. 规范名称：${item.canonicalName}；常用说法：${aliases}${scope}${note}`;
  }).join('\n');
}

function buildClosurePrompt({
  start,
  end,
  recentSources = [],
  historicalSources = [],
  terminology = [],
  customPrompt = DEFAULT_CLOSURE_PROMPT,
  segmentIndex = 0,
  segmentCount = 1
} = {}) {
  const recentText = recentSources.length
    ? recentSources.map(sourceLine).join('\n')
    : '（当前周期没有记录）';
  const historyText = historicalSources.length
    ? historicalSources.map(sourceLine).join('\n')
    : '（当前周期之前没有可用历史记录）';
  return [
    '你是“近期工作闭环整理助手”，不是项目进度管理器。',
    `当前周期：${start} 至 ${end}`,
    `这是历史记录比对的第 ${segmentIndex + 1}/${segmentCount} 批。当前周期记录在每一批中都完整提供；历史记录按批提供。`,
    '',
    '用户可编辑的闭环提示词（只能补充表达目标，不能违反事实边界和来源要求）：',
    cleanPrompt(customPrompt) || DEFAULT_CLOSURE_PROMPT,
    '',
    '任务：',
    '1. 只找出当前周期内出现的明确完成、解决、验证通过、可使用、已交付或阶段性闭环。',
    '2. 优先寻找“历史记录中的问题/待处理/测试中/进行中”与“当前周期记录中的完成结果”之间的对应关系。',
    '3. 当前周期记录中明确完成、但找不到历史对应项的内容，可以放入 recent_explicit_completions。',
    '4. 不要总结整个项目，也不要假设随手记录覆盖了项目全部事实。未记录不等于未完成。',
    '',
    '名称和语义匹配：',
    '1. 规范名称优先使用术语规范中的名称。',
    '2. 记录中的简称、口语、缩写、错写和新造词可能指向同一事项，例如“项目简称”“产品简称”“客户简称”。',
    '3. 不能只因为一个词相似就合并，必须结合完整记录、产品上下文、任务动作和时间关系判断。',
    '4. 同一个产品可能包含不同功率段、版本或子任务。若细分信息不充分，提升到产品族或宏观层级，不要强行指定细分范围。',
    '5. 如果无法确定是否为同一事项，放入 needs_confirmation；不要把不确定关系写成已完成事实。',
    '',
    '事实边界：',
    '1. “已联系”“已安排”“计划处理”“继续跟进”“正在排查”不能直接当作已完成。',
    '2. 不要输出“全部完成”“所有功率段完成”“项目已结束”等超过证据范围的结论。',
    '3. 每条结论必须引用历史依据或当前周期依据的来源编号。来源编号只使用输入中的编号，不要自造编号。',
    '4. 只输出简要判断依据，不要输出详细的内部思考过程。',
    '',
    '术语规范：',
    terminologyPrompt(terminology),
    '',
    '当前周期记录（必须全部参与判断）：',
    recentText,
    '',
    '历史记录（本批）：',
    historyText,
    '',
    '请只返回合法 JSON，不要 Markdown 代码围栏，不要返回 JSON 之外的解释。格式如下：',
    JSON.stringify({
      completed_items: [{
        title: '规范名称 + 事项 + 已完成/已闭环',
        summary: '说明此前状态与当前完成结果，使用谨慎、事实准确的语言。',
        scope: 'macro 或 specific',
        status: 'completed 或 stage_completed',
        confidence: 'high 或 medium',
        before_refs: ['H001'],
        recent_refs: ['N001'],
        note: '细分范围不明确时说明范围限制。'
      }],
      recent_explicit_completions: [{
        title: '当前周期明确完成的事项',
        summary: '只依据当前周期记录描述。',
        confidence: 'high 或 medium',
        recent_refs: ['N002']
      }],
      needs_confirmation: [{
        alias: '记录中的新说法',
        canonical_name: '可能对应的规范名称',
        reason: '说明可能相关但无法确定的原因。',
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
