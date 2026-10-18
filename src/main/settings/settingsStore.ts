// Settings persisted as userData/settings.json: deep-merged with platform defaults, validated/clamped,
// written atomically (temp + rename). Side effects (theme, hotkeys, autostart, watcher, popup material,
// broadcasting settings:changed) are attached by index.ts through onChange(), which keeps this module
// free of electron imports and unit-testable.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalize as normalizeAccel } from '../../shared/accelerator';
import { defaultSettings, POPUP_SIZE, type DeepPartial, type Platform, type Settings, type ShortcutId } from '../../shared/types';
import { logger } from '../log';

const log = logger('settings');

type Listener = (next: Settings, prev: Settings) => void;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, patch: unknown): T {
  if (!isObj(base) || !isObj(patch)) return (patch === undefined ? base : (patch as T));
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    const cur = out[k];
    out[k] = isObj(cur) && isObj(v) ? deepMerge(cur, v) : v;
  }
  return out as T;
}

function bool(v: unknown, fb: boolean): boolean {
  return typeof v === 'boolean' ? v : fb;
}
function int(v: unknown, fb: number, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fb;
  return Math.min(max, Math.max(min, Math.round(v)));
}
function oneOf<T extends string>(v: unknown, allowed: readonly T[], fb: T): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fb;
}
function str(v: unknown, fb: string, maxLen: number): string {
  return typeof v === 'string' ? v.slice(0, maxLen) : fb;
}
function strList(v: unknown, fb: string[], maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(v)) return fb;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== 'string') continue;
    const s = item.trim().slice(0, maxLen);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

const SHORTCUT_IDS: ShortcutId[] = ['openPopup', 'pasteLastPlain', 'toggleCapture'];

/** Validates every field of `c` against `fb` (the value to keep when a field is invalid). */
export function sanitize(c: unknown, fb: Settings, platform: Platform): Settings {
  const s = isObj(c) ? c : {};
  const g = isObj(s['general']) ? s['general'] : {};
  const sc = isObj(s['shortcuts']) ? s['shortcuts'] : {};
  const h = isObj(s['history']) ? s['history'] : {};
  const a = isObj(s['appearance']) ? s['appearance'] : {};
  const p = isObj(s['privacy']) ? s['privacy'] : {};
  const u = isObj(s['updates']) ? s['updates'] : {};

  const shortcuts = { ...fb.shortcuts };
  for (const id of SHORTCUT_IDS) {
    const raw = sc[id];
    if (typeof raw !== 'string') continue;
    const n = normalizeAccel(raw, platform);
    if (n !== null) shortcuts[id] = n;
  }

  return {
    general: {
      launchAtLogin: bool(g['launchAtLogin'], fb.general.launchAtLogin),
      hideOnBlur: bool(g['hideOnBlur'], fb.general.hideOnBlur),
      moveToTopOnPaste: bool(g['moveToTopOnPaste'], fb.general.moveToTopOnPaste),
      pasteDelayMs: int(g['pasteDelayMs'], fb.general.pasteDelayMs, 0, 1000),
      mergeSeparator: str(g['mergeSeparator'], fb.general.mergeSeparator, 64),
      showSourceApp: bool(g['showSourceApp'], fb.general.showSourceApp),
    },
    shortcuts,
    history: {
      maxItems: int(h['maxItems'], fb.history.maxItems, 50, 100_000),
      expireDays: int(h['expireDays'], fb.history.expireDays, 0, 3650),
      dedupe: bool(h['dedupe'], fb.history.dedupe),
      captureImages: bool(h['captureImages'], fb.history.captureImages),
      captureFiles: bool(h['captureFiles'], fb.history.captureFiles),
      maxImageBytes: int(h['maxImageBytes'], fb.history.maxImageBytes, 256 * 1024, 512 * 1024 * 1024),
      pollIntervalMs: int(h['pollIntervalMs'], fb.history.pollIntervalMs, 100, 2000),
    },
    appearance: {
      theme: oneOf(a['theme'], ['system', 'light', 'dark'] as const, fb.appearance.theme),
      density: oneOf(a['density'], ['comfortable', 'compact'] as const, fb.appearance.density),
      vibrancy: bool(a['vibrancy'], fb.appearance.vibrancy),
      previewVisible: bool(a['previewVisible'], fb.appearance.previewVisible),
      popupPosition: oneOf(a['popupPosition'], ['cursor', 'center', 'remember'] as const, fb.appearance.popupPosition),
      showQuickPasteBadges: oneOf(a['showQuickPasteBadges'], ['always', 'modifier', 'never'] as const, fb.appearance.showQuickPasteBadges),
      popupWidth: int(a['popupWidth'], fb.appearance.popupWidth, POPUP_SIZE.minWidth, POPUP_SIZE.maxWidth),
      popupListWidth: int(a['popupListWidth'], fb.appearance.popupListWidth, POPUP_SIZE.minListWidth, POPUP_SIZE.maxWidth),
      popupHeight: int(a['popupHeight'], fb.appearance.popupHeight, POPUP_SIZE.minHeight, POPUP_SIZE.maxHeight),
    },
    privacy: {
      skipConcealed: bool(p['skipConcealed'], fb.privacy.skipConcealed),
      ignoredApps: strList(p['ignoredApps'], fb.privacy.ignoredApps, 500, 260),
      ignorePatterns: strList(p['ignorePatterns'], fb.privacy.ignorePatterns, 200, 1000),
    },
    updates: {
      autoCheck: bool(u['autoCheck'], fb.updates.autoCheck),
      autoDownload: bool(u['autoDownload'], fb.updates.autoDownload),
    },
  };
}

export class SettingsStore {
  private current: Settings;
  private readonly listeners = new Set<Listener>();
  readonly defaults: Settings;

  constructor(
    private readonly file: string,
    private readonly platform: Platform,
  ) {
    this.defaults = defaultSettings(platform);
    this.current = structuredClone(this.defaults);
  }

  load(): Settings {
    if (!existsSync(this.file)) {
      this.current = structuredClone(this.defaults);
      this.write();
      log.info('created default settings at', this.file);
      return this.get();
    }
    try {
      // Strip a UTF-8 BOM: Notepad / PowerShell add one when users hand-edit the file.
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8').replace(/^﻿/, ''));
      this.current = sanitize(deepMerge(structuredClone(this.defaults), raw), this.defaults, this.platform);
    } catch (err) {
      const backup = `${this.file}.corrupt-${Date.now()}`;
      log.warn('settings.json unreadable, backing up to', backup, err);
      try {
        renameSync(this.file, backup);
      } catch {
        /* ignore */
      }
      this.current = structuredClone(this.defaults);
      this.write();
    }
    return this.get();
  }

  get(): Settings {
    return structuredClone(this.current);
  }

  set(patch: DeepPartial<Settings>): Settings {
    const prev = this.current;
    const next = sanitize(deepMerge(structuredClone(prev), patch), prev, this.platform);
    if (JSON.stringify(next) === JSON.stringify(prev)) return this.get();
    this.current = next;
    this.write();
    this.notify(next, prev);
    return this.get();
  }

  reset(): Settings {
    const prev = this.current;
    this.current = structuredClone(this.defaults);
    this.write();
    this.notify(this.current, prev);
    return this.get();
  }

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(next: Settings, prev: Settings): void {
    for (const fn of this.listeners) {
      try {
        fn(structuredClone(next), structuredClone(prev));
      } catch (err) {
        log.error('settings listener failed', err);
      }
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(this.current, null, 2)}\n`, 'utf8');
      renameSync(tmp, this.file);
    } catch (err) {
      log.error('failed to write settings', err);
    }
  }
}

let instance: SettingsStore | null = null;

export function initSettings(file: string, platform: Platform): SettingsStore {
  instance = new SettingsStore(file, platform);
  instance.load();
  return instance;
}

export function settings(): SettingsStore {
  if (!instance) throw new Error('settings not initialised');
  return instance;
}
