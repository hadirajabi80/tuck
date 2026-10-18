// Name of the foreground app at copy time. Windows: exe basename via koffi; macOS: lsappinfo (best effort).
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { getForegroundWindow, processImagePath, windowProcessId } from '../native/user32';

let macCache: { at: number; name: string | null } | null = null;

function run(cmd: string, args: string[], timeoutMs: number): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

async function macFrontApp(): Promise<string | null> {
  if (macCache && Date.now() - macCache.at < 500) return macCache.name;
  let name: string | null = null;
  const front = await run('lsappinfo', ['front'], 150);
  const asn = front?.trim();
  if (asn) {
    const info = await run('lsappinfo', ['info', '-only', 'name', asn], 150);
    const m = info ? /"(?:LSDisplayName|name)"\s*=\s*"([^"]*)"/i.exec(info) : null;
    name = m?.[1] || null;
  }
  macCache = { at: Date.now(), name };
  return name;
}

export function winForegroundApp(): string | null {
  const hwnd = getForegroundWindow();
  if (hwnd === null) return null;
  const ids = windowProcessId(hwnd);
  if (!ids) return null;
  if (ids.pid === process.pid) return null; // our own window
  const path = processImagePath(ids.pid);
  return path ? basename(path) : null;
}

export async function currentSourceApp(): Promise<string | null> {
  try {
    if (process.platform === 'win32') return winForegroundApp();
    if (process.platform === 'darwin') return await macFrontApp();
  } catch {
    /* best effort */
  }
  return null;
}
