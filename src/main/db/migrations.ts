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

/**
 * v2 — user-defined pin order. `pin_order` (REAL, ascending = top first) is set for pinned clips and NULL
 * otherwise. NULL pins (e.g. written mid-import) sort first, i.e. on top. Existing pins keep their v1 order
 * (pinned_at DESC). Idempotent: the column is added only when missing and only unordered pins are backfilled.
 */
function v2(db: DatabaseSync): void {
  const cols = db.prepare('PRAGMA table_info(clips)').all() as unknown as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'pin_order')) db.exec('ALTER TABLE clips ADD COLUMN pin_order REAL');
  db.exec('CREATE INDEX IF NOT EXISTS idx_clips_pin_order ON clips(pinned, pin_order)');
  db.exec('UPDATE clips SET pin_order = NULL WHERE pinned = 0 AND pin_order IS NOT NULL');
  const pinned = db
    .prepare('SELECT id FROM clips WHERE pinned = 1 AND pin_order IS NULL ORDER BY pinned_at DESC, updated_at DESC, id')
    .all() as unknown as Array<{ id: string }>;
  if (!pinned.length) return;
  const top = (db.prepare('SELECT min(pin_order) AS m FROM clips WHERE pinned = 1').get() as { m: number | null }).m;
  const base = top === null ? 0 : top - pinned.length;
  const stmt = db.prepare('UPDATE clips SET pin_order = ? WHERE id = ?');
  pinned.forEach((r, i) => stmt.run(base + i, r.id));
}

interface Migration {
  version: number;
  /** SQL script or a function (for steps SQLite can't express idempotently, e.g. ADD COLUMN). */
  up: string | ((db: DatabaseSync) => void);
}

const MIGRATIONS: Migration[] = [
  { version: 1, up: V1 },
  { version: 2, up: v2 },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1]!.version;

/** The original v1 schema (exported so tests can build a v1 database and upgrade it). */
export const SCHEMA_V1_SQL = V1;

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
      if (typeof m.up === 'string') db.exec(m.up);
      else m.up(db);
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
