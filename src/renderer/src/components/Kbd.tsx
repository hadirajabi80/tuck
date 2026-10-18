import { cx } from '@/lib/cx';
import styles from './Kbd.module.css';

export interface KbdProps {
  /** Separate keycaps, e.g. ['Ctrl','Shift','V'] or ['⌘','⇧','V']. */
  parts: string[];
  size?: 'sm' | 'md';
  /** Render without keycap chrome (inline hints in the status bar). */
  bare?: boolean;
  className?: string;
}

export function Kbd({ parts, size = 'sm', bare, className }: KbdProps) {
  if (!parts.length) return null;
  return (
    <span className={cx(styles.combo, className)} aria-label={parts.join(' ')}>
      {parts.map((p, i) => (
        <kbd key={`${p}-${i}`} className={cx(bare ? styles.bare : styles.key, styles[size])} aria-hidden>
          {p}
        </kbd>
      ))}
    </span>
  );
}
