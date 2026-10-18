// In-house windowed list: per-item heights (fixed per row type), absolute positioning, sticky section
// headers with push-up, keep-in-view for keyboard selection and an end-reached callback for paging.
import {
  Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type ForwardedRef, type HTMLAttributes, type ReactNode, type Ref,
} from 'react';
import styles from './VirtualList.module.css';

export interface VirtualListHandle {
  scrollToIndex: (index: number) => void;
  scrollToTop: () => void;
  element: () => HTMLDivElement | null;
}

export interface VirtualListProps<T> extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  items: readonly T[];
  itemHeight: (item: T, index: number) => number;
  getKey: (item: T, index: number) => string;
  renderItem: (item: T, index: number, style: CSSProperties) => ReactNode;
  /** Extra pixels rendered above/below the viewport. */
  overscan?: number;
  /** Items that stick to the top (section headers). */
  isSticky?: (item: T) => boolean;
  renderSticky?: (item: T, index: number) => ReactNode;
  stickyHeight?: number;
  onEndReached?: () => void;
  endThreshold?: number;
  /** Called with the first/last fully visible item index after scroll or resize. */
  onRangeChange?: (first: number, last: number) => void;
  /** Content rendered after the items (e.g. "loading more…"). */
  footer?: ReactNode;
  footerHeight?: number;
}

function lowerBound(offsets: number[], value: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function VirtualListInner<T>(
  {
    items, itemHeight, getKey, renderItem, overscan = 240, isSticky, renderSticky, stickyHeight = 24, onEndReached,
    endThreshold = 480, onRangeChange, footer, footerHeight = 0, className, ...rest
  }: VirtualListProps<T>,
  ref: ForwardedRef<VirtualListHandle>,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(0);

  const { offsets, heights, total, stickyIdx } = useMemo(() => {
    const off: number[] = new Array(items.length);
    const hs: number[] = new Array(items.length);
    const st: number[] = [];
    let y = 0;
    items.forEach((it, i) => {
      off[i] = y;
      const h = itemHeight(it, i);
      hs[i] = h;
      y += h;
      if (isSticky?.(it)) st.push(i);
    });
    return { offsets: off, heights: hs, total: y, stickyIdx: st };
  }, [items, itemHeight, isSticky]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    setViewport(el.clientHeight);
    const ro = new ResizeObserver(() => setViewport(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (el) setScrollTop(el.scrollTop);
  }, []);

  // Clamp scrollTop when the list shrinks.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && el.scrollTop !== scrollTop) setScrollTop(el.scrollTop);
  }, [total, scrollTop]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = scroller.current;
      if (!el || index < 0 || index >= items.length) return;
      const top = offsets[index]!;
      const bottom = top + heights[index]!;
      const sticky = stickyIdx.length && !isSticky?.(items[index]!) ? stickyHeight : 0;
      // first item under a header: reveal the header too
      const prevIsHeader = index > 0 && isSticky?.(items[index - 1]!);
      if (top - sticky < el.scrollTop || (prevIsHeader && top - heights[index - 1]! < el.scrollTop)) {
        el.scrollTop = prevIsHeader ? offsets[index - 1]! : Math.max(0, top - sticky);
      } else if (bottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = bottom - el.clientHeight + (index === items.length - 1 ? footerHeight : 0);
      }
      setScrollTop(el.scrollTop);
    },
    [items, offsets, heights, stickyIdx.length, isSticky, stickyHeight, footerHeight],
  );

  useImperativeHandle(ref, () => ({
    scrollToIndex,
    scrollToTop: () => {
      if (scroller.current) scroller.current.scrollTop = 0;
      setScrollTop(0);
    },
    element: () => scroller.current,
  }), [scrollToIndex]);

  // visible window
  let start = 0;
  let end = -1;
  if (items.length) {
    start = lowerBound(offsets, Math.max(0, scrollTop - overscan));
    end = lowerBound(offsets, scrollTop + viewport + overscan);
  }

  // range + paging callbacks
  const lastRange = useRef('');
  useEffect(() => {
    if (!items.length || viewport === 0) return;
    let first = lowerBound(offsets, scrollTop);
    if (offsets[first]! < scrollTop) first = Math.min(items.length - 1, first + 1);
    let last = lowerBound(offsets, scrollTop + viewport);
    if (offsets[last]! + heights[last]! > scrollTop + viewport && last > first) last--;
    const key = `${first}:${last}:${items.length}`;
    if (key !== lastRange.current) {
      lastRange.current = key;
      onRangeChange?.(first, last);
    }
    if (onEndReached && total - (scrollTop + viewport) < endThreshold) onEndReached();
  }, [scrollTop, viewport, items.length, offsets, heights, total, onRangeChange, onEndReached, endThreshold]);

  // sticky header
  let sticky: ReactNode = null;
  if (renderSticky && stickyIdx.length && scrollTop > 0) {
    let cur = -1;
    let next = -1;
    for (let k = 0; k < stickyIdx.length; k++) {
      if (offsets[stickyIdx[k]!]! <= scrollTop) cur = stickyIdx[k]!;
      else { next = stickyIdx[k]!; break; }
    }
    if (cur >= 0) {
      const push = next >= 0 ? Math.min(0, offsets[next]! - scrollTop - stickyHeight) : 0;
      sticky = (
        <div className={styles.stickyWrap} aria-hidden>
          <div className={styles.sticky} style={{ transform: `translateY(${push}px)`, height: stickyHeight }}>
            {renderSticky(items[cur]!, cur)}
          </div>
        </div>
      );
    }
  }

  const rendered: ReactNode[] = [];
  for (let i = start; i <= end && i < items.length; i++) {
    const it = items[i]!;
    rendered.push(<Fragment key={getKey(it, i)}>{renderItem(it, i, { position: 'absolute', top: offsets[i], left: 0, right: 0, height: heights[i] })}</Fragment>);
  }

  return (
    <div ref={scroller} className={`${styles.scroller} ${className ?? ''}`} onScroll={onScroll} {...rest}>
      {sticky}
      <div className={styles.inner} style={{ height: total + footerHeight }}>
        {rendered}
        {footer && (
          <div className={styles.footer} style={{ top: total, height: footerHeight }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export const VirtualList = forwardRef(VirtualListInner) as <T>(
  props: VirtualListProps<T> & { ref?: Ref<VirtualListHandle> },
) => ReturnType<typeof VirtualListInner>;
