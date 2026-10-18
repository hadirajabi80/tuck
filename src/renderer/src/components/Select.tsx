import { ChevronsUpDown } from 'lucide-react';
import { Icon } from './Icon';
import styles from './form.module.css';

export interface SelectOption<T extends string> { value: T; label: string; disabled?: boolean }

export interface SelectProps<T extends string> {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  minWidth?: number;
}

/** Native <select> (best keyboard + screen reader behaviour) with Tuck styling. */
export function Select<T extends string>({ value, options, onChange, disabled, id, minWidth, ...aria }: SelectProps<T>) {
  return (
    <span className={styles.selectWrap}>
      <select
        id={id}
        className={styles.select}
        value={value}
        disabled={disabled}
        style={minWidth ? { minWidth } : undefined}
        onChange={(e) => onChange(e.target.value as T)}
        {...aria}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon icon={ChevronsUpDown} size={13} className={styles.selectChevron} />
    </span>
  );
}
