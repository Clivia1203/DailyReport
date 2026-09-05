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

function buildPrompt({ start, end, periodLabel, template, sources }) {
  const sourceText = sources.length
    ? sources.map(s => `[${s.ref}] ${s.date} ${s.time}  ${s.text}`).join('\n')
    : '（本周期没有原始记录）';
  return [
    `报告周期：${periodLabel || `${start} 至 ${end}`}`,
    '',
    '用户模板与要求：',
    template || DEFAULT_REPORT_TEMPLATES.custom,
    '',
    '完整性要求（必须遵守）：',
    '1. 原始记录按 [R001]、[R002] 的形式提供；每一个来源编号都必须至少在总结正文中被引用一次。',
    '2. 可以合并相近内容、调整语序和润色表达，但不能删除任务细节、结果、问题、时间线或事实。',
    '3. 不能根据常识推测原始记录没有提到的完成结果、原因、计划或风险。',
    '4. 输出 Markdown 正文，不要输出解释、免责声明或“作为 AI”的话。',
    '',
    '原始记录：',
    sourceText
  ].join('\n');
}

function coveredRefs(content, sources) {
  const text = String(content || '');
  return sources.filter(s => new RegExp(`(?:\\[|【)${s.ref}(?:\\]|】)`).test(text));
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
  buildPrompt,
  coveredRefs,
  stripSourceRefs,
  appendRawRecords,
  markdownToText,
  sourceHash,
  templateHash,
  reportId
};
