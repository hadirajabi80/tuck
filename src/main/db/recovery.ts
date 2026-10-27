// Keeps the history database usable when the file on disk gets damaged.
//   openDatabaseSafely(): open + migrate + quick_check. On failure the damaged files are moved aside
//     (tuck.db.damaged-<stamp>[-wal|-shm], never deleted), every clip that can still be read is copied into a
//     fresh database, and clips missing from it are filled in from the newest automatic backup.
//   backupDatabase(): VACUUM INTO userData/backups/tuck-<stamp>-<reason>.db (a clean, self-contained copy),
//     keeping the newest BACKUP_KEEP files. Taken once a day and before imports.
import { existsSync, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { logger } from '../log';
import { openDatabase } from './connection';

const log = logger('db-recovery');

export const BACKUP_KEEP = 5;
const BACKUP_RE = /^tuck-\d{8}-\d{6}(?:-[a-z0-9-]+)?\.db$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface RecoveryReport {
  /** Where the damaged files were moved (the main file; -wal/-shm sit next to it). */
  damagedFile: string;
  /** Clips read back from the damaged file. */
  salvaged: number;
  /** Clips the damaged file still listed but that could not be read. */
  unreadable: number;
  /** Clips added from the newest backup that the damaged file no longer had. */
  fromBackup: number;
  backupFile: string | null;
  error: string;
}

const stamp = (d = new Date()): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** 'ok', or the first problem SQLite's quick_check reports. */
export function quickCheck(conn: DatabaseSync): string {
  try {
    const row = conn.prepare('PRAGMA quick_check(1)').get() as { quick_check?: string } | undefined;
    if (row?.quick_check !== 'ok') return row?.quick_check ?? 'quick_check returned nothing';
    // quick_check skips index/table consistency; a full read of the clips table catches broken leaf pages.
    conn.prepare('SELECT count(*) AS n FROM clips NOT INDEXED').get();
    return 'ok';
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/** Opens the history database, repairing it first when it is damaged. */
export function openDatabaseSafely(
  file: string,
  opts: { backupsDir: string; imagesDir: string },
): { db: DatabaseSync; recovery: RecoveryReport | null } {
  let problem: string;
  try {
    const db = openDatabase(file);
    problem = quickCheck(db);
    if (problem === 'ok') return { db, recovery: null };
    try {
      db.close();
    } catch {
      /* closing a damaged db can fail too */
    }
  } catch (err) {
    problem = err instanceof Error ? err.message : String(err);
  }
  log.error(`database damaged (${problem}) — repairing`);
  const damagedFile = quarantine(file);
  const db = openDatabase(file); // fresh file, current schema
  // Report what actually landed in the new file (per-insert counts undercount: reads that go through the
  // damaged file's WAL can succeed after a first attempt failed).
  const listed = salvageInto(damagedFile, db).listed;
  const salvaged = clipCount(db);
  const unreadable = Math.max(0, listed - salvaged);
  const backupFile = newestBackup(opts.backupsDir);
  if (backupFile) mergeFromBackup(db, backupFile, opts.imagesDir);
  const fromBackup = clipCount(db) - salvaged;
  const report: RecoveryReport = { damagedFile, salvaged, unreadable, fromBackup, backupFile, error: problem };
  log.warn(
    `repaired: ${salvaged} clip(s) rescued, ${unreadable} unreadable, ${fromBackup} restored from ` +
      `${backupFile ? basename(backupFile) : 'no backup'}; damaged files kept as ${basename(damagedFile)}`,
  );
  return { db, recovery: report };
}

/** Moves tuck.db and its -wal/-shm aside under one new name so SQLite can still read them as a set. */
function quarantine(file: string): string {
  const target = `${file}.damaged-${stamp()}`;
  for (const suffix of ['', '-wal', '-shm']) {
    const from = file + suffix;
    if (existsSync(from)) renameSync(from, target + suffix);
  }
  return target;
}

const clipCount = (db: DatabaseSync): number => Number((db.prepare('SELECT count(*) AS n FROM clips').get() as { n: number }).n);

/** Copies every readable row of the damaged database into `dst` (same columns only). `listed` = rows its indexes knew. */
export function salvageInto(damagedFile: string, dst: DatabaseSync): { listed: number; salvaged: number; unreadable: number } {
  let src: DatabaseSync;
  try {
    src = new DatabaseSync(damagedFile, { readOnly: true });
  } catch (err) {
    log.warn('damaged file cannot be opened at all', err);
    return { listed: 0, salvaged: 0, unreadable: 0 };
  }
  try {
    const rowids = clipRowids(src);
    const dstCols = new Set(columnsOf(dst, 'clips'));
    let salvaged = 0;
    let unreadable = 0;
    const one = src.prepare('SELECT * FROM clips WHERE rowid = ?');
    dst.exec('BEGIN');
    try {
      for (const rowid of rowids) {
        let row: Record<string, unknown> | undefined;
        try {
          row = one.get(rowid) as Record<string, unknown> | undefined;
        } catch {
          unreadable++;
          continue;
        }
        if (!row || typeof row['id'] !== 'string') {
          unreadable++;
          continue;
        }
        if (insertRow(dst, 'clips', row, dstCols)) salvaged++;
      }
      for (const table of ['groups', 'snippets', 'clip_groups']) copyTable(src, dst, table);
      dst.exec('COMMIT');
    } catch (err) {
      dst.exec('ROLLBACK');
      throw err;
    }
    return { listed: rowids.length, salvaged, unreadable };
  } finally {
    src.close();
  }
}

/** Rowids from every index that still reads, plus a table walk that stops at the first broken page. */
function clipRowids(src: DatabaseSync): number[] {
  const ids = new Set<number>();
  const indexes = safeAll(src, "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'clips' AND sql IS NOT NULL");
  for (const ix of indexes) {
    for (const r of safeAll(src, `SELECT rowid AS r FROM clips INDEXED BY "${String(ix['name'])}"`)) ids.add(Number(r['r']));
  }
  try {
    for (const r of src.prepare('SELECT rowid AS r FROM clips').iterate()) ids.add(Number((r as { r: number }).r));
  } catch {
    /* broken page: keep what we have */
  }
  return [...ids].sort((a, b) => a - b);
}

/** Adds clips from a backup that `db` doesn't have (by content hash); skips image clips whose file is gone. */
export function mergeFromBackup(db: DatabaseSync, backupFile: string, imagesDir: string): number {
  let src: DatabaseSync;
  try {
    src = new DatabaseSync(backupFile, { readOnly: true });
  } catch (err) {
    log.warn(`backup ${basename(backupFile)} cannot be opened`, err);
    return 0;
  }
  try {
    const dstCols = new Set(columnsOf(db, 'clips'));
    const have = db.prepare('SELECT 1 FROM clips WHERE hash = ? OR id = ?');
    let added = 0;
    db.exec('BEGIN');
    try {
      for (const table of ['groups', 'snippets']) copyTable(src, db, table);
      for (const row of safeAll(src, 'SELECT * FROM clips')) {
        if (have.get(row['hash'] as string, row['id'] as string)) continue;
        if (row['kind'] === 'image' && !existsSync(join(imagesDir, `${String(row['id'])}.png`))) continue;
        if (insertRow(db, 'clips', row, dstCols)) added++;
      }
      copyTable(src, db, 'clip_groups');
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    return added;
  } finally {
    src.close();
  }
}

/** Clean copy of the open database into `dir`; prunes old backups. Returns the new file or null. */
export function backupDatabase(db: DatabaseSync, dir: string, reason: string): string | null {
  try {
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `tuck-${stamp()}-${reason.replace(/[^a-z0-9-]/gi, '').toLowerCase() || 'manual'}.db`);
    if (quickCheck(db) !== 'ok') {
      log.warn(`backup (${reason}) skipped: database fails its check`);
      return null;
    }
    db.prepare('VACUUM INTO ?').run(file);
    pruneBackups(dir);
    log.info(`backup (${reason}) → ${basename(file)}`);
    return file;
  } catch (err) {
    log.warn(`backup (${reason}) failed`, err);
    return null;
  }
}

/** Daily backup: only when the newest one is older than a day. */
export function backupIfDue(db: DatabaseSync, dir: string): string | null {
  const newest = newestBackup(dir);
  if (newest && Date.now() - statSync(newest).mtimeMs < DAY_MS) return null;
  return backupDatabase(db, dir, 'daily');
}

export function listBackups(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => BACKUP_RE.test(n))
      .map((n) => join(dir, n))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  } catch {
    return [];
  }
}

function newestBackup(dir: string): string | null {
  return listBackups(dir)[0] ?? null;
}

function pruneBackups(dir: string): void {
  for (const old of listBackups(dir).slice(BACKUP_KEEP)) {
    try {
      unlinkSync(old);
    } catch {
      /* in use / gone */
    }
  }
}

function safeAll(db: DatabaseSync, sql: string): Record<string, unknown>[] {
  try {
    return db.prepare(sql).all() as Record<string, unknown>[];
  } catch {
    return [];
  }
}

function columnsOf(db: DatabaseSync, table: string): string[] {
  return safeAll(db, `PRAGMA table_info("${table}")`).map((c) => String(c['name']));
}

function insertRow(db: DatabaseSync, table: string, row: Record<string, unknown>, cols: Set<string>): boolean {
  const keys = Object.keys(row).filter((k) => cols.has(k));
  if (!keys.length) return false;
  try {
    const res = db
      .prepare(`INSERT OR IGNORE INTO "${table}" (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
      .run(...(keys.map((k) => row[k]) as never[]));
    return res.changes > 0;
  } catch {
    return false;
  }
}

function copyTable(src: DatabaseSync, dst: DatabaseSync, table: string): void {
  const cols = new Set(columnsOf(dst, table));
  for (const row of safeAll(src, `SELECT * FROM "${table}"`)) insertRow(dst, table, row, cols);
}
