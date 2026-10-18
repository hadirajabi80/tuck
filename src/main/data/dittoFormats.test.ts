import { describe, expect, it } from 'vitest';
import {
  decodeAnsiText, decodeDib, decodeRtf, decodeUtf16Text, extractCfHtml, isPng, parseDropFiles, premultiply,
} from './dittoFormats';

function cfHtml(fragment: string): Buffer {
  const pre = '<html><body>\r\n<!--StartFragment-->';
  const post = '<!--EndFragment-->\r\n</body></html>';
  const header = (a: number, b: number, c: number, d: number) =>
    `Version:0.9\r\nStartHTML:${String(a).padStart(10, '0')}\r\nEndHTML:${String(b).padStart(10, '0')}\r\n` +
    `StartFragment:${String(c).padStart(10, '0')}\r\nEndFragment:${String(d).padStart(10, '0')}\r\n`;
  const hLen = Buffer.byteLength(header(0, 0, 0, 0));
  const startHtml = hLen;
  const startFrag = startHtml + Buffer.byteLength(pre);
  const endFrag = startFrag + Buffer.byteLength(fragment);
  const endHtml = endFrag + Buffer.byteLength(post);
  return Buffer.from(header(startHtml, endHtml, startFrag, endFrag) + pre + fragment + post + '\0', 'utf8');
}

/** BITMAPINFOHEADER (40 bytes) */
function bih(o: { w: number; h: number; bpp: number; comp?: number; clrUsed?: number; size?: number }): Buffer {
  const b = Buffer.alloc(o.size ?? 40);
  b.writeUInt32LE(o.size ?? 40, 0);
  b.writeInt32LE(o.w, 4);
  b.writeInt32LE(o.h, 8);
  b.writeUInt16LE(1, 12);
  b.writeUInt16LE(o.bpp, 14);
  b.writeUInt32LE(o.comp ?? 0, 16);
  b.writeUInt32LE(o.clrUsed ?? 0, 32);
  return b;
}

describe('text decoders', () => {
  it('decodes UTF-16LE and stops at the first NUL', () => {
    const buf = Buffer.concat([Buffer.from('héllo 👋 مرحبا', 'utf16le'), Buffer.from([0, 0, 0x41, 0])]);
    expect(decodeUtf16Text(buf)).toBe('héllo 👋 مرحبا');
    expect(decodeUtf16Text(Buffer.from('no nul', 'utf16le'))).toBe('no nul');
  });
  it('decodes ANSI as windows-1252', () => {
    expect(decodeAnsiText(Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x00, 0x41]))).toBe('café €');
  });
  it('decodes RTF as latin1 without trailing NULs', () => {
    expect(decodeRtf(Buffer.from('{\\rtf1 hi}\0\0', 'latin1'))).toBe('{\\rtf1 hi}');
  });
});

describe('extractCfHtml', () => {
  it('uses StartFragment/EndFragment byte offsets (multi-byte safe)', () => {
    expect(extractCfHtml(cfHtml('<b>ünïcødé ✓</b>'))).toBe('<b>ünïcødé ✓</b>');
  });
  it('falls back to fragment markers when offsets are bogus', () => {
    const s = 'Version:0.9\r\nStartFragment:999999\r\nEndFragment:1000000\r\n<html><body><!--StartFragment--><i>x</i><!--EndFragment--></body></html>';
    expect(extractCfHtml(Buffer.from(s))).toBe('<i>x</i>');
  });
  it('falls back to <body> content, then to the markup after the header', () => {
    expect(extractCfHtml(Buffer.from('Version:0.9\r\n<html><body><p>a</p></body></html>'))).toBe('<p>a</p>');
    expect(extractCfHtml(Buffer.from('Version:0.9\r\n<p>loose</p>'))).toBe('<p>loose</p>');
    expect(extractCfHtml(Buffer.alloc(0))).toBeNull();
  });
});

describe('parseDropFiles', () => {
  it('parses wide DROPFILES', () => {
    const head = Buffer.alloc(20);
    head.writeUInt32LE(20, 0);
    head.writeUInt32LE(1, 16);
    const buf = Buffer.concat([head, Buffer.from('C:\\a b\\x.txt\0D:\\ü.png\0\0', 'utf16le')]);
    expect(parseDropFiles(buf)).toEqual(['C:\\a b\\x.txt', 'D:\\ü.png']);
  });
  it('parses ANSI DROPFILES and rejects garbage', () => {
    const head = Buffer.alloc(20);
    head.writeUInt32LE(20, 0);
    const buf = Buffer.concat([head, Buffer.from('C:\\one.txt\0C:\\two.txt\0\0', 'latin1')]);
    expect(parseDropFiles(buf)).toEqual(['C:\\one.txt', 'C:\\two.txt']);
    expect(parseDropFiles(Buffer.alloc(10))).toEqual([]);
    const bad = Buffer.alloc(24);
    bad.writeUInt32LE(5000, 0);
    expect(parseDropFiles(bad)).toEqual([]);
  });
});

describe('decodeDib', () => {
  it('decodes bottom-up 24-bpp with row padding', () => {
    // 2x2: bottom row first. stride = 8 (6 + 2 padding)
    const bottom = [0, 0, 255, 0, 255, 0, 0, 0]; // red, green
    const top = [255, 0, 0, 255, 255, 255, 0, 0]; // blue, white
    const dib = Buffer.concat([bih({ w: 2, h: 2, bpp: 24 }), Buffer.from([...bottom, ...top])]);
    const out = decodeDib(dib)!;
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);
    expect([...out.bgra]).toEqual([255, 0, 0, 255, 255, 255, 255, 255, 0, 0, 255, 255, 0, 255, 0, 255]);
    expect(out.hasAlpha).toBe(false);
  });

  it('handles top-down 32-bpp BI_RGB with zero alpha as opaque', () => {
    const px = Buffer.from([10, 20, 30, 0, 40, 50, 60, 0]);
    const out = decodeDib(Buffer.concat([bih({ w: 2, h: -1, bpp: 32 }), px]))!;
    expect([...out.bgra]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('keeps real alpha in 32-bpp images', () => {
    const px = Buffer.from([10, 20, 30, 128, 40, 50, 60, 255]);
    const out = decodeDib(Buffer.concat([bih({ w: 2, h: 1, bpp: 32 }), px]))!;
    expect(out.bgra[3]).toBe(128);
    expect(out.hasAlpha).toBe(true);
    const pm = premultiply(Buffer.from(out.bgra));
    expect([...pm.subarray(0, 4)]).toEqual([5, 10, 15, 128]);
  });

  it('decodes BI_BITFIELDS with masks after a 40-byte header (Ditto CF_DIB)', () => {
    const masks = Buffer.alloc(12);
    masks.writeUInt32LE(0x00ff0000, 0);
    masks.writeUInt32LE(0x0000ff00, 4);
    masks.writeUInt32LE(0x000000ff, 8);
    const px = Buffer.from([1, 2, 3, 0]);
    const out = decodeDib(Buffer.concat([bih({ w: 1, h: 1, bpp: 32, comp: 3 }), masks, px]))!;
    expect([...out.bgra]).toEqual([1, 2, 3, 255]);
  });

  it('decodes BITMAPV5HEADER bitfields with an alpha mask', () => {
    const h = bih({ w: 1, h: 1, bpp: 32, comp: 3, size: 124 });
    h.writeUInt32LE(0x00ff0000, 40);
    h.writeUInt32LE(0x0000ff00, 44);
    h.writeUInt32LE(0x000000ff, 48);
    h.writeUInt32LE(0xff000000, 52);
    const out = decodeDib(Buffer.concat([h, Buffer.from([9, 8, 7, 200])]))!;
    expect([...out.bgra]).toEqual([9, 8, 7, 200]);
  });

  it('decodes 16-bpp 5-6-5 bitfields', () => {
    const masks = Buffer.alloc(12);
    masks.writeUInt32LE(0xf800, 0);
    masks.writeUInt32LE(0x07e0, 4);
    masks.writeUInt32LE(0x001f, 8);
    const px = Buffer.alloc(4); // stride 4 (2 bytes + 2 padding)
    px.writeUInt16LE(0xffff, 0);
    const out = decodeDib(Buffer.concat([bih({ w: 1, h: 1, bpp: 16, comp: 3 }), masks, px]))!;
    expect([...out.bgra]).toEqual([255, 255, 255, 255]);
  });

  it('decodes 8-bpp and 1-bpp palettes', () => {
    const pal = Buffer.from([0, 0, 0, 0, 255, 255, 255, 0]); // black, white
    const p8 = Buffer.concat([bih({ w: 2, h: 1, bpp: 8, clrUsed: 2 }), pal, Buffer.from([1, 0, 0, 0])]);
    expect([...decodeDib(p8)!.bgra]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    const p1 = Buffer.concat([bih({ w: 3, h: 1, bpp: 1, clrUsed: 2 }), pal, Buffer.from([0b10100000, 0, 0, 0])]);
    expect([...decodeDib(p1)!.bgra]).toEqual([255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });

  it('rejects truncated, compressed and nonsense headers', () => {
    expect(decodeDib(Buffer.alloc(10))).toBeNull();
    expect(decodeDib(Buffer.concat([bih({ w: 100, h: 100, bpp: 24 }), Buffer.alloc(16)]))).toBeNull();
    expect(decodeDib(Buffer.concat([bih({ w: 1, h: 1, bpp: 24, comp: 1 }), Buffer.alloc(4)]))).toBeNull();
    expect(decodeDib(Buffer.concat([bih({ w: 0, h: 1, bpp: 24 }), Buffer.alloc(4)]))).toBeNull();
  });

  it('detects PNG signatures', () => {
    expect(isPng(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(true);
    expect(isPng(Buffer.from('GIF89a...'))).toBe(false);
  });
});
