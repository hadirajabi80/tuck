// Collections (Ditto "groups"): many-to-many with clips through clip_groups.
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { GROUP_COLORS, type Group, type GroupColor, type GroupInput } from '../../shared/types';
import { transaction } from './connection';

interface GroupRow {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  sort_order: number;
  created_at: number;
  clip_count: number;
}

const SELECT = `SELECT g.id, g.name, g.color, g.icon, g.sort_order, g.created_at,
  (SELECT count(*) FROM clip_groups cg WHERE cg.group_id = g.id) AS clip_count FROM groups g`;

function map(r: GroupRow): Group {
  return {
    id: r.id,
    name: r.name,
    color: (GROUP_COLORS as readonly string[]).includes(r.color ?? '') ? (r.color as GroupColor) : null,
    icon: r.icon,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
    clipCount: r.clip_count,
  };
}

function cleanName(name: unknown): string {
  const s = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, 80) : '';
  if (!s) throw new Error('Collection name is required');
  return s;
}

function cleanColor(c: unknown): GroupColor | null {
  return typeof c === 'string' && (GROUP_COLORS as readonly string[]).includes(c) ? (c as GroupColor) : null;
}

function cleanIcon(i: unknown): string | null {
  return typeof i === 'string' && /^[a-z0-9-]{1,64}$/.test(i) ? i : null;
}

export class GroupRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Group[] {
    return (this.db.prepare(`${SELECT} ORDER BY g.sort_order ASC, g.created_at ASC`).all() as unknown as GroupRow[]).map(map);
  }

  get(id: string): Group | null {
    const r = this.db.prepare(`${SELECT} WHERE g.id = ?`).get(id) as unknown as GroupRow | undefined;
    return r ? map(r) : null;
  }

  findByName(name: string): Group | null {
    const r = this.db.prepare(`${SELECT} WHERE lower(g.name) = lower(?) LIMIT 1`).get(name.trim()) as unknown as GroupRow | undefined;
    return r ? map(r) : null;
  }

  create(input: GroupInput, now = Date.now()): Group {
    const id = randomUUID();
    const next = (this.db.prepare('SELECT coalesce(max(sort_order), -1) + 1 AS n FROM groups').get() as { n: number }).n;
    this.db
      .prepare('INSERT INTO groups (id, name, color, icon, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, cleanName(input.name), cleanColor(input.color), cleanIcon(input.icon), next, now);
    return this.get(id)!;
  }

  /** Returns the existing group with that name (case-insensitive) or creates it. */
  ensure(name: string): { group: Group; created: boolean } {
    const existing = this.findByName(cleanName(name));
    if (existing) return { group: existing, created: false };
    return { group: this.create({ name }), created: true };
  }

  update(id: string, patch: Partial<GroupInput>): Group {
    const cur = this.get(id);
    if (!cur) throw new Error('Collection not found');
    const name = patch.name !== undefined ? cleanName(patch.name) : cur.name;
    const color = patch.color !== undefined ? cleanColor(patch.color) : cur.color;
    const icon = patch.icon !== undefined ? cleanIcon(patch.icon) : cur.icon;
    this.db.prepare('UPDATE groups SET name = ?, color = ?, icon = ? WHERE id = ?').run(name, color, icon, id);
    return this.get(id)!;
  }

  delete(id: string): boolean {
    return Number(this.db.prepare('DELETE FROM groups WHERE id = ?').run(id).changes) > 0;
  }

  /** Sets sort_order from the given id order; ids not listed keep their relative order after them. */
  reorder(ids: string[]): Group[] {
    transaction(this.db, () => {
      const all = this.list().map((g) => g.id);
      const listed = ids.filter((id) => all.includes(id));
      const rest = all.filter((id) => !listed.includes(id));
      const stmt = this.db.prepare('UPDATE groups SET sort_order = ? WHERE id = ?');
      [...listed, ...rest].forEach((id, i) => stmt.run(i, id));
    });
    return this.list();
  }
}
