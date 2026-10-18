// Loads a renderer route (dev server or built files) and forwards renderer diagnostics to the main log.
import type { BrowserWindow } from 'electron';
import type { WindowKind } from '../../shared/types';
import { logger } from '../log';
import { paths } from '../paths';

export function loadRoute(win: BrowserWindow, kind: WindowKind): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  const p = devUrl ? win.loadURL(`${devUrl}#/${kind}`) : win.loadFile(paths.rendererHtml, { hash: `/${kind}` });
  p.catch((err: Error) => logger(`window:${kind}`).error('load failed', err.message));
}

export function attachWindowLogging(win: BrowserWindow, kind: WindowKind): void {
  const log = logger(`renderer:${kind}`);
  win.webContents.on('console-message', (e) => {
    const level = String(e.level);
    if (level === 'error') log.error(e.message);
    else if (level === 'warning') log.warn(e.message);
    else log.info(e.message);
  });
  win.webContents.on('preload-error', (_e, path, error) => log.error(`preload failed ${path}:`, error));
  win.webContents.on('did-fail-load', (_e, code, desc, url) => log.error(`did-fail-load ${code} ${desc} ${url}`));
  win.webContents.on('did-finish-load', () => log.info('loaded'));
}
