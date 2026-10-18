// Writes clip content to the system clipboard, flagging the change as our own so the watcher skips it.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { logger } from '../log';
import { CF_HDROP, CF_UNICODETEXT, registeredFormat, writeClipboardFormats, type Hwnd } from '../native/user32';
import { buildDropFiles, buildFilenamesPlist } from './fileLists';
import { blobOf, rawType, writeItem, type ClipboardPayload } from './systemClipboard';
import { watcher } from './watcher';

const log = logger('writer');

export interface ClipContent {
  text?: string | null;
  html?: string | null;
  rtf?: string | null;
  /** Absolute path of a PNG to place on the clipboard. */
  imagePath?: string | null;
  files?: string[] | null;
}

let ownerHwnd: (() => Hwnd | null) | null = null;

/** Windows: our window used as clipboard owner for native CF_HDROP writes. */
export function setClipboardOwner(fn: () => Hwnd | null): void {
  ownerHwnd = fn;
}

/** Native CF_HDROP + CF_UNICODETEXT + Preferred DropEffect, so multi-file clips paste into Explorer. */
function writeFilesWindows(files: string[]): boolean {
  const owner = ownerHwnd?.();
  if (!owner) return false;
  const effect = registeredFormat('Preferred DropEffect');
  const entries = [
    { format: CF_HDROP, data: buildDropFiles(files) },
    { format: CF_UNICODETEXT, data: Buffer.from(`${files.join('\r\n')}\0`, 'utf16le') },
  ];
  if (effect) {
    const e = Buffer.alloc(4);
    e.writeUInt32LE(1, 0); // DROPEFFECT_COPY
    entries.push({ format: effect, data: e });
  }
  return writeClipboardFormats(owner, entries);
}

async function writeFiles(files: string[]): Promise<void> {
  if (process.platform === 'win32') {
    if (writeFilesWindows(files)) {
      log.debug('files written as native CF_HDROP');
      return;
    }
    log.warn('native CF_HDROP write failed — falling back to FileNameW');
    // Fallback: FileNameW carries only the first file; text keeps all paths.
    await writeItem({
      'text/plain': files.join('\r\n'),
      [rawType('FileNameW')]: blobOf(Buffer.from(`${files[0]}\0`, 'utf16le')),
    });
    return;
  }
  const payload: ClipboardPayload = {
    'text/plain': files.join('\n'),
    'text/uri-list': files.map((f) => pathToFileURL(f).href).join('\r\n'),
  };
  if (process.platform === 'darwin') payload[rawType('NSFilenamesPboardType')] = blobOf(Buffer.from(buildFilenamesPlist(files), 'utf8'));
  await writeItem(payload);
}

export async function writeContent(c: ClipContent): Promise<boolean> {
  watcher().beginOwnChange();
  try {
    if (c.files && c.files.length) {
      await writeFiles(c.files);
      return true;
    }
    if (c.imagePath) {
      const png = await readFile(c.imagePath);
      await writeItem({ 'image/png': blobOf(png, 'image/png') });
      return true;
    }
    const payload: ClipboardPayload = { 'text/plain': c.text ?? '' };
    if (c.html) payload['text/html'] = c.html;
    if (c.rtf) payload['text/rtf'] = c.rtf;
    await writeItem(payload);
    return true;
  } catch (err) {
    log.error('clipboard write failed', err);
    return false;
  } finally {
    await watcher().endOwnChange();
  }
}
