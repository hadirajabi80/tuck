import type { CSSProperties } from 'react';
import styles from './SectionHeader.module.css';

export function SectionHeader({ label, style, sticky }: { label: string; style?: CSSProperties; sticky?: boolean }) {
  return (
    <div className={styles.header} style={style} data-sticky={sticky ? 'true' : undefined} role="presentation">
      {label}
    </div>
  );
}
