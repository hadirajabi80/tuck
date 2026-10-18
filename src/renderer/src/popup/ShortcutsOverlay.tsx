import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import { comboParts } from '@/lib/keys';
import { Icon } from '@/components/Icon';
import { Kbd } from '@/components/Kbd';
import { usePopup } from '@/store/popupStore';
import styles from './ShortcutsOverlay.module.css';

type Row = [string, string[]];

export function ShortcutsOverlay() {
  const closeMenu = usePopup((s) => s.closeMenu);
  const platform = api.platform;
  const k = (c: string) => comboParts(c, platform);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);

  const groups: Array<{ title: string; rows: Row[] }> = [
    {
      title: 'Paste',
      rows: [
        ['Paste selection', ['↵']],
        ['Paste as plain text', k('shift+enter')],
        ['Paste with last transform', k('mod+enter')],
        ['Quick paste row 1–9', [...k('mod'), '1–9']],
        ['Transform menu', k('mod+t')],
        ['Copy without pasting', k('mod+c')],
      ],
    },
    {
      title: 'Navigate',
      rows: [
        ['Move selection', ['↑', '↓']],
        ['Jump 10 rows', ['PgUp', 'PgDn']],
        ['First / last', ['Home', 'End']],
        ['Next / previous filter', ['Tab', ...k('shift+tab')]],
        ['Clear search', k('mod+shift+c')],
        ['Hide Tuck', ['Esc']],
      ],
    },
    {
      title: 'Select',
      rows: [
        ['Toggle multi-select', k('mod+space')],
        ['Extend selection', [...k('shift'), '↑↓']],
        ['Select all', k('mod+a')],
      ],
    },
    {
      title: 'Organize',
      rows: [
        ['Pin / unpin', k('mod+p')],
        ['Move pin up / down', [...k('alt'), '↑↓']],
        ['Collections', k('mod+g')],
        ['Edit text', k('mod+e')],
        ['Save as snippet', k('mod+s')],
        ['New snippet', k('mod+n')],
        ['Delete', platform === 'darwin' ? ['⌘', '⌫'] : ['Del']],
        ['Undo delete', k('mod+z')],
      ],
    },
    {
      title: 'Window',
      rows: [
        ['Toggle preview', k('mod+.')],
        ['Settings', k('mod+,')],
        ['This overlay', ['?']],
      ],
    },
  ];

  return (
    <div className={styles.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) closeMenu(); }}>
      <div
        ref={ref}
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape' || e.key === '?' || (e.key === '/' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); closeMenu(); }
        }}
      >
        <header className={styles.header}>
          <h2>Keyboard shortcuts</h2>
          <button type="button" className={styles.close} aria-label="Close" onClick={closeMenu}>
            <Icon icon={X} size={14} />
          </button>
        </header>
        <div className={styles.grid}>
          {groups.map((g) => (
            <section key={g.title} className={styles.group}>
              <h3>{g.title}</h3>
              <dl>
                {g.rows.map(([label, keys]) => (
                  <div key={label} className={styles.row}>
                    <dt>{label}</dt>
                    <dd><Kbd parts={keys} /></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <footer className={styles.footer}>
          Drag rows to reorder pins, into Pinned to pin, or out to unpin (not while searching) · Alt+click opens a link or reveals a file · Double-click pastes
        </footer>
      </div>
    </div>
  );
}
