// Remembers which window had focus before the popup appeared and gives focus back to it.
import { app } from 'electron';
import { logger } from '../log';
import { forceForeground, getForegroundWindow, windowClassName, windowProcessId, type Hwnd } from '../native/user32';

/** Shell surfaces that get focus when the user clicks the tray icon — never paste targets. */
const SHELL_CLASSES = new Set(['Shell_TrayWnd', 'Shell_SecondaryTrayWnd', 'NotifyIconOverflowWindow', 'TopLevelWindowForOverflowXamlIsland', 'Windows.UI.Core.CoreWindow']);

const log = logger('focus');
let previous: Hwnd | null = null;

/** Windows: store the current foreground HWND (ignoring our own windows). macOS: nothing to do. */
export function captureFocus(): void {
  if (process.platform !== 'win32') return;
  const hwnd = getForegroundWindow();
  if (hwnd === null) return;
  const ids = windowProcessId(hwnd);
  if (ids && ids.pid === process.pid) return; // our own popup/settings — keep the earlier target
  const cls = windowClassName(hwnd);
  if (cls && SHELL_CLASSES.has(cls)) return;
  previous = hwnd;
}

export function previousWindow(): Hwnd | null {
  return previous;
}

/** Returns focus to the captured window. macOS: app.hide() hands activation back to the previous app. */
export function restoreFocus(): boolean {
  if (process.platform === 'darwin') {
    app.hide();
    return true;
  }
  if (process.platform !== 'win32' || previous === null) return false;
  const ok = forceForeground(previous);
  if (!ok) log.warn('could not restore foreground window');
  return ok;
}
