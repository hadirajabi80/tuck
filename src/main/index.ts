// Tuck main process bootstrap (DESIGN §C boot order).
//
// Dev/QA environment hooks:
//   TUCK_USER_DATA=<dir>          use <dir> as userData (fresh profile for tests; also disables login-item writes)
//   TUCK_DEV_IMPORT_DITTO=<path>  run a Ditto import of <path> once after boot and log the result
//   TUCK_DEV_SHOW=popup|settings  show the popup / open settings right after boot
//   TUCK_DEV_SELFTEST=1           drive the IPC surface from the popup renderer and log a report (creates test data)
//   TUCK_DEV_CAPTURE=<dir>        with TUCK_DEV_SHOW, save a PNG screenshot of the shown window into <dir>
//   TUCK_SMOKE_EXIT_MS=<ms>       quit automatically after <ms>
//   TUCK_DEBUG=1                  debug-level logging
import { app, nativeTheme, Notification } from 'electron';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pretty } from '../shared/accelerator';
import type { Platform, Settings } from '../shared/types';
import { launchAtLoginSupported, syncAutostart } from './autostart';
import { captureClip, copyClip, flushUndo } from './clips/clipService';
import { initWatcher, watcher } from './clipboard/watcher';
import { setClipboardOwner } from './clipboard/writer';
import { initRepos, r } from './context';
import { runDittoImport } from './data/dittoService';
import { runSelfTest } from './dev/selfTest';
import { closeDb, initDb } from './db/connection';
import { hotkeys, initHotkeys } from './hotkeys/hotkeyManager';
import { initImageStore } from './images/imageStore';
import { registerIpcHandlers } from './ipc/handlers';
import { emit } from './ipc/typed';
import { closeLog, initLogFile, logger } from './log';
import { enforceRetention, scheduleRetention, stopRetention } from './maintenance/retention';
import { pasteLastPlain } from './paste/pasteService';
import { applyUserDataOverride, paths } from './paths';
import { handleTuckProtocol, registerTuckScheme } from './protocol';
import { initSettings, settings } from './settings/settingsStore';
import { createTray, destroyTray, rebuildTray } from './tray/tray';
import { allowPopupClose, applyPopupAppearance, createPopupWindow, destroyPopup, popupHwnd, popupWindow, showPopup, togglePopup } from './windows/popupWindow';
import { openSettingsWindow, refreshSettingsTitleBar, settingsWindow } from './windows/settingsWindow';

const overridden = applyUserDataOverride();
initLogFile(paths.logFile);
const log = logger('main');
const platform: Platform = process.platform === 'darwin' ? 'darwin' : 'win32';
let quitting = false;

process.on('uncaughtException', (err) => log.error('uncaught exception', err));
process.on('unhandledRejection', (err) => log.error('unhandled rejection', err));

if (!app.requestSingleInstanceLock()) {
  log.info('another instance is running — handing over');
  app.quit();
} else {
  registerTuckScheme();
  app.on('second-instance', () => {
    log.info('second instance → show popup');
    showPopup('second-instance');
  });
  app.on('window-all-closed', () => {
    /* tray app: stay alive */
  });
  app.on('before-quit', () => {
    quitting = true;
    allowPopupClose();
  });
  app.on('will-quit', shutdown);
  app.whenReady().then(boot).catch((err) => {
    log.error('boot failed', err);
    app.exit(1);
  });
}

function quit(): void {
  quitting = true;
  app.quit();
}

function relaunch(): void {
  app.relaunch({ args: process.argv.slice(1).filter((a) => a !== '--hidden') });
  quit();
}

function onSettingsChanged(next: Settings, prev: Settings): void {
  emit('settings:changed', next);
  if (next.appearance.theme !== prev.appearance.theme) nativeTheme.themeSource = next.appearance.theme;
  if (JSON.stringify(next.shortcuts) !== JSON.stringify(prev.shortcuts)) hotkeys().syncFromSettings();
  if (next.general.launchAtLogin !== prev.general.launchAtLogin) syncAutostart(next.general.launchAtLogin);
  if (next.history.pollIntervalMs !== prev.history.pollIntervalMs) watcher().setPollInterval(next.history.pollIntervalMs);
  if (next.appearance.vibrancy !== prev.appearance.vibrancy || next.appearance.previewVisible !== prev.appearance.previewVisible) {
    applyPopupAppearance(next);
  }
  if (next.history.maxItems < prev.history.maxItems || (next.history.expireDays && next.history.expireDays !== prev.history.expireDays)) {
    enforceRetention();
  }
  rebuildTray();
}

async function boot(): Promise<void> {
  const t0 = Date.now();
  log.info(
    `Tuck ${app.getVersion()} — electron ${process.versions.electron}, node ${process.versions.node}, ${process.platform}/${process.arch}, ` +
      `packaged=${app.isPackaged}, userData=${paths.userData}${overridden ? ' (TUCK_USER_DATA)' : ''}`,
  );

  const store = initSettings(paths.settingsFile, platform);
  const s = store.get();
  nativeTheme.themeSource = s.appearance.theme;

  const db = initDb(paths.dbFile);
  initRepos(db);
  const images = initImageStore(paths.imagesDir);
  void images.sweepOrphans(new Set(r().clips.imageClipIds())).catch((err) => log.warn('orphan sweep failed', err));
  handleTuckProtocol();

  if (process.platform === 'darwin') app.dock?.hide();

  initWatcher({
    settings: () => settings().get(),
    onCapture: (read) => {
      captureClip(read);
    },
    onStateChange: (state) => {
      emit('capture:changed', state);
      rebuildTray();
    },
  });

  registerIpcHandlers({ quit, relaunch });

  createPopupWindow();
  setClipboardOwner(() => popupHwnd());

  createTray({
    platform,
    openPopup: () => showPopup('tray'),
    togglePopup: () => togglePopup('tray'),
    openSettings: () => openSettingsWindow(),
    quit,
    isPaused: () => watcher().getState().paused,
    setPaused: (p) => watcher().setPaused(p),
    launchAtLogin: () => settings().get().general.launchAtLogin,
    setLaunchAtLogin: (on) => settings().set({ general: { launchAtLogin: on } }),
    launchAtLoginSupported,
    openAccelerator: () => settings().get().shortcuts.openPopup,
    recent: () => r().clips.recent(5).map((c) => ({ id: c.id, label: c.preview })),
    copyClip: (id) => void copyClip(id),
  });

  initHotkeys({
    platform,
    actions: {
      openPopup: () => togglePopup('hotkey'),
      pasteLastPlain: () => void pasteLastPlain(),
      toggleCapture: () => watcher().setPaused(!watcher().getState().paused),
    },
    load: () => settings().get().shortcuts,
    save: (id, accelerator) => settings().set({ shortcuts: { [id]: accelerator } }),
    onChange: (status) => {
      emit('shortcuts:changed', status);
      rebuildTray();
    },
  });
  const status = hotkeys().registerAll();
  const open = status.find((x) => x.id === 'openPopup');
  log.info(`hotkey openPopup ${open?.accelerator ? pretty(open.accelerator, platform) : '(unbound)'}: ${open?.registered ? 'registered' : `NOT registered (${open?.error ?? 'unbound'})`}`);
  if (open?.accelerator && !open.registered) notifyHotkeyConflict(open.accelerator);

  await watcher().start();
  scheduleRetention();
  syncAutostart(s.general.launchAtLogin);
  store.onChange(onSettingsChanged);
  nativeTheme.on('updated', () => {
    refreshSettingsTitleBar();
    applyPopupAppearance(settings().get());
  });

  log.info(`ready in ${Date.now() - t0} ms (${r().clips.count()} clips)`);
  devHooks();
}

/** The open shortcut is held by another app (typically Ditto, which shares Ctrl+`): tell the user how to fix it. */
function notifyHotkeyConflict(accelerator: string): void {
  if (!Notification.isSupported()) return;
  const n = new Notification({
    title: `Tuck can't use ${pretty(accelerator, platform)}`,
    body: 'Another app (often Ditto) already uses this shortcut. Click to choose a different one. Tuck is still in the tray.',
  });
  n.on('click', () => openSettingsWindow('shortcuts'));
  n.show();
}

function devHooks(): void {
  const show = process.env['TUCK_DEV_SHOW'];
  if (show === 'popup') setTimeout(() => showPopup('api'), 800);
  if (show === 'settings') openSettingsWindow();

  const captureDir = process.env['TUCK_DEV_CAPTURE'];
  if (show && captureDir) {
    setTimeout(() => {
      const w = show === 'popup' ? popupWindow() : settingsWindow();
      if (!w) return log.warn('TUCK_DEV_CAPTURE: no window');
      void w.webContents.capturePage().then((img) => {
        const file = join(captureDir, `${show}-${nativeTheme.shouldUseDarkColors ? 'dark' : 'light'}.png`);
        writeFileSync(file, img.toPNG());
        log.info(`TUCK_DEV_CAPTURE: saved ${file}`);
      });
    }, 2500);
  }

  const ditto = process.env['TUCK_DEV_IMPORT_DITTO'];
  if (ditto) {
    log.info(`TUCK_DEV_IMPORT_DITTO: importing ${ditto}`);
    void runDittoImport({ path: ditto, includeImages: true, includeGroups: true }).then((res) => {
      log.info('TUCK_DEV_IMPORT_DITTO result', JSON.stringify(res));
    });
  }

  if (process.env['TUCK_DEV_SELFTEST']) {
    setTimeout(() => {
      const w = popupWindow();
      if (w) void runSelfTest(w);
    }, 2500);
  }

  const exitMs = Number(process.env['TUCK_SMOKE_EXIT_MS'] ?? 0);
  if (exitMs > 0) setTimeout(quit, exitMs);
}

function shutdown(): void {
  log.info('shutting down');
  try {
    hotkeys().unregisterAll();
  } catch {
    /* not initialised */
  }
  try {
    watcher().stop();
  } catch {
    /* not initialised */
  }
  stopRetention();
  try {
    flushUndo();
  } catch {
    /* repos not initialised */
  }
  destroyTray();
  destroyPopup();
  closeDb();
  closeLog();
  void quitting;
}
