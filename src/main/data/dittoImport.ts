// Ditto import (DESIGN §I): detect %APPDATA%\Ditto\Ditto.db, inspect counts, chunked import with progress,
// dedupe/merge by hash, groups → collections, lDontAutoDelete/stickyClipOrder → pinned.
// Electron-free: image encoding/storage is injected (ImageSink) so the whole pipeline runs under plain node.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { setImmediate as tick } from 'node:timers/promises';
import { LIMITS, type ClipImageMeta, type DittoDetectResult, type DittoImportError, type DittoImportResult, type DittoInspectResult } from '../../shared/types';
import { buildFilesClip, buildImageClip, buildTextClip, pngSize, type NewClipInput } from '../db/clipBuilder';
import type { ClipRepository } from '../db/clipRepository';
import { transaction } from '../db/connection';
import type { GroupRepository } from '../db/groupRepository';
import { logger } from '../log';
import { decodeAnsiText, decodeDib, decodeRtf, decodeUtf16Text, extractCfHtml, isPng, parseDropFiles, premultiply } from './dittoFormats';
import { openSqliteSource, SqliteOpenError, type OpenedSqlite } from './sqliteOpen';

const log = logger('ditto');

export const DITTO_CHUNK = 200;
const STICKY_NONE = -2147483647;

export interface ImageSink {
  /** Encodes premultiplied BGRA to PNG. */
  encodeBitmap(bgra: Buffer, width: number, height: number): Buffer;
  /** Stores a PNG for clip `id` (original + thumbnail). */
  save(id: string, png: Buffer): ClipImageMeta;
}

export interface DittoImportDeps {
  db: DatabaseSync;
  clips: ClipRepository;
  groups: GroupRepository;
  images: ImageSink | null;
  limits?: { maxTextBytes?: number; maxImageBytes?: number; maxHtmlBytes?: number; maxRtfBytes?: number };
  onProgress?: (done: number, total: number) => void;
}

export interface DittoImportOptions {
  path: string;
  includeImages: boolean;
  includeGroups: boolean;
}

export interface DittoImportStats extends DittoImportResult {
  durationMs: number;
  /** Per-reason skip counters (diagnostics). */
  skipReasons: Record<string, number>;
  /** Ditto format names seen with counts. */
  formats: Record<string, number>;
}

// ------------------------------------------------------------------------------------------ detect

export function dittoCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  const add = (...parts: (string | undefined)[]) => {
    if (parts.every(Boolean)) out.push(join(...(parts as string[])));
  };
  add(env['APPDATA'], 'Ditto', 'Ditto.db');
  add(env['LOCALAPPDATA'], 'Ditto', 'Ditto.db');
  add(env['ProgramFiles'], 'Ditto', 'Ditto.db');
  add(env['ProgramFiles(x86)'], 'Ditto', 'Ditto.db');
  // Microsoft Store build: %LOCALAPPDATA%\Packages\<...Ditto...>\LocalCache\Roaming\Ditto\Ditto.db
  const pkgs = env['LOCALAPPDATA'] ? join(env['LOCALAPPDATA'], 'Packages') : null;
  if (pkgs) {
    try {
      for (const name of readdirSync(pkgs)) {
        if (/ditto/i.test(name)) out.push(join(pkgs, name, 'LocalCache', 'Roaming', 'Ditto', 'Ditto.db'));
      }
    } catch {
      /* no Packages dir */
    }
  }
  return out;
}

export function detectDitto(env: NodeJS.ProcessEnv = process.env): DittoDetectResult {
  if (process.platform !== 'win32') return { found: false, path: null };
  for (const p of dittoCandidates(env)) {
    try {
      if (existsSync(p) && statSync(p).size > 0) return { found: true, path: p };
    } catch {
      /* unreadable */
    }
  }
  return { found: false, path: null };
}

// ------------------------------------------------------------------------------------------ open

interface OpenDitto {
  src: DatabaseSync;
  opened: OpenedSqlite;
  mainCols: Set<string>;
  close(): void;
}

class DittoError extends Error {
  constructor(
    readonly code: DittoImportError,
    message: string,
  ) {
    super(message);
  }
}

async function openDitto(path: string): Promise<OpenDitto> {
  let opened: OpenedSqlite;
  try {
    opened = await openSqliteSource(path);
  } catch (err) {
    if (err instanceof SqliteOpenError) throw new DittoError(err.code, err.message);
    throw new DittoError('read-failed', (err as Error).message);
  }
  let src: DatabaseSync;
  try {
    src = new DatabaseSync(opened.path, { readOnly: true });
  } catch (err) {
    opened.cleanup();
    throw new DittoError('read-failed', (err as Error).message);
  }
  const close = () => {
    try {
      src.close();
    } catch {
      /* ignore */
    }
    opened.cleanup();
  };
  try {
    const tables = new Set(
      (src.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as Array<{ name: string }>).map((r) => r.name),
    );
    if (!tables.has('Main') || !tables.has('Data')) throw new DittoError('not-ditto', 'No Ditto Main/Data tables in this database.');
    const mainCols = new Set((src.prepare('PRAGMA table_info(Main)').all() as unknown as Array<{ name: string }>).map((r) => r.name));
    const dataCols = new Set((src.prepare('PRAGMA table_info(Data)').all() as unknown as Array<{ name: string }>).map((r) => r.name));
    for (const c of ['lID', 'lParentID', 'strClipBoardFormat', 'ooData']) {
      if (!dataCols.has(c)) throw new DittoError('not-ditto', `Ditto Data table lacks ${c}.`);
    }
    if (!mainCols.has('lID')) throw new DittoError('not-ditto', 'Ditto Main table lacks lID.');
    return { src, opened, mainCols, close };
  } catch (err) {
    close();
    if (err instanceof DittoError) throw err;
    throw new DittoError('read-failed', (err as Error).message);
  }
}

const colOr = (cols: Set<string>, name: string, fallback = 'NULL'): string => (cols.has(name) ? name : `${fallback} AS ${name}`);

function isPinnedRow(r: MainRow): boolean {
  if ((r.lDontAutoDelete ?? 0) > 0) return true;
  return r.stickyClipOrder !== null && r.stickyClipOrder !== undefined && r.stickyClipOrder > STICKY_NONE;
}

function clipWhere(cols: Set<string>): string {
  return cols.has('bIsGroup') ? 'WHERE coalesce(bIsGroup, 0) = 0' : '';
}

export async function inspectDitto(path: string): Promise<DittoInspectResult> {
  let d: OpenDitto | null = null;
  try {
    d = await openDitto(path);
    const c = d.mainCols;
    const clips = (d.src.prepare(`SELECT count(*) AS n FROM Main ${clipWhere(c)}`).get() as { n: number }).n;
    const groups = c.has('bIsGroup') ? (d.src.prepare('SELECT count(*) AS n FROM Main WHERE bIsGroup = 1').get() as { n: number }).n : 0;
    const pinnedParts: string[] = [];
    if (c.has('lDontAutoDelete')) pinnedParts.push('coalesce(lDontAutoDelete, 0) > 0');
    if (c.has('stickyClipOrder')) pinnedParts.push(`(stickyClipOrder IS NOT NULL AND stickyClipOrder > ${STICKY_NONE})`);
    const where = [c.has('bIsGroup') ? 'coalesce(bIsGroup, 0) = 0' : '1', pinnedParts.length ? `(${pinnedParts.join(' OR ')})` : '0'];
    const pinned = (d.src.prepare(`SELECT count(*) AS n FROM Main WHERE ${where.join(' AND ')}`).get() as { n: number }).n;
    return { ok: true, path, clips, groups, pinned };
  } catch (err) {
    const code = err instanceof DittoError ? err.code : 'unknown';
    log.warn('inspect failed', code, (err as Error).message);
    return { ok: false, path, clips: 0, groups: 0, pinned: 0, error: code };
  } finally {
    d?.close();
  }
}

// ------------------------------------------------------------------------------------------ import

interface MainRow {
  lID: number;
  lDate: number | null;
  mText: string | null;
  lDontAutoDelete: number | null;
  lParentID: number | null;
  lastPasteDate: number | null;
  stickyClipOrder: number | null;
}

interface DataIndexRow {
  lID: number;
  lParentID: number;
  fmt: string;
  len: number;
}

interface Prepared {
  input: NewClipInput;
  createdAt: number;
  lastPastedAt: number | null;
  pinned: boolean;
  pinnedAt: number;
  groupId: string | null;
}

const placeholders = (n: number): string => Array.from({ length: n }, () => '?').join(',');

export function emptyResult(extra: Partial<DittoImportResult> = {}): DittoImportResult {
  return { ok: false, canceled: false, imported: 0, merged: 0, skipped: 0, groups: 0, images: 0, ...extra };
}

export async function importDitto(opts: DittoImportOptions, deps: DittoImportDeps): Promise<DittoImportStats> {
  const started = Date.now();
  const maxText = deps.limits?.maxTextBytes ?? LIMITS.maxTextBytes;
  const maxImage = deps.limits?.maxImageBytes ?? 25 * 1024 * 1024;
  const maxHtml = deps.limits?.maxHtmlBytes ?? LIMITS.maxHtmlBytes;
  const maxRtf = deps.limits?.maxRtfBytes ?? LIMITS.maxRtfBytes;
  const skipReasons: Record<string, number> = {};
  const formats: Record<string, number> = {};
  const skip = (why: string) => (skipReasons[why] = (skipReasons[why] ?? 0) + 1);
  const res: DittoImportStats = { ...emptyResult(), durationMs: 0, skipReasons, formats };

  let d: OpenDitto | null = null;
  try {
    d = await openDitto(opts.path);
    const { src, mainCols: c } = d;

    // ---- groups
    const groupMap = new Map<number, string>();
    if (opts.includeGroups && c.has('bIsGroup')) {
      const rows = src.prepare(`SELECT lID, ${colOr(c, 'mText')} FROM Main WHERE bIsGroup = 1 ORDER BY lID`).all() as unknown as Array<{
        lID: number;
        mText: string | null;
      }>;
      for (const r of rows) {
        const name = (r.mText ?? '').trim() || `Ditto group ${r.lID}`;
        const { group } = deps.groups.ensure(name);
        groupMap.set(r.lID, group.id);
      }
      res.groups = new Set(groupMap.values()).size;
    }

    // ---- clips
    const ids = (src.prepare(`SELECT lID FROM Main ${clipWhere(c)} ORDER BY lID`).all() as unknown as Array<{ lID: number }>).map((r) => r.lID);
    const total = ids.length;
    deps.onProgress?.(0, total);
    const mainSql = `SELECT lID, ${colOr(c, 'lDate')}, ${colOr(c, 'mText')}, ${colOr(c, 'lDontAutoDelete')}, ${colOr(c, 'lParentID')},
      ${colOr(c, 'lastPasteDate')}, ${colOr(c, 'stickyClipOrder')} FROM Main WHERE lID IN `;
    const blobStmt = src.prepare('SELECT ooData FROM Data WHERE lID = ?');
    const blob = (id: number): Uint8Array | null => {
      const r = blobStmt.get(id) as { ooData: Uint8Array | null } | undefined;
      return r?.ooData ?? null;
    };

    for (let i = 0; i < ids.length; i += DITTO_CHUNK) {
      const part = ids.slice(i, i + DITTO_CHUNK);
      const mains = src.prepare(`${mainSql}(${placeholders(part.length)}) ORDER BY lID`).all(...(part as SQLInputValue[])) as unknown as MainRow[];
      const dataRows = src
        .prepare(
          `SELECT lID, lParentID, strClipBoardFormat AS fmt, length(ooData) AS len FROM Data WHERE lParentID IN (${placeholders(part.length)})`,
        )
        .all(...(part as SQLInputValue[])) as unknown as DataIndexRow[];
      const byClip = new Map<number, Map<string, DataIndexRow>>();
      for (const r of dataRows) {
        formats[r.fmt] = (formats[r.fmt] ?? 0) + 1;
        let m = byClip.get(r.lParentID);
        if (!m) byClip.set(r.lParentID, (m = new Map()));
        if (!m.has(r.fmt)) m.set(r.fmt, r);
      }

      // Phase A — decode (async; yields after every image so the main thread stays responsive).
      const prepared: Prepared[] = [];
      for (const m of mains) {
        const fm = byClip.get(m.lID);
        if (!fm || fm.size === 0) {
          skip('no-data');
          res.skipped++;
          continue;
        }
        let input: NewClipInput | null = null;
        try {
          // files
          const hdrop = fm.get('CF_HDROP');
          if (hdrop && hdrop.len > 0 && hdrop.len < 4 * 1024 * 1024) {
            const u8 = blob(hdrop.lID);
            const files = u8 ? parseDropFiles(u8) : [];
            if (files.length) input = buildFilesClip(files);
          }
          // text (+ html/rtf alternates)
          if (!input) {
            let text: string | null = null;
            const uni = fm.get('CF_UNICODETEXT');
            const ansi = fm.get('CF_TEXT') ?? fm.get('CF_OEMTEXT');
            if (uni && uni.len > 0) {
              if (uni.len <= maxText * 2 + 2) {
                const u8 = blob(uni.lID);
                if (u8) text = decodeUtf16Text(u8);
              } else skip('text-too-large');
            } else if (ansi && ansi.len > 0) {
              if (ansi.len <= maxText + 1) {
                const u8 = blob(ansi.lID);
                if (u8) text = decodeAnsiText(u8);
              } else skip('text-too-large');
            }
            if (text !== null && Buffer.byteLength(text, 'utf8') > maxText) {
              skip('text-too-large');
              text = null;
            }
            if (text !== null && text.trim()) {
              let html: string | null = null;
              let rtf: string | null = null;
              const h = fm.get('HTML Format');
              if (h && h.len > 0 && h.len <= maxHtml * 4) {
                const u8 = blob(h.lID);
                html = u8 ? extractCfHtml(u8) : null;
                if (html && Buffer.byteLength(html, 'utf8') > maxHtml) html = null;
              }
              const r = fm.get('Rich Text Format');
              if (r && r.len > 0 && r.len <= maxRtf + 1) {
                const u8 = blob(r.lID);
                rtf = u8 ? decodeRtf(u8) || null : null;
              }
              input = buildTextClip(text, { html, rtf });
            }
          }
          // image
          if (!input && opts.includeImages && deps.images) {
            const png = fm.get('PNG');
            const dib = fm.get('CF_DIBV5') ?? fm.get('CF_DIB');
            if (png && png.len > 0) {
              const u8 = blob(png.lID);
              const size = u8 && isPng(u8) ? pngSize(u8) : null;
              if (u8 && size && u8.length <= maxImage) input = buildImageClip(Buffer.from(u8), size.width, size.height);
            }
            if (!input && dib && dib.len > 0) {
              const u8 = blob(dib.lID);
              const bmp = u8 ? decodeDib(u8) : null;
              if (bmp) {
                const pngBuf = deps.images.encodeBitmap(premultiply(bmp.bgra), bmp.width, bmp.height);
                if (pngBuf.length <= maxImage) input = buildImageClip(pngBuf, bmp.width, bmp.height);
                else skip('image-too-large');
              } else skip('dib-undecodable');
            }
            if (input) await tick();
          }
        } catch (err) {
          log.warn(`clip ${m.lID} failed to decode:`, (err as Error).message);
          skip('decode-error');
          input = null;
        }
        if (!input) {
          const onlyImage = !opts.includeImages && (fm.has('PNG') || fm.has('CF_DIB') || fm.has('CF_DIBV5'));
          skip(onlyImage ? 'image-excluded' : 'nothing-decodable');
          res.skipped++;
          continue;
        }
        const createdAt = m.lDate && m.lDate > 0 ? m.lDate * 1000 : started;
        const pinned = isPinnedRow(m);
        const sticky = m.stickyClipOrder !== null && m.stickyClipOrder > STICKY_NONE ? m.stickyClipOrder : null;
        prepared.push({
          input,
          createdAt,
          lastPastedAt: m.lastPasteDate && m.lastPasteDate > 0 ? m.lastPasteDate * 1000 : null,
          pinned,
          // Sticky clips keep Ditto's order (higher stickyClipOrder first); other pins use their copy time.
          pinnedAt: sticky !== null ? started + Math.round(sticky * 1000) : createdAt,
          groupId: m.lParentID !== null && m.lParentID > 0 ? (groupMap.get(m.lParentID) ?? null) : null,
        });
      }

      // Phase B — write the chunk in one transaction.
      transaction(deps.db, () => {
        for (const p of prepared) {
          const existing = deps.clips.findIdByHash(p.input.hash);
          if (existing) {
            if (p.pinned) deps.clips.mergePinned(existing, p.pinnedAt);
            if (p.groupId) deps.clips.addToGroups(existing, [p.groupId]);
            res.merged++;
            continue;
          }
          if (p.input.kind === 'image' && !deps.images) {
            res.skipped++;
            continue;
          }
          const id = deps.clips.insert(p.input, {
            createdAt: p.createdAt,
            updatedAt: p.createdAt,
            pinned: p.pinned,
            pinnedAt: p.pinned ? p.pinnedAt : null,
            lastPastedAt: p.lastPastedAt,
            storeImage: deps.images ? (cid, png) => deps.images!.save(cid, png) : undefined,
          });
          if (p.groupId) deps.clips.addToGroups(id, [p.groupId]);
          res.imported++;
          if (p.input.kind === 'image') res.images++;
        }
      });
      deps.onProgress?.(Math.min(total, i + part.length), total);
      await tick();
    }
    res.ok = true;
  } catch (err) {
    res.ok = false;
    res.error = err instanceof DittoError ? err.code : 'unknown';
    res.message = (err as Error).message;
    log.error('import failed', res.error, res.message);
  } finally {
    d?.close();
  }
  res.durationMs = Date.now() - started;
  log.info(
    `import ${res.ok ? 'done' : 'failed'} in ${res.durationMs} ms: imported=${res.imported} merged=${res.merged} skipped=${res.skipped} ` +
      `groups=${res.groups} images=${res.images} skipReasons=${JSON.stringify(skipReasons)}`,
  );
  return res;
}
