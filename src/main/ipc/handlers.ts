// Registers every InvokeContract channel. The handler table is typed as a mapped type over InvokeChannel,
// so a channel added to the shared contract without a handler fails typecheck.
import { statSync } from 'node:fs';
import { app, shell, systemPreferences, type IpcMainInvokeEvent } from 'electron';
import type { InvokeChannel, InvokeReq, InvokeRes } from '../../shared/ipc';
import { INVOKE_CHANNELS } from '../../shared/ipc';
import type { AppInfo, Platform, Stats } from '../../shared/types';
import { launchAtLoginSupported } from '../autostart';
import {
  clearClips, copyClip, createTextClip, deleteClips, pinClip, setClipGroups, undoDelete, updateClipText,
} from '../clips/clipService';
import { watcher } from '../clipboard/watcher';
import { r } from '../context';
import { detectDitto, inspectDitto } from '../data/dittoImport';
import { pickDittoFile, runDittoImport } from '../data/dittoService';
import { exportToFile, importFromFile } from '../data/exportImport';
import { searchClips } from '../db/search';
import { hotkeys } from '../hotkeys/hotkeyManager';
import { imageStore } from '../images/imageStore';
import { logger } from '../log';
import { accessibilityTrusted, performPaste } from '../paste/pasteService';
import { paths } from '../paths';
import { settings } from '../settings/settingsStore';
import { hidePopup, markPopupReady, setPopupLayout } from '../windows/popupWindow';
import { closeSettingsWindow, openSettingsWindow } from '../windows/settingsWindow';
import { emit, handle } from './typed';

const log = logger('ipc');

type Handlers = { [C in InvokeChannel]: (req: InvokeReq<C>, event: IpcMainInvokeEvent) => InvokeRes<C> | Promise<InvokeRes<C>> };

export interface AppControl {
  quit(): void;
  relaunch(): void;
}

function fileSize(p: string): number {
  try {
    return statSync(p).size;
  } catch {
    return 0;
  }
}

const SETTINGS_SECTIONS = new Set(['general', 'shortcuts', 'history', 'appearance', 'privacy', 'about']);

export function registerIpcHandlers(control: AppControl): void {
  const handlers: Handlers = {
    // ---- clips
    'clips:list': (q) => searchClips(r().db, r().clips, q),
    'clips:get': ({ id }) => r().clips.get(id),
    'clips:update': ({ id, text }) => updateClipText(id, text),
    'clips:pin': ({ id, pinned }) => pinClip(id, !!pinned),
    'clips:setGroups': ({ id, groupIds }) => setClipGroups(id, groupIds),
    'clips:delete': ({ ids }) => ({ deleted: deleteClips(ids) }),
    'clips:undoDelete': () => ({ restored: undoDelete() }),
    'clips:clear': ({ includePinned }) => ({ deleted: clearClips(includePinned) }),
    'clips:createText': ({ text }) => createTextClip(text),
    'clips:copy': async ({ id, plain }) => ({ ok: await copyClip(id, !!plain) }),

    // ---- groups
    'groups:list': () => r().groups.list(),
    'groups:create': (input) => {
      const g = r().groups.create(input);
      emit('groups:changed', { ids: [g.id] });
      return g;
    },
    'groups:update': ({ id, ...patch }) => {
      const g = r().groups.update(id, patch);
      emit('groups:changed', { ids: [id] });
      return g;
    },
    'groups:delete': ({ id }) => {
      const ok = r().groups.delete(id);
      if (ok) {
        emit('groups:changed', { ids: [id] });
        emit('clips:changed', { reason: 'updated', ids: [] });
      }
      return { ok };
    },
    'groups:reorder': ({ ids }) => {
      const list = r().groups.reorder(Array.isArray(ids) ? ids : []);
      emit('groups:changed', { ids: list.map((g) => g.id) });
      return list;
    },

    // ---- snippets
    'snippets:list': (req) => r().snippets.list(req?.query),
    'snippets:create': (input) => {
      const s = r().snippets.create(input);
      emit('snippets:changed', { ids: [s.id] });
      return s;
    },
    'snippets:update': ({ id, ...patch }) => {
      const s = r().snippets.update(id, patch);
      emit('snippets:changed', { ids: [id] });
      return s;
    },
    'snippets:delete': ({ id }) => {
      const ok = r().snippets.delete(id);
      if (ok) emit('snippets:changed', { ids: [id] });
      return { ok };
    },

    // ---- paste
    'paste:perform': (req) => performPaste(req),

    // ---- popup
    'popup:ready': () => markPopupReady(),
    'popup:hide': (req) => hidePopup(req?.reason === 'paste' || req?.reason === 'action' ? req.reason : 'escape'),
    'popup:setLayout': ({ previewVisible }) => setPopupLayout(!!previewVisible),

    // ---- settings
    'settings:get': () => settings().get(),
    'settings:set': (patch) => settings().set(patch ?? {}),
    'settings:reset': () => settings().reset(),
    'settings:openWindow': (req) => {
      const section = req?.section && SETTINGS_SECTIONS.has(req.section) ? req.section : undefined;
      hidePopup('action');
      openSettingsWindow(section);
    },
    'settings:closeWindow': () => closeSettingsWindow(),

    // ---- shortcuts
    'shortcuts:status': () => hotkeys().status(),
    'shortcuts:set': ({ id, accelerator }) => hotkeys().set(id, accelerator),
    'shortcuts:setRecording': ({ recording }) => hotkeys().setRecording(!!recording),

    // ---- capture
    'capture:getState': () => watcher().getState(),
    'capture:setPaused': ({ paused }) => watcher().setPaused(!!paused),

    // ---- data
    'data:export': (req) => exportToFile({ includeImages: !!req?.includeImages }),
    'data:import': () => importFromFile(),
    'stats:get': async (): Promise<Stats> => {
      const s = r().clips.stats();
      const dbBytes = fileSize(paths.dbFile) + fileSize(`${paths.dbFile}-wal`);
      return { ...s, dbBytes, imagesBytes: await imageStore().totalBytes() };
    },
    'data:detectDitto': () => detectDitto(),
    'data:pickDittoFile': () => pickDittoFile(),
    'data:inspectDitto': ({ path }) => inspectDitto(path),
    'data:importDitto': (req) => runDittoImport(req),

    // ---- app
    'app:getInfo': (): AppInfo => ({
      name: app.getName(),
      version: app.getVersion(),
      platform: (process.platform === 'darwin' ? 'darwin' : 'win32') as Platform,
      arch: process.arch,
      electron: process.versions.electron ?? '',
      chrome: process.versions.chrome ?? '',
      node: process.versions.node,
      isPackaged: app.isPackaged,
      userDataPath: paths.userData,
      dbPath: paths.dbFile,
      imagesPath: paths.imagesDir,
      accessibilityTrusted: accessibilityTrusted(),
      launchAtLoginSupported: launchAtLoginSupported(),
    }),
    'app:openExternal': async ({ url }) => {
      if (typeof url !== 'string' || !/^(https?:|mailto:)/i.test(url)) throw new Error('Only http(s) and mailto links can be opened');
      await shell.openExternal(url);
    },
    'app:revealPath': ({ path }) => {
      if (typeof path !== 'string' || !path) return;
      shell.showItemInFolder(path);
    },
    'app:requestAccessibility': () => {
      if (process.platform !== 'darwin') return { trusted: true };
      return { trusted: systemPreferences.isTrustedAccessibilityClient(true) };
    },
    'app:quit': () => control.quit(),
    'app:relaunch': () => control.relaunch(),
  };

  for (const channel of Object.keys(handlers) as InvokeChannel[]) {
    const fn = handlers[channel] as (req: unknown, e: IpcMainInvokeEvent) => unknown;
    handle(channel, (async (req: unknown, e: IpcMainInvokeEvent) => {
      try {
        return await fn(req, e);
      } catch (err) {
        log.warn(`${channel} failed:`, (err as Error).message);
        throw err;
      }
    }) as never);
  }
  const missing = (Object.keys(INVOKE_CHANNELS) as InvokeChannel[]).filter((c) => !(c in handlers));
  if (missing.length) log.error('channels without handler:', missing.join(', '));
  else log.info(`registered ${Object.keys(handlers).length} IPC handlers`);
}
