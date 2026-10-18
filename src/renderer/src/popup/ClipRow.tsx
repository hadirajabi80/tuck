import { Check, GripVertical, Pin } from 'lucide-react';
import { memo, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import type { ClipSummary } from '@shared/types';
import { appLabel, basename, hostname, relativeTime } from '@/lib/format';
import { clipImageSrc } from '@/lib/images';
import { cx } from '@/lib/cx';
import { Icon, KIND_ICONS } from '@/components/Icon';
import styles from './ClipRow.module.css';

export interface RowCommonProps {
  style: CSSProperties;
  selected: boolean;
  multiSelected: boolean;
  multiMode: boolean;
  quickIndex: number;
  showBadge: boolean;
  removing: boolean;
  posInSet: number;
  setSize: number;
  onClick: (id: string, e: MouseEvent) => void;
  onDoubleClick: (id: string) => void;
  onContextMenu: (id: string, e: MouseEvent) => void;
}

export interface ClipRowProps extends RowCommonProps {
  clip: ClipSummary;
  showSourceApp: boolean;
  onPin: (id: string) => void;
  /** Drag-and-drop pin ordering is available for this row (shows the hover grip). */
  draggable?: boolean;
  /** This row is being dragged (it stays in place, dimmed, while a lifted copy follows the pointer). */
  dragging?: boolean;
  onPointerDown?: (id: string, e: PointerEvent<HTMLDivElement>) => void;
}

function displayText(c: ClipSummary): string {
  if (c.kind === 'link') return c.preview.replace(/^https?:\/\/(www\.)?/i, '');
  if (c.kind === 'files' && c.files?.length) {
    const first = basename(c.files[0]!);
    return c.files.length > 1 ? `${first}  +${c.files.length - 1} more` : first;
  }
  return c.preview || ' ';
}

export const ClipRow = memo(function ClipRow(p: ClipRowProps) {
  const { clip: c } = p;
  const [pop, setPop] = useState(false);
  const meta = [
    c.kind === 'link' ? hostname(c.meta.url ?? c.preview) : p.showSourceApp ? appLabel(c.sourceApp) : '',
    relativeTime(c.updatedAt),
  ].filter(Boolean).join(' · ');
  const title = c.kind === 'files' ? c.files?.join('\n') : c.kind === 'image' ? undefined : c.preview;

  return (
    <div
      id={`clip-row-${c.id}`}
      role="option"
      aria-selected={p.multiMode ? p.multiSelected : p.selected}
      aria-current={p.selected || undefined}
      aria-posinset={p.posInSet}
      aria-setsize={p.setSize}
      className={styles.row}
      style={p.style}
      data-selected={p.selected ? 'true' : undefined}
      data-multi={p.multiSelected ? 'true' : undefined}
      data-removing={p.removing ? 'true' : undefined}
      data-dragging={p.dragging ? 'true' : undefined}
      onPointerDown={p.onPointerDown ? (e) => p.onPointerDown!(c.id, e) : undefined}
      onClick={(e) => p.onClick(c.id, e)}
      onDoubleClick={() => p.onDoubleClick(c.id)}
      onContextMenu={(e) => p.onContextMenu(c.id, e)}
    >
      <div className={styles.inner}>
        <span className={styles.lead}>
          {p.multiMode ? (
            <span className={cx(styles.check, p.multiSelected && styles.checked)} aria-hidden>
              {p.multiSelected && <Icon icon={Check} size={10} strokeWidth={3} />}
            </span>
          ) : (
            <>
              {p.quickIndex >= 0 && <span className={styles.badge} data-visible={p.showBadge ? 'true' : undefined} aria-hidden>{p.quickIndex + 1}</span>}
              {p.draggable && !p.showBadge && (
                <span className={styles.grip} aria-hidden title={c.pinned ? 'Drag to reorder · drop on the history to unpin' : 'Drag into Pinned to pin'}>
                  <Icon icon={GripVertical} size={12} strokeWidth={2} />
                </span>
              )}
            </>
          )}
        </span>
        <Glyph clip={c} />
        <span className={cx(styles.text, (c.kind === 'code' || c.kind === 'color') && styles.mono)} title={title}>
          {displayText(c)}
        </span>
        <span className={styles.meta}>{meta}</span>
        <button
          type="button"
          tabIndex={-1}
          className={cx(styles.pin, c.pinned && styles.pinned, pop && styles.pop)}
          aria-label={c.pinned ? 'Unpin' : 'Pin'}
          title={c.pinned ? 'Unpin' : 'Pin'}
          onClick={(e) => { e.stopPropagation(); setPop(true); setTimeout(() => setPop(false), 140); p.onPin(c.id); }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <Icon icon={Pin} size={13} strokeWidth={c.pinned ? 2.2 : 1.8} />
        </button>
      </div>
    </div>
  );
});

function Glyph({ clip: c }: { clip: ClipSummary }) {
  const [loaded, setLoaded] = useState(false);
  if (c.kind === 'image' && c.image) {
    return (
      <span className={styles.thumb}>
        <img
          src={clipImageSrc(c.id, 'thumb')}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          data-loaded={loaded ? 'true' : undefined}
          onLoad={() => setLoaded(true)}
        />
      </span>
    );
  }
  if (c.kind === 'color' && c.meta.colorHex) {
    return (
      <span className={styles.glyph} data-kind="color">
        <span className={styles.swatch} style={{ background: c.meta.colorHex }} />
      </span>
    );
  }
  return (
    <span className={styles.glyph} data-kind={c.kind}>
      <Icon icon={KIND_ICONS[c.kind]} size={15} />
    </span>
  );
}
