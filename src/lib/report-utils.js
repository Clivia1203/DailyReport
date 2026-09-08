const crypto = require('crypto');
const { catalogFor } = require('./prompt-catalog');

const DEFAULT_REPORT_TEMPLATES = require('../prompts/zh-CN.json').reportTemplates;

function pad(n, width = 2) { return String(n).padStart(width, '0'); }

function localDateStr(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function localTimeStr(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sourceRef(index) { return `R${pad(index + 1, 3)}`; }

function sourceBundle(entries) {
  return entries
    .slice()
    .sort((a, b) => a.ts - b.ts || (a.createdAt || 0) - (b.createdAt || 0))
    .map((entry, index) => ({
      ref: sourceRef(index),
      id: entry.id,
      date: localDateStr(entry.ts),
      time: localTimeStr(entry.ts),
      text: String(entry.text || '')
    }));
}

function sourceLine(source) {
  return `[${source.ref}] ${source.date} ${source.time}  ${source.text}`;
}

/**
 * 把过长周期拆成多个不可分割的记录组。
 * 记录永远不会在组之间被拆开，调用方可以对每组单独生成并最终合并。
 */
function splitSources(sources, { maxSources = 40, maxChars = 20000 } = {}) {
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return [[]];

  const chunks = [];
  let chunk = [];
  let chars = 0;
  for (const source of list) {
    const lineLength = sourceLine(source).length + 1;
    const wouldOverflow = chunk.length > 0 && (
      chunk.length >= maxSources || chars + lineLength > maxChars
    );
    if (wouldOverflow) {
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

function reportPromptRules(locale = 'zh-CN') {
  return catalogFor(locale).reportPromptRules || catalogFor('zh-CN').reportPromptRules;
}

function terminologyPrompt(terminology, locale = 'zh-CN') {
  const rules = reportPromptRules(locale);
  const terms = Array.isArray(terminology) ? terminology : [];
  if (!terms.length) return rules.terminologyEmpty;
  return terms.map((term, index) => {
    const canonical = String(term?.canonicalName || term?.canonical_name || '').trim();
    if (!canonical) return '';
    const aliases = Array.isArray(term.aliases) && term.aliases.length ? term.aliases.join('、') : rules.noAliases;
    const scope = term.scope ? `${rules.scope}${term.scope}` : '';
    const note = term.note ? `${rules.note}${term.note}` : '';
    return `${index + 1}. ${rules.canonical}${canonical}${rules.aliases}${aliases}${scope}${note}`;
  }).filter(Boolean).join('\n');
}

function buildPrompt({ start, end, periodLabel, template, sources, terminology = [], segmentIndex = 0, segmentCount = 1, locale = 'zh-CN' }) {
  const rules = reportPromptRules(locale);
  const sourceList = Array.isArray(sources) ? sources : [];
  const sourceText = sourceList.length
    ? sourceList.map(sourceLine).join('\n')
    : rules.noSources;
  const segmentInstruction = segmentCount > 1
    ? [
      fillPrompt(rules.longSegment, { index: segmentIndex + 1, total: segmentCount }),
      rules.segmentOnly,
      rules.segmentOutput
    ] : [rules.completePeriod];
  const sourceScope = segmentCount > 1 ? rules.segmentScope : rules.periodScope;
  return [
    fillPrompt(rules.period, { value: periodLabel || `${start} 至 ${end}` }),
    '',
    rules.template,
    template || catalogFor(locale).reportTemplates?.custom || DEFAULT_REPORT_TEMPLATES.custom,
    '',
    rules.terminology,
    terminologyPrompt(terminology, locale),
    rules.macro,
    '',
    ...segmentInstruction,
    '',
    rules.completeness,
    fillPrompt(rules.rule1, { scope: sourceScope }),
    rules.rule2,
    rules.rule3,
    rules.rule4,
    rules.rule5,
    rules.rule6,
    '',
    rules.sources,
    sourceText
  ].join('\n');
}

function coveredRefs(content, sources) {
  const text = String(content || '');
  return sources.filter(s => new RegExp(`(?:\\[|【)${s.ref}(?:\\]|】)`).test(text));
}

/**
 * 对每条来源做可解释的完整性检查：AI 正文是否引用，以及原始明细是否原样保留。
 * 语义润色无法用字符串比较准确判断，因此这里只报告确定的事实，不伪造“语义 100% 一致”。
 */
function auditSourceRecords(aiContent, fullContent, sources) {
  const citedRefs = new Set(coveredRefs(aiContent, sources).map(source => source.ref));
  const fullText = String(fullContent || '');
  return sources.map(source => ({
    ref: source.ref,
    cited: citedRefs.has(source.ref),
    rawPreserved: fullText.includes(`- ${source.time}  ${source.text}`)
  }));
}

function stripSourceRefs(content) {
  return String(content || '')
    .replace(/\s*(?:\[|【)R\d{3}(?:\]|】)/g, '')
    .replace(/^\s*```(?:markdown)?\s*$/gim, '')
    .replace(/^\s*```\s*$/gim, '')
    .trim();
}

function rawRecordsMarkdown(sources, locale = 'zh-CN') {
  const rules = reportPromptRules(locale);
  const list = Array.isArray(sources) ? sources : [];
  if (!list.length) return `- ${rules.rawEmpty}`;
  let day = '';
  const lines = [];
  for (const source of list) {
    if (source.date !== day) {
      day = source.date;
      lines.push(`### ${day}`);
    }
    lines.push(`- ${source.time}  ${source.text}`);
  }
  return lines.join('\n');
}

function appendRawRecords(content, sources, { locale = 'zh-CN' } = {}) {
  const rules = reportPromptRules(locale);
  const body = stripSourceRefs(content) || rules.emptyBody;
  return `${body}\n\n---\n\n## ${rules.rawHeading}\n\n${rawRecordsMarkdown(sources, locale)}`;
}

function markdownToText(markdown) {
  return String(markdown || '')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ')
    .replace(/^[ \t]*\d+\.[ \t]+/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^[ \t]*---[ \t]*$/gm, '────────────────')
    .trim();
}

function hash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function sourceHash(sources) {
  return hash(sources.map(s => `${s.id}|${s.date}|${s.time}|${s.text}`).join('\n'));
}

function templateHash(template) { return hash(template || ''); }

function reportId() { return crypto.randomUUID(); }

function reportInputStatus(sources, locale = 'zh-CN') {
  const count = Array.isArray(sources) ? sources.length : 0;
  return {
    ok: count > 0,
    count,
    error: count > 0 ? '' : reportPromptRules(locale).noSourcesError
  };
}

module.exports = {
  DEFAULT_REPORT_TEMPLATES,
  reportPromptRules,
  localDateStr,
  localTimeStr,
  sourceBundle,
  splitSources,
  terminologyPrompt,
  buildPrompt,
  coveredRefs,
  auditSourceRecords,
  stripSourceRefs,
  appendRawRecords,
  markdownToText,
  sourceHash,
  templateHash,
  reportId,
  reportInputStatus
};
