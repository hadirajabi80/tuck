import { afterEach, describe, expect, it, vi } from 'vitest';
import { position } from './Menu';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });

describe('Menu submenu placement', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens to the right when there is room', () => {
    vi.stubGlobal('window', { innerWidth: 900, innerHeight: 600 });
    expect(position({ rect: rect(100, 100, 200, 28), placement: 'right-start' }, 200, 120).left).toBe(298);
  });

  it('flips to the left when only the left side fits', () => {
    vi.stubGlobal('window', { innerWidth: 520, innerHeight: 600 });
    expect(position({ rect: rect(300, 100, 200, 28), placement: 'right-start' }, 200, 120).left).toBe(102);
  });

  it('drops below its item in a narrow popup instead of covering it', () => {
    vi.stubGlobal('window', { innerWidth: 320, innerHeight: 600 });
    const item = rect(60, 100, 230, 28);
    const p = position({ rect: item, placement: 'right-start' }, 200, 120);
    expect(p.top).toBeGreaterThanOrEqual(item.bottom);
    expect(p.left).toBe(76);
  });

  it('goes above its item when a narrow popup has no room below', () => {
    vi.stubGlobal('window', { innerWidth: 320, innerHeight: 300 });
    const item = rect(60, 240, 230, 28);
    const p = position({ rect: item, placement: 'right-start' }, 200, 120);
    expect(p.top + 120).toBeLessThanOrEqual(item.top);
  });
});
