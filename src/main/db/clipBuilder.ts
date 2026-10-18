// Pure helpers that turn raw clipboard content into a NewClipInput (kind, meta, preview, hash, size).
// Shared by the clipboard reader, edits (clips:update), createText, Tuck JSON import and Ditto import.
import { createHash } from 'node:crypto';
import { analyzeText, filesPreview, imagePreview, makePreview } from '../../shared/detect';
import type { ClipImageMeta, ClipKind, ClipMeta } from '../../shared/types';

export interface NewClipInput {
  kind: ClipKind;
  text: string | null;
  html: string | null;
  rtf: string | null;
  files: string[] | null;
  /** For image clips: PNG bytes still to be written by the image store (only when the clip is new). */
  png: Buffer | null;
  /** Image dimensions (needed for the preview before the PNG is stored). */
  imageSize: { width: number; height: number } | null;
  /** Already stored image (e.g. restored rows). */
  image: ClipImageMeta | null;
  preview: string;
  hash: string;
  byteSize: number;
  sourceApp: string | null;
  meta: ClipMeta;
}

/** Content hash. Text-family kinds share one namespace so re-detection never breaks dedupe. */
export function clipHash(family: 'text' | 'image' | 'files', content: string | Uint8Array): string {
  const h = createHash('sha1');
  h.update(`${family}\0`);
  h.update(content);
  return h.digest('hex');
}

export function familyOf(kind: ClipKind): 'text' | 'image' | 'files' {
  return kind === 'image' ? 'image' : kind === 'files' ? 'files' : 'text';
}

const utf8Len = (s: string | null | undefined): number => (s ? Buffer.byteLength(s, 'utf8') : 0);

export function buildTextClip(text: string, opts: { html?: string | null; rtf?: string | null; sourceApp?: string | null } = {}): NewClipInput {
  const { kind, meta } = analyzeText(text);
  const html = opts.html || null;
  const rtf = opts.rtf || null;
  return {
    kind,
    text,
    html,
    rtf,
    files: null,
    png: null,
    imageSize: null,
    image: null,
    preview: makePreview(text) || '(whitespace)',
    hash: clipHash('text', text),
    byteSize: utf8Len(text) + utf8Len(html) + utf8Len(rtf),
    sourceApp: opts.sourceApp ?? null,
    meta,
  };
}

export function buildFilesClip(files: string[], sourceApp: string | null = null): NewClipInput {
  const text = files.join('\n');
  return {
    kind: 'files',
    text,
    html: null,
    rtf: null,
    files,
    png: null,
    imageSize: null,
    image: null,
    preview: filesPreview(files),
    hash: clipHash('files', text),
    byteSize: utf8Len(text),
    sourceApp,
    meta: { fileCount: files.length },
  };
}

export function buildImageClip(png: Buffer, width: number, height: number, sourceApp: string | null = null): NewClipInput {
  return {
    kind: 'image',
    text: null,
    html: null,
    rtf: null,
    files: null,
    png,
    imageSize: { width, height },
    image: null,
    preview: imagePreview(width, height),
    hash: clipHash('image', png),
    byteSize: png.byteLength,
    sourceApp,
    meta: {},
  };
}

/** Reads width/height from a PNG IHDR chunk; null when the bytes are not a PNG. */
export function pngSize(png: Uint8Array): { width: number; height: number } | null {
  if (png.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (png[i] !== sig[i]) return null;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}
