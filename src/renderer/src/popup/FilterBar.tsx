import { ChevronDown, Layers, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Menu, type MenuItem } from '@/components/Menu';
import { groupColorVar, useGroups } from '@/store/groupsStore';
import { FILTERS, usePopup } from '@/store/popupStore';
import { useSettings } from '@/store/settingsStore';
import { formatCount } from '@/lib/format';
import styles from './FilterBar.module.css';

export function FilterBar() {
  const filter = usePopup((s) => s.filter);
  const setFilter = usePopup((s) => s.setFilter);
  const captureImages = useSettings((s) => s.settings?.history.captureImages ?? true);
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chipsRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [filter]);
  return (
    <div className={styles.bar}>
      <div ref={chipsRef} className={styles.chips} role="tablist" aria-label="Filter clips">
        {FILTERS.map((f) => (
          <Chip
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            aria-controls="clip-list"
            tabIndex={-1}
            active={filter === f.id}
            onClick={() => setFilter(f.id)}
            title={f.id === 'images' && !captureImages ? 'Image capture is off' : undefined}
          >
            {f.label}
          </Chip>
        ))}
      </div>
      <GroupPicker />
    </div>
  );
}

export function GroupPicker() {
  const groups = useGroups((s) => s.groups);
  const createGroup = useGroups((s) => s.create);
  const groupId = usePopup((s) => s.groupId);
  const menuOpen = usePopup((s) => s.menu.kind === 'collections');
  const openMenu = usePopup((s) => s.openMenu);
  const closeMenu = usePopup((s) => s.closeMenu);
  const setGroup = usePopup((s) => s.setGroup);
  const btn = useRef<HTMLButtonElement>(null);
  const current = groups.find((g) => g.id === groupId);

  const items = useMemo<MenuItem[]>(() => [
    { type: 'checkbox', id: 'all', label: 'All clips', checked: !groupId, onSelect: () => setGroup(null) },
    ...(groups.length ? [{ type: 'separator' as const, id: 'sep1' }, { type: 'label' as const, id: 'lbl', label: 'Collections' }] : []),
    ...groups.map<MenuItem>((g) => ({
      type: 'checkbox', id: g.id, label: g.name, checked: g.id === groupId, dot: groupColorVar(g.color), hint: formatCount(g.clipCount),
      onSelect: () => setGroup(g.id),
    })),
    { type: 'separator', id: 'sep2' },
    { type: 'create', id: 'new', label: 'New collection…', placeholder: 'Collection name', onCreate: (name) => { void createGroup(name).then((g) => g && setGroup(g.id)); } },
  ], [groups, groupId, setGroup, createGroup]);

  const onClose = useCallback(() => closeMenu(), [closeMenu]);
  const rect = btn.current?.getBoundingClientRect();

  return (
    <div className={styles.picker}>
      <button
        ref={btn}
        type="button"
        tabIndex={-1}
        className={styles.pickerButton}
        data-active={current ? 'true' : undefined}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => (menuOpen ? closeMenu() : openMenu({ kind: 'collections' }))}
      >
        {current ? (
          <span className={styles.dot} style={{ background: groupColorVar(current.color) }} />
        ) : (
          <Icon icon={Layers} size={13} />
        )}
        <span className={styles.pickerLabel}>{current ? current.name : 'Collections'}</span>
        <Icon icon={ChevronDown} size={12} className={styles.chevron} />
      </button>
      {current && (
        <button type="button" tabIndex={-1} className={styles.clearGroup} aria-label="Show all clips" onClick={() => setGroup(null)}>
          <Icon icon={X} size={12} strokeWidth={2} />
        </button>
      )}
      {menuOpen && rect && <Menu items={items} anchor={{ rect, placement: 'bottom-end' }} label="Collections" onClose={onClose} minWidth={220} />}
    </div>
  );
}
