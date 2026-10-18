// Schema migrations keyed by version in the `meta` table (DESIGN §C "DB schema").
import type { DatabaseSync } from 'node:sqlite';

const V1 = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS clips (
  id             TEXT PRIMARY KEY,
  kind           TEXT NOT NULL CHECK (kind IN ('text','link','color','code','image','files')),
  text           TEXT,
  html           TEXT,
  rtf            TEXT,
  files_json     TEXT,
  image_json     TEXT,
  preview        TEXT NOT NULL,
  hash           TEXT NOT NULL,
  byte_size      INTEGER NOT NULL DEFAULT 0,
  source_app     TEXT,
  pinned         INTEGER NOT NULL DEFAULT 0,
  pinned_at      INTEGER,
  copy_count     INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  last_pasted_at INTEGER,
  meta_json      TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_hash         ON clips(hash);
CREATE INDEX        IF NOT EXISTS idx_clips_updated      ON clips(updated_at DESC);
CREATE INDEX        IF NOT EXISTS idx_clips_kind_updated ON clips(kind, updated_at DESC);
CREATE INDEX        IF NOT EXISTS idx_clips_pinned       ON clips(pinned, pinned_at DESC);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clip_groups (
  clip_id  TEXT NOT NULL REFERENCES clips(id)  ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (clip_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_clip_groups_group ON clip_groups(group_id);

CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, keyword TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0, usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
  text, content='clips', content_rowid='rowid', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS clips_ai AFTER INSERT ON clips BEGIN
  INSERT INTO clips_fts(rowid, text) VALUES (new.rowid, coalesce(new.text, ''));
END;
CREATE TRIGGER IF NOT EXISTS clips_ad AFTER DELETE ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, text) VALUES ('delete', old.rowid, coalesce(old.text, ''));
END;
CREATE TRIGGER IF NOT EXISTS clips_au AFTER UPDATE OF text ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, text) VALUES ('delete', old.rowid, coalesce(old.text, ''));
  INSERT INTO clips_fts(rowid, text) VALUES (new.rowid, coalesce(new.text, ''));
END;
`;

const MIGRATIONS: Array<{ version: number; sql: string }> = [{ version: 1, sql: V1 }];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

export function currentVersion(db: DatabaseSync): number {
  const hasMeta = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='meta'").get();
  if (!hasMeta) return 0;
  const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as { value: string } | undefined;
  return row ? Number(row.value) || 0 : 0;
}

/** Applies pending migrations, each in its own transaction. Returns the resulting schema version. */
export function migrate(db: DatabaseSync): number {
  let version = currentVersion(db);
  for (const m of MIGRATIONS) {
    if (m.version <= version) continue;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)").run(String(m.version));
      db.exec('COMMIT');
      version = m.version;
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return version;
}
