// clips:list — filters, FTS5 trigram substring search (terms >= 3 chars), LIKE for shorter terms,
// fuzzy subsequence fallback over recent previews, paging and total.
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { subsequenceScore } from '../../shared/detect';
import type { ClipFilterId, ClipPage, ClipQuery } from '../../shared/types';
import { PIN_ORDER_SQL, SUMMARY_COLS, type ClipRepository } from './clipRepository';

const FUZZY_SCAN = 2000;

function filterClause(filter: ClipFilterId): string | null {
  switch (filter) {
    case 'pinned':
      return 'c.pinned = 1';
    case 'text':
      return "c.kind IN ('text','link','color','code')";
    case 'images':
      return "c.kind = 'image'";
    case 'links':
      return "c.kind = 'link'";
    case 'files':
      return "c.kind = 'files'";
    case 'colors':
      return "c.kind = 'color'";
    case 'code':
      return "c.kind = 'code'";
    default:
      return null;
  }
}

export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`;
}

/** Base WHERE (filter, excludePinned, group) shared by the exact and fuzzy passes. */
function baseWhere(q: ClipQuery): { where: string[]; params: SQLInputValue[] } {
  const where: string[] = [];
  const params: SQLInputValue[] = [];
  const f = filterClause(q.filter);
  if (f) where.push(f);
  if (q.excludePinned) where.push('c.pinned = 0');
  if (q.groupId) {
    where.push('EXISTS (SELECT 1 FROM clip_groups g WHERE g.clip_id = c.id AND g.group_id = ?)');
    params.push(q.groupId);
  }
  return { where, params };
}

export function searchClips(db: DatabaseSync, repo: ClipRepository, query: ClipQuery): ClipPage {
  const limit = Math.min(500, Math.max(1, Math.floor(query.limit || 100)));
  const offset = Math.max(0, Math.floor(query.offset || 0));
  const q = (query.query ?? '').trim();
  // Pinned lists keep the user's pin order even while searching (the popup shows them as their own section).
  const order = query.filter === 'pinned' ? PIN_ORDER_SQL : 'c.updated_at DESC';

  const { where, params } = baseWhere(query);
  let join = '';
  const terms = q ? q.split(/\s+/).filter(Boolean) : [];
  const ftsTerms = terms.filter((t) => [...t].length >= 3);
  const likeTerms = terms.filter((t) => [...t].length < 3);
  const textParams: SQLInputValue[] = [];
  const textWhere: string[] = [];
  if (ftsTerms.length) {
    join = 'JOIN clips_fts f ON f.rowid = c.rowid';
    textWhere.push('clips_fts MATCH ?');
    textParams.push(ftsTerms.map(ftsPhrase).join(' '));
  }
  for (const t of likeTerms) {
    textWhere.push("coalesce(c.text, c.preview) LIKE ? ESCAPE '\\'");
    textParams.push(`%${escapeLike(t)}%`);
  }

  const allWhere = [...where, ...textWhere];
  const whereSql = allWhere.length ? `WHERE ${allWhere.join(' AND ')}` : '';
  const allParams = [...params, ...textParams];

  let total: number;
  let rows: unknown[];
  try {
    total = (db.prepare(`SELECT count(*) AS n FROM clips c ${join} ${whereSql}`).get(...allParams) as { n: number }).n;
    rows = db
      .prepare(`SELECT ${SUMMARY_COLS} FROM clips c ${join} ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...allParams, limit, offset);
  } catch {
    // A malformed FTS expression should never surface as an error — fall back to LIKE for everything.
    const likeWhere = [...where, ...terms.map(() => "coalesce(c.text, c.preview) LIKE ? ESCAPE '\\'")];
    const likeParams = [...params, ...terms.map((t) => `%${escapeLike(t)}%`)];
    const ws = likeWhere.length ? `WHERE ${likeWhere.join(' AND ')}` : '';
    total = (db.prepare(`SELECT count(*) AS n FROM clips c ${ws}`).get(...likeParams) as { n: number }).n;
    rows = db.prepare(`SELECT ${SUMMARY_COLS} FROM clips c ${ws} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...likeParams, limit, offset);
  }
  const items = repo.mapRows(rows as Parameters<ClipRepository['mapRows']>[0]);

  // Fuzzy fallback: only for single-term queries whose exact matches all fit on the first page.
  if (q && terms.length === 1 && [...q].length >= 3 && offset === 0 && total < limit) {
    const seen = new Set(items.map((i) => i.id));
    const ws = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const candidates = db
      .prepare(`SELECT c.id, c.preview FROM clips c ${ws} ORDER BY c.updated_at DESC LIMIT ${FUZZY_SCAN}`)
      .all(...params) as unknown as Array<{ id: string; preview: string }>;
    const scored: Array<{ id: string; score: number }> = [];
    // Require on average >= 1 point per query char so widely scattered matches are not noise.
    const minScore = [...q].length;
    for (const c of candidates) {
      if (seen.has(c.id)) continue;
      const score = subsequenceScore(q, c.preview);
      if (score >= minScore) scored.push({ id: c.id, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const extra = repo.summaries(scored.slice(0, limit - items.length).map((s) => s.id));
    items.push(...extra);
    total += extra.length;
  }

  return { items, total, offset };
}
