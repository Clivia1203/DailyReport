const REASONING_EFFORTS = Object.freeze(['auto', 'low', 'high', 'max']);

function normalizeReasoningEffort(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return REASONING_EFFORTS.includes(normalized) ? normalized : 'auto';
}

function resolveReasoningEffort(value, segmentCount) {
  const preference = normalizeReasoningEffort(value);
  if (preference !== 'auto') return preference;
  return Number(segmentCount) > 1 ? 'high' : 'low';
}

module.exports = {
  REASONING_EFFORTS,
  normalizeReasoningEffort,
  resolveReasoningEffort
};
