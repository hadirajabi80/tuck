// Accessible menu (role="menu"): arrow navigation, Home/End, typeahead, access keys, submenus,
// checkbox items and an inline "create" item. Rendered in a portal, positioned and clamped to the viewport.
// Used for the popup context menu, TransformMenu, GroupMenu and the Collections picker.
import type { LucideIcon } from 'lucide-react';
import { Check, ChevronRight, Plus } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '@/lib/cx';
import { Icon } from './Icon';
import { Kbd } from './Kbd';
import styles from './Menu.module.css';

interface BaseItem { id: string; label: string; icon?: LucideIcon; disabled?: boolean }

export type MenuItem =
  | (BaseItem & { type?: 'item'; onSelect: () => void; shortcut?: string[]; accessKey?: string; danger?: boolean; hint?: string })
  | (BaseItem & { type: 'checkbox'; checked: boolean; onSelect: () => void; dot?: string; hint?: string; keepOpen?: boolean })
  | (BaseItem & { type: 'submenu'; items: MenuItem[] })
  | (BaseItem & { type: 'create'; placeholder: string; onCreate: (value: string) => void })
  | { type: 'separator'; id: string }
  | { type: 'label'; id: string; label: string };

export type MenuAnchor =
  | { x: number; y: number }
  | { rect: { left: number; top: number; right: number; bottom: number; width: number; height: number }; placement?: 'bottom-start' | 'bottom-end' | 'right-start' };

export type MenuCloseReason = 'select' | 'escape' | 'outside' | 'tab';

export interface MenuProps {
  items: MenuItem[];
  anchor: MenuAnchor;
  onClose: (reason: MenuCloseReason) => void;
  label: string;
  minWidth?: number;
  /** Index of the initially active item (default: first enabled). */
  initialActive?: number;
}

const MARGIN = 6;

function isInteractive(item: MenuItem): boolean {
  return item.type !== 'separator' && item.type !== 'label' && !item.disabled;
}

function firstIndex(items: MenuItem[], from: number, dir: 1 | -1): number {
  const n = items.length;
  for (let k = 0; k < n; k++) {
    const i = (((from + dir * k) % n) + n) % n;
    if (isInteractive(items[i]!)) return i;
  }
  return -1;
}

export function position(anchor: MenuAnchor, w: number, h: number): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left: number;
  let top: number;
  if ('x' in anchor) {
    left = anchor.x;
    top = anchor.y;
    if (left + w > vw - MARGIN) left = Math.max(MARGIN, anchor.x - w);
    if (top + h > vh - MARGIN) top = Math.max(MARGIN, anchor.y - h);
  } else {
    const r = anchor.rect;
    const placement = anchor.placement ?? 'bottom-start';
    if (placement === 'right-start') {
      left = r.right - 2;
      top = r.top - 5;
      if (left + w > vw - MARGIN) left = r.left - w + 2;
      if (left < MARGIN) {
        // Narrow popup: no room on either side, so drop the submenu below its item (indented) instead of
        // clamping it back over the item that opened it; flip above when there is no room below.
        left = r.left + 16;
        top = r.bottom + 2;
        if (top + h > vh - MARGIN) top = r.top - h - 2;
      }
    } else {
      left = placement === 'bottom-end' ? r.right - w : r.left;
      top = r.bottom + 4;
      if (top + h > vh - MARGIN) top = r.top - h - 4;
    }
  }
  left = Math.min(Math.max(MARGIN, left), Math.max(MARGIN, vw - w - MARGIN));
  top = Math.min(Math.max(MARGIN, top), Math.max(MARGIN, vh - h - MARGIN));
  return { left, top };
}

interface SurfaceProps extends MenuProps {
  depth: number;
  /** Closes only this (sub)menu, returning focus to the parent. */
  onBack?: () => void;
}

function MenuSurface({ items, anchor, onClose, label, minWidth = 200, initialActive, depth, onBack }: SurfaceProps) {
  const ref = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const [active, setActive] = useState(() => (initialActive !== undefined && items[initialActive] && isInteractive(items[initialActive]) ? initialActive : firstIndex(items, 0, 1)));
  const [openSub, setOpenSub] = useState<number | null>(null);
  const [creating, setCreating] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const typeahead = useRef({ buf: '', at: 0 });
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(position(anchor, el.offsetWidth, el.offsetHeight));
  }, [items.length]);

  useEffect(() => {
    if (creating === null) ref.current?.focus({ preventScroll: true });
  }, [creating]);

  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);

  useEffect(() => {
    if (active < 0) return;
    document.getElementById(`${baseId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active, baseId]);

  const activate = (i: number, via: 'key' | 'mouse') => {
    const item = items[i];
    if (!item || !isInteractive(item)) return;
    switch (item.type) {
      case 'submenu':
        setOpenSub(i);
        return;
      case 'create':
        setCreating(i);
        setDraft('');
        return;
      case 'checkbox':
        item.onSelect();
        if (!item.keepOpen) onClose('select');
        return;
      case 'separator':
      case 'label':
        return;
      default:
        item.onSelect();
        onClose('select');
    }
    void via;
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (creating !== null) return;
    const key = e.key;
    if (key === 'ArrowDown') { e.preventDefault(); setActive((a) => firstIndex(items, a + 1, 1)); setOpenSub(null); return; }
    if (key === 'ArrowUp') { e.preventDefault(); setActive((a) => firstIndex(items, (a < 0 ? 0 : a) - 1, -1)); setOpenSub(null); return; }
    if (key === 'Home') { e.preventDefault(); setActive(firstIndex(items, 0, 1)); return; }
    if (key === 'End') { e.preventDefault(); setActive(firstIndex(items, items.length - 1, -1)); return; }
    if (key === 'Enter' || key === ' ') { e.preventDefault(); activate(active, 'key'); return; }
    if (key === 'ArrowRight') {
      e.preventDefault();
      if (items[active]?.type === 'submenu') setOpenSub(active);
      return;
    }
    if (key === 'ArrowLeft') {
      e.preventDefault();
      if (onBack) onBack();
      return;
    }
    if (key === 'Escape') {
      e.preventDefault();
      if (onBack) onBack();
      else onClose('escape');
      return;
    }
    if (key === 'Tab') { e.preventDefault(); onClose('tab'); return; }
    if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const upper = key.toUpperCase();
      const byAccess = items.findIndex((it) => it.type !== 'separator' && it.type !== 'label' && (it.type ?? 'item') === 'item' && 'accessKey' in it && it.accessKey === upper && !it.disabled);
      if (byAccess >= 0) { e.preventDefault(); setActive(byAccess); activate(byAccess, 'key'); return; }
      const now = Date.now();
      const t = typeahead.current;
      t.buf = now - t.at > 600 ? key.toLowerCase() : t.buf + key.toLowerCase();
      t.at = now;
      const start = t.buf.length === 1 ? active + 1 : active;
      for (let k = 0; k < items.length; k++) {
        const i = (start + k) % items.length;
        const it = items[i]!;
        if (isInteractive(it) && 'label' in it && it.label.toLowerCase().startsWith(t.buf)) { setActive(i); break; }
      }
    }
  };

  const submenuItem = openSub !== null ? items[openSub] : undefined;
  const subAnchorRect = openSub !== null ? document.getElementById(`${baseId}-${openSub}`)?.getBoundingClientRect() : undefined;

  return (
    <>
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        aria-activedescendant={active >= 0 && creating === null ? `${baseId}-${active}` : undefined}
        tabIndex={-1}
        className={styles.menu}
        style={{ minWidth, left: pos?.left ?? -9999, top: pos?.top ?? -9999, zIndex: 80 + depth }}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item, i) => {
          if (item.type === 'separator') return <div key={item.id} role="separator" className={styles.separator} />;
          if (item.type === 'label') return <div key={item.id} className={styles.groupLabel} role="presentation">{item.label}</div>;
          const id = `${baseId}-${i}`;
          if (item.type === 'create' && creating === i) {
            return (
              <div key={item.id} className={styles.createRow} role="none">
                <Icon icon={item.icon ?? Plus} size={14} className={styles.itemIcon} />
                <input
                  autoFocus
                  className={styles.createInput}
                  placeholder={item.placeholder}
                  value={draft}
                  aria-label={item.placeholder}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const v = draft.trim();
                      if (v) { item.onCreate(v); onClose('select'); }
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setCreating(null);
                    }
                  }}
                />
              </div>
            );
          }
          const isCheckbox = item.type === 'checkbox';
          const checked = isCheckbox ? item.checked : undefined;
          return (
            <div
              key={item.id}
              id={id}
              role={isCheckbox ? 'menuitemcheckbox' : 'menuitem'}
              aria-checked={checked}
              aria-disabled={item.disabled || undefined}
              aria-haspopup={item.type === 'submenu' ? 'menu' : undefined}
              aria-expanded={item.type === 'submenu' ? openSub === i : undefined}
              className={cx(styles.item, i === active && styles.active, item.disabled && styles.disabled, item.type !== 'submenu' && item.type !== 'checkbox' && item.type !== 'create' && item.danger && styles.danger)}
              onMouseEnter={() => {
                if (!isInteractive(item)) return;
                setActive(i);
                if (hoverTimer.current) clearTimeout(hoverTimer.current);
                if (item.type === 'submenu') hoverTimer.current = setTimeout(() => setOpenSub(i), 110);
                else if (openSub !== null) hoverTimer.current = setTimeout(() => { setOpenSub(null); ref.current?.focus({ preventScroll: true }); }, 160);
              }}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => activate(i, 'mouse')}
            >
              {isCheckbox ? (
                <span className={cx(styles.check, checked && styles.checked)}>{checked && <Icon icon={Check} size={11} strokeWidth={2.5} />}</span>
              ) : item.icon || item.type === 'create' ? (
                <Icon icon={item.icon ?? Plus} size={14} className={styles.itemIcon} />
              ) : (
                <span className={styles.iconSpacer} />
              )}
              {isCheckbox && item.dot && <span className={styles.dot} style={{ background: item.dot }} />}
              <span className={styles.itemLabel}>{item.label}</span>
              {'hint' in item && item.hint && <span className={styles.hint}>{item.hint}</span>}
              {(item.type ?? 'item') === 'item' && 'shortcut' in item && item.shortcut && <Kbd parts={item.shortcut} className={styles.shortcut} />}
              {(item.type ?? 'item') === 'item' && 'accessKey' in item && item.accessKey && !('shortcut' in item && item.shortcut) && (
                <Kbd parts={[item.accessKey]} className={styles.shortcut} />
              )}
              {item.type === 'submenu' && <Icon icon={ChevronRight} size={13} className={styles.chevron} />}
            </div>
          );
        })}
      </div>
      {submenuItem && submenuItem.type === 'submenu' && subAnchorRect && (
        <MenuSurface
          key={submenuItem.id}
          items={submenuItem.items}
          anchor={{ rect: subAnchorRect, placement: 'right-start' }}
          label={submenuItem.label}
          minWidth={180}
          depth={depth + 1}
          onClose={onClose}
          onBack={() => { setOpenSub(null); ref.current?.focus({ preventScroll: true }); }}
        />
      )}
    </>
  );
}

/** Root menu: portal + outside-click handling. */
export function Menu(props: MenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const { onClose } = props;
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose('outside');
    };
    const onBlur = () => onClose('outside');
    // Defer so the opening click/contextmenu does not immediately close it.
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDown, true);
      window.addEventListener('blur', onBlur);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [onClose]);
  const items = useMemo(() => props.items, [props.items]);
  return createPortal(
    <div ref={rootRef} className={styles.layer}>
      <MenuSurface {...props} items={items} depth={0} />
    </div>,
    document.body,
  );
}
