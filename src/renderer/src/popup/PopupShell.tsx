import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { applyAppearance } from '@/lib/theme';
import { usePopup } from '@/store/popupStore';
import { useSettings } from '@/store/settingsStore';
import { Toasts } from '@/components/Toasts';
import { CaptureBanner } from './CaptureBanner';
import { ClipList } from './ClipList';
import { FilterBar } from './FilterBar';
import { GroupMenu } from './GroupMenu';
import { PreviewPane } from './PreviewPane';
import { RowContextMenu } from './RowContextMenu';
import { SearchBar } from './SearchBar';
import { ShortcutsOverlay } from './ShortcutsOverlay';
import { StatusBar } from './StatusBar';
import { TransformMenu } from './TransformMenu';
import { usePopupKeys } from './usePopupKeys';
import styles from './PopupShell.module.css';

export function PopupShell() {
  const platform = api.platform;
  const keys = usePopupKeys(platform);
  const settings = useSettings((s) => s.settings);
  const previewVisible = usePopup((s) => s.previewVisible);
  const menu = usePopup((s) => s.menu);
  const [shownAt, setShownAt] = useState(0);

  useEffect(() => applyAppearance(settings, 'popup'), [settings]);

  // Replay the show animation on every popup:shown.
  useEffect(() => api.on('popup:shown', () => setShownAt(Date.now())), []);

  return (
    <div
      key={shownAt}
      className={styles.shell}
      data-density={settings?.appearance.density ?? 'comfortable'}
      data-preview={previewVisible ? 'on' : 'off'}
      onKeyDown={keys.onKeyDown}
      onKeyUp={keys.onKeyUp}
      onMouseDown={(e) => {
        // Keep focus in the search input when clicking non-focusable chrome.
        const t = e.target as HTMLElement;
        if (!t.closest('input, textarea, select, [contenteditable="true"]')) e.preventDefault();
      }}
    >
      <SearchBar />
      <FilterBar />
      <CaptureBanner />
      <div className={styles.body}>
        <ClipList />
        {previewVisible && (
          <>
            <div className={styles.divider} />
            <PreviewPane />
          </>
        )}
      </div>
      <StatusBar />
      <Toasts />
      {menu.kind === 'context' && <RowContextMenu />}
      {menu.kind === 'transform' && <TransformMenu />}
      {menu.kind === 'group' && <GroupMenu />}
      {menu.kind === 'help' && <ShortcutsOverlay />}
    </div>
  );
}
