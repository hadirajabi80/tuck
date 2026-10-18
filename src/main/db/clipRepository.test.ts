import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { buildFilesClip, buildImageClip, buildTextClip, clipHash, pngSize } from './clipBuilder';
import { ClipRepository, importedPinOrder } from './clipRepository';
import { openDatabase } from './connection';
import { GroupRepository } from './groupRepository';
import { searchClips } from './search';
import { SnippetRepository } from './snippetRepository';
import { currentVersion, migrate, SCHEMA_V1_SQL, SCHEMA_VERSION } from './migrations';

function setup() {
  const db = openDatabase(':memory:');
  return { db, clips: new ClipRepository(db), groups: new GroupRepository(db), snippets: new SnippetRepository(db) };
}

const fakeImage = (id: string) => ({ width: 10, height: 5, bytes: 3, file: `${id}.png`, thumb: `${id}.png`, thumbWidth: 10, thumbHeight: 5 });

describe('migrations', () => {
  it('creates the schema idempotently', () => {
    const { db } = setup();
    expect(SCHEMA_VERSION).toBe(2);
    expect(currentVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'clips_fts'").get()).toBeTruthy();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'idx_clips_pin_order'").get()).toBeTruthy();
    expect(migrate(db)).toBe(SCHEMA_VERSION); // re-running is a no-op
  });

  it('upgrades a v1 database to v2 keeping the pinned order (pinned_at DESC)', () => {
    const db = new DatabaseSync(':memory:');
    db.exec(SCHEMA_V1_SQL);
    db.exec("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '1')");
    const ins = db.prepare(
      `INSERT INTO clips (id, kind, text, preview, hash, pinned, pinned_at, created_at, updated_at) VALUES (?, 'text', ?, ?, ?, ?, ?, ?, ?)`,
    );
    ins.run('a', 'alpha', 'alpha', 'ha', 1, 100, 1, 1);
    ins.run('b', 'beta', 'beta', 'hb', 1, 300, 2, 2);
    ins.run('c', 'gamma', 'gamma', 'hc', 0, null, 3, 3);
    ins.run('d', 'delta', 'delta', 'hd', 1, 200, 4, 4);
    expect(currentVersion(db)).toBe(1);
    expect(migrate(db)).toBe(2);
    const cols = (db.prepare('PRAGMA table_info(clips)').all() as unknown as Array<{ name: string }>).map((c) => c.name);
    expect(cols).toContain('pin_order');
    const clips = new ClipRepository(db);
    expect(clips.pinnedIds()).toEqual(['b', 'd', 'a']);
    expect(clips.getSummary('c')!.pinOrder).toBeNull();
    expect(clips.getSummary('b')!.pinOrder).toBe(0);
    // FTS triggers still work after the upgrade
    expect(searchClips(db, clips, { filter: 'all', query: 'gamm', offset: 0, limit: 10 }).items.map((i) => i.id)).toEqual(['c']);
    // idempotent: running the v2 step again (e.g. meta reset) changes nothing
    db.exec("UPDATE meta SET value = '1' WHERE key = 'schema_version'");
    expect(migrate(db)).toBe(2);
    expect(clips.pinnedIds()).toEqual(['b', 'd', 'a']);
  });

  it('upgrades a v1 database file through openDatabase', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tuck-mig-'));
    const file = join(dir, 'tuck.db');
    try {
      const v1 = new DatabaseSync(file);
      v1.exec(SCHEMA_V1_SQL);
      v1.exec("INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '1')");
      v1.prepare(`INSERT INTO clips (id, kind, text, preview, hash, pinned, pinned_at, created_at, updated_at) VALUES ('x', 'text', 'x', 'x', 'hx', 1, 5, 1, 1)`).run();
      v1.close();
      const db = openDatabase(file);
      expect(currentVersion(db)).toBe(2);
      expect(new ClipRepository(db).getSummary('x')!.pinOrder).toBe(0);
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('clipBuilder', () => {
  it('derives kind, preview, meta and a family-scoped hash', () => {
    const t = buildTextClip('https://example.com/a  ', { html: '<a>x</a>' });
    expect(t.kind).toBe('link');
    expect(t.meta.url).toContain('example.com');
    expect(t.hash).toBe(clipHash('text', 'https://example.com/a  '));
    const f = buildFilesClip(['C:\\a.txt', 'C:\\b.txt']);
    expect(f.kind).toBe('files');
    expect(f.preview).toBe('C:\\a.txt');
    expect(f.meta.fileCount).toBe(2);
    expect(f.hash).not.toBe(clipHash('text', 'C:\\a.txt\nC:\\b.txt'));
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    expect(pngSize(png)).toEqual({ width: 640, height: 480 });
    expect(buildImageClip(png, 640, 480).preview).toBe('Image 640×480');
  });
});

describe('ClipRepository', () => {
  it('dedupes by hash: moves to top, bumps copyCount, keeps pin and groups', () => {
    const { clips, groups } = setup();
    const a = clips.upsert(buildTextClip('alpha'), { dedupe: true, now: 1000 });
    clips.upsert(buildTextClip('beta'), { dedupe: true, now: 2000 });
    const g = groups.create({ name: 'Work' });
    clips.setPinned(a.id, true, 1500);
    clips.setGroups(a.id, [g.id]);
    const again = clips.upsert(buildTextClip('alpha'), { dedupe: true, now: 3000 });
    expect(again).toEqual({ id: a.id, created: false });
    const s = clips.getSummary(a.id)!;
    expect(s.copyCount).toBe(2);
    expect(s.updatedAt).toBe(3000);
    expect(s.pinned).toBe(true);
    expect(s.groupIds).toEqual([g.id]);
    expect(clips.recent(1)[0]!.id).toBe(a.id);
    expect(groups.list()[0]!.clipCount).toBe(1);
  });

  it('stores duplicates when dedupe is off', () => {
    const { clips } = setup();
    clips.upsert(buildTextClip('same'), { dedupe: false });
    clips.upsert(buildTextClip('same'), { dedupe: false });
    expect(clips.count()).toBe(2);
  });

  it('stores images through the storeImage hook', () => {
    const { clips } = setup();
    const png = Buffer.from('fakepng');
    const { id } = clips.upsert(buildImageClip(png, 10, 5), { dedupe: true, storeImage: (cid) => fakeImage(cid) });
    const c = clips.get(id)!;
    expect(c.kind).toBe('image');
    expect(c.image?.file).toBe(`${id}.png`);
    expect(c.text).toBeNull();
    expect(clips.imageClipIds()).toEqual([id]);
  });

  it('edits re-derive kind/preview/hash and merge collisions', () => {
    const { clips } = setup();
    const a = clips.upsert(buildTextClip('first'), { dedupe: true, now: 1 }).id;
    const b = clips.upsert(buildTextClip('#ff0000'), { dedupe: true, now: 2 }).id;
    clips.setPinned(b, true);
    const edited = clips.updateText(a, '  const x = () => { return 1; };\nexport default x;')!;
    expect(edited.kind).toBe('code');
    expect(edited.html).toBeNull();
    const merged = clips.updateText(a, '#ff0000')!;
    expect(merged.kind).toBe('color');
    expect(merged.pinned).toBe(true);
    expect(clips.getRow(b)).toBeNull();
    expect(clips.count()).toBe(1);
  });

  it('deletes with snapshots and restores them (undo)', () => {
    const { db, clips, groups } = setup();
    const g = groups.create({ name: 'G' });
    const id = clips.upsert(buildTextClip('to delete'), { dedupe: true }).id;
    clips.setGroups(id, [g.id]);
    const snaps = clips.delete([id, 'missing']);
    expect(snaps).toHaveLength(1);
    expect(clips.count()).toBe(0);
    const { restored } = clips.restore(snaps);
    expect(restored).toEqual([id]);
    expect(clips.getSummary(id)!.groupIds).toEqual([g.id]);
    // FTS stays consistent after delete + restore
    expect(searchClips(db, clips, { filter: 'all', query: 'delete', offset: 0, limit: 10 }).total).toBe(1);
  });

  it('applies retention to unpinned clips only', () => {
    const { clips } = setup();
    const now = 100 * 86_400_000;
    for (let i = 0; i < 10; i++) clips.upsert(buildTextClip(`clip ${i}`), { dedupe: true, now: now - (10 - i) * 1000 });
    const old = clips.upsert(buildTextClip('ancient'), { dedupe: true, now: now - 50 * 86_400_000 }).id;
    const pinnedOld = clips.upsert(buildTextClip('ancient pinned'), { dedupe: true, now: now - 60 * 86_400_000 }).id;
    clips.setPinned(pinnedOld, true);
    const ids = clips.retentionCandidates(8, 30, now);
    expect(ids).toContain(old);
    expect(ids).not.toContain(pinnedOld);
    expect(ids.length).toBe(3); // 11 unpinned, keep 8 → 3 (incl. 'ancient')
    clips.deleteHard(ids);
    expect(clips.count()).toBe(9);
  });

  it('clears unpinned or everything', () => {
    const { clips } = setup();
    const a = clips.upsert(buildTextClip('a'), { dedupe: true }).id;
    clips.upsert(buildTextClip('b'), { dedupe: true });
    clips.setPinned(a, true);
    expect(clips.clear(false).ids).toHaveLength(1);
    expect(clips.count()).toBe(1);
    expect(clips.clear(true).ids).toEqual([a]);
  });

  it('markPasted moves to top when asked', () => {
    const { clips } = setup();
    const a = clips.upsert(buildTextClip('a'), { dedupe: true, now: 1 }).id;
    clips.upsert(buildTextClip('b'), { dedupe: true, now: 2 });
    clips.markPasted([a], true, 10);
    expect(clips.recent(1)[0]!.id).toBe(a);
    expect(clips.getSummary(a)!.lastPastedAt).toBe(10);
  });
});

describe('pin order', () => {
  function pins(n: number) {
    const s = setup();
    const ids = Array.from({ length: n }, (_, i) => s.clips.upsert(buildTextClip(`clip ${i}`), { dedupe: true, now: 1000 + i }).id);
    return { ...s, ids };
  }
  const pinnedList = (s: ReturnType<typeof pins>, query = '') =>
    searchClips(s.db, s.clips, { filter: 'pinned', query, offset: 0, limit: 500 }).items.map((i) => i.id);

  it('pins go to the top, unpinning clears the order', () => {
    const s = pins(4);
    const [a, b, c] = s.ids as [string, string, string];
    s.clips.setPinned(a, true, 10);
    s.clips.setPinned(b, true, 5); // older timestamp, but pinned later → on top
    s.clips.setPinned(c, true, 7);
    expect(pinnedList(s)).toEqual([c, b, a]);
    expect(s.clips.setPinned(c, false)!.pinOrder).toBeNull();
    expect(s.clips.getRow(c)!.pin_order).toBeNull();
    expect(pinnedList(s)).toEqual([b, a]);
    // pinning an already pinned clip keeps its place
    s.clips.setPinned(a, true, 99);
    expect(pinnedList(s)).toEqual([b, a]);
    s.clips.setPinned(c, true);
    expect(pinnedList(s)).toEqual([c, b, a]);
  });

  it('reorders pins and keeps that order in searches and the All view', () => {
    const s = pins(4);
    const [a, b, c, d] = s.ids as [string, string, string, string];
    for (const id of [a, b, c]) s.clips.setPinned(id, true);
    expect(s.clips.reorderPinned([a, c, b])).toEqual([a, c, b]);
    expect(pinnedList(s)).toEqual([a, c, b]);
    expect(pinnedList(s, 'clip')).toEqual([a, c, b]); // FTS query keeps pin order
    expect(pinnedList(s, 'p')).toEqual([a, c, b]); // LIKE query too
    // the All view's unpinned part is unaffected
    expect(searchClips(s.db, s.clips, { filter: 'all', query: '', offset: 0, limit: 50, excludePinned: true }).items.map((i) => i.id)).toEqual([d]);
    // a new pin still lands on top of a reordered list
    s.clips.setPinned(d, true);
    expect(pinnedList(s)).toEqual([d, a, c, b]);
  });

  it('pins unpinned ids passed to reorderPinned at their position; ignores unknown and duplicate ids', () => {
    const s = pins(3);
    const [a, b, c] = s.ids as [string, string, string];
    s.clips.setPinned(a, true);
    s.clips.setPinned(b, true); // [b, a]
    expect(s.clips.reorderPinned([b, c, 'nope', c, a], 5000)).toEqual([b, c, a]);
    const sc = s.clips.getSummary(c)!;
    expect(sc.pinned).toBe(true);
    expect(sc.pinnedAt).toBe(5000);
    expect(pinnedList(s)).toEqual([b, c, a]);
  });

  it('works with more pins than the renderer loaded: unlisted pins follow in their old order', () => {
    const s = pins(60);
    for (const id of s.ids) s.clips.setPinned(id, true);
    const before = s.clips.pinnedIds();
    expect(before.length).toBe(60);
    const page = before.slice(0, 50);
    const moved = [page[49]!, ...page.slice(0, 49)]; // drag the 50th visible pin to the top
    const after = s.clips.reorderPinned(moved);
    expect(after).toEqual([...moved, ...before.slice(50)]);
    expect(s.clips.pinnedIds()).toEqual(after);
    // only a subset → the subset goes first, the rest keep their relative order
    expect(s.clips.reorderPinned([before[59]!])).toEqual([before[59]!, ...after.filter((id) => id !== before[59])]);
  });

  it('settles unordered pins (imports) above the existing ones, newest pin first', () => {
    const s = pins(4);
    const [a, b, c, d] = s.ids as [string, string, string, string];
    s.clips.setPinned(a, true);
    s.clips.setPinned(b, true); // [b, a]
    expect(s.clips.mergePinned(c, 100)).toBe(true);
    expect(s.clips.mergePinned(d, 200)).toBe(true);
    expect(s.clips.mergePinned(d, 300)).toBe(false); // already pinned
    expect(pinnedList(s)).toEqual([d, c, b, a]); // NULL order sorts on top even before settling
    expect(s.clips.settlePinOrder()).toBe(2);
    expect(s.clips.settlePinOrder()).toBe(0);
    expect(pinnedList(s)).toEqual([d, c, b, a]);
    expect(s.clips.getSummary(d)!.pinOrder).not.toBeNull();
  });

  it('inserted pins without an order sort on top; undo restores the old position', () => {
    const s = pins(2);
    const [a, b] = s.ids as [string, string];
    s.clips.setPinned(a, true);
    s.clips.setPinned(b, true); // [b, a]
    const x = s.clips.insert(buildTextClip('imported'), { pinned: true, pinnedAt: 1 });
    expect(pinnedList(s)).toEqual([x, b, a]);
    s.clips.settlePinOrder();
    const snaps = s.clips.delete([b]);
    expect(pinnedList(s)).toEqual([x, a]);
    s.clips.restore(snaps);
    expect(pinnedList(s)).toEqual([x, b, a]);
  });

  it('an edit that merges into a pinned clip takes over its place', () => {
    const s = pins(3);
    const [a, b, c] = s.ids as [string, string, string];
    s.clips.setPinned(a, true);
    s.clips.setPinned(b, true);
    s.clips.reorderPinned([a, b]);
    s.clips.updateText(c, 'clip 0'); // collides with a
    expect(pinnedList(s)).toEqual([c, b]);
  });

  it('orders imported pins by source pin order, then newest pin', () => {
    expect(importedPinOrder([
      { id: 'old1', pinOrder: null, pinnedAt: 10 },
      { id: 'p2', pinOrder: 2, pinnedAt: 0 },
      { id: 'old2', pinOrder: null, pinnedAt: 20 },
      { id: 'p0', pinOrder: -1, pinnedAt: 0 },
    ])).toEqual(['p0', 'p2', 'old2', 'old1']);
  });
});

describe('searchClips', () => {
  function seeded() {
    const s = setup();
    const t = (text: string, now: number) => s.clips.upsert(buildTextClip(text), { dedupe: true, now }).id;
    const ids = {
      hello: t('Hello clipboard world', 1),
      link: t('https://github.com/tuck/app', 2),
      color: t('#5B5BD6', 3),
      code: t('function add(a, b) {\n  return a + b;\n}\nconsole.log(add(1, 2));', 4),
      percent: t('100% done_now', 5),
      getfw: t('GetForegroundWindow returns HWND', 6),
    };
    const img = s.clips.upsert(buildImageClip(Buffer.from('png'), 4, 4), { dedupe: true, now: 7, storeImage: fakeImage }).id;
    return { ...s, ids, img };
  }

  it('filters by kind and pinned, ordered by recency', () => {
    const { db, clips, ids, img } = seeded();
    const q = (filter: Parameters<typeof searchClips>[2]['filter']) => searchClips(db, clips, { filter, query: '', offset: 0, limit: 50 });
    expect(q('all').total).toBe(7);
    expect(q('all').items[0]!.id).toBe(img);
    expect(q('images').items.map((i) => i.id)).toEqual([img]);
    expect(q('links').items.map((i) => i.id)).toEqual([ids.link]);
    expect(q('colors').items.map((i) => i.id)).toEqual([ids.color]);
    expect(q('code').items.map((i) => i.id)).toEqual([ids.code]);
    expect(q('text').total).toBe(6);
    clips.setPinned(ids.hello, true, 100);
    clips.setPinned(ids.link, true, 50);
    // newest pin action on top (pin order, not pinned_at)
    expect(q('pinned').items.map((i) => i.id)).toEqual([ids.link, ids.hello]);
    expect(searchClips(db, clips, { filter: 'all', query: '', offset: 0, limit: 50, excludePinned: true }).total).toBe(5);
  });

  it('FTS trigram substring search (case-insensitive), multi-term AND', () => {
    const { db, clips, ids } = seeded();
    const s = (query: string) => searchClips(db, clips, { filter: 'all', query, offset: 0, limit: 50 });
    expect(s('lipbo').items.map((i) => i.id)).toEqual([ids.hello]);
    expect(s('CLIPBOARD').items.map((i) => i.id)).toEqual([ids.hello]);
    expect(s('hello world').items.map((i) => i.id)).toEqual([ids.hello]);
    expect(s('github tuck').items.map((i) => i.id)).toEqual([ids.link]);
    expect(s('"quoted').total).toBe(0);
  });

  it('LIKE for short terms with escaping', () => {
    const { db, clips, ids } = seeded();
    const s = (query: string) => searchClips(db, clips, { filter: 'all', query, offset: 0, limit: 50 });
    expect(s('%').items.map((i) => i.id)).toEqual([ids.percent]);
    expect(s('_n').items.map((i) => i.id)).toEqual([ids.percent]);
    expect(s('5B').items.map((i) => i.id)).toEqual([ids.color]);
  });

  it('fuzzy subsequence fallback appends non-exact matches', () => {
    const { db, clips, ids } = seeded();
    const res = searchClips(db, clips, { filter: 'all', query: 'gfwin', offset: 0, limit: 50 });
    expect(res.items.map((i) => i.id)).toContain(ids.getfw);
    expect(res.total).toBe(res.items.length);
  });

  it('pages with offset/limit and reports the total', () => {
    const { db, clips } = seeded();
    const p1 = searchClips(db, clips, { filter: 'all', query: '', offset: 0, limit: 3 });
    const p2 = searchClips(db, clips, { filter: 'all', query: '', offset: 3, limit: 3 });
    expect(p1.total).toBe(7);
    expect(p1.items).toHaveLength(3);
    expect(p2.offset).toBe(3);
    expect(new Set([...p1.items, ...p2.items].map((i) => i.id)).size).toBe(6);
  });

  it('filters by group', () => {
    const { db, clips, groups, ids } = seeded();
    const g = groups.create({ name: 'Links', color: 'blue' });
    clips.setGroups(ids.link, [g.id]);
    const res = searchClips(db, clips, { filter: 'all', groupId: g.id, query: '', offset: 0, limit: 50 });
    expect(res.items.map((i) => i.id)).toEqual([ids.link]);
    expect(res.items[0]!.groupIds).toEqual([g.id]);
  });
});

describe('Group/Snippet repositories', () => {
  it('creates, renames, reorders, deletes groups (membership cascades)', () => {
    const { clips, groups } = setup();
    const a = groups.create({ name: '  Alpha  ', color: 'red', icon: 'star' });
    const b = groups.create({ name: 'Beta', color: 'nope' as never });
    expect(a.name).toBe('Alpha');
    expect(b.color).toBeNull();
    expect(groups.ensure('alpha').created).toBe(false);
    expect(groups.reorder([b.id, a.id]).map((g) => g.id)).toEqual([b.id, a.id]);
    expect(groups.update(a.id, { name: 'A2' }).name).toBe('A2');
    const id = clips.upsert(buildTextClip('x'), { dedupe: true }).id;
    clips.setGroups(id, [a.id, b.id, 'bogus']);
    expect(clips.getSummary(id)!.groupIds.sort()).toEqual([a.id, b.id].sort());
    expect(groups.delete(a.id)).toBe(true);
    expect(clips.getSummary(id)!.groupIds).toEqual([b.id]);
    expect(() => groups.create({ name: '   ' })).toThrow();
  });

  it('snippets CRUD + search', () => {
    const { snippets } = setup();
    const s = snippets.create({ title: 'Sig', body: 'Best,\nMe', keyword: ';sig' });
    snippets.create({ title: '', body: 'Address line\nCity' });
    expect(snippets.list().length).toBe(2);
    expect(snippets.list('city')[0]!.title).toBe('Address line');
    expect(snippets.update(s.id, { body: 'Cheers' }).body).toBe('Cheers');
    snippets.markUsed(s.id);
    expect(snippets.get(s.id)!.usageCount).toBe(1);
    expect(snippets.exists('Sig', 'Cheers')).toBe(true);
    expect(snippets.delete(s.id)).toBe(true);
    expect(() => snippets.create({ title: 't', body: '' })).toThrow();
  });
});
