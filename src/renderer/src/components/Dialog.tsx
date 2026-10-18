// Modal dialog + imperative confirm(). Focus is trapped while open and restored on close.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { create } from 'zustand';
import { Button } from './Button';
import { Checkbox } from './TextField';
import styles from './Dialog.module.css';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  checkbox?: { label: string; defaultChecked: boolean };
}

export interface ConfirmResult { confirmed: boolean; checked: boolean }

interface DialogState {
  current: (ConfirmOptions & { resolve: (r: ConfirmResult) => void }) | null;
}

const useDialog = create<DialogState>(() => ({ current: null }));

export function confirm(options: ConfirmOptions): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    useDialog.getState().current?.resolve({ confirmed: false, checked: false });
    useDialog.setState({ current: { ...options, resolve } });
  });
}

export function Dialog({ title, children, footer, onClose, labelledBy }: { title: ReactNode; children?: ReactNode; footer: ReactNode; onClose: () => void; labelledBy?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? el?.querySelector<HTMLElement>('button, input, select, textarea');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select, textarea, [tabindex="0"]')];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className={styles.scrim} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? 'tuck-dialog-title'} onKeyDown={onKeyDown}>
        <h2 className={styles.title} id={labelledBy ?? 'tuck-dialog-title'}>{title}</h2>
        {children && <div className={styles.body}>{children}</div>}
        <div className={styles.footer}>{footer}</div>
      </div>
    </div>
  );
}

/** Mount once per window. */
export function DialogHost() {
  const current = useDialog((s) => s.current);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (current) setChecked(current.checkbox?.defaultChecked ?? false);
  }, [current]);
  if (!current) return null;
  const close = (confirmed: boolean) => {
    current.resolve({ confirmed, checked });
    useDialog.setState({ current: null });
  };
  return (
    <Dialog
      title={current.title}
      onClose={() => close(false)}
      footer={
        <>
          <Button onClick={() => close(false)}>{current.cancelLabel ?? 'Cancel'}</Button>
          <Button variant={current.danger ? 'destructive' : 'primary'} onClick={() => close(true)} data-autofocus>
            {current.confirmLabel ?? 'OK'}
          </Button>
        </>
      }
    >
      {current.message && <div className={styles.message}>{current.message}</div>}
      {current.checkbox && (
        <div className={styles.checkbox}>
          <Checkbox checked={checked} onChange={setChecked} label={current.checkbox.label} />
        </div>
      )}
    </Dialog>
  );
}
