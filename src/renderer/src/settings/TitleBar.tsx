import { api } from '@/lib/api';
import { TuckMark } from '@/components/EmptyState';
import styles from './TitleBar.module.css';

/** Drag region. Leaves room for macOS traffic lights (left) and the Windows titleBarOverlay controls (right). */
export function TitleBar() {
  return (
    <div className={styles.bar} data-platform={api.platform}>
      <div className={styles.title}>
        <TuckMark size={16} />
        <span>Tuck Settings</span>
      </div>
    </div>
  );
}
