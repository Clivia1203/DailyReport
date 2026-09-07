const {
  sourceBundle,
  splitSources
} = require('./report-utils');
const {
  normalizeTerminology
} = require('./terminology');

const MAX_DISCOVERY_SOURCES = 60;
const MAX_DISCOVERY_CHARS = 18000;
const MAX_DISCOVERY_OUTPUT_TOKENS = 4096;
const MAX_DISCOVERY_CANDIDATES = 240;

const DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT = [
  '请从日报原文中识别“可能指向同一件事情”的不同叫法，并建立可供后续报告使用的术语对照。',
  '规范输出名称应当是记录中有证据支持、稳定且简洁的名称；常用说法必须保留用户在日报里实际使用过的原话、简称、口语、缩写、错写或新造词。',
  '只有在结合完整记录、产品上下文和任务动作后能够合理判断为同一事项时才合并，不能只因为字面相似就合并。',
  '同一个产品可能存在不同功率段、版本或子任务；如果细分信息没有被稳定、明确地记录，使用产品族或更宏观的规范名称，不要猜测具体功率段。',
  '不要总结项目进度，不要补充日报之外的背景，不要把仅仅相关但不是同一事项的词语放进同一组。',
  '如果没有足够证据形成可靠对照，可以返回空数组。'
].join('\n');

function discoverySystemPrompt() {
  return '你是日报术语归并助手。你只能依据输入的日报记录建立术语对照，不得编造产品、项目或功率段信息。最终响应必须是合法 JSON，不要输出 Markdown 围栏、解释或思考过程。';
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

function discoveryFormat() {
  return JSON.stringify({
    terms: [{
      canonical_name: '记录中有证据支持的规范名称',
      aliases: ['日报里实际出现过的叫法1', '日报里实际出现过的叫法2'],
      scope: '只有记录明确支持时填写适用范围，否则为空字符串',
      note: '必要时说明为什么细分信息应保留在宏观层级'
    }]
  }, null, 2);
}

function buildDiscoveryPrompt(sources, customPrompt = DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT) {
  const list = Array.isArray(sources) ? sources : [];
  const sourceText = list.length
    ? list.map(cleanSourceText).join('\n')
    : '（没有可用日报记录）';
  return [
    '任务规则：',
    String(customPrompt || DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT).trim(),
    '',
    '本批日报记录（必须逐条阅读；每条只作为事实证据，不要遗漏记录中出现的候选叫法）：',
    sourceText,
    '',
    '请只返回合法 JSON，格式如下：',
    discoveryFormat(),
    '',
    '约束：',
    '1. aliases 只能填写输入记录中实际出现过的说法，不要凭空创造别名。',
    '2. 一个术语至少要有规范名称；没有可靠别名时可以暂不输出。',
    '3. 细分范围不明确时不要强行拆分或指定功率段。'
  ].join('\n');
}

function formatTerminologyList(items) {
  const terms = normalizeTerminology(items);
  if (!terms.length) return '（暂无已有术语）';
  return terms.map((term, index) => {
    const aliases = term.aliases.length ? term.aliases.join('、') : '无';
    const scope = term.scope ? `；范围：${term.scope}` : '';
    const note = term.note ? `；说明：${term.note}` : '';
    return `${index + 1}. 规范名称：${term.canonicalName}；常用说法：${aliases}${scope}${note}`;
  }).join('\n');
}

function buildConsolidationPrompt(candidates, existing = [], customPrompt = DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT) {
  const list = normalizeTerminology(candidates).slice(0, MAX_DISCOVERY_CANDIDATES);
  return [
    '请把多个批次识别出的候选术语归并为一份最终词典。',
    '',
    '归并规则：',
    String(customPrompt || DEFAULT_TERMINOLOGY_DISCOVERY_PROMPT).trim(),
    '如果不同候选可能是同一事项但证据不足，保留较宏观的规范名称，或不要合并；不要输出无法从候选中得到依据的新名称。',
    '',
    '用户已经存在的词典（必须保留其内容；新识别结果只能补充，不得删除）：',
    formatTerminologyList(existing),
    '',
    '本次各批次候选：',
    formatTerminologyList(list),
    '',
    '请只返回合法 JSON：',
    discoveryFormat(),
    '',
    'aliases 只能来自用户词典或候选中的实际说法；不要输出解释。'
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

function parseTerminologyResponse(value) {
  const text = stripJsonFence(value);
  if (!text) return null;
  let emptyResult = null;
  // 优先尝试后出现的完整片段：模型常会先输出一个空示例或中间草稿，最终词典通常在后面。
  for (const candidate of jsonCandidates(text).reverse()) {
    try {
      const parsed = JSON.parse(candidate);
      const items = Array.isArray(parsed) ? parsed : parsed?.terms;
      if (!Array.isArray(items)) continue;
      const result = normalizeTerminology(items.map(item => ({
        id: item?.id,
        canonicalName: item?.canonicalName || item?.canonical_name || item?.name,
        aliases: Array.isArray(item?.aliases)
          ? item.aliases
          : String(item?.alias || item?.common_names || item?.commonNames || '')
            .split(/[\n,，、;；]+/)
            .map(alias => alias.trim())
            .filter(Boolean),
        scope: item?.scope,
        note: item?.note
      })));
      if (result.length) return result;
      emptyResult = result;
    } catch { /* 尝试下一个完整 JSON 片段 */ }
  }
  return emptyResult;
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
  mergeTerminologyResults,
  normalizeDiscoveryState
};
