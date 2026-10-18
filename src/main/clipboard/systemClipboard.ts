// Thin wrapper over Electron 44's asynchronous clipboard API (W3C-style ClipboardItem/Blob; the old sync
// readText/readHTML/readImage/readBuffer/availableFormats API no longer exists — verified at runtime).
// MIME types seen on Windows: text/plain, text/html, text/rtf, image/png, text/uri-list, and raw OS formats as
// `electron application/osclipboard;format="<name>"`.
import { clipboard, ClipboardItem } from 'electron';

export const rawType = (format: string): string => `electron application/osclipboard;format="${format}"`;

export interface ClipboardSnapshot {
  /** Lower-cased MIME types of the first clipboard item. */
  types: string[];
  item: ClipboardItem | null;
}

export async function snapshot(): Promise<ClipboardSnapshot> {
  const items = await clipboard.read();
  const item = items[0] ?? null;
  return { item, types: item ? item.types.map((t) => t.toLowerCase()) : [] };
}

function findType(snap: ClipboardSnapshot, type: string): string | null {
  if (!snap.item) return null;
  const want = type.toLowerCase();
  return snap.item.types.find((t) => t.toLowerCase() === want) ?? null;
}

export function hasType(snap: ClipboardSnapshot, type: string): boolean {
  return snap.types.includes(type.toLowerCase());
}

export async function getBlob(snap: ClipboardSnapshot, type: string): Promise<Blob | null> {
  const t = findType(snap, type);
  if (!t || !snap.item) return null;
  try {
    const v = (await snap.item.getType(t)) as unknown;
    return v instanceof Blob ? v : null;
  } catch {
    return null;
  }
}

export async function getBytes(snap: ClipboardSnapshot, type: string, maxBytes = Number.MAX_SAFE_INTEGER): Promise<Buffer | null> {
  const blob = await getBlob(snap, type);
  if (!blob || blob.size === 0 || blob.size > maxBytes) return null;
  return Buffer.from(await blob.arrayBuffer());
}

export async function getText(snap: ClipboardSnapshot, type: string, maxBytes = Number.MAX_SAFE_INTEGER): Promise<string | null> {
  const blob = await getBlob(snap, type);
  if (!blob || blob.size > maxBytes) return null;
  return blob.text();
}

export type ClipboardPayload = Record<string, string | Blob>;

export async function writeItem(payload: ClipboardPayload): Promise<void> {
  await clipboard.write([new ClipboardItem(payload)]);
}

export function blobOf(data: Uint8Array, type = 'application/octet-stream'): Blob {
  return new Blob([new Uint8Array(data.buffer, data.byteOffset, data.byteLength) as Uint8Array<ArrayBuffer>], { type });
}
