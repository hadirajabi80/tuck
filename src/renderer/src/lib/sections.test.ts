import { describe, expect, it } from 'vitest';
import type { ClipSummary, Snippet } from '@shared/types';
import { buildRows, moveId, rangeIds, selectableIds } from './sections';

const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime();
const HOUR = 3_600_000;

function clip(id: string, updatedAt: number, pinned = false): ClipSummary {
  return {
    id, kind: 'text', preview: id, hasHtml: false, hasRtf: false, image: null, files: null, byteSize: 1, sourceApp: null,
    pinned, pinnedAt: pinned ? updatedAt : null, pinOrder: null, copyCount: 1, createdAt: updatedAt, updatedAt, lastPastedAt: null, groupIds: [], meta: {},
  };
}

const snippet = (id: string): Snippet => ({ id, title: id, body: id, keyword: null, groupId: null, sortOrder: 0, usageCount: 0, createdAt: 0, updatedAt: 0 });

describe('buildRows', () => {
  const items = [clip('a', NOW - HOUR), clip('b', NOW - 2 * HOUR), clip('c', NOW - 24 * HOUR), clip('d', NOW - 3 * 24 * HOUR), clip('e', NOW - 30 * 24 * HOUR)];

  it('groups the All filter into Pinned / Today / Yesterday / This week / Earlier', () => {
    const rows = buildRows({ filter: 'all', query: '', pinned: [clip('p', NOW - 5 * HOUR, true)], items, snippets: [], now: NOW });
    expect(rows.map((r) => (r.type === 'header' ? `#${r.label}` : r.id))).toEqual([
      '#Pinned', 'p', '#Today', 'a', 'b', '#Yesterday', 'c', '#This week', 'd', '#Earlier', 'e',
    ]);
  });

  it('drops pinned rows that also appear in the main list', () => {
    const rows = buildRows({ filter: 'all', query: '', pinned: [clip('a', NOW - HOUR, true)], items, snippets: [], now: NOW });
    expect(selectableIds(rows).filter((id) => id === 'a')).toHaveLength(1);
  });

  it('uses a single Results section while searching', () => {
    const rows = buildRows({ filter: 'all', query: 'x', pinned: [clip('p', NOW, true)], items, snippets: [], now: NOW });
    expect(rows.filter((r) => r.type === 'header').map((r) => r.type === 'header' && r.label)).toEqual(['Pinned', 'Results']);
  });

  it('has no Pinned header outside the All filter', () => {
    const rows = buildRows({ filter: 'text', query: '', pinned: [clip('p', NOW, true)], items, snippets: [], now: NOW });
    expect(rows.some((r) => r.type === 'header' && r.key === 'pinned')).toBe(false);
  });

  it('renders the pinned filter and snippets without headers', () => {
    expect(buildRows({ filter: 'pinned', query: '', pinned: [], items: [clip('p', NOW, true)], snippets: [], now: NOW }).map((r) => r.type)).toEqual(['clip']);
    expect(buildRows({ filter: 'snippets', query: '', pinned: [], items: [], snippets: [snippet('s1'), snippet('s2')], now: NOW }).map((r) => r.id)).toEqual(['s1', 's2']);
  });
});

describe('selection helpers', () => {
  const ids = ['a', 'b', 'c', 'd'];
  it('moveId clamps and handles a missing selection', () => {
    expect(moveId(ids, 'b', 1)).toBe('c');
    expect(moveId(ids, 'd', 10)).toBe('d');
    expect(moveId(ids, 'a', -1)).toBe('a');
    expect(moveId(ids, null, 1)).toBe('a');
    expect(moveId(ids, 'zz', -1)).toBe('d');
    expect(moveId([], 'a', 1)).toBeNull();
  });
  it('rangeIds is inclusive in either direction', () => {
    expect(rangeIds(ids, 'b', 'd')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(ids, 'd', 'b')).toEqual(['b', 'c', 'd']);
    expect(rangeIds(ids, 'x', 'c')).toEqual(['c']);
  });
});
