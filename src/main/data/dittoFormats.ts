// Pure decoders for Windows clipboard formats as stored by Ditto (Data.ooData) — also used for live CF_HDROP.
// No electron/node-only APIs besides Buffer, so they unit-test with synthetic fixtures.

const toBuf = (u8: Uint8Array): Buffer => Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength);

let cp1252: InstanceType<typeof TextDecoder> | null | undefined;
function ansiDecoder(): InstanceType<typeof TextDecoder> | null {
  if (cp1252 === undefined) {
    try {
      cp1252 = new TextDecoder('windows-1252');
    } catch {
      cp1252 = null;
    }
  }
  return cp1252;
}

/** CF_UNICODETEXT: UTF-16LE, terminated by the first U+0000. */
export function decodeUtf16Text(u8: Uint8Array): string {
  const b = toBuf(u8);
  const units = b.length >> 1;
  let end = units;
  for (let i = 0; i < units; i++) {
    if (b[i * 2] === 0 && b[i * 2 + 1] === 0) {
      end = i;
      break;
    }
  }
  return b.toString('utf16le', 0, end * 2);
}

function nulIndex(u8: Uint8Array): number {
  const i = u8.indexOf(0);
  return i === -1 ? u8.length : i;
}

/** CF_TEXT / CF_OEMTEXT: ANSI (decoded as windows-1252, latin1 fallback), terminated by the first NUL. */
export function decodeAnsiText(u8: Uint8Array): string {
  const slice = u8.subarray(0, nulIndex(u8));
  const dec = ansiDecoder();
  return dec ? dec.decode(slice) : toBuf(slice).toString('latin1');
}

/** "Rich Text Format": 7-bit RTF source, latin1, NUL-terminated. */
export function decodeRtf(u8: Uint8Array): string {
  return toBuf(u8.subarray(0, nulIndex(u8))).toString('latin1');
}

/**
 * "HTML Format" (CF_HTML): UTF-8 with a header of byte offsets. Returns the fragment
 * (StartFragment/EndFragment offsets → <!--StartFragment--> markers → <body> content → everything after the header).
 */
export function extractCfHtml(u8: Uint8Array): string | null {
  const data = u8.subarray(0, nulIndex(u8));
  if (!data.length) return null;
  const head = toBuf(data.subarray(0, Math.min(data.length, 2048))).toString('latin1');
  const num = (key: string): number | null => {
    const m = new RegExp(`${key}:\\s*(-?\\d+)`).exec(head);
    return m ? Number(m[1]) : null;
  };
  const sf = num('StartFragment');
  const ef = num('EndFragment');
  if (sf !== null && ef !== null && sf >= 0 && ef > sf && ef <= data.length) {
    const frag = toBuf(data.subarray(sf, ef)).toString('utf8').trim();
    if (frag) return frag;
  }
  const full = toBuf(data).toString('utf8');
  const a = full.indexOf('<!--StartFragment-->');
  const b = full.indexOf('<!--EndFragment-->');
  if (a !== -1 && b > a) {
    const frag = full.slice(a + '<!--StartFragment-->'.length, b).trim();
    if (frag) return frag;
  }
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(full);
  if (body?.[1]?.trim()) return body[1].trim();
  const sh = num('StartHTML');
  if (sh !== null && sh > 0 && sh < data.length) {
    const rest = toBuf(data.subarray(sh)).toString('utf8').trim();
    if (rest) return rest;
  }
  const lt = full.indexOf('<');
  return lt >= 0 ? full.slice(lt).trim() || null : null;
}

/** CF_HDROP: DROPFILES { DWORD pFiles; POINT pt; BOOL fNC; BOOL fWide } + double-NUL-terminated path list. */
export function parseDropFiles(u8: Uint8Array): string[] {
  if (u8.length < 20) return [];
  const b = toBuf(u8);
  const pFiles = b.readUInt32LE(0);
  const wide = b.readUInt32LE(16) !== 0;
  if (pFiles < 20 || pFiles >= b.length) return [];
  const out: string[] = [];
  if (wide) {
    let start = pFiles;
    for (let i = pFiles; i + 1 < b.length; i += 2) {
      if (b[i] === 0 && b[i + 1] === 0) {
        if (i === start) break;
        out.push(b.toString('utf16le', start, i));
        start = i + 2;
      }
    }
  } else {
    let start = pFiles;
    for (let i = pFiles; i < b.length; i++) {
      if (b[i] === 0) {
        if (i === start) break;
        out.push(decodeAnsiText(b.subarray(start, i)));
        start = i + 1;
      }
    }
  }
  return out.filter((p) => p.length > 0);
}

export interface DecodedBitmap {
  width: number;
  height: number;
  /** Straight (non-premultiplied) BGRA, top-down rows, width*4 bytes per row. */
  bgra: Buffer;
  /** True when at least one pixel is not fully opaque. */
  hasAlpha: boolean;
}

const BI_RGB = 0;
const BI_BITFIELDS = 3;
const BI_ALPHABITFIELDS = 6;
const MAX_PIXELS = 120_000_000;

function maskInfo(mask: number): { shift: number; bits: number } {
  if (!mask) return { shift: 0, bits: 0 };
  let shift = 0;
  while (((mask >>> shift) & 1) === 0) shift++;
  let bits = 0;
  while (shift + bits < 32 && ((mask >>> (shift + bits)) & 1) === 1) bits++;
  return { shift, bits };
}

function scaleTo8(v: number, bits: number): number {
  if (bits === 0) return 0;
  if (bits >= 8) return (v >>> (bits - 8)) & 0xff;
  return Math.round((v * 255) / ((1 << bits) - 1));
}

/**
 * CF_DIB / CF_DIBV5 (packed DIB: BITMAPINFOHEADER/V4/V5 + optional masks/palette + bits) → BGRA.
 * Supports 1/4/8 bpp palettes, 16/24/32 bpp, BI_RGB and BI_BITFIELDS/BI_ALPHABITFIELDS, bottom-up and top-down.
 * 32-bpp images whose alpha channel is entirely zero are treated as opaque. Returns null for anything else.
 */
export function decodeDib(u8: Uint8Array): DecodedBitmap | null {
  if (u8.length < 40) return null;
  const b = toBuf(u8);
  const biSize = b.readUInt32LE(0);
  if (biSize < 40 || biSize > b.length) return null;
  const width = b.readInt32LE(4);
  const rawHeight = b.readInt32LE(8);
  const bpp = b.readUInt16LE(14);
  const compression = b.readUInt32LE(16);
  const clrUsed = b.readUInt32LE(32);
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  if (width <= 0 || height <= 0 || width * height > MAX_PIXELS) return null;
  if (![1, 4, 8, 16, 24, 32].includes(bpp)) return null;
  if (compression !== BI_RGB && compression !== BI_BITFIELDS && compression !== BI_ALPHABITFIELDS) return null;

  let offset = biSize;
  let rMask = 0, gMask = 0, bMask = 0, aMask = 0;
  const bitfields = compression === BI_BITFIELDS || compression === BI_ALPHABITFIELDS;
  if (bitfields) {
    if (bpp !== 16 && bpp !== 32) return null;
    if (biSize >= 52) {
      rMask = b.readUInt32LE(40);
      gMask = b.readUInt32LE(44);
      bMask = b.readUInt32LE(48);
      if (biSize >= 56) aMask = b.readUInt32LE(52);
    } else {
      const n = compression === BI_ALPHABITFIELDS ? 4 : 3;
      if (b.length < offset + n * 4) return null;
      rMask = b.readUInt32LE(offset);
      gMask = b.readUInt32LE(offset + 4);
      bMask = b.readUInt32LE(offset + 8);
      if (n === 4) aMask = b.readUInt32LE(offset + 12);
      offset += n * 4;
    }
  } else if (bpp === 16) {
    rMask = 0x7c00; gMask = 0x03e0; bMask = 0x001f; // 5-5-5
  } else if (bpp === 32) {
    rMask = 0x00ff0000; gMask = 0x0000ff00; bMask = 0x000000ff; aMask = 0xff000000;
  }

  let palette: Buffer | null = null;
  if (bpp <= 8) {
    const entries = clrUsed || 1 << bpp;
    if (entries > 256 || b.length < offset + entries * 4) return null;
    palette = b.subarray(offset, offset + entries * 4);
    offset += entries * 4;
  } else if (clrUsed > 0 && clrUsed <= 256) {
    offset += clrUsed * 4; // optional colour table for true-colour DIBs
  }

  const stride = Math.floor((width * bpp + 31) / 32) * 4;
  const needed = stride * height;
  // Some producers write redundant masks after a V4/V5 header; detect by exact size.
  if (bitfields && biSize > 40 && b.length - offset - needed === 12) offset += 12;
  if (b.length - offset < needed) return null;

  const out = Buffer.alloc(width * height * 4);
  const r = maskInfo(rMask), g = maskInfo(gMask), bl = maskInfo(bMask);
  // Without an explicit alpha mask, the bits not used by R/G/B are an alpha candidate (32 bpp only).
  const effA = bpp === 32 && !aMask ? ~(rMask | gMask | bMask) >>> 0 : aMask;
  const a = maskInfo(effA);
  let anyAlpha = false;
  let translucent = false;

  for (let y = 0; y < height; y++) {
    const srcRow = offset + (topDown ? y : height - 1 - y) * stride;
    let o = y * width * 4;
    for (let x = 0; x < width; x++, o += 4) {
      if (bpp === 24) {
        const p = srcRow + x * 3;
        out[o] = b[p]!;
        out[o + 1] = b[p + 1]!;
        out[o + 2] = b[p + 2]!;
        out[o + 3] = 255;
      } else if (bpp === 32 || bpp === 16) {
        const v = bpp === 32 ? b.readUInt32LE(srcRow + x * 4) : b.readUInt16LE(srcRow + x * 2);
        out[o] = scaleTo8((v & bMask) >>> bl.shift, bl.bits);
        out[o + 1] = scaleTo8((v & gMask) >>> g.shift, g.bits);
        out[o + 2] = scaleTo8((v & rMask) >>> r.shift, r.bits);
        if (a.bits) {
          const av = scaleTo8(((v & effA) >>> 0) >>> a.shift, a.bits);
          out[o + 3] = av;
          if (av) anyAlpha = true;
          if (av !== 255) translucent = true;
        } else out[o + 3] = 255;
      } else {
        const bitPos = x * bpp;
        const byte = b[srcRow + (bitPos >> 3)]!;
        const idx = (byte >> (8 - bpp - (bitPos & 7))) & ((1 << bpp) - 1);
        const pi = idx * 4;
        if (!palette || pi + 3 >= palette.length) {
          out[o] = out[o + 1] = out[o + 2] = 0;
        } else {
          out[o] = palette[pi]!;
          out[o + 1] = palette[pi + 1]!;
          out[o + 2] = palette[pi + 2]!;
        }
        out[o + 3] = 255;
      }
    }
  }

  if (a.bits && !anyAlpha) {
    for (let i = 3; i < out.length; i += 4) out[i] = 255;
    translucent = false;
  }
  return { width, height, bgra: out, hasAlpha: translucent };
}

/** In-place premultiply of straight BGRA (nativeImage.createFromBitmap expects premultiplied N32). */
export function premultiply(bgra: Buffer): Buffer {
  for (let i = 0; i < bgra.length; i += 4) {
    const a = bgra[i + 3]!;
    if (a === 255) continue;
    bgra[i] = Math.round((bgra[i]! * a) / 255);
    bgra[i + 1] = Math.round((bgra[i + 1]! * a) / 255);
    bgra[i + 2] = Math.round((bgra[i + 2]! * a) / 255);
  }
  return bgra;
}

export const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

export function isPng(u8: Uint8Array): boolean {
  return u8.length > 8 && PNG_MAGIC.every((v, i) => u8[i] === v);
}
