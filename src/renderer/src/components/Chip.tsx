import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Icon } from './Icon';
import styles from './Chip.module.css';

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: LucideIcon;
  /** Small color dot before the label (collections). */
  dot?: string;
  children: ReactNode;
}

/** Filter chip (role="tab" in the popup FilterBar) and generic pill. */
export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip({ active, icon, dot, children, className, ...rest }, ref) {
  return (
    <button ref={ref} type="button" className={cx(styles.chip, active && styles.active, className)} {...rest}>
      {dot && <span className={styles.dot} style={{ background: dot }} />}
      {icon && <Icon icon={icon} size={13} />}
      <span>{children}</span>
    </button>
  );
});

/** Static tag (collections in the preview header, keyword badges). */
export function Tag({ children, dot, tone = 'neutral', title }: { children: ReactNode; dot?: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; title?: string }) {
  return (
    <span className={cx(styles.tag, styles[tone])} title={title}>
      {dot && <span className={styles.dot} style={{ background: dot }} />}
      {children}
    </span>
  );
}
