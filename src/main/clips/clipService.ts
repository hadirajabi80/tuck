// Orchestrates clip mutations: repository + image files + undo ring + events + retention.
import type { Clip, ClipSummary } from '../../shared/types';
import type { ReadResult } from '../clipboard/reader';
import { writeContent, type ClipContent } from '../clipboard/writer';
import { r } from '../context';
import { buildTextClip } from '../db/clipBuilder';
import type { ClipSnapshot } from '../db/clipRepository';
import { imageStore } from '../images/imageStore';
import { emit } from '../ipc/typed';
import { logger } from '../log';
import { retentionAfterInsert } from '../maintenance/retention';
import { UndoRing } from '../maintenance/undoRing';
import { settings } from '../settings/settingsStore';

const log = logger('clips');

const undo = new UndoRing((snaps: ClipSnapshot[]) => {
  for (const s of snaps) {
    if (s.row.kind !== 'image') continue;
    // Only delete files whose clip was not restored / re-created meanwhile.
    if (!r().clips.getRow(s.row.id)) imageStore().delete(s.row.id);
  }
});

export function flushUndo(): void {
  undo.flush();
}

/** Watcher capture → upsert (dedupe by hash) → clips:changed → retention. */
export function captureClip(read: ReadResult): ClipSummary | null {
  const dedupe = settings().get().history.dedupe;
  const { id, created } = r().clips.upsert(read.input, {
    dedupe,
    storeImage: (cid, png) => imageStore().save(cid, png, read.decoded),
  });
  log.info(`${created ? 'captured' : 'bumped'} ${read.input.kind} clip ${id}${read.input.sourceApp ? ` from ${read.input.sourceApp}` : ''}`);
  emit('clips:changed', { reason: created ? 'added' : 'updated', ids: [id] });
  if (created) retentionAfterInsert();
  return r().clips.getSummary(id);
}

export function createTextClip(text: string): Clip {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Text is empty');
  const { id, created } = r().clips.upsert(buildTextClip(text), { dedupe: true });
  emit('clips:changed', { reason: created ? 'added' : 'updated', ids: [id] });
  if (created) retentionAfterInsert();
  return r().clips.get(id)!;
}

export function updateClipText(id: string, text: string): Clip {
  if (typeof text !== 'string' || !text.length) throw new Error('Text is empty');
  const clip = r().clips.updateText(id, text);
  if (!clip) throw new Error('Clip not found');
  emit('clips:changed', { reason: 'updated', ids: [id] });
  return clip;
}

export function pinClip(id: string, pinned: boolean): ClipSummary {
  const s = r().clips.setPinned(id, pinned);
  if (!s) throw new Error('Clip not found');
  emit('clips:changed', { reason: 'updated', ids: [id] });
  return s;
}

/** Sets the pin order (pins listed ids that aren't pinned yet). See 'clips:reorderPinned'. */
export function reorderPinned(ids: string[]): string[] {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : [];
  const order = r().clips.reorderPinned(list);
  emit('clips:changed', { reason: 'updated', ids: list });
  return order;
}

export function setClipGroups(id: string, groupIds: string[]): ClipSummary {
  const s = r().clips.setGroups(id, Array.isArray(groupIds) ? groupIds.filter((g) => typeof g === 'string') : []);
  if (!s) throw new Error('Clip not found');
  emit('clips:changed', { reason: 'updated', ids: [id] });
  emit('groups:changed', { ids: groupIds });
  return s;
}

export function deleteClips(ids: string[]): number {
  const snaps = r().clips.delete(Array.isArray(ids) ? ids.filter((x) => typeof x === 'string') : []);
  if (!snaps.length) return 0;
  undo.push(snaps);
  log.info(`deleted ${snaps.length} clip(s) (${snaps.filter((x) => x.row.pinned).length} pinned) — undo kept 60 s`);
  emit('clips:changed', { reason: 'deleted', ids: snaps.map((s) => s.row.id) });
  if (snaps.some((s) => s.groupIds.length)) emit('groups:changed', { ids: [] });
  return snaps.length;
}

export function undoDelete(): number {
  const snaps = undo.pop();
  if (!snaps) return 0;
  const { restored, skipped } = r().clips.restore(snaps);
  // Skipped image snapshots: their content exists again under another clip → drop their files.
  for (const s of skipped) if (s.row.kind === 'image' && !r().clips.getRow(s.row.id)) imageStore().delete(s.row.id);
  if (restored.length) emit('clips:changed', { reason: 'restored', ids: restored });
  return restored.length;
}

export function clearClips(includePinned: boolean): number {
  const { ids, imageIds } = r().clips.clear(!!includePinned);
  log.info(`cleared history: ${ids.length} clip(s) removed${includePinned ? ' including pinned' : ', pinned kept'}`);
  for (const id of imageIds) imageStore().delete(id);
  emit('clips:changed', { reason: 'cleared', ids });
  emit('groups:changed', { ids: [] });
  return ids.length;
}

/** Clipboard payload for a clip (plain drops html/rtf). */
export function contentFor(clip: Clip, plain = false): ClipContent {
  if (clip.kind === 'image') return { imagePath: imageStore().pathFor(clip.id, 'full') };
  if (clip.kind === 'files' && clip.files?.length && !plain) return { files: clip.files };
  return { text: clip.text ?? '', html: plain ? null : clip.html, rtf: plain ? null : clip.rtf };
}

export async function copyClip(id: string, plain = false): Promise<boolean> {
  const clip = r().clips.get(id);
  if (!clip) return false;
  return writeContent(contentFor(clip, plain));
}
