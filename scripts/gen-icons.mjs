#!/usr/bin/env node
// Generates Tuck's icon assets into build/ with zero dependencies (node:zlib + a tiny rasteriser).
//   build/icon.svg            vector source (same geometry as the PNGs)
//   build/icon.png            1024×1024 app icon (electron-builder derives .icns on macOS from it)
//   build/icon.ico            Windows app icon: 16/24/32/48/64/128 (BMP) + 256 (PNG)
//   build/tray.png, tray@2x.png, tray.ico   Windows tray (accent glyph, readable on light & dark taskbars)
//   build/trayTemplate.png, trayTemplate@2x.png   macOS menu-bar template (black + alpha)
// Concept (DESIGN.md §A): rounded-square dark-indigo card whose top-right corner is folded over;
// the fold is a small accent-coloured triangle. Run: `npm run icons`.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'build');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- geometry (unit square 0..1)

const APP = {
  L: 0.098, T: 0.098, R: 0.902, B: 0.902, // card bounds (macOS-style 10% margin)
  radius: 0.185,
  fold: 0.27,                                // leg length of the folded triangle
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

const CARD_TOP = hex('#33318C');
const CARD_BOTTOM = hex('#16153D');
const FLAP_LIGHT = hex('#A9A6FF');
const FLAP_DARK = hex('#6E6ADE');
const WHITE = [255, 255, 255];

/** Inside a rounded rectangle (inset by `s`). */
function inRoundRect(x, y, g, s = 0) {
  const L = g.L + s, T = g.T + s, R = g.R - s, B = g.B - s, r = Math.max(0, g.radius - s);
  if (x < L || x > R || y < T || y > B) return false;
  const cx = x < L + r ? L + r : x > R - r ? R - r : x;
  const cy = y < T + r ? T + r : y > B - r ? B - r : y;
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

/** Below/left of the fold diagonal from (R-F, T) to (R, T+F), moved inward by `s`. */
function belowFold(x, y, g, s = 0) {
  return x - y <= g.R - g.fold - g.T - s * Math.SQRT2;
}

function inCard(x, y, g, s = 0) {
  return inRoundRect(x, y, g, s) && belowFold(x, y, g, s);
}

/** Distance (approx.) outside the flap triangle — for its drop shadow. */
function flapOutsideDist(x, y, g) {
  const x0 = g.R - g.fold, y1 = g.T + g.fold;
  const d1 = x0 - x;                                  // left of the vertical leg
  const d2 = y - y1;                                  // below the horizontal leg
  const d3 = ((x - y) - (g.R - g.fold - g.T)) / Math.SQRT2; // beyond the diagonal (cut-away side)
  return Math.max(d1, d2, d3);
}

function inBar(x, y, x0, x1, y0, y1) {
  const r = (y1 - y0) / 2;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = (y0 + y1) / 2;
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

const BARS = [
  { x0: 0.22, x1: 0.60, y0: 0.415, y1: 0.475, a: 0.95 },
  { x0: 0.22, x1: 0.74, y0: 0.545, y1: 0.605, a: 0.62 },
  { x0: 0.22, x1: 0.52, y0: 0.675, y1: 0.735, a: 0.40 },
];

// ---------------------------------------------------------------- samplers → straight RGBA

/** Composite `top` (rgb, alpha) over `dst` [r,g,b,a] (straight alpha). */
function over(dst, rgb, a) {
  if (a <= 0) return;
  const outA = a + dst[3] * (1 - a);
  if (outA <= 0) return;
  for (let i = 0; i < 3; i++) dst[i] = (rgb[i] * a + dst[i] * dst[3] * (1 - a)) / outA;
  dst[3] = outA;
}

function sampleApp(x, y, size) {
  const g = APP;
  const px = [0, 0, 0, 0];
  if (inCard(x, y, g)) {
    const t = clamp01((y - g.T) / (g.B - g.T));
    over(px, mix(CARD_TOP, CARD_BOTTOM, t), 1);
    // subtle top highlight hairline
    if (!inCard(x, y, g, 0.006)) over(px, WHITE, 0.12 * clamp01(1 - (y - g.T) / 0.3));
    if (size >= 48) for (const b of BARS) if (inBar(x, y, b.x0, b.x1, b.y0, b.y1)) over(px, WHITE, b.a);
    // flap drop shadow onto the card
    const d = flapOutsideDist(x + 0.004, y - 0.008, g);
    if (d > 0) over(px, [0, 0, 0], 0.38 * clamp01(1 - d / 0.05) ** 1.6);
  }
  if (inFlapTri(x, y, g)) {
    // gradient perpendicular to the diagonal: lighter at the crease
    const dist = ((g.R - g.fold - g.T) - (x - y)) / Math.SQRT2; // 0 at the crease → grows toward the corner
    const t = clamp01(dist / (g.fold / Math.SQRT2));
    over(px, mix(FLAP_LIGHT, FLAP_DARK, t), 1);
  }
  return px;
}

/** The folded flap: right triangle (R-F,T) (R,T+F) (R-F,T+F), right angle at bottom-left; inset by `s`. */
function inFlapTri(x, y, g, s = 0) {
  const x0 = g.R - g.fold + s, y1 = g.T + g.fold - s;
  return x >= x0 && y <= y1 && (x - y) <= (g.R - g.fold - g.T) - s * Math.SQRT2;
}

// Tray glyph: a clipboard (board + clip + two text lines), laid out on a 16-unit pixel grid so
// edges land on whole pixels at 16/32/48 px and stay crisp in the Windows notification area.
const U = 1 / 16;
const BOARD = { L: 2 * U, T: 2.5 * U, R: 14 * U, B: 15.5 * U, radius: 2.5 * U };
const CLIP = { L: 5 * U, T: 0.5 * U, R: 11 * U, B: 4.5 * U, radius: 1.25 * U };
const CLIP_GAP = 1 * U;                                   // transparent ring that separates clip from board
const LINES = [
  { x0: 5 * U, x1: 11 * U, y0: 7.5 * U, y1: 9 * U },
  { x0: 5 * U, x1: 9 * U, y0: 11 * U, y1: 12.5 * U },
];

const inRR = (x, y, r, s = 0) =>
  inRoundRect(x, y, { L: r.L + s, T: r.T + s, R: r.R - s, B: r.B - s, radius: Math.max(0, r.radius - s) });
const inLine = (x, y) => LINES.some((l) => inBar(x, y, l.x0, l.x1, l.y0, l.y1));

/** Windows tray: accent clipboard with a white clip and lines — readable on light and dark taskbars. */
function sampleTrayWin(x, y) {
  const px = [0, 0, 0, 0];
  const inClipZone = inRR(x, y, CLIP, -CLIP_GAP);
  if (inRR(x, y, BOARD) && !inClipZone) {
    const t = clamp01((y - BOARD.T) / (BOARD.B - BOARD.T));
    over(px, mix(hex('#7C78EE'), hex('#4F4FCB'), t), 1);
    if (inLine(x, y)) over(px, WHITE, 0.95);
  }
  if (inRR(x, y, CLIP)) {
    over(px, hex('#3B39A6'), 1);                          // dark rim: visible on a light taskbar
    if (inRR(x, y, CLIP, 0.75 * U)) over(px, WHITE, 1);   // light core: visible on a dark taskbar
  }
  return px;
}

// App icon (large sizes + macOS): the brand tile with a white clipboard on it. Small Windows sizes (taskbar,
// Explorer lists) use the tray glyph instead, which stays legible at 16–48 px.
const T_BOARD = { L: 0.29, T: 0.27, R: 0.71, B: 0.8, radius: 0.07 };
const T_CLIP = { L: 0.39, T: 0.195, R: 0.61, B: 0.325, radius: 0.04 };
const T_LINES = [
  { x0: 0.36, x1: 0.64, y0: 0.45, y1: 0.495 },
  { x0: 0.36, x1: 0.58, y0: 0.565, y1: 0.61 },
  { x0: 0.36, x1: 0.62, y0: 0.68, y1: 0.725 },
];
const TILE = { L: APP.L, T: APP.T, R: APP.R, B: APP.B, radius: APP.radius };

function sampleAppTile(x, y) {
  const px = [0, 0, 0, 0];
  if (!inRoundRect(x, y, TILE)) return px;
  over(px, mix(CARD_TOP, CARD_BOTTOM, clamp01((y - TILE.T) / (TILE.B - TILE.T))), 1);
  if (!inRoundRect(x, y, { ...TILE, L: TILE.L + 0.006, T: TILE.T + 0.006, R: TILE.R - 0.006, B: TILE.B - 0.006, radius: TILE.radius - 0.006 }))
    over(px, WHITE, 0.12 * clamp01(1 - (y - TILE.T) / 0.3));       // top hairline highlight
  const inClipZone = inRR(x, y, T_CLIP, -0.028);
  if (inRR(x, y, { ...T_BOARD, T: T_BOARD.T + 0.02, B: T_BOARD.B + 0.02 }) && !inRR(x, y, T_BOARD) && !inClipZone)
    over(px, [0, 0, 0], 0.28);                                       // soft drop shadow
  if (inRR(x, y, T_BOARD) && !inClipZone) {
    over(px, mix(WHITE, hex('#E4E3FF'), clamp01((y - T_BOARD.T) / (T_BOARD.B - T_BOARD.T))), 1);
    if (T_LINES.some((l) => inBar(x, y, l.x0, l.x1, l.y0, l.y1))) over(px, hex('#4F4FCB'), 0.9);
  }
  if (inRR(x, y, T_CLIP)) over(px, mix(FLAP_LIGHT, FLAP_DARK, clamp01((y - T_CLIP.T) / (T_CLIP.B - T_CLIP.T))), 1);
  return px;
}

/** macOS template: board outline + solid clip + lines in black, transparent elsewhere. */
function sampleTrayTemplate(x, y, size) {
  const stroke = (size <= 16 ? 1.5 : 1.25) * U;
  const px = [0, 0, 0, 0];
  const inClipZone = inRR(x, y, CLIP, -CLIP_GAP);
  if (inRR(x, y, BOARD) && !inRR(x, y, BOARD, stroke) && !inClipZone) over(px, [0, 0, 0], 1);
  if (inLine(x, y)) over(px, [0, 0, 0], 1);
  if (inRR(x, y, CLIP)) over(px, [0, 0, 0], 1);
  return px;
}

function render(size, sampler, ss = 4) {
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      // average premultiplied samples
      let r = 0, gg = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const s = sampler((pxi + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, size);
          r += s[0] * s[3]; gg += s[1] * s[3]; b += s[2] * s[3]; a += s[3];
        }
      }
      const n = ss * ss;
      const o = (py * size + pxi) * 4;
      const A = a / n;
      buf[o] = A > 0 ? Math.round(r / a) : 0;
      buf[o + 1] = A > 0 ? Math.round(gg / a) : 0;
      buf[o + 2] = A > 0 ? Math.round(b / a) : 0;
      buf[o + 3] = Math.round(A * 255);
    }
  }
  return buf;
}

// ---------------------------------------------------------------- encoders

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** 32-bpp BMP (DIB) icon image: BITMAPINFOHEADER + bottom-up BGRA + AND mask. */
function encodeIcoBmp(rgba, w, h) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0); header.writeInt32LE(w, 4); header.writeInt32LE(h * 2, 8);
  header.writeUInt16LE(1, 12); header.writeUInt16LE(32, 14); header.writeUInt32LE(0, 16);
  const maskStride = Math.ceil(w / 32) * 4;
  header.writeUInt32LE(w * h * 4 + maskStride * h, 20);
  const pixels = Buffer.alloc(w * h * 4);
  const mask = Buffer.alloc(maskStride * h);
  for (let y = 0; y < h; y++) {
    const dy = h - 1 - y; // bottom-up
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, d = (dy * w + x) * 4;
      pixels[d] = rgba[s + 2]; pixels[d + 1] = rgba[s + 1]; pixels[d + 2] = rgba[s]; pixels[d + 3] = rgba[s + 3];
      if (rgba[s + 3] === 0) mask[dy * maskStride + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return Buffer.concat([header, pixels, mask]);
}

function encodeIco(images /* [{size, rgba}] */) {
  const entries = images.map(({ size, rgba }) => ({ size, data: size >= 256 ? encodePng(rgba, size, size) : encodeIcoBmp(rgba, size, size) }));
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach((e, i) => {
    const o = i * 16;
    dir[o] = e.size >= 256 ? 0 : e.size; dir[o + 1] = e.size >= 256 ? 0 : e.size;
    dir[o + 2] = 0; dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(e.data.length, o + 8); dir.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, dir, ...entries.map((e) => e.data)]);
}

// ---------------------------------------------------------------- SVG source

function svg() {
  const S = 1024, p = (v) => +(v * S).toFixed(1);
  const rr = (r, fill, extra = '') => `<rect x="${p(r.L)}" y="${p(r.T)}" width="${p(r.R - r.L)}" height="${p(r.B - r.T)}" rx="${p(r.radius)}" fill="${fill}"${extra}/>`;
  const lines = T_LINES.map((l) => `<rect x="${p(l.x0)}" y="${p(l.y0)}" width="${p(l.x1 - l.x0)}" height="${p(l.y1 - l.y0)}" rx="${p((l.y1 - l.y0) / 2)}" fill="#4F4FCB" fill-opacity="0.9"/>`).join('\n  ');
  const gap = { L: T_CLIP.L - 0.028, T: T_CLIP.T - 0.028, R: T_CLIP.R + 0.028, B: T_CLIP.B + 0.028, radius: T_CLIP.radius + 0.028 };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}">
  <!-- Tuck app icon — generated by scripts/gen-icons.mjs; edit the script, not this file. -->
  <defs>
    <linearGradient id="tile" x1="0" y1="${p(TILE.T)}" x2="0" y2="${p(TILE.B)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#33318C"/><stop offset="1" stop-color="#16153D"/></linearGradient>
    <linearGradient id="board" x1="0" y1="${p(T_BOARD.T)}" x2="0" y2="${p(T_BOARD.B)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#E4E3FF"/></linearGradient>
    <linearGradient id="clip" x1="0" y1="${p(T_CLIP.T)}" x2="0" y2="${p(T_CLIP.B)}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#A9A6FF"/><stop offset="1" stop-color="#6E6ADE"/></linearGradient>
    <mask id="gap"><rect width="${S}" height="${S}" fill="#fff"/>${rr(gap, '#000')}</mask>
  </defs>
  ${rr(TILE, 'url(#tile)')}
  <g mask="url(#gap)">${rr({ ...T_BOARD, T: T_BOARD.T + 0.02, B: T_BOARD.B + 0.02 }, '#000', ' fill-opacity="0.28"')}${rr(T_BOARD, 'url(#board)')}</g>
  ${lines}
  ${rr(T_CLIP, 'url(#clip)')}
</svg>
`;
}

// ---------------------------------------------------------------- write everything

const TRAY_SCALES = [['', 16], ['@1.25x', 20], ['@1.5x', 24], ['@1.75x', 28], ['@2x', 32], ['@2.5x', 40], ['@3x', 48]];

const write = (name, data) => { writeFileSync(join(OUT, name), data); console.log(`  build/${name}  ${data.length} B`); };

console.log('Generating icons…');
write('icon.svg', svg());
write('icon.png', encodePng(render(1024, sampleAppTile, 3), 1024, 1024));
write('icon.ico', encodeIco([16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({
  size,
  rgba: size <= 48 ? render(size, sampleTrayWin, 8) : render(size, sampleAppTile, 6),
}))));
// Every Windows DPI step gets its own bitmap; nativeImage.createFromPath('tray.png') picks up the @Nx files.
for (const [suffix, size] of TRAY_SCALES) write(`tray${suffix}.png`, encodePng(render(size, sampleTrayWin, 8), size, size));
write('tray.ico', encodeIco([16, 20, 24, 32, 40, 48].map((size) => ({ size, rgba: render(size, sampleTrayWin, 8) }))));
write('trayTemplate.png', encodePng(render(16, sampleTrayTemplate, 8), 16, 16));
write('trayTemplate@2x.png', encodePng(render(32, sampleTrayTemplate, 8), 32, 32));
// TUCK_ICON_PREVIEW=<file.png>: contact sheet of the tray glyph at 16/20/24/32 px, nearest-neighbour ×8,
// on a light and a dark taskbar colour, for eyeballing pixel crispness.
const previewFile = process.env.TUCK_ICON_PREVIEW;
if (previewFile) {
  const sizes = [16, 20, 24, 32], zoom = 8, pad = 16;
  const cell = 32 * zoom + pad * 2, W = cell * sizes.length, H = cell * 2;
  const sheet = Buffer.alloc(W * H * 4);
  [[0xf3, 0xf3, 0xf3], [0x20, 0x20, 0x24]].forEach((bg, row) => {
    for (let y = row * cell; y < (row + 1) * cell; y++) for (let x = 0; x < W; x++) sheet.set([...bg, 255], (y * W + x) * 4);
    sizes.forEach((size, col) => {
      const img = render(size, sampleTrayWin, 8);
      for (let y = 0; y < size * zoom; y++) for (let x = 0; x < size * zoom; x++) {
        const s = (Math.floor(y / zoom) * size + Math.floor(x / zoom)) * 4, a = img[s + 3] / 255;
        const d = ((row * cell + pad + y) * W + col * cell + pad + x) * 4;
        for (let i = 0; i < 3; i++) sheet[d + i] = Math.round(img[s + i] * a + sheet[d + i] * (1 - a));
      }
    });
  });
  writeFileSync(previewFile, encodePng(sheet, W, H));
  console.log(`  preview ${previewFile}`);
}
console.log('Done.');
