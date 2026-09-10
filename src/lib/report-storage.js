'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function hasOwn(value, key) {
  return !!value && Object.prototype.hasOwnProperty.call(value, key);
}

function createReportStorage({
  directory,
  fileSystem = fs,
  pathModule = path,
  idFactory = crypto.randomUUID
} = {}) {
  if (typeof directory !== 'function' && (typeof directory !== 'string' || !directory)) {
    throw new TypeError('报告存储必须提供目录');
  }

  const resolveDirectory = () => {
    const value = typeof directory === 'function' ? directory() : directory;
    if (!value) throw new Error('报告存储目录为空');
    return String(value);
  };

  function token() {
    try {
      const value = String(idFactory() || '');
      return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'temporary';
    } catch {
      return `temporary-${Date.now()}`;
    }
  }

  function idStem(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'report';
  }

  function safeFileName(value) {
    const text = String(value || '');
    const base = pathModule.basename(text);
    if (!text || !base || base !== text || base === '.' || base === '..') return '';
    return base;
  }

  function artifactFileName(report, kind, uniqueFile = false) {
    const field = kind === 'thinking' ? 'thinkingFile' : 'contentFile';
    if (!uniqueFile) {
      const existing = safeFileName(report?.[field]);
      if (existing) return existing;
    }
    const suffix = uniqueFile ? `-${token()}` : '';
    return kind === 'thinking'
      ? `${idStem(report?.id)}${suffix}.thinking.json`
      : `${idStem(report?.id)}${suffix}.md`;
  }

  function artifactPath(report, kind, uniqueFile = false) {
    return pathModule.join(
      resolveDirectory(),
      artifactFileName(report, kind, uniqueFile)
    );
  }

  function readContent(report) {
    if (!report) return '';
    const fileName = safeFileName(report.contentFile);
    if (fileName) {
      try {
        return fileSystem.readFileSync(pathModule.join(resolveDirectory(), fileName), 'utf8')
          .replace(/^\ufeff/, '');
      } catch { /* 外置文件不可读时回退旧版内嵌正文 */ }
    }
    return hasOwn(report, 'content') ? String(report.content ?? '') : '';
  }

  function readThinking(report) {
    if (!report) return null;
    const fileName = safeFileName(report.thinkingFile);
    if (fileName) {
      try {
        const value = JSON.parse(
          fileSystem.readFileSync(pathModule.join(resolveDirectory(), fileName), 'utf8')
            .replace(/^\ufeff/, '')
        );
        if (value !== null && value !== undefined) return value;
      } catch { /* 外置文件不可读时回退旧版内嵌过程 */ }
    }
    return hasOwn(report, 'thinking') ? (report.thinking ?? null) : null;
  }

  function cleanup(target) {
    try { fileSystem.unlinkSync(target); } catch { /* 文件已不存在 */ }
  }

  function replaceFile(temp, target) {
    try {
      fileSystem.renameSync(temp, target);
    } catch (error) {
      if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
      try {
        fileSystem.unlinkSync(target);
        fileSystem.renameSync(temp, target);
      } catch (replaceError) {
        cleanup(temp);
        throw replaceError;
      }
    }
  }

  function writeAtomic(target, content) {
    const directoryPath = resolveDirectory();
    const temp = `${target}.${token()}.tmp`;
    fileSystem.mkdirSync(directoryPath, { recursive: true });
    try {
      fileSystem.writeFileSync(temp, content, 'utf8');
      replaceFile(temp, target);
    } catch (error) {
      cleanup(temp);
      throw error;
    }
  }

  function persist(report, { uniqueFile = false } = {}) {
    if (!report || typeof report !== 'object' || !report.id) return false;
    const hasContent = hasOwn(report, 'content');
    const hasThinking = hasOwn(report, 'thinking');

    if (hasContent) {
      const fileName = artifactFileName(report, 'content', uniqueFile);
      writeAtomic(
        pathModule.join(resolveDirectory(), fileName),
        String(report.content ?? '')
      );
      report.contentFile = fileName;
      delete report.content;
    }

    if (hasThinking) {
      if (report.thinking === null || report.thinking === undefined) {
        const oldFile = safeFileName(report.thinkingFile);
        if (oldFile) cleanup(pathModule.join(resolveDirectory(), oldFile));
        delete report.thinkingFile;
        delete report.thinking;
      } else {
        const fileName = artifactFileName(report, 'thinking', uniqueFile);
        writeAtomic(
          pathModule.join(resolveDirectory(), fileName),
          JSON.stringify(report.thinking, null, 2)
        );
        report.thinkingFile = fileName;
        delete report.thinking;
      }
    }

    return hasContent || hasThinking;
  }

  function migrateReports(reports, options = {}) {
    const nextReports = (Array.isArray(reports) ? reports : []).map(report => (
      report && typeof report === 'object' ? { ...report } : report
    ));
    let migratedReports = 0;
    let migratedContent = 0;
    let migratedThinking = 0;

    for (const report of nextReports) {
      if (!report || typeof report !== 'object') continue;
      const hasContent = hasOwn(report, 'content');
      const hasThinking = hasOwn(report, 'thinking');
      if (!hasContent && !hasThinking) continue;
      persist(report, options);
      migratedReports += 1;
      if (hasContent) migratedContent += 1;
      if (hasThinking && report.thinkingFile) migratedThinking += 1;
    }

    return { reports: nextReports, migratedReports, migratedContent, migratedThinking };
  }

  function forClient(report) {
    if (!report) return null;
    const { contentFile, thinkingFile, content, thinking, ...metadata } = report;
    const next = { ...metadata, content: readContent(report) };
    const snapshot = readThinking(report);
    if (snapshot !== null && snapshot !== undefined) next.thinking = snapshot;
    return next;
  }

  function forBackup(report) {
    if (!report) return null;
    const { contentFile, thinkingFile, ...metadata } = report;
    const next = { ...metadata, content: readContent(report) };
    const snapshot = readThinking(report);
    if (snapshot !== null && snapshot !== undefined) next.thinking = snapshot;
    return next;
  }

  return {
    readContent,
    readThinking,
    persist,
    migrateReports,
    forClient,
    forBackup,
    contentPath: report => artifactPath(report, 'content'),
    thinkingPath: report => artifactPath(report, 'thinking')
  };
}

module.exports = { createReportStorage };
