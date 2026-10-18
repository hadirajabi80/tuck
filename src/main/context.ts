// Process-wide singletons wired at boot (DB + repositories). Kept tiny to avoid import cycles.
import type { DatabaseSync } from 'node:sqlite';
import { ClipRepository } from './db/clipRepository';
import { GroupRepository } from './db/groupRepository';
import { SnippetRepository } from './db/snippetRepository';

export interface Repos {
  db: DatabaseSync;
  clips: ClipRepository;
  groups: GroupRepository;
  snippets: SnippetRepository;
}

let repos: Repos | null = null;

export function initRepos(db: DatabaseSync): Repos {
  repos = { db, clips: new ClipRepository(db), groups: new GroupRepository(db), snippets: new SnippetRepository(db) };
  return repos;
}

export function r(): Repos {
  if (!repos) throw new Error('repositories not initialised');
  return repos;
}
