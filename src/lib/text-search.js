/* 日报本地搜索规则：不依赖网络或 AI，保证输入时即时响应。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DRTextSearch = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HAN_RE = /\p{Script=Han}/u;
  const HAN_ONLY_RE = /^[\p{Script=Han}]+$/u;
  const SEARCH_TOKEN_RE = /[\p{Script=Han}]+|[\p{L}\p{N}]+/gu;
  const NON_WORD_RE = /[^\p{L}\p{N}]+/gu;

  function normalizeSearchText(value) {
    return String(value ?? '')
      .normalize('NFKC')
      .toLocaleLowerCase()
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(NON_WORD_RE, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function compact(value) {
    return normalizeSearchText(value).replace(/\s+/g, '');
  }

  function searchTerms(query) {
    return normalizeSearchText(query).match(SEARCH_TOKEN_RE) || [];
  }

  function isSubsequence(haystack, needle) {
    let cursor = 0;
    for (const char of needle) {
      cursor = haystack.indexOf(char, cursor);
      if (cursor < 0) return false;
      cursor += char.length;
    }
    return true;
  }

  function editDistanceAtMostOne(left, right) {
    if (Math.abs(left.length - right.length) > 1) return false;
    let row = 0;
    let column = 0;
    let edits = 0;
    while (row < left.length && column < right.length) {
      if (left[row] === right[column]) {
        row += 1;
        column += 1;
        continue;
      }
      edits += 1;
      if (edits > 1) return false;
      if (left.length > right.length) row += 1;
      else if (left.length < right.length) column += 1;
      else { row += 1; column += 1; }
    }
    return edits + (left.length - row) + (right.length - column) <= 1;
  }

  function fuzzyLatinMatch(normalizedText, term) {
    if (term.length < 4 || HAN_RE.test(term)) return false;
    const words = normalizedText.match(SEARCH_TOKEN_RE) || [];
    return words.some(word => !HAN_RE.test(word) && editDistanceAtMostOne(word, term));
  }

  function matchesTerm(normalizedText, compactText, term) {
    const needle = compact(term);
    if (!needle) return true;
    if (compactText.includes(needle)) return true;
    if (HAN_ONLY_RE.test(needle)) return isSubsequence(compactText, needle);
    return fuzzyLatinMatch(normalizedText, needle);
  }

  function matchesSearch(text, query) {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return true;

    const normalizedText = normalizeSearchText(text);
    const compactText = normalizedText.replace(/\s+/g, '');
    const queryCompact = normalizedQuery.replace(/\s+/g, '');
    if (queryCompact && compactText.includes(queryCompact)) return true;

    return searchTerms(normalizedQuery).every(term => matchesTerm(normalizedText, compactText, term));
  }

  return { normalizeSearchText, searchTerms, matchesSearch };
});
