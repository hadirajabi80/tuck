// Global shortcuts: register from settings, live re-register with validation and conflict detection,
// temporary release while the settings recorder captures a combo.
import { globalShortcut } from 'electron';
import { normalize, validate } from '../../shared/accelerator';
import type { Platform, ShortcutId, ShortcutSetResult, ShortcutStatus } from '../../shared/types';
import { logger } from '../log';

const log = logger('hotkeys');
export const SHORTCUT_IDS: ShortcutId[] = ['openPopup', 'pasteLastPlain', 'toggleCapture'];

interface Entry {
  accelerator: string;
  registered: boolean;
  error: string | null;
}

export interface HotkeyDeps {
  platform: Platform;
  actions: Record<ShortcutId, () => void>;
  /** Current accelerators from settings. */
  load: () => Record<ShortcutId, string>;
  /** Persists an accelerator into settings. */
  save: (id: ShortcutId, accelerator: string) => void;
  onChange: (status: ShortcutStatus[]) => void;
}

export class HotkeyManager {
  private entries = new Map<ShortcutId, Entry>();
  private recording = false;

  constructor(private readonly deps: HotkeyDeps) {
    for (const id of SHORTCUT_IDS) this.entries.set(id, { accelerator: '', registered: false, error: null });
  }

  status(): ShortcutStatus[] {
    return SHORTCUT_IDS.map((id) => {
      const e = this.entries.get(id)!;
      return { id, accelerator: e.accelerator, registered: e.registered, error: e.error };
    });
  }

  private statusOf(id: ShortcutId): ShortcutStatus {
    return this.status().find((s) => s.id === id)!;
  }

  private tryRegister(id: ShortcutId, accel: string): boolean {
    if (!accel) return false;
    try {
      return globalShortcut.register(accel, () => {
        try {
          this.deps.actions[id]();
        } catch (err) {
          log.error(`action ${id} failed`, err);
        }
      });
    } catch (err) {
      log.warn(`register ${accel} threw`, (err as Error).message);
      return false;
    }
  }

  private release(accel: string): void {
    if (!accel) return;
    try {
      globalShortcut.unregister(accel);
    } catch {
      /* not registered */
    }
  }

  /** (Re-)registers everything from settings. */
  registerAll(): ShortcutStatus[] {
    const wanted = this.deps.load();
    for (const id of SHORTCUT_IDS) {
      const e = this.entries.get(id)!;
      if (e.registered) this.release(e.accelerator);
      e.registered = false;
    }
    const used = new Set<string>();
    for (const id of SHORTCUT_IDS) {
      const e = this.entries.get(id)!;
      const accel = normalize(wanted[id] ?? '', this.deps.platform) ?? '';
      e.accelerator = accel;
      e.error = null;
      if (!accel) continue;
      const v = validate(accel, this.deps.platform);
      if (!v.ok) {
        e.error = v.reason;
        continue;
      }
      if (used.has(accel.toLowerCase())) {
        e.error = 'Already used by another Tuck shortcut';
        continue;
      }
      used.add(accel.toLowerCase());
      if (this.recording) continue;
      e.registered = this.tryRegister(id, accel);
      if (!e.registered) e.error = 'Already in use by another app';
    }
    const st = this.status();
    log.info('status', st.map((s) => `${s.id}=${s.accelerator || '(none)'}:${s.registered ? 'ok' : (s.error ?? 'unbound')}`).join(' '));
    this.deps.onChange(st);
    return st;
  }

  /** Re-registers only when settings differ from what is registered (e.g. after settings:reset / import). */
  syncFromSettings(): void {
    const wanted = this.deps.load();
    const differs = SHORTCUT_IDS.some((id) => (normalize(wanted[id] ?? '', this.deps.platform) ?? '') !== this.entries.get(id)!.accelerator);
    if (differs) this.registerAll();
  }

  set(id: ShortcutId, accelerator: string): ShortcutSetResult {
    if (!SHORTCUT_IDS.includes(id)) {
      return { ok: false, status: { id, accelerator: '', registered: false, error: 'Unknown shortcut' }, error: 'unknown' };
    }
    const accel = normalize(typeof accelerator === 'string' ? accelerator : '', this.deps.platform);
    if (accel === null) return { ok: false, status: this.statusOf(id), error: 'invalid', message: 'Unrecognised key combination' };
    const v = validate(accel, this.deps.platform);
    if (!v.ok) return { ok: false, status: this.statusOf(id), error: 'invalid', message: v.reason };
    const e = this.entries.get(id)!;

    if (accel) {
      const clash = SHORTCUT_IDS.find((o) => o !== id && this.entries.get(o)!.accelerator.toLowerCase() === accel.toLowerCase());
      if (clash) return { ok: false, status: this.statusOf(id), error: 'conflict-internal', message: `Already used by "${clash}"` };
    }
    if (accel === e.accelerator && (e.registered || !accel || this.recording)) {
      return { ok: true, status: this.statusOf(id) };
    }

    const old = e.accelerator;
    const oldRegistered = e.registered;
    if (oldRegistered) this.release(old);
    e.registered = false;

    if (!accel) {
      e.accelerator = '';
      e.error = null;
      this.deps.save(id, '');
      this.deps.onChange(this.status());
      return { ok: true, status: this.statusOf(id) };
    }

    if (!this.tryRegister(id, accel)) {
      if (oldRegistered) e.registered = this.tryRegister(id, old);
      if (this.recording && e.registered) {
        this.release(old);
        e.registered = false;
      }
      this.deps.onChange(this.status());
      return { ok: false, status: this.statusOf(id), error: 'conflict-system', message: 'Already in use by another app' };
    }
    e.accelerator = accel;
    e.error = null;
    e.registered = true;
    if (this.recording) {
      // Availability verified; actually bind once recording ends.
      this.release(accel);
    }
    this.deps.save(id, accel);
    log.info(`${id} → ${accel}`);
    const result = { ok: true, status: this.statusOf(id) };
    this.deps.onChange(this.status());
    return result;
  }

  setRecording(recording: boolean): void {
    if (recording === this.recording) return;
    this.recording = recording;
    if (recording) {
      for (const id of SHORTCUT_IDS) {
        const e = this.entries.get(id)!;
        if (e.registered) this.release(e.accelerator);
      }
      log.debug('recording: shortcuts released');
    } else {
      this.registerAll();
    }
  }

  unregisterAll(): void {
    try {
      globalShortcut.unregisterAll();
    } catch {
      /* app quitting */
    }
    for (const e of this.entries.values()) e.registered = false;
  }
}

let instance: HotkeyManager | null = null;

export function initHotkeys(deps: HotkeyDeps): HotkeyManager {
  instance = new HotkeyManager(deps);
  return instance;
}

export function hotkeys(): HotkeyManager {
  if (!instance) throw new Error('hotkeys not initialised');
  return instance;
}
