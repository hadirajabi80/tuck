import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Icon } from './Icon';
import { Spinner } from './Spinner';
import styles from './Button.module.css';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'destructive' | 'link';
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  loading?: boolean;
  /** Icon-only button: requires aria-label. */
  iconOnly?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, iconRight, loading, iconOnly, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 14 : 15;
  return (
    <button
      ref={ref}
      type={type}
      className={cx(styles.button, styles[variant], styles[size], iconOnly && styles.iconOnly, loading && styles.loading, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={iconSize - 2} /> : icon ? <Icon icon={icon} size={iconSize} /> : null}
      {children !== undefined && children !== null && <span className={styles.label}>{children}</span>}
      {iconRight && <Icon icon={iconRight} size={iconSize - 1} className={styles.iconRight} />}
    </button>
  );
});
