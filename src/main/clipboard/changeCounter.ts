// Cheap "did the clipboard change?" counter. Windows: GetClipboardSequenceNumber; macOS: NSPasteboard changeCount;
// fallback (koffi missing): FNV-1a hash of the type list + text (+ image size).
import { pasteboardChangeCount } from '../native/objc';
import { clipboardSequenceNumber } from '../native/user32';
import { getBlob, getText, snapshot } from './systemClipboard';

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

let mode: 'native' | 'fallback' | null = null;

export function nativeChangeCount(): number | null {
  if (process.platform === 'win32') return clipboardSequenceNumber();
  if (process.platform === 'darwin') return pasteboardChangeCount();
  return null;
}

export function changeCounterMode(): 'native' | 'fallback' {
  if (mode === null) mode = nativeChangeCount() === null ? 'fallback' : 'native';
  return mode;
}

export async function currentChangeCount(): Promise<number> {
  if (changeCounterMode() === 'native') {
    const n = nativeChangeCount();
    if (n !== null) return n;
  }
  const snap = await snapshot();
  let sig = `${snap.types.join('|')}\0${(await getText(snap, 'text/plain', 4 * 1024 * 1024)) ?? ''}`;
  const img = snap.types.find((t) => t.startsWith('image/'));
  if (img) sig += `\0${(await getBlob(snap, img))?.size ?? 0}`;
  return fnv1a(sig);
}
