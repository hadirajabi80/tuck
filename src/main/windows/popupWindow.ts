// The popup: created once at startup (hidden, preloaded), shown at the cursor by the hotkey, hidden on blur.
import { release } from 'node:os';
import { app, BrowserWindow, nativeTheme, screen, type Rectangle } from 'electron';
import type { FilterId, PopupShownEvent, Settings } from '../../shared/types';
import { emit } from '../ipc/typed';
import { logger } from '../log';
import { forceForeground, hwndFromHandle, type Hwnd } from '../native/user32';
import { captureFocus, restoreFocus } from '../paste/focusTracker';
import { paths } from '../paths';
import { settings } from '../settings/settingsStore';
import { clampInto, computePopupBounds } from './placement';
import { attachWindowLogging, loadRoute } from './load';

const log = logger('popup');
const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';
export const POPUP_HEIGHT = 460;
export const POPUP_WIDTH_PREVIEW = 760;
export const POPUP_WIDTH_LIST = 480;

export type HideReason = 'escape' | 'paste' | 'blur' | 'action';

let win: BrowserWindow | null = null;
let ready = false;
let pendingShow: PopupShownEvent | null = null;
let lastBounds: Rectangle | null = null;
let previewVisible = true;
let allowClose = false;
let shownAt = 0;

export function isWin11(): boolean {
  if (!isWin) return false;
  const build = Number(release().split('.')[2] ?? 0);
  return build >= 22621;
}

export function vibrancySupported(): boolean {
  return isMac || isWin11();
}

function solidBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#1C1C20' : '#F7F7F9';
}

function width(): number {
  return previewVisible ? POPUP_WIDTH_PREVIEW : POPUP_WIDTH_LIST;
}

export function createPopupWindow(): BrowserWindow {
  const s = settings().get();
  previewVisible = s.appearance.previewVisible;
  const acrylic = isWin11() && s.appearance.vibrancy;
  win = new BrowserWindow({
    width: width(),
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    roundedCorners: true,
    title: 'Tuck',
    transparent: isMac,
    vibrancy: isMac && s.appearance.vibrancy ? 'popover' : undefined,
    visualEffectState: 'active',
    backgroundMaterial: isWin ? (acrylic ? 'acrylic' : 'none') : undefined,
    backgroundColor: isMac || acrylic ? '#00000000' : solidBackground(),
    webPreferences: {
      preload: paths.preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: ['--window=popup'],
    },
  });
  if (isMac) {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setAlwaysOnTop(true, 'floating');
  }
  attachWindowLogging(win, 'popup');
  win.on('blur', () => {
    // Ignore the blur that can arrive right after showing while Windows settles focus.
    if (Date.now() - shownAt < 150) return;
    if (settings().get().general.hideOnBlur) hidePopup('blur');
  });
  win.on('close', (e) => {
    if (!allowClose) {
      e.preventDefault();
      hidePopup('action');
    }
  });
  win.on('closed', () => {
    win = null;
    ready = false;
  });
  win.webContents.on('did-finish-load', () => {
    // Fallback in case the renderer never calls popup:ready.
    setTimeout(() => markPopupReady(), 1500);
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    log.error('popup renderer gone:', d.reason);
    ready = false;
    if (win && !win.isDestroyed()) loadRoute(win, 'popup');
  });
  loadRoute(win, 'popup');
  log.info(`created (acrylic=${acrylic})`);
  return win;
}

export function popupWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null;
}

export function popupHwnd(): Hwnd | null {
  const w = popupWindow();
  if (!w || !isWin) return null;
  try {
    return hwndFromHandle(w.getNativeWindowHandle());
  } catch {
    return null;
  }
}

export function isPopupVisible(): boolean {
  const w = popupWindow();
  return !!w && w.isVisible();
}

export function markPopupReady(): void {
  if (ready) return;
  ready = true;
  if (pendingShow) {
    const p = pendingShow;
    pendingShow = null;
    reallyShow(p);
  }
}

export function showPopup(trigger: PopupShownEvent['trigger'], filter?: FilterId): void {
  let w = popupWindow();
  if (!w) w = createPopupWindow();
  const ev: PopupShownEvent = filter ? { trigger, filter } : { trigger };
  if (w.isVisible()) {
    w.focus();
    emit('popup:shown', ev);
    return;
  }
  captureFocus();
  if (!ready) {
    pendingShow = ev;
    return;
  }
  reallyShow(ev);
}

function reallyShow(ev: PopupShownEvent): void {
  const w = popupWindow();
  if (!w) return;
  const mode = settings().get().appearance.popupPosition;
  const bounds = computePopupBounds({ width: width(), height: POPUP_HEIGHT }, mode, lastBounds);
  w.setBounds(bounds);
  log.info(`show (${ev.trigger}) at ${bounds.x},${bounds.y} ${bounds.width}x${bounds.height} [${mode}]`);
  shownAt = Date.now();
  w.show();
  w.focus();
  w.webContents.focus();
  if (isWin) {
    setTimeout(() => {
      const cur = popupWindow();
      if (cur && cur.isVisible() && !cur.isFocused()) {
        const h = popupHwnd();
        if (h !== null) forceForeground(h);
        cur.focus();
        cur.webContents.focus();
      }
    }, 50);
  }
  emit('popup:shown', ev);
}

export function hidePopup(reason: HideReason): void {
  const w = popupWindow();
  if (!w || !w.isVisible()) return;
  lastBounds = w.getBounds();
  w.hide();
  log.info(`hide (${reason})`);
  emit('popup:hidden', { reason });
  if (reason === 'escape') restoreFocus();
  else if (isMac && reason === 'paste') app.hide();
}

export function togglePopup(trigger: PopupShownEvent['trigger']): void {
  if (isPopupVisible()) hidePopup('escape');
  else showPopup(trigger);
}

export function setPopupLayout(preview: boolean): void {
  previewVisible = !!preview;
  const w = popupWindow();
  if (!w) return;
  const b = w.getBounds();
  const next = { ...b, width: width(), height: POPUP_HEIGHT };
  if (w.isVisible()) {
    const area = screen.getDisplayMatching(b).workArea;
    w.setBounds(clampInto(next, area));
  } else w.setBounds(next);
}

/** Applies appearance changes that affect the window material. */
export function applyPopupAppearance(s: Settings): void {
  const w = popupWindow();
  if (!w) return;
  if (isWin) {
    const acrylic = isWin11() && s.appearance.vibrancy;
    try {
      w.setBackgroundMaterial(acrylic ? 'acrylic' : 'none');
      w.setBackgroundColor(acrylic ? '#00000000' : solidBackground());
    } catch (err) {
      log.warn('setBackgroundMaterial failed', err);
    }
  } else if (isMac) {
    w.setVibrancy(s.appearance.vibrancy ? 'popover' : null);
  }
  if (s.appearance.previewVisible !== previewVisible && !w.isVisible()) setPopupLayout(s.appearance.previewVisible);
}

/** Lets the popup close for real (before-quit), otherwise closing just hides it. */
export function allowPopupClose(): void {
  allowClose = true;
}

export function destroyPopup(): void {
  allowClose = true;
  const w = popupWindow();
  if (w) w.destroy();
  win = null;
}
