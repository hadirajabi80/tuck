import { create } from 'zustand';

export type ToastLevel = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction { label: string; onClick: () => void }

export interface Toast {
  id: number;
  level: ToastLevel;
  message: string;
  action?: ToastAction;
  durationMs: number;
}

interface ToastState {
  toasts: Toast[];
  push: (t: { level?: ToastLevel; message: string; action?: ToastAction; durationMs?: number }) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();
const MAX_TOASTS = 3;

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: ({ level = 'info', message, action, durationMs }) => {
    const id = nextId++;
    const duration = durationMs ?? (action ? 5000 : level === 'error' ? 5000 : 3000);
    const toast: Toast = { id, level, message, action, durationMs: duration };
    set((s) => ({ toasts: [...s.toasts, toast].slice(-MAX_TOASTS) }));
    timers.set(id, setTimeout(() => get().dismiss(id), duration));
    return id;
  },
  dismiss: (id) => {
    const t = timers.get(id);
    if (t) clearTimeout(t);
    timers.delete(id);
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
  },
}));

/** Imperative helper for non-React code. */
export const toast = (message: string, level: ToastLevel = 'info', action?: ToastAction, durationMs?: number): number =>
  useToasts.getState().push({ message, level, action, durationMs });
