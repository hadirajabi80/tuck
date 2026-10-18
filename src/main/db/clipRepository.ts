// Clip persistence: insert/dedupe, reads, edits, pins, groups, deletes (with snapshots for undo), retention.
// Pure DB code (node:sqlite only) — image files are handled by the caller through the ImageHooks.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Clip, ClipImageMeta, ClipKind, ClipMeta, ClipSummary } from '../../shared/types';
import { buildTextClip, type NewClipInput } from './clipBuilder';
import { transaction } from './connection';

export interface ClipRow {
  rowid?: number;
  id: string;
  kind: ClipKind;
  text: string | null;
  html: string | null;
  rtf: string | null;
  files_json: string | null;
  image_json: string | null;
  preview: string;
  hash: string;
  byte_size: number;
  source_app: string | null;
  pinned: number;
  pinned_at: number | null;
  copy_count: number;
  created_at: number;
  updated_at: number;
  last_pasted_at: number | null;
  meta_json: string;
}

interface SummaryRow {
  id: string;
  kind: ClipKind;
  preview: string;
  has_html: number;
  has_rtf: number;
  image_json: string | null;
  files_json: string | null;
  byte_size: number;
  source_app: string | null;
  pinned: number;
  pinned_at: number | null;
  copy_count: number;
  created_at: number;
  updated_at: number;
  last_pasted_at: number | null;
  meta_json: string;
}

/** A deleted clip kept in memory for undo. */
export interface ClipSnapshot {
  row: ClipRow;
  groupIds: string[];
}

export interface InsertOptions {
  id?: string;
  createdAt?: number;
  updatedAt?: number;
  pinned?: boolean;
  pinnedAt?: number | null;
  lastPastedAt?: number | null;
  copyCount?: number;
  /** When false the hash gets a unique suffix so identical content is stored again. */
  dedupe?: boolean;
  /** Called for new image clips (input.png set) with the new id; must store the PNG and return its meta. */
  storeImage?: (id: string, png: Buffer) => ClipImageMeta;
}

export const SUMMARY_COLS =
  'c.id, c.kind, c.preview, (c.html IS NOT NULL) AS has_html, (c.rtf IS NOT NULL) AS has_rtf, c.image_json, c.files_json, ' +
  'c.byte_size, c.source_app, c.pinned, c.pinned_at, c.copy_count, c.created_at, c.updated_at, c.last_pasted_at, c.meta_json';

function parseJson<T>(s: string | null, fb: T): T {
  if (!s) return fb;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fb;
  }
}

export function mapSummary(r: SummaryRow, groupIds: string[] = []): ClipSummary {
  return {
    id: r.id,
    kind: r.kind,
    preview: r.preview,
    hasHtml: !!r.has_html,
    hasRtf: !!r.has_rtf,
    image: parseJson<ClipImageMeta | null>(r.image_json, null),
    files: parseJson<string[] | null>(r.files_json, null),
    byteSize: r.byte_size,
    sourceApp: r.source_app,
    pinned: !!r.pinned,
    pinnedAt: r.pinned_at,
    copyCount: r.copy_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    lastPastedAt: r.last_pasted_at,
    groupIds,
    meta: parseJson<ClipMeta>(r.meta_json, {}),
  };
}

function mapClip(r: ClipRow, groupIds: string[]): Clip {
  return {
    ...mapSummary({ ...r, has_html: r.html !== null ? 1 : 0, has_rtf: r.rtf !== null ? 1 : 0 }, groupIds),
    text: r.text,
    html: r.html,
    rtf: r.rtf,
    hash: r.hash,
  };
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',');

/** Splits arrays for `IN (...)` lists (SQLite's default variable limit is 32766; stay well below). */
function chunks<T>(items: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class ClipRepository {
  constructor(private readonly db: DatabaseSync) {}

  // ---------------------------------------------------------------- reads

  groupIdsFor(ids: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const part of chunks(ids)) {
      if (!part.length) continue;
      const rows = this.db
        .prepare(`SELECT clip_id, group_id FROM clip_groups WHERE clip_id IN (${placeholders(part.length)}) ORDER BY added_at`)
        .all(...part) as unknown as Array<{ clip_id: string; group_id: string }>;
      for (const r of rows) {
        const list = map.get(r.clip_id);
        if (list) list.push(r.group_id);
        else map.set(r.clip_id, [r.group_id]);
      }
    }
    return map;
  }

  /** Summaries for `ids`, in the given order (missing ids are dropped). */
  summaries(ids: string[]): ClipSummary[] {
    if (!ids.length) return [];
    const byId = new Map<string, SummaryRow>();
    for (const part of chunks(ids)) {
      const rows = this.db
        .prepare(`SELECT ${SUMMARY_COLS} FROM clips c WHERE c.id IN (${placeholders(part.length)})`)
        .all(...part) as unknown as SummaryRow[];
      for (const r of rows) byId.set(r.id, r);
    }
    const groups = this.groupIdsFor(ids);
    const out: ClipSummary[] = [];
    for (const id of ids) {
      const r = byId.get(id);
      if (r) out.push(mapSummary(r, groups.get(id) ?? []));
    }
    return out;
  }

  /** Maps summary rows already fetched with SUMMARY_COLS (attaches group ids in one query). */
  mapRows(rows: SummaryRow[]): ClipSummary[] {
    const groups = this.groupIdsFor(rows.map((r) => r.id));
    return rows.map((r) => mapSummary(r, groups.get(r.id) ?? []));
  }

  getSummary(id: string): ClipSummary | null {
    return this.summaries([id])[0] ?? null;
  }

  getRow(id: string): ClipRow | null {
    return (this.db.prepare('SELECT * FROM clips WHERE id = ?').get(id) as unknown as ClipRow | undefined) ?? null;
  }

  get(id: string): Clip | null {
    const row = this.getRow(id);
    if (!row) return null;
    return mapClip(row, this.groupIdsFor([id]).get(id) ?? []);
  }

  findIdByHash(hash: string): string | null {
    const r = this.db.prepare('SELECT id FROM clips WHERE hash = ?').get(hash) as { id: string } | undefined;
    return r?.id ?? null;
  }

  recent(limit: number): ClipSummary[] {
    const rows = this.db
      .prepare(`SELECT ${SUMMARY_COLS} FROM clips c ORDER BY c.updated_at DESC LIMIT ?`)
      .all(limit) as unknown as SummaryRow[];
    return this.mapRows(rows);
  }

  /** Most recent text-family clip (for the "paste last as plain" shortcut). */
  latestText(): Clip | null {
    const r = this.db
      .prepare("SELECT id FROM clips WHERE kind IN ('text','link','color','code') ORDER BY updated_at DESC LIMIT 1")
      .get() as { id: string } | undefined;
    return r ? this.get(r.id) : null;
  }

  count(): number {
    return (this.db.prepare('SELECT count(*) AS n FROM clips').get() as { n: number }).n;
  }

  stats(): { totalClips: number; pinnedClips: number; imageClips: number; oldestAt: number | null } {
    const r = this.db
      .prepare(
        "SELECT count(*) AS total, coalesce(sum(pinned), 0) AS pinned, coalesce(sum(kind = 'image'), 0) AS images, min(created_at) AS oldest FROM clips",
      )
      .get() as { total: number; pinned: number; images: number; oldest: number | null };
    return { totalClips: r.total, pinnedClips: r.pinned, imageClips: r.images, oldestAt: r.oldest };
  }

  imageClipIds(): string[] {
    return (this.db.prepare("SELECT id FROM clips WHERE kind = 'image'").all() as unknown as Array<{ id: string }>).map((r) => r.id);
  }

  // ---------------------------------------------------------------- writes

  /** Inserts a new clip and returns its id. */
  insert(input: NewClipInput, opts: InsertOptions = {}): string {
    const id = opts.id ?? randomUUID();
    const now = Date.now();
    const createdAt = opts.createdAt ?? now;
    const updatedAt = opts.updatedAt ?? createdAt;
    let image = input.image;
    if (!image && input.png && opts.storeImage) image = opts.storeImage(id, input.png);
    if (input.kind === 'image' && !image) throw new Error('image clip without stored image');
    const hash = opts.dedupe === false ? `${input.hash}#${id}` : input.hash;
    const pinned = opts.pinned ? 1 : 0;
    this.db
      .prepare(
        `INSERT INTO clips (id, kind, text, html, rtf, files_json, image_json, preview, hash, byte_size, source_app,
           pinned, pinned_at, copy_count, created_at, updated_at, last_pasted_at, meta_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.kind,
        input.text,
        input.html,
        input.rtf,
        input.files ? JSON.stringify(input.files) : null,
        image ? JSON.stringify(image) : null,
        input.preview,
        hash,
        image ? image.bytes : input.byteSize,
        input.sourceApp,
        pinned,
        pinned ? (opts.pinnedAt ?? updatedAt) : null,
        opts.copyCount ?? 1,
        createdAt,
        updatedAt,
        opts.lastPastedAt ?? null,
        JSON.stringify(input.meta ?? {}),
      );
    return id;
  }

  /**
   * Insert, or — when dedupe is on and the hash exists — move the existing clip to the top and bump copyCount
   * (pin and groups are kept).
   */
  upsert(input: NewClipInput, opts: InsertOptions & { dedupe: boolean; now?: number }): { id: string; created: boolean } {
    const now = opts.now ?? Date.now();
    if (opts.dedupe) {
      const existing = this.findIdByHash(input.hash);
      if (existing) {
        this.db
          .prepare('UPDATE clips SET updated_at = ?, copy_count = copy_count + 1, source_app = coalesce(?, source_app) WHERE id = ?')
          .run(now, input.sourceApp, existing);
        return { id: existing, created: false };
      }
    }
    const id = this.insert(input, { ...opts, createdAt: opts.createdAt ?? now, updatedAt: opts.updatedAt ?? now });
    return { id, created: true };
  }

  /** Text edit: html/rtf cleared, kind/meta/preview/hash re-derived. A hash collision merges the other clip into this one. */
  updateText(id: string, text: string, now = Date.now()): Clip | null {
    const row = this.getRow(id);
    if (!row) return null;
    if (row.kind === 'image') throw new Error('image clips cannot be edited as text');
    const next = buildTextClip(text, { sourceApp: row.source_app });
    transaction(this.db, () => {
      const other = this.findIdByHash(next.hash);
      if (other && other !== id) {
        const o = this.getRow(other);
        if (o?.pinned && !row.pinned) {
          this.db.prepare('UPDATE clips SET pinned = 1, pinned_at = ? WHERE id = ?').run(o.pinned_at ?? now, id);
        }
        this.db
          .prepare('INSERT OR IGNORE INTO clip_groups (clip_id, group_id, added_at) SELECT ?, group_id, added_at FROM clip_groups WHERE clip_id = ?')
          .run(id, other);
        this.db.prepare('DELETE FROM clips WHERE id = ?').run(other);
      }
      this.db
        .prepare(
          `UPDATE clips SET kind = ?, text = ?, html = NULL, rtf = NULL, files_json = NULL, preview = ?, hash = ?, byte_size = ?,
             meta_json = ?, updated_at = ? WHERE id = ?`,
        )
        .run(next.kind, text, next.preview, next.hash, next.byteSize, JSON.stringify(next.meta), now, id);
    });
    return this.get(id);
  }

  setPinned(id: string, pinned: boolean, now = Date.now()): ClipSummary | null {
    this.db.prepare('UPDATE clips SET pinned = ?, pinned_at = ? WHERE id = ?').run(pinned ? 1 : 0, pinned ? now : null, id);
    return this.getSummary(id);
  }

  /** Replaces the clip's group membership (unknown group ids are ignored). */
  setGroups(id: string, groupIds: string[], now = Date.now()): ClipSummary | null {
    if (!this.getRow(id)) return null;
    transaction(this.db, () => {
      const keep = new Set(groupIds);
      const current = this.groupIdsFor([id]).get(id) ?? [];
      for (const g of current) if (!keep.has(g)) this.db.prepare('DELETE FROM clip_groups WHERE clip_id = ? AND group_id = ?').run(id, g);
      this.addToGroups(id, groupIds, now);
    });
    return this.getSummary(id);
  }

  addToGroups(id: string, groupIds: string[], now = Date.now()): void {
    const stmt = this.db.prepare(
      'INSERT OR IGNORE INTO clip_groups (clip_id, group_id, added_at) SELECT ?, id, ? FROM groups WHERE id = ?',
    );
    for (const g of groupIds) stmt.run(id, now, g);
  }

  /** OR-merges a pin into an existing clip (Ditto/Tuck import). */
  mergePinned(id: string, pinnedAt: number): void {
    this.db.prepare('UPDATE clips SET pinned = 1, pinned_at = coalesce(pinned_at, ?) WHERE id = ? AND pinned = 0').run(pinnedAt, id);
  }

  markPasted(ids: string[], moveToTop: boolean, now = Date.now()): void {
    const sql = moveToTop
      ? 'UPDATE clips SET last_pasted_at = ?, updated_at = ? WHERE id = ?'
      : 'UPDATE clips SET last_pasted_at = ? WHERE id = ?';
    const stmt = this.db.prepare(sql);
    transaction(this.db, () => {
      // Merged pastes keep their relative order: the last id ends up on top.
      ids.forEach((id, i) => (moveToTop ? stmt.run(now, now + i, id) : stmt.run(now, id)));
    });
  }

  /** Deletes clips and returns full snapshots (rows + groups) for the undo ring. */
  delete(ids: string[]): ClipSnapshot[] {
    if (!ids.length) return [];
    return transaction(this.db, () => {
      const snaps: ClipSnapshot[] = [];
      const groups = this.groupIdsFor(ids);
      for (const id of ids) {
        const row = this.getRow(id);
        if (!row) continue;
        snaps.push({ row, groupIds: groups.get(id) ?? [] });
        this.db.prepare('DELETE FROM clips WHERE id = ?').run(id);
      }
      return snaps;
    });
  }

  /** Re-inserts snapshots. Rows whose hash now belongs to another clip are skipped (returned in `skipped`). */
  restore(snaps: ClipSnapshot[]): { restored: string[]; skipped: ClipSnapshot[] } {
    const restored: string[] = [];
    const skipped: ClipSnapshot[] = [];
    transaction(this.db, () => {
      for (const s of snaps) {
        const r = s.row;
        if (this.getRow(r.id) || this.findIdByHash(r.hash)) {
          skipped.push(s);
          continue;
        }
        const cols = ['id', 'kind', 'text', 'html', 'rtf', 'files_json', 'image_json', 'preview', 'hash', 'byte_size', 'source_app',
          'pinned', 'pinned_at', 'copy_count', 'created_at', 'updated_at', 'last_pasted_at', 'meta_json'] as const;
        this.db
          .prepare(`INSERT INTO clips (${cols.join(',')}) VALUES (${placeholders(cols.length)})`)
          .run(...cols.map((c) => r[c] as SQLInputValue));
        this.addToGroups(r.id, s.groupIds, Date.now());
        restored.push(r.id);
      }
    });
    return { restored, skipped };
  }

  /** Deletes everything (or everything unpinned). Returns deleted ids and the ids of deleted image clips. */
  clear(includePinned: boolean): { ids: string[]; imageIds: string[] } {
    const where = includePinned ? '' : 'WHERE pinned = 0';
    const rows = this.db.prepare(`SELECT id, kind FROM clips ${where}`).all() as unknown as Array<{ id: string; kind: ClipKind }>;
    this.db.prepare(`DELETE FROM clips ${where}`).run();
    return { ids: rows.map((r) => r.id), imageIds: rows.filter((r) => r.kind === 'image').map((r) => r.id) };
  }

  /** Ids of unpinned clips beyond `maxItems` (by updated_at) or older than `expireDays` (0 = never). */
  retentionCandidates(maxItems: number, expireDays: number, now = Date.now()): string[] {
    const ids = new Set<string>();
    const over = this.db
      .prepare('SELECT id FROM clips WHERE pinned = 0 ORDER BY updated_at DESC LIMIT -1 OFFSET ?')
      .all(Math.max(0, maxItems)) as unknown as Array<{ id: string }>;
    for (const r of over) ids.add(r.id);
    if (expireDays > 0) {
      const cutoff = now - expireDays * 86_400_000;
      const old = this.db.prepare('SELECT id FROM clips WHERE pinned = 0 AND updated_at < ?').all(cutoff) as unknown as Array<{ id: string }>;
      for (const r of old) ids.add(r.id);
    }
    return [...ids];
  }

  /** Permanent delete without snapshots; returns ids of image clips (whose files the caller removes). */
  deleteHard(ids: string[]): string[] {
    const imageIds: string[] = [];
    transaction(this.db, () => {
      for (const part of chunks(ids)) {
        const rows = this.db
          .prepare(`SELECT id FROM clips WHERE kind = 'image' AND id IN (${placeholders(part.length)})`)
          .all(...part) as unknown as Array<{ id: string }>;
        imageIds.push(...rows.map((r) => r.id));
        this.db.prepare(`DELETE FROM clips WHERE id IN (${placeholders(part.length)})`).run(...part);
      }
    });
    return imageIds;
  }

  /** Every row, oldest first (export). */
  *iterateAll(): Generator<Clip> {
    const ids = (this.db.prepare('SELECT id FROM clips ORDER BY updated_at ASC').all() as unknown as Array<{ id: string }>).map((r) => r.id);
    for (const part of chunks(ids, 200)) {
      const groups = this.groupIdsFor(part);
      for (const id of part) {
        const row = this.getRow(id);
        if (row) yield mapClip(row, groups.get(id) ?? []);
      }
    }
  }
}
