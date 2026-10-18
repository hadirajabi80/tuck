// Settings window: 920×640 (min 760×520), hidden title bar with Windows titleBarOverlay / macOS hiddenInset.
import { BrowserWindow, nativeTheme } from 'electron';
import type { SettingsSection } from '../../shared/types';
import { logger } from '../log';
import { iconPath, paths } from '../paths';
import { attachWindowLogging, loadRoute } from './load';

const log = logger('settings-window');
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
const TITLEBAR_HEIGHT = 40;

let win: BrowserWindow | null = null;
let loaded = false;
let pendingSection: SettingsSection | null = null;

function overlay(): Electron.TitleBarOverlay {
  const dark = nativeTheme.shouldUseDarkColors;
  return { color: dark ? '#1C1C20' : '#F7F7F9', symbolColor: dark ? '#EDEDF2' : '#1A1A22', height: TITLEBAR_HEIGHT };
}

export function settingsWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function openSettingsWindow(section?: SettingsSection): BrowserWindow {
  const existing = settingsWindow();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    if (section) existing.webContents.send('settings:navigate', { section });
    return existing;
  }
  loaded = false;
  pendingSection = section ?? null;
  win = new BrowserWindow({
    width: 920,
    height: 640,
    minWidth: 760,
    minHeight: 520,
    show: false,
    title: 'Tuck Settings',
    icon: isWin ? iconPath('icon.ico') : iconPath('icon.png'),
    titleBarStyle: isMac ? 'hiddenInset' : 'hidden',
    titleBarOverlay: isWin ? overlay() : undefined,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1C1C20' : '#F7F7F9',
    autoHideMenuBar: true,
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: ['--window=settings'],
    },
  });
  win.removeMenu();
  attachWindowLogging(win, 'settings');
  win.once('ready-to-show', () => {
    win?.show();
    win?.focus();
  });
  win.webContents.on('did-finish-load', () => {
    loaded = true;
    if (pendingSection) {
      win?.webContents.send('settings:navigate', { section: pendingSection });
      pendingSection = null;
    }
  });
  win.on('closed', () => {
    win = null;
    loaded = false;
  });
  loadRoute(win, 'settings');
  log.info('opened', section ?? '');
  return win;
}

export function closeSettingsWindow(): void {
  settingsWindow()?.close();
}

/** Re-colour the Windows caption buttons when the theme flips. */
export function refreshSettingsTitleBar(): void {
  const w = settingsWindow();
  if (!w || !isWin) return;
  try {
    w.setTitleBarOverlay(overlay());
    w.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1C1C20' : '#F7F7F9');
  } catch {
    /* window without overlay */
  }
}

export function settingsWindowLoaded(): boolean {
  return loaded;
}
