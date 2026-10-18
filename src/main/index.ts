// PLACEHOLDER — replaced by main engineer.
// Minimal Phase-0 bootstrap: opens the popup and settings renderer routes in two plain windows so the
// scaffold (preload bridge, renderer bundle, hash routing) can be verified with `npm run dev`.
// None of the real boot order from DESIGN.md section C lives here yet.
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import type { WindowKind } from '../shared/types';

const preload = join(__dirname, '../preload/index.js');

function createWindow(kind: WindowKind): BrowserWindow {
  const win = new BrowserWindow({
    width: kind === 'popup' ? 760 : 920,
    height: kind === 'popup' ? 460 : 640,
    title: `Tuck — ${kind} (placeholder)`,
    show: true,
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
      additionalArguments: [`--window=${kind}`],
    },
  });

  // Surface renderer output in the terminal so `npm run dev` shows load errors.
  win.webContents.on('console-message', (e) => {
    console.log(`[renderer:${kind}] ${e.level}: ${e.message}`);
  });
  win.webContents.on('preload-error', (_e, path, error) => {
    console.error(`[preload:${kind}] failed to load ${path}:`, error);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[window:${kind}] did-fail-load ${code} ${desc} ${url}`);
  });
  win.webContents.on('did-finish-load', () => console.log(`[window:${kind}] loaded`));

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(`${devUrl}#/${kind}`);
  else void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: `/${kind}` });
  return win;
}

app.whenReady().then(() => {
  console.log(`[main] Tuck placeholder — electron ${process.versions.electron}, node ${process.versions.node}, ${process.platform}`);
  createWindow('popup');
  createWindow('settings');

  // Smoke-test hook: TUCK_SMOKE_EXIT_MS=5000 npm run dev → quits automatically.
  const exitMs = Number(process.env['TUCK_SMOKE_EXIT_MS'] ?? 0);
  if (exitMs > 0) setTimeout(() => app.quit(), exitMs);
});

app.on('window-all-closed', () => app.quit());
