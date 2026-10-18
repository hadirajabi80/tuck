import type { LucideIcon } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import styles from './form.module.css';

export interface Segment<T extends string> { value: T; label: string; icon?: LucideIcon }

export interface SegmentedControlProps<T extends string> {
  value: T;
  options: ReadonlyArray<Segment<T>>;
  onChange: (value: T) => void;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

/** radiogroup with roving tabindex; arrows move + select. */
export function SegmentedControl<T extends string>({ value, options, onChange, ...aria }: SegmentedControlProps<T>) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const i = options.findIndex((o) => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = options.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onChange(options[next]!.value);
    requestAnimationFrame(() => (ref.current?.querySelectorAll('button')[next] as HTMLButtonElement | undefined)?.focus());
  };
  return (
    <div ref={ref} role="radiogroup" className={styles.segmented} onKeyDown={onKeyDown} {...aria}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className={styles.segment}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon icon={o.icon} size={13} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}
