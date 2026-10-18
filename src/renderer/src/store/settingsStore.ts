// Settings, shortcut statuses, capture state and app info — shared by both windows.
// Every change saves immediately via settings:set; the store reflects settings:changed broadcasts.
import { create } from 'zustand';
import type { AppInfo, CaptureState, DeepPartial, Settings, ShortcutStatus } from '@shared/types';
import { api } from '@/lib/api';
import { toast } from './toastStore';

interface SettingsState {
  settings: Settings | null;
  shortcuts: ShortcutStatus[];
  capture: CaptureState;
  appInfo: AppInfo | null;
  loaded: boolean;
  load: () => Promise<void>;
  set: (patch: DeepPartial<Settings>) => Promise<Settings | null>;
  reset: () => Promise<void>;
  setPaused: (paused: boolean) => Promise<void>;
  refreshAppInfo: () => Promise<void>;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function mergeSettings<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isObj(v) && isObj(out[k]) ? mergeSettings(out[k], v) : v;
  return out as T;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: null,
  shortcuts: [],
  capture: { paused: false, pausedAt: null },
  appInfo: null,
  loaded: false,

  load: async () => {
    try {
      const [settings, shortcuts, capture, appInfo] = await Promise.all([
        api.invoke('settings:get'),
        api.invoke('shortcuts:status'),
        api.invoke('capture:getState'),
        api.invoke('app:getInfo'),
      ]);
      set({ settings, shortcuts, capture, appInfo, loaded: true });
    } catch (err) {
      console.error('[tuck] settings load failed', err);
      set({ loaded: true });
      toast('Could not load settings', 'error');
    }
  },

  set: async (patch) => {
    const prev = get().settings;
    if (prev) set({ settings: mergeSettings(prev, patch) });
    try {
      const next = await api.invoke('settings:set', patch);
      set({ settings: next });
      return next;
    } catch (err) {
      console.error('[tuck] settings:set failed', err);
      if (prev) set({ settings: prev });
      toast('Could not save that setting', 'error');
      return null;
    }
  },

  reset: async () => {
    const next = await api.invoke('settings:reset');
    const shortcuts = await api.invoke('shortcuts:status');
    set({ settings: next, shortcuts });
  },

  setPaused: async (paused) => {
    set({ capture: { paused, pausedAt: paused ? Date.now() : null } });
    try {
      set({ capture: await api.invoke('capture:setPaused', { paused }) });
    } catch {
      toast('Could not change capture state', 'error');
    }
  },

  refreshAppInfo: async () => {
    try {
      set({ appInfo: await api.invoke('app:getInfo') });
    } catch {
      /* ignore */
    }
  },
}));

let subscribed = false;
/** Subscribes the store to main broadcasts (once per window). */
export function initSettingsSync(): void {
  if (subscribed) return;
  subscribed = true;
  api.on('settings:changed', (settings) => useSettings.setState({ settings }));
  api.on('shortcuts:changed', (shortcuts) => useSettings.setState({ shortcuts }));
  api.on('capture:changed', (capture) => useSettings.setState({ capture }));
  void useSettings.getState().load();
}
