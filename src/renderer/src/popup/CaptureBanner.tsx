import { Pause, ShieldAlert } from 'lucide-react';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { requestAccessibility, usePopup } from '@/store/popupStore';
import { useSettings } from '@/store/settingsStore';
import styles from './CaptureBanner.module.css';

export function CaptureBanner() {
  const paused = useSettings((s) => s.capture.paused);
  const setPaused = useSettings((s) => s.setPaused);
  const trusted = useSettings((s) => s.appInfo?.accessibilityTrusted);
  const needed = usePopup((s) => s.accessibilityNeeded);
  const mac = api.platform === 'darwin';

  if (paused) {
    return (
      <div className={styles.banner} data-tone="warning" role="status">
        <Icon icon={Pause} size={13} strokeWidth={2.2} />
        <span className={styles.text}>Capture paused — new copies aren’t saved</span>
        <button type="button" tabIndex={-1} className={styles.action} onClick={() => void setPaused(false)}>
          Resume
        </button>
      </div>
    );
  }
  if (mac && (trusted === false || needed)) {
    return (
      <div className={styles.banner} data-tone="accent" role="status">
        <Icon icon={ShieldAlert} size={13} strokeWidth={2.2} />
        <span className={styles.text}>Accessibility permission needed to paste</span>
        <button type="button" tabIndex={-1} className={styles.action} onClick={() => void requestAccessibility()}>
          Grant
        </button>
      </div>
    );
  }
  return null;
}
