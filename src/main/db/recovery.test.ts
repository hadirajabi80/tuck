import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, rmSync, statSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTextClip } from './clipBuilder';
import { ClipRepository } from './clipRepository';
import { openDatabase } from './connection';
import { BACKUP_KEEP, backupDatabase, listBackups, openDatabaseSafely, quickCheck } from './recovery';

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'tuck-recovery-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A closed, checkpointed database file with `n` text clips (long texts so they span many pages). */
function makeDb(dir: string, n: number): string {
  const file = join(dir, 'tuck.db');
  const db = openDatabase(file);
  const clips = new ClipRepository(db);
  for (let i = 0; i < n; i++) clips.upsert(buildTextClip(`clip ${i} ${'x'.repeat(1500)}`), { dedupe: true });
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
  return file;
}

/** Overwrites the pages in the middle of the file with garbage (what a torn write / bad sync leaves behind). */
function damage(file: string): void {
  const size = statSync(file).size;
  const fd = openSync(file, 'r+');
  writeSync(fd, Buffer.alloc(4096 * 6, 0xa5), 0, 4096 * 6, Math.floor(size / 2 / 4096) * 4096);
  closeSync(fd);
}

const count = (file: string) => {
  const { db } = openDatabaseSafely(file, { backupsDir: join(file, '..', 'none'), imagesDir: join(file, '..', 'img') });
  const n = (db.prepare('SELECT count(*) AS n FROM clips').get() as { n: number }).n;
  db.close();
  return n;
};

describe('openDatabaseSafely', () => {
  it('opens a healthy database untouched', () => {
    const dir = tempDir();
    const file = makeDb(dir, 20);
    const { db, recovery } = openDatabaseSafely(file, { backupsDir: join(dir, 'backups'), imagesDir: join(dir, 'images') });
    expect(recovery).toBeNull();
    expect(quickCheck(db)).toBe('ok');
    db.close();
    expect(readdirSync(dir).some((n) => n.includes('damaged'))).toBe(false);
  });

  it('repairs a damaged database: keeps the damaged files, rescues readable clips, result passes its check', () => {
    const dir = tempDir();
    const file = makeDb(dir, 200);
    damage(file);
    const { db, recovery } = openDatabaseSafely(file, { backupsDir: join(dir, 'backups'), imagesDir: join(dir, 'images') });
    expect(recovery).not.toBeNull();
    expect(existsSync(recovery!.damagedFile)).toBe(true); // never deleted
    expect(recovery!.salvaged).toBeGreaterThan(0);
    expect(recovery!.salvaged).toBeLessThan(200);
    expect(quickCheck(db)).toBe('ok');
    const n = (db.prepare('SELECT count(*) AS n FROM clips').get() as { n: number }).n;
    expect(n).toBe(recovery!.salvaged);
    // full-text search was rebuilt for the rescued rows
    const hits = (db.prepare("SELECT count(*) AS n FROM clips_fts WHERE clips_fts MATCH '\"clip\"'").get() as { n: number }).n;
    expect(hits).toBe(n);
    db.close();
  });

  it('fills in lost clips from the newest backup', () => {
    const dir = tempDir();
    const backups = join(dir, 'backups');
    const file = makeDb(dir, 200);
    const live = openDatabase(file);
    expect(backupDatabase(live, backups, 'daily')).toBeTruthy();
    live.close();
    damage(file);
    const { db, recovery } = openDatabaseSafely(file, { backupsDir: backups, imagesDir: join(dir, 'images') });
    expect(recovery!.fromBackup).toBeGreaterThan(0);
    expect(recovery!.salvaged + recovery!.fromBackup).toBe(200);
    expect((db.prepare('SELECT count(*) AS n FROM clips').get() as { n: number }).n).toBe(200);
    db.close();
    expect(count(file)).toBe(200); // the repaired file opens cleanly next time
  });
});

describe('backupDatabase', () => {
  it('writes a self-contained copy and keeps only the newest few', () => {
    const dir = tempDir();
    const backups = join(dir, 'backups');
    const db = openDatabase(makeDb(dir, 5));
    for (let i = 0; i < BACKUP_KEEP + 2; i++) backupDatabase(db, backups, `test-${i}`);
    db.close();
    const files = listBackups(backups);
    expect(files.length).toBeLessThanOrEqual(BACKUP_KEEP);
    expect(files.length).toBeGreaterThan(0);
    expect(count(files[0]!)).toBe(5);
  });
});
