import type { CSSProperties } from 'react';
import styles from './SectionHeader.module.css';

export function SectionHeader({ label, style, sticky, highlight }: { label: string; style?: CSSProperties; sticky?: boolean; highlight?: boolean }) {
  return (
    <div
      className={styles.header}
      style={style}
      data-sticky={sticky ? 'true' : undefined}
      data-highlight={highlight ? 'true' : undefined}
      role="presentation"
    >
      {label}
    </div>
  );
}
