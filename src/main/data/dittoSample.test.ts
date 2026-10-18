// Verification against a REAL Ditto backup (personal data — never committed). Skipped unless
// TUCK_DITTO_SAMPLE=<path to Ditto.db / .zdb / .zip> is set:
//   TUCK_DITTO_SAMPLE=E:/copy/Ditto.zdb npx vitest run src/main/data/dittoSample.test.ts
// Prints only counts, format names and rates — never clip contents.
import { DatabaseSync } from 'node:sqlite';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ClipRepository } from '../db/clipRepository';
import { openDatabase } from '../db/connection';
import { GroupRepository } from '../db/groupRepository';
import { pngSize } from '../db/clipBuilder';
import { decodeAnsiText, decodeDib, decodeRtf, decodeUtf16Text, extractCfHtml, isPng, parseDropFiles } from './dittoFormats';
import { importDitto } from './dittoImport';
import { openSqliteSource } from './sqliteOpen';

const SAMPLE = process.env['TUCK_DITTO_SAMPLE'];

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
}

/** Minimal PNG encoder (BGRA premultiplied in → RGBA PNG) so the import runs outside Electron. */
function encodePng(bgra: Buffer, w: number, h: number): Buffer {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 4 + 1);
    raw[o] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = o + 1 + x * 4;
      raw[d] = bgra[s + 2]!;
      raw[d + 1] = bgra[s + 1]!;
      raw[d + 2] = bgra[s]!;
      raw[d + 3] = bgra[s + 3]!;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced) → RGBA, for comparing against decoded DIBs. */
function decodePng(png: Uint8Array): { w: number; h: number; rgba: Buffer } | null {
  const b = Buffer.from(png);
  let off = 8;
  let w = 0, h = 0, ct = 0, depth = 0, interlace = 0;
  const idat: Buffer[] = [];
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString('latin1', off + 4, off + 8);
    const data = b.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]!; ct = data[9]!; interlace = data[12]!;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || (ct !== 6 && ct !== 2)) return null;
  const bpp = ct === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * 4);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)]!;
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0, up = prev[i]!, c = i >= bpp ? prev[i - bpp]! : 0;
      let v = cur[i]!;
      if (ft === 1) v += a; else if (ft === 2) v += up; else if (ft === 3) v += (a + up) >> 1;
      else if (ft === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      out[o] = cur[x * bpp]!; out[o + 1] = cur[x * bpp + 1]!; out[o + 2] = cur[x * bpp + 2]!; out[o + 3] = bpp === 4 ? cur[x * bpp + 3]! : 255;
    }
    cur.copy(prev);
  }
  return { w, h, rgba: out };
}

describe.skipIf(!SAMPLE)('real Ditto sample', () => {
  it('decodes the sample and imports it', async () => {
    const t0 = Date.now();
    const opened = await openSqliteSource(SAMPLE!);
    const openMs = Date.now() - t0;
    const src = new DatabaseSync(opened.path, { readOnly: true });
    const report: Record<string, unknown> = { kind: opened.kind, openMs };
    try {
      report['mainColumns'] = (src.prepare('PRAGMA table_info(Main)').all() as Array<{ name: string }>).map((r) => r.name);
      report['dataColumns'] = (src.prepare('PRAGMA table_info(Data)').all() as Array<{ name: string }>).map((r) => r.name);
      report['formats'] = Object.fromEntries(
        (src.prepare('SELECT strClipBoardFormat f, count(*) n FROM Data GROUP BY f ORDER BY n DESC').all() as Array<{ f: string; n: number }>).map(
          (r) => [r.f, r.n],
        ),
      );

      type Row = { lID: number; lParentID: number; f: string; d: Uint8Array };
      const decoders: Record<string, (u8: Uint8Array) => boolean> = {
        CF_UNICODETEXT: (u) => decodeUtf16Text(u).length > 0,
        CF_TEXT: (u) => decodeAnsiText(u).length > 0,
        CF_OEMTEXT: (u) => decodeAnsiText(u).length > 0,
        'HTML Format': (u) => !!extractCfHtml(u),
        'Rich Text Format': (u) => decodeRtf(u).startsWith('{\\rtf'),
        CF_HDROP: (u) => parseDropFiles(u).length > 0,
        PNG: (u) => isPng(u) && !!pngSize(u),
        CF_DIB: (u) => !!decodeDib(u),
        CF_DIBV5: (u) => !!decodeDib(u),
      };
      const rates: Record<string, { ok: number; total: number }> = {};
      const tally = (r: Row) => {
        const dec = decoders[r.f];
        if (!dec) return;
        const e = (rates[r.f] ??= { ok: 0, total: 0 });
        e.total++;
        try {
          if (dec(r.d)) e.ok++;
        } catch {
          /* counted as failure */
        }
      };
      const first300 = src
        .prepare(
          `SELECT lID, lParentID, strClipBoardFormat f, ooData d FROM Data WHERE lParentID IN (SELECT lID FROM Main ORDER BY lID LIMIT 300)
           AND strClipBoardFormat NOT IN ('PNG','CF_DIB','CF_DIBV5') AND length(ooData) < 20000000`,
        )
        .iterate() as Iterable<Row>;
      for (const r of first300) tally(r);
      // every image format row, plus DIB-vs-PNG dimension agreement
      const pngDims = new Map<number, string>();
      const pngBytes = new Map<number, Uint8Array>();
      let pixelPairs = 0;
      let pixelMatchSum = 0;
      let pixelWorst = 1;
      let dibPngAgree = 0;
      let dibPngPairs = 0;
      for (const r of src.prepare("SELECT lID, lParentID, strClipBoardFormat f, ooData d FROM Data WHERE strClipBoardFormat = 'PNG'").iterate() as Iterable<Row>) {
        tally(r);
        const s = pngSize(r.d);
        if (s) pngDims.set(r.lParentID, `${s.width}x${s.height}`);
        pngBytes.set(r.lParentID, r.d);
      }
      for (const r of src
        .prepare("SELECT lID, lParentID, strClipBoardFormat f, ooData d FROM Data WHERE strClipBoardFormat IN ('CF_DIB','CF_DIBV5')")
        .iterate() as Iterable<Row>) {
        tally(r);
        const png = pngDims.get(r.lParentID);
        if (png) {
          dibPngPairs++;
          const b = decodeDib(r.d);
          if (b && `${b.width}x${b.height}` === png) {
            dibPngAgree++;
            const p = decodePng(pngBytes.get(r.lParentID)!);
            if (p) {
              // Compare RGB on opaque PNG pixels (sampled): validates orientation, channel order and masks.
              let same = 0;
              let n = 0;
              const step = Math.max(1, Math.floor((p.w * p.h) / 20000));
              for (let i = 0; i < p.w * p.h; i += step) {
                const o = i * 4;
                if (p.rgba[o + 3] !== 255) continue;
                n++;
                const close = (a: number, c: number) => Math.abs(a - c) <= 2;
                if (close(p.rgba[o]!, b.bgra[o + 2]!) && close(p.rgba[o + 1]!, b.bgra[o + 1]!) && close(p.rgba[o + 2]!, b.bgra[o]!)) same++;
              }
              if (n) {
                pixelPairs++;
                pixelMatchSum += same / n;
                pixelWorst = Math.min(pixelWorst, same / n);
              }
            }
          }
        }
      }
      report['decodeRates'] = Object.fromEntries(
        Object.entries(rates).map(([k, v]) => [k, `${v.ok}/${v.total} (${((100 * v.ok) / Math.max(1, v.total)).toFixed(1)}%)`]),
      );
      report['dibPngDimensionAgreement'] = `${dibPngAgree}/${dibPngPairs}`;
      report['dibVsPngPixels'] = {
        pairs: pixelPairs,
        avgMatch: +(pixelMatchSum / Math.max(1, pixelPairs)).toFixed(4),
        worst: +pixelWorst.toFixed(4),
      };
    } finally {
      src.close();
      opened.cleanup();
    }

    const db = openDatabase(':memory:');
    const clips = new ClipRepository(db);
    const groups = new GroupRepository(db);
    let imagesBytes = 0;
    const res = await importDitto(
      { path: SAMPLE!, includeImages: true, includeGroups: true },
      {
        db,
        clips,
        groups,
        images: {
          encodeBitmap: (bgra, w, h) => encodePng(bgra, w, h),
          save: (id, png) => {
            imagesBytes += png.length;
            const s = pngSize(png)!;
            return { width: s.width, height: s.height, bytes: png.length, file: `${id}.png`, thumb: `${id}.png`, thumbWidth: 1, thumbHeight: 1 };
          },
        },
      },
    );
    report['import'] = {
      ok: res.ok,
      imported: res.imported,
      merged: res.merged,
      skipped: res.skipped,
      groups: res.groups,
      images: res.images,
      durationMs: res.durationMs,
      skipReasons: res.skipReasons,
      kinds: Object.fromEntries((db.prepare('SELECT kind, count(*) n FROM clips GROUP BY kind').all() as Array<{ kind: string; n: number }>).map((r) => [r.kind, r.n])),
      pinned: (db.prepare('SELECT count(*) n FROM clips WHERE pinned = 1').get() as { n: number }).n,
      withHtml: (db.prepare('SELECT count(*) n FROM clips WHERE html IS NOT NULL').get() as { n: number }).n,
      withRtf: (db.prepare('SELECT count(*) n FROM clips WHERE rtf IS NOT NULL').get() as { n: number }).n,
      imagesMB: +(imagesBytes / 1048576).toFixed(1),
    };
    console.log(`DITTO SAMPLE REPORT ${JSON.stringify(report, null, 2)}`);
    expect(res.ok).toBe(true);
  }, 600_000);
});
