import styles from './ProgressBar.module.css';

export interface ProgressBarProps {
  value: number;
  max: number;
  /** Unknown progress: animated stripe. */
  indeterminate?: boolean;
  label?: string;
}

export function ProgressBar({ value, max, indeterminate, label }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className={styles.track}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={indeterminate ? undefined : max}
      aria-valuenow={indeterminate ? undefined : value}
      data-indeterminate={indeterminate ? 'true' : undefined}
    >
      <div className={styles.fill} style={indeterminate ? undefined : { width: `${pct}%` }} />
    </div>
  );
}
