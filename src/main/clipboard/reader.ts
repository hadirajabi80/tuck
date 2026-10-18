// Reads the current clipboard into a NewClipInput: files > text (+html/rtf alternates) > image.
import { fileURLToPath } from 'node:url';
import { nativeImage, type NativeImage } from 'electron';
import { LIMITS, type Settings } from '../../shared/types';
import { buildFilesClip, buildImageClip, buildTextClip, type NewClipInput } from '../db/clipBuilder';
import { parseDropFiles } from '../data/dittoFormats';
import { logger } from '../log';
import { CF_HDROP, readClipboardFormat, win32Available } from '../native/user32';
import { parseFilenamesPlist } from './fileLists';
import { getBytes, getText, hasType, rawType, type ClipboardSnapshot } from './systemClipboard';

const log = logger('reader');

export interface ReadResult {
  input: NewClipInput;
  /** Decoded image (reused for the thumbnail). */
  decoded?: NativeImage;
}

/** Parses text/uri-list; returns paths only when every entry is a file:// URL. */
export function filesFromUriList(list: string): string[] {
  const urls = list
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  if (!urls.length || !urls.every((u) => /^file:\/\//i.test(u))) return [];
  const out: string[] = [];
  for (const u of urls) {
    try {
      out.push(fileURLToPath(u));
    } catch {
      return [];
    }
  }
  return out;
}

export async function readFiles(snap: ClipboardSnapshot): Promise<string[]> {
  if (process.platform === 'win32' && win32Available()) {
    const raw = readClipboardFormat(CF_HDROP, 8 * 1024 * 1024);
    if (raw) {
      const files = parseDropFiles(raw);
      if (files.length) return files;
    }
  }
  if (hasType(snap, 'text/uri-list')) {
    const files = filesFromUriList((await getText(snap, 'text/uri-list', 4 * 1024 * 1024)) ?? '');
    if (files.length) return files;
  }
  if (process.platform === 'darwin') {
    const plist = await getBytes(snap, rawType('NSFilenamesPboardType'), 8 * 1024 * 1024);
    if (plist) return parseFilenamesPlist(plist.toString('utf8'));
  }
  if (process.platform === 'win32') {
    const fnw = await getBytes(snap, rawType('FileNameW'), 64 * 1024);
    if (fnw) {
      const s = fnw.toString('utf16le');
      const nul = s.indexOf('\0');
      const p = (nul === -1 ? s : s.slice(0, nul)).trim();
      if (p) return [p];
    }
  }
  return [];
}

function within(s: string | null, max: number): string | null {
  if (!s) return null;
  return Buffer.byteLength(s, 'utf8') <= max ? s : null;
}

export async function readClipboard(settings: Settings, sourceApp: string | null, snap: ClipboardSnapshot): Promise<ReadResult | null> {
  if (!snap.item) return null;

  // 1. files
  if (settings.history.captureFiles) {
    const files = await readFiles(snap);
    if (files.length) return { input: buildFilesClip(files, sourceApp) };
  }

  // 2. text family
  if (hasType(snap, 'text/plain')) {
    const text = await getText(snap, 'text/plain', LIMITS.maxTextBytes * 4);
    if (text === null && hasType(snap, 'text/plain')) {
      log.info('skipping oversized text clip');
    }
    if (text && text.trim()) {
      if (Buffer.byteLength(text, 'utf8') > LIMITS.maxTextBytes) {
        log.info(`skipping text clip over ${LIMITS.maxTextBytes} bytes`);
        return null;
      }
      const html = hasType(snap, 'text/html') ? within(await getText(snap, 'text/html', LIMITS.maxHtmlBytes * 2), LIMITS.maxHtmlBytes) : null;
      const rtf = hasType(snap, 'text/rtf') ? within(await getText(snap, 'text/rtf', LIMITS.maxRtfBytes * 2), LIMITS.maxRtfBytes) : null;
      return { input: buildTextClip(text, { html, rtf, sourceApp }) };
    }
  }

  // 3. image
  const imageType = hasType(snap, 'image/png') ? 'image/png' : snap.types.find((t) => t.startsWith('image/'));
  if (settings.history.captureImages && imageType) {
    const bytes = await getBytes(snap, imageType, Math.max(settings.history.maxImageBytes * 4, 64 * 1024 * 1024));
    if (!bytes) return null;
    const img = nativeImage.createFromBuffer(bytes);
    if (img.isEmpty()) return null;
    const { width, height } = img.getSize();
    const png = imageType === 'image/png' ? bytes : img.toPNG();
    if (png.byteLength > settings.history.maxImageBytes) {
      log.info(`skipping image ${width}x${height}: ${png.byteLength} bytes > maxImageBytes`);
      return null;
    }
    return { input: buildImageClip(png, width, height, sourceApp), decoded: img };
  }
  return null;
}
