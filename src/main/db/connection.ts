// SQLite connection (node:sqlite DatabaseSync, see DESIGN §0) + a tiny transaction helper.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { logger } from '../log';
import { migrate } from './migrations';

const log = logger('db');

export type Db = DatabaseSync;

let db: DatabaseSync | null = null;

export function openDatabase(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const conn = new DatabaseSync(file);
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 2000;');
  const version = migrate(conn);
  log.info(`opened ${file} (schema v${version})`);
  return conn;
}

export function initDb(file: string): DatabaseSync {
  db = openDatabase(file);
  return db;
}

/** Makes an already-open connection the app database (see recovery.openDatabaseSafely). */
export function adoptDb(conn: DatabaseSync): DatabaseSync {
  db = conn;
  return db;
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('database not open');
  return db;
}

export function closeDb(): void {
  if (!db) return;
  try {
    db.exec('PRAGMA optimize;');
    db.close();
  } catch (err) {
    log.warn('close failed', err);
  }
  db = null;
}

/** Runs fn inside BEGIN/COMMIT (nested calls join the outer transaction). */
export function transaction<T>(conn: DatabaseSync, fn: () => T): T {
  if (conn.isTransaction) return fn();
  conn.exec('BEGIN');
  try {
    const out = fn();
    conn.exec('COMMIT');
    return out;
  } catch (err) {
    try {
      conn.exec('ROLLBACK');
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}
