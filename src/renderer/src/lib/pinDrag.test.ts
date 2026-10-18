import { describe, expect, it } from 'vitest';
import { autoScrollSpeed, layoutBoxes, reorderIds, resolveDrop, sameOrder, stepSlot, type DropZoneKind } from './pinDrag';

const H = 24; // header
const R = 44; // row

function boxes(spec: Array<[string, DropZoneKind]>) {
  return layoutBoxes(spec.map(([id, zone]) => ({ id, zone, height: zone.endsWith('header') ? H : R })));
}

describe('reorderIds', () => {
  const order = ['a', 'b', 'c', 'd'];
  it('moves a pin down and up', () => {
    expect(reorderIds(order, ['a'], 3)).toEqual(['b', 'c', 'a', 'd']);
    expect(reorderIds(order, ['a'], 4)).toEqual(['b', 'c', 'd', 'a']);
    expect(reorderIds(order, ['d'], 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(reorderIds(order, ['c'], 1)).toEqual(['a', 'c', 'b', 'd']);
  });
  it('dropping a pin next to itself is a no-op', () => {
    expect(sameOrder(reorderIds(order, ['b'], 1), order)).toBe(true);
    expect(sameOrder(reorderIds(order, ['b'], 2), order)).toBe(true);
  });
  it('inserts new (unpinned) ids at the slot', () => {
    expect(reorderIds(order, ['x'], 0)).toEqual(['x', 'a', 'b', 'c', 'd']);
    expect(reorderIds(order, ['x'], 2)).toEqual(['a', 'b', 'x', 'c', 'd']);
    expect(reorderIds(order, ['x'], 99)).toEqual(['a', 'b', 'c', 'd', 'x']);
    expect(reorderIds([], ['x'], 0)).toEqual(['x']);
  });
  it('moves a multi-selection as a block, keeping its order', () => {
    expect(reorderIds(order, ['a', 'c'], 4)).toEqual(['b', 'd', 'a', 'c']);
    expect(reorderIds(order, ['b', 'd'], 0)).toEqual(['b', 'd', 'a', 'c']);
    expect(reorderIds(order, ['a', 'x'], 3)).toEqual(['b', 'c', 'a', 'x', 'd']);
  });
});

describe('resolveDrop (All view)', () => {
  // Pinned header, 3 pins, Today header, 2 history rows
  const b = boxes([['h-p', 'pinned-header'], ['a', 'pinned'], ['b', 'pinned'], ['c', 'pinned'], ['h-t', 'header'], ['x', 'normal'], ['y', 'normal']]);
  const pinsTop = H;
  const all = { mode: 'all' as const, draggingPinned: true };

  it('resolves insertion slots by row midpoints', () => {
    expect(resolveDrop(b, 0, all)).toEqual({ kind: 'pin', slot: 0, lineY: pinsTop });
    expect(resolveDrop(b, pinsTop + 10, all)).toEqual({ kind: 'pin', slot: 0, lineY: pinsTop });
    expect(resolveDrop(b, pinsTop + R - 10, all)).toEqual({ kind: 'pin', slot: 1, lineY: pinsTop + R });
    expect(resolveDrop(b, pinsTop + 2 * R + 30, all)).toEqual({ kind: 'pin', slot: 3, lineY: pinsTop + 3 * R });
    // a few px below the last pin still counts as "end of Pinned"
    expect(resolveDrop(b, pinsTop + 3 * R + 4, all)).toEqual({ kind: 'pin', slot: 3, lineY: pinsTop + 3 * R });
  });

  it('pinned rows over the history unpin; history rows there do nothing', () => {
    const y = pinsTop + 3 * R + H + 10;
    expect(resolveDrop(b, y, all)).toEqual({ kind: 'unpin' });
    expect(resolveDrop(b, y, { mode: 'all', draggingPinned: false })).toEqual({ kind: 'none' });
    expect(resolveDrop(b, pinsTop + R, { mode: 'all', draggingPinned: false })).toMatchObject({ kind: 'pin', slot: 1 });
  });

  it('uses the temporary drop zone when nothing is pinned yet', () => {
    const z = boxes([['h-p', 'pinned-header'], ['zone', 'dropzone'], ['h-t', 'header'], ['x', 'normal']]);
    expect(resolveDrop(z, 10, { mode: 'all', draggingPinned: false })).toEqual({ kind: 'pin', slot: 0, lineY: null });
    expect(resolveDrop(z, H + R + H + 10, { mode: 'all', draggingPinned: false })).toEqual({ kind: 'none' });
    const none = boxes([['h-t', 'header'], ['x', 'normal']]);
    expect(resolveDrop(none, 10, { mode: 'all', draggingPinned: false })).toEqual({ kind: 'none' });
  });
});

describe('resolveDrop (Pinned filter)', () => {
  const b = boxes([['a', 'pinned'], ['b', 'pinned']]);
  it('always reorders, never unpins', () => {
    expect(resolveDrop(b, 5, { mode: 'pinned', draggingPinned: true })).toEqual({ kind: 'pin', slot: 0, lineY: 0 });
    expect(resolveDrop(b, 999, { mode: 'pinned', draggingPinned: true })).toEqual({ kind: 'pin', slot: 2, lineY: 2 * R });
  });
});

describe('stepSlot / autoScrollSpeed', () => {
  it('steps one position, null at the edges', () => {
    const order = ['a', 'b', 'c'];
    expect(stepSlot(order, 'b', -1)).toBe(0);
    expect(reorderIds(order, ['b'], stepSlot(order, 'b', 1)!)).toEqual(['a', 'c', 'b']);
    expect(reorderIds(order, ['b'], stepSlot(order, 'b', -1)!)).toEqual(['b', 'a', 'c']);
    expect(stepSlot(order, 'a', -1)).toBeNull();
    expect(stepSlot(order, 'c', 1)).toBeNull();
    expect(stepSlot(order, 'zz', 1)).toBeNull();
  });
  it('scrolls faster closer to (or past) the edge', () => {
    expect(autoScrollSpeed(200, 400)).toBe(0);
    expect(autoScrollSpeed(30, 400)).toBeLessThan(0);
    expect(autoScrollSpeed(0, 400)).toBe(-18);
    expect(autoScrollSpeed(-50, 400)).toBe(-18);
    expect(autoScrollSpeed(390, 400)).toBeGreaterThan(0);
    expect(autoScrollSpeed(500, 400)).toBe(18);
    expect(Math.abs(autoScrollSpeed(5, 400))).toBeGreaterThan(Math.abs(autoScrollSpeed(30, 400)));
  });
});
