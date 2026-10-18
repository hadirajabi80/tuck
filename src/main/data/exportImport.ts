// Tuck JSON export/import: { format: 'tuck-export', version: 1, exportedAt, clips, groups, snippets }.
// Images are inlined as base64 PNG when includeImages. Import merges by hash, matches groups by name,
// skips snippets with identical (title, body).
import { readFile, writeFile } from 'node:fs/promises';
import { setImmediate as tick } from 'node:timers/promises';
import { BrowserWindow, dialog } from 'electron';
import type { Clip, ExportRequest, ExportResult, Group, ImportResult, Snippet } from '../../shared/types';
import { r } from '../context';
import { buildFilesClip, buildImageClip, buildTextClip, pngSize, type NewClipInput } from '../db/clipBuilder';
import { transaction } from '../db/connection';
import { imageStore } from '../images/imageStore';
import { emit } from '../ipc/typed';
import { logger } from '../log';

const log = logger('export');

interface ExportedClip extends Omit<Clip, 'image'> {
  image: Clip['image'];
  imagePng?: string;
}

interface ExportFile {
  format: 'tuck-export';
  version: 1;
  exportedAt: number;
  clips: ExportedClip[];
  groups: Group[];
  snippets: Snippet[];
}

function parent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? undefined;
}

export async function exportToFile(req: ExportRequest, path?: string): Promise<ExportResult> {
  try {
    let target = path;
    if (!target) {
      const stamp = new Date().toISOString().slice(0, 10);
      const opts: Electron.SaveDialogOptions = {
        title: 'Export Tuck history',
        defaultPath: `tuck-export-${stamp}.json`,
        filters: [{ name: 'Tuck export', extensions: ['json'] }],
      };
      const p = parent();
      const res = p ? await dialog.showSaveDialog(p, opts) : await dialog.showSaveDialog(opts);
      if (res.canceled || !res.filePath) return { ok: false, canceled: true };
      target = res.filePath;
    }
    const clips: ExportedClip[] = [];
    let n = 0;
    for (const clip of r().clips.iterateAll()) {
      const out: ExportedClip = { ...clip };
      if (clip.kind === 'image') {
        if (!req.includeImages) continue;
        try {
          out.imagePng = (await readFile(imageStore().pathFor(clip.id, 'full'))).toString('base64');
        } catch {
          continue; // image file missing
        }
      }
      clips.push(out);
      if (++n % 200 === 0) await tick();
    }
    const file: ExportFile = {
      format: 'tuck-export',
      version: 1,
      exportedAt: Date.now(),
      clips,
      groups: r().groups.list(),
      snippets: r().snippets.list(),
    };
    await writeFile(target, JSON.stringify(file), 'utf8');
    log.info(`exported ${clips.length} clips to ${target}`);
    return { ok: true, canceled: false, path: target, clips: clips.length };
  } catch (err) {
    log.error('export failed', err);
    return { ok: false, canceled: false, error: (err as Error).message };
  }
}

function inputFor(c: ExportedClip): NewClipInput | null {
  if (c.kind === 'image') {
    if (!c.imagePng) return null;
    const png = Buffer.from(c.imagePng, 'base64');
    const size = pngSize(png);
    return size ? buildImageClip(png, size.width, size.height, c.sourceApp ?? null) : null;
  }
  if (c.kind === 'files') {
    const files = Array.isArray(c.files) ? c.files.filter((f) => typeof f === 'string') : (c.text ?? '').split('\n').filter(Boolean);
    return files.length ? buildFilesClip(files, c.sourceApp ?? null) : null;
  }
  if (typeof c.text !== 'string' || !c.text) return null;
  return buildTextClip(c.text, { html: c.html ?? null, rtf: c.rtf ?? null, sourceApp: c.sourceApp ?? null });
}

export async function importFromFile(path?: string): Promise<ImportResult> {
  const result: ImportResult = { ok: false, canceled: false, imported: 0, skipped: 0, groups: 0, snippets: 0 };
  try {
    let source = path;
    if (!source) {
      const opts: Electron.OpenDialogOptions = {
        title: 'Import Tuck history',
        properties: ['openFile'],
        filters: [{ name: 'Tuck export', extensions: ['json'] }, { name: 'All files', extensions: ['*'] }],
      };
      const p = parent();
      const res = p ? await dialog.showOpenDialog(p, opts) : await dialog.showOpenDialog(opts);
      if (res.canceled || !res.filePaths[0]) return { ...result, canceled: true };
      source = res.filePaths[0];
    }
    const data = JSON.parse(await readFile(source, 'utf8')) as Partial<ExportFile>;
    if (data.format !== 'tuck-export' || !Array.isArray(data.clips)) return { ...result, error: 'Not a Tuck export file' };

    const groupMap = new Map<string, string>();
    for (const g of Array.isArray(data.groups) ? data.groups : []) {
      if (!g || typeof g.name !== 'string' || !g.name.trim()) continue;
      const { group, created } = r().groups.ensure(g.name);
      if (created && (g.color || g.icon)) r().groups.update(group.id, { color: g.color ?? null, icon: g.icon ?? null });
      groupMap.set(g.id, group.id);
      if (created) result.groups++;
    }

    const clips = data.clips;
    const total = clips.length;
    for (let i = 0; i < clips.length; i += 200) {
      const part = clips.slice(i, i + 200);
      transaction(r().db, () => {
        for (const c of part) {
          const input = c && typeof c === 'object' ? inputFor(c) : null;
          if (!input) {
            result.skipped++;
            continue;
          }
          const gids = (Array.isArray(c.groupIds) ? c.groupIds : []).map((g) => groupMap.get(g)).filter((g): g is string => !!g);
          const existing = r().clips.findIdByHash(input.hash);
          if (existing) {
            if (c.pinned) r().clips.mergePinned(existing, c.pinnedAt ?? Date.now());
            if (gids.length) r().clips.addToGroups(existing, gids);
            result.skipped++;
            continue;
          }
          const id = r().clips.insert(input, {
            createdAt: Number(c.createdAt) || Date.now(),
            updatedAt: Number(c.updatedAt) || Number(c.createdAt) || Date.now(),
            pinned: !!c.pinned,
            pinnedAt: c.pinnedAt ?? null,
            lastPastedAt: c.lastPastedAt ?? null,
            copyCount: Math.max(1, Number(c.copyCount) || 1),
            storeImage: (cid, png) => imageStore().save(cid, png),
          });
          if (gids.length) r().clips.addToGroups(id, gids);
          result.imported++;
        }
      });
      emit('data:importProgress', { source: 'tuck', done: Math.min(total, i + part.length), total });
      await tick();
    }

    for (const s of Array.isArray(data.snippets) ? data.snippets : []) {
      if (!s || typeof s.body !== 'string' || !s.body) continue;
      if (r().snippets.exists(s.title, s.body)) continue;
      r().snippets.create({ title: s.title, body: s.body, keyword: s.keyword ?? null, groupId: s.groupId ? (groupMap.get(s.groupId) ?? null) : null });
      result.snippets++;
    }
    result.ok = true;
    log.info(`imported ${result.imported} clips, ${result.skipped} skipped, ${result.groups} groups, ${result.snippets} snippets`);
    emit('clips:changed', { reason: 'imported', ids: [] });
    emit('groups:changed', { ids: [] });
    emit('snippets:changed', { ids: [] });
    return result;
  } catch (err) {
    log.error('import failed', err);
    return { ...result, ok: false, error: (err as Error).message };
  }
}
