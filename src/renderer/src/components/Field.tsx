import { useId, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import styles from './Field.module.css';

export interface FieldControlIds { id: string; labelId: string; descriptionId?: string }

export interface FieldProps {
  label: ReactNode;
  description?: ReactNode;
  /** Render prop receives ids so the control can wire aria-labelledby / aria-describedby. */
  children: ReactNode | ((ids: FieldControlIds) => ReactNode);
  /** Control under the label instead of on the right. */
  stacked?: boolean;
  disabled?: boolean;
  status?: ReactNode;
}

/** Settings row: label + description on the left, control on the right. */
export function Field({ label, description, children, stacked, disabled, status }: FieldProps) {
  const base = useId();
  const ids: FieldControlIds = { id: `${base}-control`, labelId: `${base}-label`, descriptionId: description ? `${base}-desc` : undefined };
  return (
    <div className={cx(styles.field, stacked && styles.stacked)} data-disabled={disabled ? 'true' : undefined}>
      <div className={styles.text}>
        <label className={styles.label} id={ids.labelId} htmlFor={ids.id}>
          {label}
        </label>
        {description && (
          <div className={styles.description} id={ids.descriptionId}>
            {description}
          </div>
        )}
        {status && <div className={styles.status}>{status}</div>}
      </div>
      <div className={styles.control}>{typeof children === 'function' ? children(ids) : children}</div>
    </div>
  );
}

/** Rounded card grouping Field rows with hairline separators. */
export function Card({ title, description, actions, children, className }: { title?: ReactNode; description?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx(styles.cardWrap, className)}>
      {(title || actions) && (
        <header className={styles.cardHeader}>
          <div>
            {title && <h3 className={styles.cardTitle}>{title}</h3>}
            {description && <p className={styles.cardDescription}>{description}</p>}
          </div>
          {actions && <div className={styles.cardActions}>{actions}</div>}
        </header>
      )}
      <div className={styles.card}>{children}</div>
    </section>
  );
}

/** Padded free-form content inside a Card. */
export function CardBody({ children }: { children: ReactNode }) {
  return <div className={styles.cardBody}>{children}</div>;
}
