import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useToasts, type ToastLevel } from '@/store/toastStore';
import { Icon } from './Icon';
import styles from './Toasts.module.css';

const ICONS: Record<ToastLevel, typeof Info> = { info: Info, success: CircleCheck, warning: TriangleAlert, error: CircleAlert };

/** Toast stack; polite live region for info/success, assertive (role=alert) for warnings/errors. */
export function Toasts({ placement = 'bottom' }: { placement?: 'bottom' | 'bottom-right' }) {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className={styles.region} data-placement={placement}>
      <div aria-live="polite" aria-atomic="false" className={styles.stack}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className={styles.toast}
            data-level={t.level}
            role={t.level === 'error' || t.level === 'warning' ? 'alert' : 'status'}
          >
            <Icon icon={ICONS[t.level]} size={15} className={styles.icon} />
            <span className={styles.message}>{t.message}</span>
            {t.action && (
              <button
                type="button"
                className={styles.action}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { t.action!.onClick(); dismiss(t.id); }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className={styles.close} aria-label="Dismiss" onMouseDown={(e) => e.preventDefault()} onClick={() => dismiss(t.id)}>
              <Icon icon={X} size={13} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
