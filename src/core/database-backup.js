import fs from 'node:fs';
import path from 'node:path';

/**
 * File-level SQLite backup helpers for release/recovery operations.
 * The database remains owned by CommunityDatabase; these helpers only create
 * or restore a verified file copy and never expose database credentials.
 */
export function backupDatabase(database, destination) {
  if (!database?.db || typeof database.db.exec !== 'function') throw new TypeError('Eine geöffnete CommunityDatabase ist erforderlich.');
  const target = path.resolve(destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  database.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.copyFileSync(database.file, temp);
    fs.renameSync(temp, target);
  } finally {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch {}
  }
  return { file: target, bytes: fs.statSync(target).size };
}

export function restoreDatabase(source, destination, { overwrite = false } = {}) {
  const input = path.resolve(source);
  const target = path.resolve(destination);
  if (!fs.existsSync(input)) throw new Error('Backup-Datei wurde nicht gefunden.');
  if (fs.existsSync(target) && !overwrite) throw new Error('Zieldatei existiert bereits. overwrite=true erforderlich.');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.restore-${process.pid}-${Date.now()}`;
  try {
    fs.copyFileSync(input, temp);
    if (overwrite) fs.rmSync(target, { force: true });
    fs.renameSync(temp, target);
  } finally {
    try { if (fs.existsSync(temp)) fs.rmSync(temp, { force: true }); } catch {}
  }
  return { file: target, bytes: fs.statSync(target).size };
}
