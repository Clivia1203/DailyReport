function reportCacheKey({ start, end, periodType, sourceHashValue, templateHashValue, terminologyHashValue = '' }) {
  const key = [periodType, start, end, sourceHashValue, templateHashValue].join('|');
  return terminologyHashValue ? `${key}|${terminologyHashValue}` : key;
}

function samePeriod(report, params) {
  return !!report
    && report.periodType === params.periodType
    && report.start === params.start
    && report.end === params.end;
}

function legacySnapshotHashes(report) {
  const key = typeof report?.cacheKey === 'string' ? report.cacheKey : '';
  const parts = key.split('|');
  if (parts.length < 6) return null;
  return {
    sourceHashValue: parts[parts.length - 2],
    templateHashValue: parts[parts.length - 1]
  };
}

function snapshotHashes(report) {
  if (report?.sourceHash && report?.templateHash) {
    return {
      sourceHashValue: report.sourceHash,
      templateHashValue: report.templateHash,
      terminologyHashValue: typeof report.terminologyHash === 'string' ? report.terminologyHash : ''
    };
  }
  const legacy = legacySnapshotHashes(report);
  return legacy ? { ...legacy, terminologyHashValue: '' } : null;
}

function matchesSnapshot(report, params) {
  const hashes = snapshotHashes(report);
  const hasTerminologyHash = Object.prototype.hasOwnProperty.call(params || {}, 'terminologyHashValue');
  return samePeriod(report, params)
    && !!hashes
    && hashes.sourceHashValue === params.sourceHashValue
    && hashes.templateHashValue === params.templateHashValue
    && (!hasTerminologyHash || hashes.terminologyHashValue === (params.terminologyHashValue || ''));
}

function reportTimestamp(report) {
  return Number(report?.updatedAt || report?.createdAt) || 0;
}

function newest(reports) {
  return reports
    .map((report, index) => ({ report, index }))
    .sort((a, b) => reportTimestamp(a.report) - reportTimestamp(b.report) || a.index - b.index)
    .at(-1)?.report || null;
}

function findCachedReport(reports, params) {
  const list = Array.isArray(reports) ? reports : [];
  return newest(list.filter(report => matchesSnapshot(report, params)));
}

function findLatestReport(reports, params) {
  const list = Array.isArray(reports) ? reports : [];
  return newest(list.filter(report => samePeriod(report, params)));
}

function reportCacheStatus(report, params) {
  if (!report || !samePeriod(report, params)) return 'missing';
  const hashes = snapshotHashes(report);
  if (!hashes) return 'unknown';
  const sourceChanged = hashes.sourceHashValue !== params.sourceHashValue;
  const templateChanged = hashes.templateHashValue !== params.templateHashValue;
  const terminologyChanged = Object.prototype.hasOwnProperty.call(params || {}, 'terminologyHashValue')
    && hashes.terminologyHashValue !== (params.terminologyHashValue || '');
  if (!sourceChanged && !templateChanged && !terminologyChanged) return 'fresh';
  if (sourceChanged && templateChanged && terminologyChanged) return 'source-template-and-terminology-changed';
  if (sourceChanged && templateChanged) return 'source-and-template-changed';
  if (sourceChanged && terminologyChanged) return 'source-and-terminology-changed';
  if (templateChanged && terminologyChanged) return 'template-and-terminology-changed';
  if (sourceChanged) return 'source-changed';
  if (terminologyChanged) return 'terminology-changed';
  return 'template-changed';
}

module.exports = {
  reportCacheKey,
  findCachedReport,
  findLatestReport,
  reportCacheStatus,
  snapshotHashes
};
