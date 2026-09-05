const crypto = require('crypto');

const DEFAULT_REPORT_TEMPLATES = {
  day: '请生成一份当天工作总结，按工作事项整理，说明完成内容、当前进展和需要关注的问题。语言简洁、事实准确，不要补充原始记录中没有的信息。',
  week: '请生成一份本周工作总结，优先按任务或工作主题归纳，包含本周完成、进行中事项、问题与风险、下一步计划。语言可以润色，但不得遗漏任何原始记录中的事实。',
  month: '请生成一份本月工作总结，按工作主题归纳主要进展、阶段性成果、问题与风险及下一阶段计划。保留具体任务细节，不要泛化或编造。',
  custom: '请按照用户指定的周期和模板生成工作总结。可以调整语言和结构，但必须保留所有原始记录中的事实、任务细节和时间线。'
};

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

function buildPrompt({ start, end, periodLabel, template, sources, segmentIndex = 0, segmentCount = 1 }) {
  const sourceText = sources.length
    ? sources.map(sourceLine).join('\n')
    : '（本周期没有原始记录）';
  const segmentInstruction = segmentCount > 1
    ? [
      `这是一个长周期报告的第 ${segmentIndex + 1}/${segmentCount} 个分段。`,
      '只整理本段提供的原始记录，不要猜测其他分段的内容。',
      '只输出本段 Markdown 正文，不要输出整个报告的总标题、解释或免责声明。'
    ]
    : ['这是一个完整周期报告，请输出完整的 Markdown 正文。'];
  return [
    `报告周期：${periodLabel || `${start} 至 ${end}`}`,
    '',
    '用户模板与要求：',
    template || DEFAULT_REPORT_TEMPLATES.custom,
    '',
    ...segmentInstruction,
    '',
    '完整性要求（必须遵守）：',
    `1. 原始记录按 [R001]、[R002] 的形式提供；本${segmentCount > 1 ? '段' : '周期'}每一个来源编号都必须至少在总结正文中被引用一次。`,
    '2. 可以合并相近内容、调整语序和润色表达，但不能删除任务细节、结果、问题、时间线或事实。',
    '3. 不能根据常识推测原始记录没有提到的完成结果、原因、计划或风险。',
    '4. 如果原始记录没有明确说明完成状态、进行中状态或下一步计划，请写“原始记录未明确”，不要自行补充结论。',
    '5. 每条来源在相关句末引用一次即可，不要为了重复覆盖而反复改写同一条记录。',
    '6. 只输出一个最终版本的 Markdown 正文，不要输出分析过程、候选稿、选择理由或自我检查过程。',
    '',
    '原始记录：',
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

function rawRecordsMarkdown(sources) {
  if (!sources.length) return '- 本周期没有原始记录。';
  let day = '';
  const lines = [];
  for (const source of sources) {
    if (source.date !== day) {
      day = source.date;
      lines.push(`### ${day}`);
    }
    lines.push(`- ${source.time}  ${source.text}`);
  }
  return lines.join('\n');
}

function appendRawRecords(content, sources) {
  const body = stripSourceRefs(content) || '本周期暂无 AI 总结正文。';
  return `${body}\n\n---\n\n## 原始记录明细\n\n${rawRecordsMarkdown(sources)}`;
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

module.exports = {
  DEFAULT_REPORT_TEMPLATES,
  localDateStr,
  localTimeStr,
  sourceBundle,
  splitSources,
  buildPrompt,
  coveredRefs,
  auditSourceRecords,
  stripSourceRefs,
  appendRawRecords,
  markdownToText,
  sourceHash,
  templateHash,
  reportId
};
