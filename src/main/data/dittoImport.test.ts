import { mkdtempSync as mkdtempRaw, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { zipSync } from 'fflate';
import { afterAll, describe, expect, it } from 'vitest';
import { ClipRepository } from '../db/clipRepository';
import { openDatabase } from '../db/connection';
import { GroupRepository } from '../db/groupRepository';
import { searchClips } from '../db/search';
import { importDitto, inspectDitto, type ImageSink } from './dittoImport';
import { openSqliteSource, sniff } from './sqliteOpen';

const dirs: string[] = [];
const mkdtempSync = (prefix: string): string => {
  const d = mkdtempRaw(prefix);
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const utf16 = (s: string) => Buffer.from(`${s}\0`, 'utf16le');
const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c63f8cfc0f01f0005000201' + 'b1c8e3d70000000049454e44ae426082',
  'hex',
);

function dib24(w: number, h: number): Buffer {
  const head = Buffer.alloc(40);
  head.writeUInt32LE(40, 0);
  head.writeInt32LE(w, 4);
  head.writeInt32LE(h, 8);
  head.writeUInt16LE(1, 12);
  head.writeUInt16LE(24, 14);
  const stride = Math.floor((w * 24 + 31) / 32) * 4;
  return Buffer.concat([head, Buffer.alloc(stride * h, 0x7f)]);
}

function dropFiles(files: string[]): Buffer {
  const head = Buffer.alloc(20);
  head.writeUInt32LE(20, 0);
  head.writeUInt32LE(1, 16);
  return Buffer.concat([head, Buffer.from(`${files.join('\0')}\0\0`, 'utf16le')]);
}

/** Builds a small Ditto-shaped database. `legacy` drops optional Main columns like old Ditto versions. */
function makeDittoDb(file: string, legacy = false): void {
  const db = new DatabaseSync(file);
  db.exec(
    legacy
      ? 'CREATE TABLE Main (lID INTEGER PRIMARY KEY, lDate INTEGER, mText TEXT, lDontAutoDelete INTEGER, bIsGroup INTEGER, lParentID INTEGER)'
      : `CREATE TABLE Main (lID INTEGER PRIMARY KEY, lDate INTEGER, mText TEXT, lShortCut INTEGER, lDontAutoDelete INTEGER, CRC INTEGER,
          bIsGroup INTEGER, lParentID INTEGER, QuickPasteText TEXT, clipOrder REAL, clipGroupOrder REAL, globalShortCut INTEGER,
          lastPasteDate INTEGER, stickyClipOrder REAL)`,
  );
  db.exec('CREATE TABLE Data (lID INTEGER PRIMARY KEY, lParentID INTEGER, strClipBoardFormat TEXT, ooData BLOB)');
  const main = legacy
    ? db.prepare('INSERT INTO Main (lID, lDate, mText, lDontAutoDelete, bIsGroup, lParentID) VALUES (?, ?, ?, ?, ?, ?)')
    : db.prepare('INSERT INTO Main (lID, lDate, mText, lDontAutoDelete, bIsGroup, lParentID, lastPasteDate, stickyClipOrder) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const data = db.prepare('INSERT INTO Data (lParentID, strClipBoardFormat, ooData) VALUES (?, ?, ?)');
  const m = (id: number, date: number, text: string, dad: number, group: number, parent: number, lastPaste = 0, sticky = -2147483647) =>
    legacy ? main.run(id, date, text, dad, group, parent) : main.run(id, date, text, dad, group, parent, lastPaste, sticky);

  m(1, 0, 'Snippets', 0, 1, -1); // group
  m(2, 1_700_000_000, 'hello', 0, 0, 1, 1_700_000_100); // text in group, pasted
  data.run(2, 'CF_UNICODETEXT', utf16('hello ditto'));
  data.run(2, 'CF_TEXT', Buffer.from('hello ditto\0'));
  data.run(2, 'HTML Format', Buffer.from('Version:0.9\r\n<html><body><!--StartFragment--><b>hello</b> ditto<!--EndFragment--></body></html>'));
  data.run(2, 'Rich Text Format', Buffer.from('{\\rtf1 hello ditto}\0'));
  m(3, 1_700_000_010, 'ansi', 1, 0, -1); // CF_TEXT only, lDontAutoDelete → pinned
  data.run(3, 'CF_TEXT', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0]));
  m(4, 1_700_000_020, 'files', 0, 0, -1, 0, 2); // sticky → pinned
  data.run(4, 'CF_HDROP', dropFiles(['C:\\x\\a.txt', 'C:\\x\\b.txt']));
  data.run(4, 'CF_UNICODETEXT', utf16('C:\\x\\a.txt'));
  m(5, 1_700_000_030, 'png', 0, 0, -1);
  data.run(5, 'PNG', PNG_1x1);
  data.run(5, 'CF_DIB', dib24(1, 1));
  m(6, 1_700_000_040, 'dib', 0, 0, -1);
  data.run(6, 'CF_DIB', dib24(3, 2));
  m(7, 1_700_000_050, 'dup', 0, 0, -1); // duplicate of 2 → merged
  data.run(7, 'CF_UNICODETEXT', utf16('hello ditto'));
  m(8, 1_700_000_060, 'empty', 0, 0, -1); // no data → skipped
  m(9, 1_700_000_070, 'weird', 0, 0, -1); // undecodable only → skipped
  data.run(9, 'Some Custom Format', Buffer.from([1, 2, 3]));
  db.close();
}

const sink = (): ImageSink & { saved: string[] } => {
  const saved: string[] = [];
  return {
    saved,
    encodeBitmap: (bgra, w, h) => Buffer.concat([PNG_1x1.subarray(0, 16), Buffer.from([0, 0, 0, w, 0, 0, 0, h]), bgra.subarray(0, 4)]),
    save: (id, png) => {
      saved.push(id);
      return { width: 1, height: 1, bytes: png.length, file: `${id}.png`, thumb: `${id}.png`, thumbWidth: 1, thumbHeight: 1 };
    },
  };
};

function tuck() {
  const db = openDatabase(':memory:');
  return { db, clips: new ClipRepository(db), groups: new GroupRepository(db) };
}

describe('sqliteOpen', () => {
  it('sniffs SQLite, gzip and zip and decompresses archives to a temp file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuck-sqlite-'));
    const plain = join(dir, 'Ditto.db');
    makeDittoDb(plain);
    const raw = readFileSync(plain);
    writeFileSync(join(dir, 'Ditto.zdb'), gzipSync(raw));
    writeFileSync(join(dir, 'backup.zip'), zipSync({ 'readme.txt': Buffer.from('hi'), 'Ditto.db': raw }));
    writeFileSync(join(dir, 'nope.bin'), Buffer.from('definitely not sqlite'));
    expect(sniff(raw.subarray(0, 16))).toBe('sqlite');

    for (const [name, kind] of [['Ditto.db', 'sqlite'], ['Ditto.zdb', 'gzip'], ['backup.zip', 'zip']] as const) {
      const o = await openSqliteSource(join(dir, name));
      expect(o.kind).toBe(kind);
      expect(readFileSync(o.path).equals(raw)).toBe(true);
      o.cleanup();
      if (o.temp) expect(() => readFileSync(o.temp!)).toThrow();
    }
    await expect(openSqliteSource(join(dir, 'nope.bin'))).rejects.toMatchObject({ code: 'unrecognized' });
    const inspect = await inspectDitto(join(dir, 'nope.bin'));
    expect(inspect).toMatchObject({ ok: false, error: 'unrecognized' });
  });
});

describe('importDitto', () => {
  it('inspects counts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuck-ditto-'));
    const file = join(dir, 'Ditto.db');
    makeDittoDb(file);
    expect(await inspectDitto(file)).toEqual({ ok: true, path: file, clips: 8, groups: 1, pinned: 2 });
  });

  it('imports text/html/rtf, ANSI, files, PNG, DIB with groups, pins, dedupe and skips', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuck-ditto-'));
    const file = join(dir, 'Ditto.zdb');
    makeDittoDb(join(dir, 'raw.db'));
    writeFileSync(file, gzipSync(readFileSync(join(dir, 'raw.db'))));
    const t = tuck();
    // Pre-existing Tuck clip identical to a Ditto clip → merged, gets the group.
    const progress: number[] = [];
    const images = sink();
    const res = await importDitto(
      { path: file, includeImages: true, includeGroups: true },
      { ...t, images, onProgress: (done) => progress.push(done) },
    );
    expect(res).toMatchObject({ ok: true, imported: 5, merged: 1, skipped: 2, groups: 1, images: 2 });
    expect(progress.at(-1)).toBe(8);
    expect(images.saved).toHaveLength(2);

    const all = searchClips(t.db, t.clips, { filter: 'all', query: '', offset: 0, limit: 50 }).items;
    const byPreview = (p: string) => all.find((c) => c.preview.startsWith(p))!;
    const hello = t.clips.get(byPreview('hello ditto').id)!;
    expect(hello.html).toBe('<b>hello</b> ditto');
    expect(hello.rtf).toBe('{\\rtf1 hello ditto}');
    expect(hello.createdAt).toBe(1_700_000_000_000);
    expect(hello.lastPastedAt).toBe(1_700_000_100_000);
    expect(hello.groupIds).toEqual([t.groups.list()[0]!.id]);
    expect(t.groups.list()[0]!.name).toBe('Snippets');
    expect(byPreview('café').pinned).toBe(true);
    const files = byPreview('C:\\x\\a.txt');
    expect(files.kind).toBe('files');
    expect(files.files).toEqual(['C:\\x\\a.txt', 'C:\\x\\b.txt']);
    expect(files.pinned).toBe(true);
    expect(all.filter((c) => c.kind === 'image').map((c) => c.preview).sort()).toEqual(['Image 1×1', 'Image 3×2']);

    // Re-import: everything merges, nothing new.
    const again = await importDitto({ path: file, includeImages: true, includeGroups: true }, { ...t, images: sink() });
    expect(again).toMatchObject({ ok: true, imported: 0, merged: 6, groups: 1 });
  });

  it('handles legacy schemas and excluded images/groups', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuck-ditto-'));
    const file = join(dir, 'old.db');
    makeDittoDb(file, true);
    const t = tuck();
    const res = await importDitto({ path: file, includeImages: false, includeGroups: false }, { ...t, images: null });
    expect(res).toMatchObject({ ok: true, imported: 3, merged: 1, groups: 0, images: 0 });
    expect(res.skipReasons['image-excluded']).toBe(2);
    expect(t.groups.list()).toHaveLength(0);
  });

  it('reports not-ditto for unrelated SQLite files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuck-ditto-'));
    const file = join(dir, 'other.db');
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE foo (x)');
    db.close();
    const t = tuck();
    const res = await importDitto({ path: file, includeImages: true, includeGroups: true }, { ...t, images: sink() });
    expect(res).toMatchObject({ ok: false, error: 'not-ditto' });
  });
});
