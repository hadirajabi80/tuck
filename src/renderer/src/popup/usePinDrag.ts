// Pointer-event drag and drop for pin ordering (not HTML5 DnD: it has to survive row virtualization and drive
// auto-scroll). Press a row and move > 4 px vertically to start; click / double-click / right-click are untouched.
// Drops: inside Pinned → reorder (or pin an unpinned row at that slot); pinned rows onto the history → unpin.
// Esc cancels. The rows' layout comes from ClipList (boxesRef) so hit-testing never reads the DOM.
import { useCallback, useEffect, useRef, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { autoScrollSpeed, resolveDrop, type DropTarget, type RowBox } from '@/lib/pinDrag';
import { targetIds, usePopup, visiblePinned } from '@/store/popupStore';

const START_PX = 4;

export interface PinDragState {
  active: boolean;
  /** Dragged ids in display order (stable for the whole drag). */
  ids: string[];
  primaryId: string | null;
  draggingPinned: boolean;
  target: DropTarget;
  /** Ghost row top, px from the list container's top. */
  ghostTop: number;
  /** Insertion line, px from the list container's top (null = no line). */
  lineTop: number | null;
}

const IDLE: PinDragState = {
  active: false, ids: [], primaryId: null, draggingPinned: false, target: { kind: 'none' }, ghostTop: 0, lineTop: null,
};

export const usePinDragState = create<PinDragState>(() => ({ ...IDLE }));

export interface PinDragConfig {
  enabled: boolean;
  mode: 'all' | 'pinned';
  rowHeight: number;
  /** Height of the sticky section header that covers the top of the scroller. */
  stickyHeight: number;
  getScroller: () => HTMLElement | null;
  getContainer: () => HTMLElement | null;
  boxesRef: MutableRefObject<RowBox[]>;
}

interface Session {
  id: string;
  pointerId: number;
  startY: number;
  clientY: number;
  grab: number;
  active: boolean;
  ids: string[];
  draggingPinned: boolean;
  raf: number;
  scroller: HTMLElement | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface PinDragApi {
  onRowPointerDown: (id: string, e: ReactPointerEvent<HTMLDivElement>) => void;
  /** Re-resolves the drop target (call when the row layout changed mid-drag). */
  sync: () => void;
}

export function usePinDrag(config: PinDragConfig): PinDragApi {
  const cfg = useRef(config);
  cfg.current = config;
  const session = useRef<Session | null>(null);
  // Listener identities must be stable across renders → keep them in a ref built once.
  const handlers = useRef<ReturnType<typeof makeHandlers> | null>(null);
  if (!handlers.current) handlers.current = makeHandlers(cfg, session);

  useEffect(() => () => handlers.current?.end(false), []);

  const onRowPointerDown = useCallback((id: string, e: ReactPointerEvent<HTMLDivElement>) => {
    const c = cfg.current;
    if (!c.enabled || e.button !== 0 || !e.isPrimary || session.current) return;
    if ((e.target as HTMLElement).closest('button, input, textarea')) return;
    const rect = e.currentTarget.getBoundingClientRect();
    session.current = {
      id, pointerId: e.pointerId, startY: e.clientY, clientY: e.clientY, grab: e.clientY - rect.top,
      active: false, ids: [], draggingPinned: false, raf: 0, scroller: null,
    };
    handlers.current!.listen();
  }, []);

  const sync = useCallback(() => handlers.current?.update(), []);
  return { onRowPointerDown, sync };
}

function makeHandlers(cfg: MutableRefObject<PinDragConfig>, session: MutableRefObject<Session | null>) {
  const root = () => document.documentElement;

  const update = () => {
    const s = session.current;
    const c = cfg.current;
    if (!s?.active) return;
    const scroller = c.getScroller();
    const container = c.getContainer();
    if (!scroller || !container) return;
    const sr = scroller.getBoundingClientRect();
    const cr = container.getBoundingClientRect();
    const contentY = s.clientY - sr.top + scroller.scrollTop;
    const target = resolveDrop(c.boxesRef.current, contentY, { mode: c.mode, draggingPinned: s.draggingPinned });
    const ghostTop = clamp(s.clientY - cr.top - s.grab, -c.rowHeight * 0.35, cr.height - c.rowHeight * 0.65);
    let lineTop: number | null = null;
    if (target.kind === 'pin' && target.lineY !== null) {
      const y = target.lineY - scroller.scrollTop + (sr.top - cr.top);
      // Hide the line while it is scrolled out of view (or under the sticky header, unless at the very top).
      const minY = scroller.scrollTop > 0 ? c.stickyHeight : 0;
      if (y >= minY - 1 && y <= sr.height + 1) lineTop = clamp(y, 1, sr.height - 1);
    }
    usePinDragState.setState({ target, ghostTop, lineTop });
    root().dataset.pinDrag = target.kind === 'none' ? 'blocked' : 'active';
  };

  const frame = () => {
    const s = session.current;
    if (!s?.active) return;
    const scroller = cfg.current.getScroller();
    if (scroller) {
      const sr = scroller.getBoundingClientRect();
      const speed = autoScrollSpeed(s.clientY - sr.top, sr.height);
      if (speed) scroller.scrollTop += speed; // the scroll listener re-resolves the target
    }
    s.raf = requestAnimationFrame(frame);
  };

  const activate = (s: Session) => {
    const st = usePopup.getState();
    const multiDrag = st.multi.size > 1 && st.multi.has(s.id);
    const ids = multiDrag ? targetIds(st) : [s.id];
    // Selection follows the dragged clip.
    if (multiDrag) usePopup.setState({ selectedId: s.id, anchorId: s.id });
    else st.select(s.id, 'single');
    const pinned = new Set(visiblePinned(st).map((c) => c.id));
    s.ids = ids;
    s.draggingPinned = ids.some((id) => pinned.has(id));
    s.active = true;
    s.scroller = cfg.current.getScroller();
    try {
      s.scroller?.setPointerCapture(s.pointerId); // keeps events coming while rows unmount during auto-scroll
    } catch {
      /* pointer already released */
    }
    s.scroller?.addEventListener('scroll', update, { passive: true });
    window.getSelection()?.removeAllRanges();
    usePinDragState.setState({ active: true, ids, primaryId: s.id, draggingPinned: s.draggingPinned });
    update();
    s.raf = requestAnimationFrame(frame);
  };

  const onMove = (e: PointerEvent) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    s.clientY = e.clientY;
    if (!s.active) {
      if ((e.buttons & 1) === 0) { end(false); return; }
      if (Math.abs(e.clientY - s.startY) <= START_PX) return;
      activate(s);
    }
    e.preventDefault();
    update();
  };

  const swallowClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const onUp = (e: PointerEvent) => {
    const s = session.current;
    if (!s || e.pointerId !== s.pointerId) return;
    if (!s.active) { end(false); return; }
    s.clientY = e.clientY;
    update();
    // The click that follows pointerup must not re-select / toggle anything.
    window.addEventListener('click', swallowClick, true);
    setTimeout(() => window.removeEventListener('click', swallowClick, true), 0);
    end(true);
  };

  const onCancel = () => end(false);

  const onKey = (e: KeyboardEvent) => {
    const s = session.current;
    if (!s?.active) return;
    // The list owns the keyboard while dragging; Esc cancels (and must not hide the popup).
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') end(false);
  };

  function listen() {
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onCancel);
  }

  function end(commit: boolean) {
    const s = session.current;
    if (!s) return;
    session.current = null;
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onUp, true);
    window.removeEventListener('pointercancel', onCancel, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('blur', onCancel);
    if (!s.active) return;
    cancelAnimationFrame(s.raf);
    s.scroller?.removeEventListener('scroll', update);
    try {
      s.scroller?.releasePointerCapture(s.pointerId);
    } catch {
      /* already released */
    }
    delete root().dataset.pinDrag;
    const { target } = usePinDragState.getState();
    usePinDragState.setState({ ...IDLE });
    if (!commit) return;
    const st = usePopup.getState();
    if (target.kind === 'pin') void st.dropOnPinned(s.ids, target.slot);
    else if (target.kind === 'unpin') void st.unpinByDrop(s.ids);
  }

  return { listen, end, update };
}
