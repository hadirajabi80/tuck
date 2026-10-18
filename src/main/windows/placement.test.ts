import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ screen: {} }));
const { atPoint, centered, clampInto } = await import('./placement');

const area = { x: 0, y: 0, width: 1920, height: 1040 };
const size = { width: 760, height: 460 };

describe('placement', () => {
  it('places at cursor + 12', () => {
    expect(atPoint({ x: 100, y: 100 }, size, area)).toEqual({ x: 112, y: 112, ...size });
  });
  it('flips above/left near the bottom-right edge', () => {
    expect(atPoint({ x: 1900, y: 1000 }, size, area)).toEqual({ x: 1900 - 12 - 760, y: 1000 - 12 - 460, ...size });
  });
  it('clamps into the work area with an 8 px margin (incl. negative-origin monitors)', () => {
    expect(clampInto({ x: -50, y: -50, ...size }, area)).toEqual({ x: 8, y: 8, ...size });
    const left = { x: -1280, y: 0, width: 1280, height: 1024 };
    expect(clampInto({ x: -10, y: 900, ...size }, left)).toEqual({ x: -8 - 760, y: 1024 - 8 - 460, ...size });
    expect(clampInto({ x: 0, y: 0, width: 5000, height: 5000 }, area)).toEqual({ x: 8, y: 8, width: 1904, height: 1024 });
  });
  it('centres horizontally, upper third vertically', () => {
    expect(centered(size, area)).toEqual({ x: 580, y: 193, ...size });
  });
});
