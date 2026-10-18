import type { LucideIcon } from 'lucide-react';
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cx } from '@/lib/cx';
import { Icon } from './Icon';
import styles from './form.module.css';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
  icon?: LucideIcon;
  width?: number | string;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { invalid, mono, icon, width, className, disabled, style, ...rest },
  ref,
) {
  return (
    <span
      className={cx(styles.inputWrap, className)}
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      style={{ width, ...style }}
    >
      {icon && <Icon icon={icon} size={14} style={{ marginLeft: 8, color: 'var(--fg-3)' }} />}
      <input ref={ref} className={cx(styles.input, mono && styles.mono)} disabled={disabled} aria-invalid={invalid || undefined} spellCheck={false} {...rest} />
    </span>
  );
});

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className={styles.checkbox} data-disabled={disabled ? 'true' : undefined}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}
