import { ChevronDown, ChevronUp } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cx } from '@/lib/cx';
import { Icon } from './Icon';
import styles from './form.module.css';

export interface NumberFieldProps {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  disabled?: boolean;
  id?: string;
  width?: number;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
}

/** Numeric input that commits (clamped) on blur / Enter; arrows step; Esc reverts. */
export function NumberField({ value, onChange, min, max, step = 1, suffix, disabled, id, width, ...aria }: NumberFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [value, focused]);

  const parsed = Number(draft.replace(/[,\s]/g, ''));
  const invalid = draft.trim() === '' || !Number.isFinite(parsed);

  const commit = (raw: number) => {
    const next = Math.min(max, Math.max(min, Math.round(raw / step) * step));
    setDraft(String(next));
    if (next !== value) onChange(next);
  };

  const bump = (dir: 1 | -1) => commit((invalid ? value : parsed) + dir * step);

  return (
    <span
      className={cx(styles.inputWrap, styles.number)}
      data-invalid={focused && invalid ? 'true' : undefined}
      data-disabled={disabled ? 'true' : undefined}
      style={width ? { width } : undefined}
    >
      <input
        id={id}
        className={styles.input}
        inputMode="numeric"
        value={draft}
        disabled={disabled}
        role="spinbutton"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onBlur={() => { setFocused(false); if (invalid) setDraft(String(value)); else commit(parsed); }}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { if (!invalid) commit(parsed); e.currentTarget.blur(); }
          else if (e.key === 'Escape') { setDraft(String(value)); e.currentTarget.blur(); e.stopPropagation(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); bump(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); bump(-1); }
        }}
        {...aria}
      />
      {suffix && <span className={styles.suffix}>{suffix}</span>}
      <span className={styles.stepper}>
        <button type="button" tabIndex={-1} aria-hidden onClick={() => bump(1)} disabled={disabled}>
          <Icon icon={ChevronUp} size={11} strokeWidth={2} />
        </button>
        <button type="button" tabIndex={-1} aria-hidden onClick={() => bump(-1)} disabled={disabled}>
          <Icon icon={ChevronDown} size={11} strokeWidth={2} />
        </button>
      </span>
    </span>
  );
}
