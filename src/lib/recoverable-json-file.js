'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function resolvePath(value) {
  return typeof value === 'function' ? value() : value;
}

function createRecoverableJsonFile({
  file,
  backupFile = () => `${resolvePath(file)}.bak`,
  recoveryDirectory,
  normalize = value => value,
  validate = () => true,
  empty = null,
  fileSystem = fs,
  pathModule = path,
  idFactory = crypto.randomUUID,
  now = () => new Date(),
  onEvent = () => {}
} = {}) {
  if (typeof file !== 'function' && (typeof file !== 'string' || !file)) {
    throw new TypeError('可恢复 JSON 文件必须提供文件路径');
  }

  const resolveFile = () => {
    const value = resolvePath(file);
    if (!value) throw new Error('可恢复 JSON 文件路径为空');
    return String(value);
  };

  const resolveBackupFile = () => {
    const value = resolvePath(backupFile);
    return value ? String(value) : `${resolveFile()}.bak`;
  };

  const resolveEmpty = () => (typeof empty === 'function' ? empty() : empty);

  function emit(event) {
    try { onEvent(event); } catch { /* 观察者异常不能影响存储 */ }
  }

  function exists(target) {
    try { return fileSystem.existsSync(target); }
    catch { return false; }
  }

  function cleanup(target) {
    try { fileSystem.unlinkSync(target); } catch { /* 临时文件可能已经被重命名 */ }
  }

  function token() {
    try {
      const value = String(idFactory() || '');
      return value.replace(/[^a-zA-Z0-9_-]/g, '_') || 'temporary';
    } catch {
      return `temporary-${Date.now()}`;
    }
  }

  function timestamp() {
    let value;
    try { value = typeof now === 'function' ? now() : now; }
    catch { value = Date.now(); }
    const date = new Date(value);
    const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
    return safeDate.toISOString().replace(/\D/g, '').slice(0, 14);
  }

  function readValue(target) {
    const raw = fileSystem.readFileSync(target, 'utf8').replace(/^\ufeff/, '');
    const value = JSON.parse(raw);
    if (!validate(value)) {
      const error = new Error('JSON 文件结构无效');
      error.code = 'INVALID_JSON_DATA';
      throw error;
    }
    return normalize(value);
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

  function preserveBrokenFile(target) {
    if (!exists(target)) return '';
    const directory = recoveryDirectory
      ? resolvePath(recoveryDirectory)
      : pathModule.join(pathModule.dirname(target), 'backups');
    const preserved = pathModule.join(
      String(directory),
      `${pathModule.basename(target)}.corrupt-${timestamp()}-${token()}.json`
    );
    try {
      fileSystem.mkdirSync(directory, { recursive: true });
      fileSystem.copyFileSync(target, preserved);
      return preserved;
    } catch (error) {
      emit({ type: 'preserve-failed', file: target, error });
      return '';
    }
  }

  function restoreFromBackup(source, target) {
    const directory = pathModule.dirname(target);
    fileSystem.mkdirSync(directory, { recursive: true });
    const temp = `${target}.${token()}.recovery.tmp`;
    try {
      fileSystem.copyFileSync(source, temp);
      replaceFile(temp, target);
    } catch (error) {
      cleanup(temp);
      throw error;
    }
  }

  function read() {
    const target = resolveFile();
    const backup = resolveBackupFile();
    try {
      return readValue(target);
    } catch (primaryError) {
      const primaryExists = exists(target);
      const backupExists = exists(backup);
      if (!primaryExists && !backupExists) return resolveEmpty();

      const preservedFile = preserveBrokenFile(target);
      try {
        const recovered = readValue(backup);
        restoreFromBackup(backup, target);
        emit({
          type: 'recovered',
          file: target,
          backupFile: backup,
          preservedFile,
          error: primaryError
        });
        return recovered;
      } catch (recoveryError) {
        emit({
          type: 'unrecoverable',
          file: target,
          backupFile: backup,
          preservedFile,
          error: primaryError,
          recoveryError
        });
        return resolveEmpty();
      }
    }
  }

  function write(value) {
    const target = resolveFile();
    const backup = resolveBackupFile();
    const directory = pathModule.dirname(target);
    const backupDirectory = pathModule.dirname(backup);
    const temp = `${target}.${token()}.tmp`;

    fileSystem.mkdirSync(directory, { recursive: true });
    try {
      fileSystem.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
      if (exists(target)) {
        try {
          fileSystem.mkdirSync(backupDirectory, { recursive: true });
          fileSystem.copyFileSync(target, backup);
        } catch (error) {
          // 主文件仍可安全替换；备份失败会被记录，下一次写入继续尝试。
          emit({ type: 'backup-failed', file: target, backupFile: backup, error });
        }
      }
      replaceFile(temp, target);
      return true;
    } catch (error) {
      cleanup(temp);
      throw error;
    }
  }

  return { read, write };
}

module.exports = { createRecoverableJsonFile };
