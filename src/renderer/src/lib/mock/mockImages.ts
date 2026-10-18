// Canvas-generated placeholder images for the browser mock (the real app serves tuck://img/...).
// Generated lazily on first use and cached as data URLs.

export type MockImageStyle = 'screenshot' | 'photo' | 'chart' | 'logo' | 'palette' | 'diagram';

const cache = new Map<string, string>();

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawScreenshot(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#E9EAF0';
  ctx.fillRect(0, 0, w, h);
  const pad = w * 0.04;
  ctx.fillStyle = '#FFFFFF';
  roundRect(ctx, pad, pad, w - pad * 2, h - pad * 2, w * 0.012);
  ctx.fill();
  // title bar
  ctx.fillStyle = '#F4F4F7';
  ctx.fillRect(pad, pad + w * 0.012, w - pad * 2, h * 0.07 - w * 0.012);
  ['#FF5F57', '#FEBC2E', '#28C840'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(pad + w * 0.02 + i * w * 0.018, pad + h * 0.038, w * 0.0055, 0, Math.PI * 2);
    ctx.fill();
  });
  // sidebar
  const top = pad + h * 0.07;
  ctx.fillStyle = '#F7F7FA';
  ctx.fillRect(pad, top, w * 0.2, h - pad - top);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i === 2 ? 'rgba(91,91,214,0.16)' : 'rgba(0,0,0,0.06)';
    roundRect(ctx, pad + w * 0.015, top + h * 0.04 + i * h * 0.075, w * 0.17 * (i === 2 ? 1 : 0.6 + ((i * 37) % 30) / 100), h * 0.035, 4);
    ctx.fill();
  }
  // content
  const cx = pad + w * 0.23;
  ctx.fillStyle = '#1A1A22';
  roundRect(ctx, cx, top + h * 0.05, w * 0.32, h * 0.05, 4);
  ctx.fill();
  for (let i = 0; i < 6; i++) {
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    roundRect(ctx, cx, top + h * 0.15 + i * h * 0.06, (w - cx - pad * 2) * (0.55 + ((i * 53) % 45) / 100), h * 0.028, 3);
    ctx.fill();
  }
  ctx.fillStyle = '#5B5BD6';
  roundRect(ctx, cx, top + h * 0.56, w * 0.12, h * 0.065, 6);
  ctx.fill();
  ctx.fillStyle = 'rgba(91,91,214,0.10)';
  roundRect(ctx, cx + w * 0.4, top + h * 0.15, w * 0.28, h * 0.4, 10);
  ctx.fill();
}

function drawPhoto(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#2B2D6E');
  sky.addColorStop(0.45, '#C2588A');
  sky.addColorStop(0.75, '#F6A55B');
  sky.addColorStop(1, '#FCD9A0');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(255, 236, 190, 0.95)';
  ctx.beginPath();
  ctx.arc(w * 0.68, h * 0.62, h * 0.11, 0, Math.PI * 2);
  ctx.fill();
  const layers = [
    { c: '#6B3A6E', base: 0.7, amp: 0.12 },
    { c: '#43264F', base: 0.8, amp: 0.1 },
    { c: '#22152E', base: 0.9, amp: 0.07 },
  ];
  layers.forEach((l, li) => {
    ctx.fillStyle = l.c;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (let x = 0; x <= w; x += w / 60) {
      const y = h * l.base - Math.abs(Math.sin(x / w * (5 + li * 2) + li)) * h * l.amp - Math.sin(x / w * 17 + li) * h * 0.015;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fill();
  });
}

function drawChart(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  const left = w * 0.1, bottom = h * 0.85, top = h * 0.12, right = w * 0.95;
  ctx.strokeStyle = 'rgba(0,0,0,0.08)';
  ctx.lineWidth = Math.max(1, w / 800);
  for (let i = 0; i <= 4; i++) {
    const y = top + ((bottom - top) / 4) * i;
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(right, y); ctx.stroke();
  }
  const vals = [0.35, 0.5, 0.42, 0.68, 0.6, 0.82, 0.74, 0.93];
  const bw = (right - left) / vals.length;
  vals.forEach((v, i) => {
    ctx.fillStyle = i === vals.length - 1 ? '#5B5BD6' : 'rgba(91,91,214,0.35)';
    roundRect(ctx, left + i * bw + bw * 0.2, bottom - (bottom - top) * v, bw * 0.6, (bottom - top) * v, 4);
    ctx.fill();
  });
  ctx.fillStyle = '#1A1A22';
  ctx.font = `600 ${Math.round(h * 0.05)}px system-ui, sans-serif`;
  ctx.fillText('Weekly active users', left, top - h * 0.03);
}

function drawLogo(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const s = Math.min(w, h);
  const g = ctx.createLinearGradient(0, 0, s, s);
  g.addColorStop(0, '#3B3B9E');
  g.addColorStop(1, '#1E1E5A');
  ctx.fillStyle = '#F2F2F7';
  ctx.fillRect(0, 0, w, h);
  const x = (w - s * 0.7) / 2, y = (h - s * 0.7) / 2, size = s * 0.7, r = size * 0.22, fold = size * 0.3;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + size - fold, y);
  ctx.lineTo(x + size, y + fold);
  ctx.lineTo(x + size, y + size - r);
  ctx.arcTo(x + size, y + size, x + size - r, y + size, r);
  ctx.lineTo(x + r, y + size);
  ctx.arcTo(x, y + size, x, y + size - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8B87F0';
  ctx.beginPath();
  ctx.moveTo(x + size - fold, y);
  ctx.lineTo(x + size - fold, y + fold);
  ctx.lineTo(x + size, y + fold);
  ctx.closePath();
  ctx.fill();
}

function drawPalette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const colors = ['#5B5BD6', '#2AA07D', '#E2A336', '#E5484D', '#D6409F', '#0090FF'];
  ctx.fillStyle = '#FAFAFC';
  ctx.fillRect(0, 0, w, h);
  const sw = w / colors.length;
  colors.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.fillRect(i * sw, 0, sw + 1, h * 0.78);
    ctx.fillStyle = '#4A4A57';
    ctx.font = `${Math.round(h * 0.06)}px ui-monospace, monospace`;
    ctx.fillText(c, i * sw + sw * 0.12, h * 0.9);
  });
}

function drawDiagram(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  const boxes = [
    { x: 0.08, y: 0.4, t: 'Renderer' }, { x: 0.39, y: 0.4, t: 'Preload' }, { x: 0.7, y: 0.18, t: 'Main' }, { x: 0.7, y: 0.62, t: 'SQLite' },
  ];
  ctx.strokeStyle = '#7B7B89';
  ctx.lineWidth = Math.max(2, w / 500);
  const arrow = (x1: number, y1: number, x2: number, y2: number) => {
    ctx.beginPath(); ctx.moveTo(x1 * w, y1 * h); ctx.lineTo(x2 * w, y2 * h); ctx.stroke();
  };
  arrow(0.3, 0.5, 0.39, 0.5);
  arrow(0.61, 0.46, 0.7, 0.3);
  arrow(0.81, 0.4, 0.81, 0.62);
  boxes.forEach((b, i) => {
    ctx.fillStyle = i === 2 ? 'rgba(91,91,214,0.14)' : '#F1F1F4';
    ctx.strokeStyle = i === 2 ? '#5B5BD6' : 'rgba(0,0,0,0.16)';
    roundRect(ctx, b.x * w, b.y * h, w * 0.22, h * 0.2, 10);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#1A1A22';
    ctx.font = `500 ${Math.round(h * 0.055)}px system-ui, sans-serif`;
    ctx.fillText(b.t, b.x * w + w * 0.03, b.y * h + h * 0.12);
  });
}

const DRAW: Record<MockImageStyle, (ctx: CanvasRenderingContext2D, w: number, h: number) => void> = {
  screenshot: drawScreenshot, photo: drawPhoto, chart: drawChart, logo: drawLogo, palette: drawPalette, diagram: drawDiagram,
};

/** Data URL for a generated image, or '' outside a DOM (tests). */
export function renderMockImage(key: string, style: MockImageStyle, width: number, height: number): string {
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  DRAW[style](ctx, canvas.width, canvas.height);
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}
