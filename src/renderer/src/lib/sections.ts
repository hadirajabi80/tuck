// Builds the flat row model for the popup list: sticky section headers + clip/snippet rows. Pure — unit-tested.
import type { ClipSummary, FilterId, Snippet } from '@shared/types';
import { SECTION_LABELS, dateSection, type DateSection } from './format';

export type SectionKey = DateSection | 'pinned' | 'results';

export type ListRow =
  | { type: 'header'; key: SectionKey; label: string; id: string }
  | { type: 'clip'; id: string; clip: ClipSummary; section: SectionKey }
  | { type: 'snippet'; id: string; snippet: Snippet };

export interface BuildRowsInput {
  filter: FilterId;
  query: string;
  pinned: ClipSummary[];
  items: ClipSummary[];
  snippets: Snippet[];
  now?: number;
}

function header(key: SectionKey): ListRow {
  return { type: 'header', key, label: SECTION_LABELS[key], id: `section-${key}` };
}

/**
 * Rules (DESIGN.md §E):
 * - Snippets filter: snippet rows, no headers.
 * - Pinned filter: pinned rows, no headers (everything is pinned).
 * - All filter: "Pinned" section first (pinned list), then the rest.
 * - Without a query the rest is bucketed into Today / Yesterday / This week / Earlier (input is sorted by updatedAt desc).
 * - With a query the order is relevance, so the rest goes under a single "Results" header (only when a Pinned section exists).
 */
export function buildRows({ filter, query, pinned, items, snippets, now = Date.now() }: BuildRowsInput): ListRow[] {
  if (filter === 'snippets') return snippets.map((s) => ({ type: 'snippet', id: s.id, snippet: s }));
  if (filter === 'pinned') return items.map((c) => ({ type: 'clip', id: c.id, clip: c, section: 'pinned' }));

  const rows: ListRow[] = [];
  const showPinned = filter === 'all' && pinned.length > 0;
  if (showPinned) {
    rows.push(header('pinned'));
    for (const c of pinned) rows.push({ type: 'clip', id: c.id, clip: c, section: 'pinned' });
  }
  const pinnedIds = showPinned ? new Set(pinned.map((c) => c.id)) : null;
  const rest = pinnedIds ? items.filter((c) => !pinnedIds.has(c.id)) : items;

  if (query.trim()) {
    if (showPinned && rest.length) rows.push(header('results'));
    for (const c of rest) rows.push({ type: 'clip', id: c.id, clip: c, section: 'results' });
    return rows;
  }

  let current: SectionKey | null = null;
  for (const c of rest) {
    const s = dateSection(c.updatedAt, now);
    if (s !== current) {
      rows.push(header(s));
      current = s;
    }
    rows.push({ type: 'clip', id: c.id, clip: c, section: s });
  }
  return rows;
}

/** Ids of selectable rows in display order. */
export function selectableIds(rows: ListRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) if (r.type !== 'header') out.push(r.id);
  return out;
}

/** Moves within `ids` from `current` by `delta`, clamped. Missing current → first (or last for negative delta). */
export function moveId(ids: string[], current: string | null, delta: number): string | null {
  if (!ids.length) return null;
  const i = current ? ids.indexOf(current) : -1;
  if (i === -1) return delta < 0 ? ids[ids.length - 1]! : ids[0]!;
  const next = Math.min(ids.length - 1, Math.max(0, i + delta));
  return ids[next]!;
}

/** Inclusive id range between two ids in display order (order preserved). */
export function rangeIds(ids: string[], a: string, b: string): string[] {
  const i = ids.indexOf(a);
  const j = ids.indexOf(b);
  if (i === -1 || j === -1) return [b];
  const [lo, hi] = i <= j ? [i, j] : [j, i];
  return ids.slice(lo, hi + 1);
}
