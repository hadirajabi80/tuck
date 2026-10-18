import { describe, expect, it } from 'vitest';
import { parseDropFiles } from '../data/dittoFormats';
import { UndoRing } from '../maintenance/undoRing';
import { buildDropFiles, buildFilenamesPlist, parseFilenamesPlist } from './fileLists';

describe('file list payloads', () => {
  it('round-trips NSFilenamesPboardType plists with XML escaping', () => {
    const files = ['/Users/me/a & b.txt', '/tmp/<x>"quote"\'s.png'];
    expect(parseFilenamesPlist(buildFilenamesPlist(files))).toEqual(files);
  });
  it('round-trips DROPFILES', () => {
    const files = ['C:\\one.txt', 'D:\\dir with space\\ü.png'];
    expect(parseDropFiles(buildDropFiles(files))).toEqual(files);
  });
});

describe('UndoRing', () => {
  it('pops the latest batch inside the window and expires old ones', () => {
    let now = 0;
    const expired: string[] = [];
    const snap = (id: string) => ({ row: { id } as never, groupIds: [] });
    const ring = new UndoRing((s) => expired.push(...s.map((x) => (x.row as { id: string }).id)), 2, 1000, () => now);
    ring.push([snap('a')]);
    now = 100;
    ring.push([snap('b')]);
    now = 500;
    ring.push([snap('c')]); // overflows → 'a' expires
    expect(expired).toEqual(['a']);
    now = 1150; // 'b' (t=100) is now older than 1000 ms
    expect(ring.pop()!.map((s) => (s.row as { id: string }).id)).toEqual(['c']);
    expect(expired).toEqual(['a', 'b']);
    expect(ring.pop()).toBeNull();
    ring.flush();
  });
});
