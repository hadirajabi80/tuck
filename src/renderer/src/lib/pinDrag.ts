// Pure helpers for drag-and-drop pin ordering in the popup list (unit-tested).
// Coordinates are list-content pixels (0 = top of the first row, independent of scrolling).

/** What a row contributes to drop resolution. 'dropzone' is the temporary "drop here to pin" row. */
export type DropZoneKind = 'pinned-header' | 'header' | 'pinned' | 'normal' | 'dropzone';

export interface RowBox {
  id: string;
  zone: DropZoneKind;
  top: number;
  height: number;
}

export type DropTarget =
  /** Insert before visible pin `slot` (0..n, counted in the current pinned order, dragged rows included). */
  | { kind: 'pin'; slot: number; /** Content y of the insertion line; null = highlight the drop zone instead. */ lineY: number | null }
  /** Dragged pinned rows released over the history rows → unpin them. */
  | { kind: 'unpin' }
  /** Nothing happens (unpinned rows over the time-ordered history). */
  | { kind: 'none' };

export interface ResolveOptions {
  /** 'pinned' = the Pinned filter (every row is a pin, nowhere to unpin). */
  mode: 'all' | 'pinned';
  /** At least one dragged row is pinned. */
  draggingPinned: boolean;
  /** Extra pixels below the last pin that still count as "inside Pinned". */
  slack?: number;
}

/** Lays out rows top to bottom (same arithmetic as VirtualList). */
export function layoutBoxes(rows: ReadonlyArray<{ id: string; zone: DropZoneKind; height: number }>): RowBox[] {
  let y = 0;
  return rows.map((r) => {
    const box = { id: r.id, zone: r.zone, top: y, height: r.height };
    y += r.height;
    return box;
  });
}

function pinSlot(pins: RowBox[], y: number): { slot: number; lineY: number } {
  let slot = 0;
  while (slot < pins.length && pins[slot]!.top + pins[slot]!.height / 2 <= y) slot++;
  const lineY = slot < pins.length ? pins[slot]!.top : pins[pins.length - 1]!.top + pins[pins.length - 1]!.height;
  return { slot, lineY };
}

/** Resolves the pointer's content y to a drop target. */
export function resolveDrop(boxes: readonly RowBox[], y: number, opts: ResolveOptions): DropTarget {
  const pins = boxes.filter((b) => b.zone === 'pinned');
  const outside: DropTarget = opts.draggingPinned && opts.mode === 'all' ? { kind: 'unpin' } : { kind: 'none' };
  if (opts.mode === 'pinned') return pins.length ? { kind: 'pin', ...pinSlot(pins, y) } : { kind: 'none' };

  const zone = boxes.find((b) => b.zone === 'dropzone');
  const last = pins.length ? pins[pins.length - 1]! : zone;
  if (!last) return outside;
  const end = last.top + last.height + (opts.slack ?? 8);
  if (y >= end) return outside;
  if (!pins.length) return { kind: 'pin', slot: 0, lineY: null };
  return { kind: 'pin', ...pinSlot(pins, y) };
}

/** New pinned order after moving `moving` (display order) to `slot` of `order`. Ids not in `order` get pinned there. */
export function reorderIds(order: readonly string[], moving: readonly string[], slot: number): string[] {
  const set = new Set(moving);
  let before = 0;
  for (let i = 0; i < Math.min(slot, order.length); i++) if (set.has(order[i]!)) before++;
  const rest = order.filter((id) => !set.has(id));
  const at = Math.max(0, Math.min(rest.length, slot - before));
  return [...rest.slice(0, at), ...moving, ...rest.slice(at)];
}

export function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Slot for moving pin `id` one position up (-1) or down (+1); null at the edge or when `id` isn't a visible pin. */
export function stepSlot(order: readonly string[], id: string, delta: -1 | 1): number | null {
  const i = order.indexOf(id);
  if (i < 0) return null;
  const j = i + delta;
  if (j < 0 || j >= order.length) return null;
  return delta < 0 ? j : j + 1;
}

/** Auto-scroll speed (px per frame) for a pointer at `y` in a viewport of `height` px; 0 away from the edges. */
export function autoScrollSpeed(y: number, height: number, edge = 40, max = 18): number {
  if (height <= 0) return 0;
  const e = Math.min(edge, height / 3);
  if (y < e) return -Math.ceil(max * Math.min(1, (e - y) / e));
  if (y > height - e) return Math.ceil(max * Math.min(1, (y - (height - e)) / e));
  return 0;
}
