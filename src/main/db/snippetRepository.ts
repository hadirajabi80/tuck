// Saved reusable text snippets.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { Snippet, SnippetInput } from '../../shared/types';
import { escapeLike } from './search';

interface SnippetRow {
  id: string;
  title: string;
  body: string;
  keyword: string | null;
  group_id: string | null;
  sort_order: number;
  usage_count: number;
  created_at: number;
  updated_at: number;
}

function map(r: SnippetRow): Snippet {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    keyword: r.keyword,
    groupId: r.group_id,
    sortOrder: r.sort_order,
    usageCount: r.usage_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const cleanTitle = (t: unknown, body: string): string => {
  const s = typeof t === 'string' ? t.trim().slice(0, 200) : '';
  return s || body.trim().split(/\r?\n/)[0]!.slice(0, 60) || 'Untitled snippet';
};
const cleanKeyword = (k: unknown): string | null => {
  const s = typeof k === 'string' ? k.trim().slice(0, 64) : '';
  return s || null;
};

export class SnippetRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(query?: string): Snippet[] {
    const q = (query ?? '').trim();
    let sql = 'SELECT * FROM snippets';
    const params: SQLInputValue[] = [];
    if (q) {
      sql += " WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR keyword LIKE ? ESCAPE '\\'";
      const like = `%${escapeLike(q)}%`;
      params.push(like, like, like);
    }
    sql += ' ORDER BY sort_order ASC, updated_at DESC';
    return (this.db.prepare(sql).all(...params) as unknown as SnippetRow[]).map(map);
  }

  get(id: string): Snippet | null {
    const r = this.db.prepare('SELECT * FROM snippets WHERE id = ?').get(id) as unknown as SnippetRow | undefined;
    return r ? map(r) : null;
  }

  private validGroup(groupId: unknown): string | null {
    if (typeof groupId !== 'string' || !groupId) return null;
    return this.db.prepare('SELECT 1 FROM groups WHERE id = ?').get(groupId) ? groupId : null;
  }

  create(input: SnippetInput, now = Date.now()): Snippet {
    const body = typeof input.body === 'string' ? input.body : '';
    if (!body) throw new Error('Snippet body is required');
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO snippets (id, title, body, keyword, group_id, sort_order, usage_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?)',
      )
      .run(id, cleanTitle(input.title, body), body, cleanKeyword(input.keyword), this.validGroup(input.groupId), now, now);
    return this.get(id)!;
  }

  update(id: string, patch: Partial<SnippetInput>, now = Date.now()): Snippet {
    const cur = this.get(id);
    if (!cur) throw new Error('Snippet not found');
    const body = typeof patch.body === 'string' && patch.body ? patch.body : cur.body;
    const title = patch.title !== undefined ? cleanTitle(patch.title, body) : cur.title;
    const keyword = patch.keyword !== undefined ? cleanKeyword(patch.keyword) : cur.keyword;
    const groupId = patch.groupId !== undefined ? this.validGroup(patch.groupId) : cur.groupId;
    this.db
      .prepare('UPDATE snippets SET title = ?, body = ?, keyword = ?, group_id = ?, updated_at = ? WHERE id = ?')
      .run(title, body, keyword, groupId, now, id);
    return this.get(id)!;
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM snippets WHERE id = ?').run(id).changes) > 0;
  }

  markUsed(id: string): void {
    this.db.prepare('UPDATE snippets SET usage_count = usage_count + 1 WHERE id = ?').run(id);
  }

  exists(title: string, body: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM snippets WHERE title = ? AND body = ?').get(title, body);
  }
}
