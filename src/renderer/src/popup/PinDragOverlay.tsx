// Visuals for pin drag and drop: the lifted copy of the dragged row, the insertion line and the
// "drop here to pin" zone shown when nothing is pinned yet. State comes from usePinDragState.
import { Pin, PinOff } from 'lucide-react';
import { memo, type CSSProperties } from 'react';
import type { ClipSummary } from '@shared/types';
import { Icon } from '@/components/Icon';
import { findClip, usePopup } from '@/store/popupStore';
import { ClipRow } from './ClipRow';
import { usePinDragState } from './usePinDrag';
import styles from './PinDragOverlay.module.css';

const noop = () => {};

export function PinDragOverlay({ rowHeight, showSourceApp }: { rowHeight: number; showSourceApp: boolean }) {
  const active = usePinDragState((s) => s.active);
  const primaryId = usePinDragState((s) => s.primaryId);
  const count = usePinDragState((s) => s.ids.length);
  const kind = usePinDragState((s) => s.target.kind);
  const ghostTop = usePinDragState((s) => s.ghostTop);
  const lineTop = usePinDragState((s) => s.lineTop);
  const clip = usePopup((s) => findClip(s, primaryId));
  if (!active || !clip) return null;

  const hint = kind === 'unpin' ? 'unpin' : kind === 'pin' && !clip.pinned ? 'pin' : null;
  return (
    <div className={styles.layer} aria-hidden>
      {lineTop !== null && <div className={styles.line} style={{ transform: `translateY(${lineTop - 1}px)` }} />}
      <div
        className={styles.ghost}
        data-blocked={kind === 'none' ? 'true' : undefined}
        data-stack={count > 1 ? 'true' : undefined}
        style={{ transform: `translateY(${ghostTop}px)`, height: rowHeight }}
      >
        <div className={styles.card}>
          <GhostRow clip={clip} showSourceApp={showSourceApp} />
          {hint && (
            <span className={styles.hint} data-kind={hint}>
              <Icon icon={hint === 'unpin' ? PinOff : Pin} size={11} strokeWidth={2.2} />
              <span className={styles.hintText}>{hint === 'unpin' ? 'Unpin' : 'Pin'}</span>
            </span>
          )}
          {count > 1 && <span className={styles.count}>{count}</span>}
        </div>
      </div>
    </div>
  );
}

const ROW_STYLE: CSSProperties = { position: 'relative', height: '100%' };

const GhostRow = memo(function GhostRow({ clip, showSourceApp }: { clip: ClipSummary; showSourceApp: boolean }) {
  return (
    <ClipRow
      clip={clip}
      showSourceApp={showSourceApp}
      onPin={noop}
      style={ROW_STYLE}
      selected
      multiSelected={false}
      multiMode={false}
      quickIndex={-1}
      showBadge={false}
      removing={false}
      posInSet={0}
      setSize={0}
      onClick={noop}
      onDoubleClick={noop}
      onContextMenu={noop}
    />
  );
});

/** Placeholder row inside the (temporary) Pinned section while dragging with nothing pinned yet. */
export function PinDropZone({ style, hot }: { style: CSSProperties; hot: boolean }) {
  return (
    <div className={styles.zoneRow} style={style} role="presentation">
      <div className={styles.zone} data-hot={hot ? 'true' : undefined}>
        <Icon icon={Pin} size={13} />
        Drop here to pin
      </div>
    </div>
  );
}
