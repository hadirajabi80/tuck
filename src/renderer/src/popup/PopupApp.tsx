import { useEffect } from 'react';
import { api, isMock } from '@/lib/api';
import { initGroupsSync } from '@/store/groupsStore';
import { initPopupSync, usePopup } from '@/store/popupStore';
import { initSettingsSync } from '@/store/settingsStore';
import { PopupShell } from './PopupShell';
import styles from './PopupApp.module.css';

export function PopupApp() {
  useEffect(() => {
    initSettingsSync();
    initGroupsSync();
    initPopupSync();
    void api.invoke('popup:ready').catch((err) => console.error('[tuck] popup:ready failed', err));
  }, []);

  if (!isMock) return <PopupShell />;
  return <MockDesktop />;
}

/** Browser-only frame: shows the popup at its real window size over a wallpaper so translucency is visible. */
function MockDesktop() {
  const previewVisible = usePopup((s) => s.previewVisible);
  return (
    <div className={styles.desktop}>
      <div className={styles.window} style={{ width: previewVisible ? 760 : 480 }}>
        <PopupShell />
      </div>
      <div className={styles.caption}>
        Browser mock · {previewVisible ? '760' : '480'} × 460 · <a href="#/settings">Settings</a>
      </div>
    </div>
  );
}
