// Launch at login (HKCU Run key on Windows, Login Items on macOS). Skipped with a warning for dev builds,
// otherwise Electron.exe from node_modules would be registered.
import { app } from 'electron';
import { logger } from './log';

const log = logger('autostart');

export function launchAtLoginSupported(): boolean {
  return app.isPackaged && (process.platform === 'win32' || process.platform === 'darwin');
}

export function syncAutostart(enabled: boolean): void {
  if (!app.isPackaged) {
    log.warn(`not packaged — skipping setLoginItemSettings(openAtLogin=${enabled})`);
    return;
  }
  if (process.env['TUCK_USER_DATA']) {
    log.warn('TUCK_USER_DATA set (test instance) — skipping login item');
    return;
  }
  try {
    // openAsHidden was removed from Electron's typings; '--hidden' in args is what Tuck checks.
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    log.info(`openAtLogin=${enabled}`);
  } catch (err) {
    log.error('setLoginItemSettings failed', err);
  }
}

export function launchedHidden(): boolean {
  return process.argv.includes('--hidden') || app.getLoginItemSettings().wasOpenedAtLogin === true;
}
