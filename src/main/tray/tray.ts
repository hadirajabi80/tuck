// Tray / menu-bar icon: Open Tuck, Pause capture, 5 recent clips, Launch at login, Settings…, Quit.
// Windows: left click toggles the popup. macOS: click opens the menu.
import { Menu, nativeImage, Tray, type MenuItemConstructorOptions, type NativeImage } from 'electron';
import { pretty } from '../../shared/accelerator';
import type { Platform } from '../../shared/types';
import { logger } from '../log';
import { iconPath } from '../paths';

const log = logger('tray');
const isMac = process.platform === 'darwin';

export interface TrayDeps {
  platform: Platform;
  openPopup: () => void;
  togglePopup: () => void;
  openSettings: () => void;
  quit: () => void;
  isPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  launchAtLogin: () => boolean;
  setLaunchAtLogin: (on: boolean) => void;
  launchAtLoginSupported: () => boolean;
  openAccelerator: () => string;
  recent: () => Array<{ id: string; label: string }>;
  copyClip: (id: string) => void;
  /** Version of a downloaded update waiting to install, else null. */
  updateReady: () => string | null;
  installUpdate: () => void;
  checkForUpdates: () => void;
}

let tray: Tray | null = null;
let deps: TrayDeps | null = null;
let normalIcon: NativeImage | null = null;
let pausedIcon: NativeImage | null = null;

function withDot(img: NativeImage): NativeImage {
  const out = nativeImage.createEmpty();
  // Same DPI steps as build/tray@Nx.png, so the paused icon stays as crisp as the normal one.
  for (const scaleFactor of [1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
    const size = img.getSize(scaleFactor);
    const w = Math.round(size.width * scaleFactor);
    const h = Math.round(size.height * scaleFactor);
    if (!w || !h) continue;
    const bmp = Buffer.from(img.toBitmap({ scaleFactor }));
    if (bmp.length !== w * h * 4) continue; // no exact bitmap at this scale (fractional DPI rounding)
    const r = Math.max(2, Math.round(w * 0.2));
    const cx = w - r - 1;
    const cy = h - r - 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r + 1) continue;
        const i = (y * w + x) * 4;
        if (d > r) {
          bmp[i + 3] = 0; // 1px transparent ring for contrast
          continue;
        }
        bmp[i] = 0x1b; // B  (#C7891B amber, premultiplied opaque)
        bmp[i + 1] = 0x89; // G
        bmp[i + 2] = 0xc7; // R
        bmp[i + 3] = 0xff;
      }
    }
    out.addRepresentation({ scaleFactor, width: w, height: h, buffer: nativeImage.createFromBitmap(bmp, { width: w, height: h }).toPNG() });
  }
  if (isMac) out.setTemplateImage(true);
  return out.isEmpty() ? img : out;
}

function loadIcons(): void {
  const file = isMac ? 'trayTemplate.png' : 'tray.png';
  normalIcon = nativeImage.createFromPath(iconPath(file));
  if (normalIcon.isEmpty()) log.warn('tray icon missing at', iconPath(file));
  if (isMac) normalIcon.setTemplateImage(true);
  try {
    pausedIcon = withDot(normalIcon);
  } catch (err) {
    log.warn('paused icon failed', err);
    pausedIcon = normalIcon;
  }
}

function truncate(s: string, n = 48): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one || '(empty)';
}

function buildMenu(): Menu {
  const d = deps!;
  const accel = d.openAccelerator();
  const recent = d.recent();
  const ready = d.updateReady();
  const items: MenuItemConstructorOptions[] = [
    ...(ready
      ? ([{ label: `Restart to update to v${ready}`, click: () => d.installUpdate() }, { type: 'separator' }] satisfies MenuItemConstructorOptions[])
      : []),
    { label: 'Open Tuck', accelerator: accel || undefined, registerAccelerator: false, click: () => d.openPopup() },
    { label: 'Pause capture', type: 'checkbox', checked: d.isPaused(), click: (mi) => d.setPaused(mi.checked) },
    { type: 'separator' },
    ...(recent.length
      ? recent.map<MenuItemConstructorOptions>((c) => ({ label: truncate(c.label).replace(/&/g, '&&'), click: () => d.copyClip(c.id) }))
      : [{ label: 'No clips yet', enabled: false }]),
    { type: 'separator' },
    {
      label: 'Launch at login',
      type: 'checkbox',
      checked: d.launchAtLogin(),
      enabled: d.launchAtLoginSupported(),
      click: (mi) => d.setLaunchAtLogin(mi.checked),
    },
    { label: 'Settings…', accelerator: isMac ? 'Command+,' : undefined, registerAccelerator: false, click: () => d.openSettings() },
    { label: 'Check for updates…', enabled: !ready, click: () => d.checkForUpdates() },
    { type: 'separator' },
    { label: 'Quit Tuck', click: () => d.quit() },
  ];
  return Menu.buildFromTemplate(items);
}

function refreshLook(): void {
  if (!tray || !deps) return;
  const paused = deps.isPaused();
  const icon = paused ? pausedIcon : normalIcon;
  if (icon && !icon.isEmpty()) tray.setImage(icon);
  const accel = deps.openAccelerator();
  tray.setToolTip(paused ? 'Tuck — capture paused' : `Tuck${accel ? ` — ${pretty(accel, deps.platform)}` : ''}`);
}

/** Refreshes icon + tooltip (the menu itself is built fresh every time it opens). */
export function rebuildTray(): void {
  if (!tray || !deps) return;
  refreshLook();
}

function popMenu(): void {
  if (!tray || !deps) return;
  try {
    tray.popUpContextMenu(buildMenu());
  } catch (err) {
    log.error('menu failed', err);
  }
}

export function createTray(d: TrayDeps): Tray | null {
  deps = d;
  try {
    loadIcons();
    tray = new Tray(normalIcon ?? nativeImage.createEmpty());
    if (isMac) {
      tray.on('click', popMenu);
      tray.on('right-click', popMenu);
    } else {
      tray.on('click', () => d.togglePopup());
      tray.on('right-click', popMenu);
    }
    rebuildTray();
    log.info('created');
    return tray;
  } catch (err) {
    log.error('tray creation failed', err);
    return null;
  }
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
