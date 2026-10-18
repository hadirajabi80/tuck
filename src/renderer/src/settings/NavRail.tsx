import type { LucideIcon } from 'lucide-react';
import { Info, Keyboard, History, Paintbrush, Shield, SlidersHorizontal } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';
import type { SettingsSection } from '@shared/types';
import { cx } from '@/lib/cx';
import { Icon } from '@/components/Icon';
import styles from './NavRail.module.css';

export const SECTIONS: ReadonlyArray<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'general', label: 'General', icon: SlidersHorizontal },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'history', label: 'History', icon: History },
  { id: 'appearance', label: 'Appearance', icon: Paintbrush },
  { id: 'privacy', label: 'Privacy', icon: Shield },
  { id: 'about', label: 'About', icon: Info },
];

export function NavRail({ section, onSelect }: { section: SettingsSection; onSelect: (s: SettingsSection) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent) => {
    const i = SECTIONS.findIndex((s) => s.id === section);
    let next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % SECTIONS.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + SECTIONS.length) % SECTIONS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = SECTIONS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    onSelect(SECTIONS[next]!.id);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`#nav-${SECTIONS[next]!.id}`)?.focus());
  };
  return (
    <nav className={styles.rail} aria-label="Settings sections">
      <div ref={ref} role="tablist" aria-orientation="vertical" className={styles.list} onKeyDown={onKeyDown}>
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            id={`nav-${s.id}`}
            type="button"
            role="tab"
            aria-selected={section === s.id}
            aria-controls="settings-panel"
            tabIndex={section === s.id ? 0 : -1}
            className={cx(styles.item, section === s.id && styles.active)}
            onClick={() => onSelect(s.id)}
          >
            <Icon icon={s.icon} size={15} />
            {s.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
