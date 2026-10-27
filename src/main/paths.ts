// Filesystem locations used by the main process. All paths derive from Electron's userData directory,
// which can be redirected for tests / QA with TUCK_USER_DATA=<dir> (applied in applyUserDataOverride()).
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { app } from 'electron';

let applied = false;

/**
 * Honour TUCK_USER_DATA before anything touches userData (single-instance lock, logs, settings, db).
 * Must be called at module load of index.ts, before app.whenReady().
 */
export function applyUserDataOverride(): string | null {
  if (applied) return null;
  applied = true;
  const dir = process.env['TUCK_USER_DATA'];
  if (!dir) return null;
  const abs = resolve(dir);
  mkdirSync(abs, { recursive: true });
  app.setPath('userData', abs);
  // Keep Chromium's caches next to it as well so parallel test instances don't collide.
  app.setPath('sessionData', join(abs, 'session'));
  return abs;
}

export const paths = {
  get userData(): string {
    return app.getPath('userData');
  },
  get settingsFile(): string {
    return join(this.userData, 'settings.json');
  },
  get dbFile(): string {
    return join(this.userData, 'tuck.db');
  },
  get imagesDir(): string {
    return join(this.userData, 'images');
  },
  get backupsDir(): string {
    return join(this.userData, 'backups');
  },
  get thumbsDir(): string {
    return join(this.userData, 'images', 'thumbs');
  },
  get logsDir(): string {
    return join(this.userData, 'logs');
  },
  get logFile(): string {
    return join(this.userData, 'logs', 'main.log');
  },
  get preload(): string {
    return join(__dirname, '../preload/index.js');
  },
  get rendererHtml(): string {
    return join(__dirname, '../renderer/index.html');
  },
};

/** Runtime icon (tray / app png). Packaged: <resources>/icons/<file>; dev: <appPath>/build/<file>. See DESIGN §0. */
export function iconPath(file: string): string {
  return app.isPackaged ? join(process.resourcesPath, 'icons', file) : join(app.getAppPath(), 'build', file);
}
