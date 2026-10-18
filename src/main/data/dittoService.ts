// Electron glue for the Ditto import: file dialog, image sink (nativeImage), progress events, retention afterwards.
import { BrowserWindow, dialog } from 'electron';
import type { DittoImportRequest, DittoImportResult } from '../../shared/types';
import { r } from '../context';
import { imageStore } from '../images/imageStore';
import { emit } from '../ipc/typed';
import { logger } from '../log';
import { enforceRetention } from '../maintenance/retention';
import { settings } from '../settings/settingsStore';
import { emptyResult, importDitto, type DittoImportStats } from './dittoImport';

const log = logger('ditto');
let running = false;

export async function pickDittoFile(): Promise<{ canceled: boolean; path: string | null }> {
  const opts: Electron.OpenDialogOptions = {
    title: 'Import from Ditto',
    properties: ['openFile'],
    filters: [
      { name: 'Ditto database', extensions: ['db', 'zdb', 'zip', 'bak'] },
      { name: 'All files', extensions: ['*'] },
    ],
  };
  const parent = BrowserWindow.getFocusedWindow();
  const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  if (res.canceled || !res.filePaths[0]) return { canceled: true, path: null };
  return { canceled: false, path: res.filePaths[0] };
}

export async function runDittoImport(req: DittoImportRequest): Promise<DittoImportStats | DittoImportResult> {
  if (running) return emptyResult({ error: 'unknown', message: 'An import is already running' });
  let path = typeof req?.path === 'string' && req.path ? req.path : null;
  if (!path) {
    const picked = await pickDittoFile();
    if (picked.canceled || !picked.path) return emptyResult({ canceled: true, error: 'canceled' });
    path = picked.path;
  }
  running = true;
  try {
    const s = settings().get();
    const store = imageStore();
    const res = await importDitto(
      { path, includeImages: req?.includeImages !== false, includeGroups: req?.includeGroups !== false },
      {
        db: r().db,
        clips: r().clips,
        groups: r().groups,
        images: {
          encodeBitmap: (bgra, w, h) => store.encodeBitmap(bgra, w, h).png,
          save: (id, png) => store.save(id, png),
        },
        limits: { maxImageBytes: s.history.maxImageBytes },
        onProgress: (done, total) => emit('data:importProgress', { source: 'ditto', done, total }),
      },
    );
    if (res.ok) {
      emit('clips:changed', { reason: 'imported', ids: [] });
      if (res.groups) emit('groups:changed', { ids: [] });
      const before = r().clips.count();
      const trimmed = enforceRetention();
      if (trimmed > 0) {
        res.message =
          `${trimmed} older clips were removed by your history limits (max ${s.history.maxItems} items` +
          `${s.history.expireDays ? `, ${s.history.expireDays} days` : ''}). Raise them in Settings › History to keep more.`;
        log.info(`retention after import removed ${trimmed} of ${before} clips`);
      }
      (res as DittoImportStats & { trimmed?: number }).trimmed = trimmed;
    }
    return res;
  } finally {
    running = false;
  }
}
