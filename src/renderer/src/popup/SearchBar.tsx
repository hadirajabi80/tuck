import { PanelRightClose, PanelRightOpen, Search, Settings2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { registerSearchInput, focusSearch } from '@/lib/focus';
import { comboParts } from '@/lib/keys';
import { Icon } from '@/components/Icon';
import { Kbd } from '@/components/Kbd';
import { Spinner } from '@/components/Spinner';
import { useGroups } from '@/store/groupsStore';
import { usePopup } from '@/store/popupStore';
import styles from './SearchBar.module.css';

const PLACEHOLDERS: Record<string, string> = {
  all: 'Search clips…', pinned: 'Search pinned…', text: 'Search text…', images: 'Search images…', links: 'Search links…',
  files: 'Search files…', colors: 'Search colors…', code: 'Search code…', snippets: 'Search snippets…',
};

export function SearchBar() {
  const query = usePopup((s) => s.query);
  const filter = usePopup((s) => s.filter);
  const groupId = usePopup((s) => s.groupId);
  const selectedId = usePopup((s) => s.selectedId);
  const loading = usePopup((s) => s.loading);
  const setQuery = usePopup((s) => s.setQuery);
  const previewVisible = usePopup((s) => s.previewVisible);
  const togglePreview = usePopup((s) => s.togglePreview);
  const groupName = useGroups((s) => s.groups.find((g) => g.id === groupId)?.name);
  const slowLoading = useDelayed(loading && query !== '', 120);
  const platform = api.platform;

  const placeholder = groupName && filter !== 'snippets' ? `Search in ${groupName}…` : PLACEHOLDERS[filter];

  return (
    <div className={styles.bar}>
      <Icon icon={Search} size={17} className={styles.icon} />
      <input
        ref={registerSearchInput}
        className={styles.input}
        role="combobox"
        aria-label="Search clipboard history"
        aria-expanded="true"
        aria-controls="clip-list"
        aria-autocomplete="list"
        aria-activedescendant={selectedId ? `clip-row-${selectedId}` : undefined}
        placeholder={placeholder}
        value={query}
        autoFocus
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setQuery(e.target.value)}
        onBlur={(e) => {
          // Keep focus in the input unless it moved to a real control (menu, editor, dialog).
          const to = e.relatedTarget as HTMLElement | null;
          if (!to) focusSearch();
        }}
      />
      {slowLoading && <Spinner size={13} label="Searching" />}
      {query && (
        <button type="button" className={styles.clear} aria-label="Clear search" tabIndex={-1} onClick={() => { setQuery(''); focusSearch(); }}>
          <Icon icon={X} size={13} strokeWidth={2} />
        </button>
      )}
      <button
        type="button"
        className={styles.previewToggle}
        tabIndex={-1}
        aria-pressed={previewVisible}
        aria-label={previewVisible ? 'Hide preview' : 'Show preview'}
        title={`${previewVisible ? 'Hide' : 'Show'} preview (${comboParts('mod+.', platform).join('+')})`}
        onClick={() => togglePreview()}
      >
        <Icon icon={previewVisible ? PanelRightClose : PanelRightOpen} size={15} />
      </button>
      <button
        type="button"
        className={styles.settings}
        tabIndex={-1}
        aria-label="Open settings"
        title="Settings"
        onClick={() => void api.invoke('settings:openWindow', {})}
      >
        <Icon icon={Settings2} size={14} />
        <Kbd parts={comboParts('mod+,', platform)} />
      </button>
    </div>
  );
}

function useDelayed(flag: boolean, ms: number): boolean {
  const [v, setV] = useState(false);
  useEffect(() => {
    if (!flag) { setV(false); return; }
    const t = setTimeout(() => setV(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return v;
}
