// Keyboard helpers shared by the popup key map and display components. Pure — unit-tested.
import type { Platform } from '@shared/types';

export interface ModKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** The platform "primary" modifier: Cmd on macOS, Ctrl elsewhere. */
export function isMod(e: Pick<ModKeyEvent, 'ctrlKey' | 'metaKey'>, platform: Platform): boolean {
  return platform === 'darwin' ? e.metaKey : e.ctrlKey;
}

/** True when the key itself is the primary modifier (Control / Meta). */
export function isModKey(e: Pick<ModKeyEvent, 'key'>, platform: Platform): boolean {
  return platform === 'darwin' ? e.key === 'Meta' : e.key === 'Control';
}

/** Ctrl/Cmd+1..9 → 0..8, else -1. Uses `code` so it works with Shift and any layout. */
export function quickPasteIndex(e: ModKeyEvent, platform: Platform): number {
  if (!isMod(e, platform) || e.altKey || e.shiftKey) return -1;
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
  return m ? Number(m[1]) - 1 : -1;
}

/** Delete selection: Delete on Windows, Cmd+Backspace (or forward Delete) on macOS. */
export function isDeleteCombo(e: ModKeyEvent, platform: Platform, inputIdle: boolean): boolean {
  if (platform === 'darwin') return (e.key === 'Backspace' && e.metaKey) || (e.key === 'Delete' && inputIdle);
  // Plain Delete deletes the clip only when the search input has nothing after the caret to delete.
  return e.key === 'Delete' && !e.ctrlKey && !e.altKey && !e.metaKey && inputIdle;
}

/** Matches "mod+shift+c" style combos (mod = Cmd on mac, Ctrl elsewhere). Key compared case-insensitively. */
export function matchCombo(e: ModKeyEvent, combo: string, platform: Platform): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop() ?? '';
  const want = { mod: false, shift: false, alt: false, ctrl: false };
  for (const p of parts) if (p in want) want[p as keyof typeof want] = true;
  const mod = isMod(e, platform);
  // "ctrl" on mac means the physical Control key; on Windows it is the same as mod.
  const ctrl = platform === 'darwin' ? e.ctrlKey : false;
  if (mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt || ctrl !== want.ctrl) return false;
  const k = e.key.toLowerCase();
  if (k === key) return true;
  // Fall back to the physical key for letters/digits (Shift or layouts may change e.key).
  if (/^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return e.code === `Digit${key}`;
  if (key === '.') return e.code === 'Period';
  if (key === ',') return e.code === 'Comma';
  if (key === '/') return e.code === 'Slash';
  if (key === 'space') return e.code === 'Space';
  return false;
}

const MAC_SYMBOLS: Record<string, string> = {
  mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', enter: '↵', backspace: '⌫', delete: '⌦', esc: 'esc', tab: '⇥',
  up: '↑', down: '↓', left: '←', right: '→', space: 'Space',
};
const WIN_SYMBOLS: Record<string, string> = {
  mod: 'Ctrl', shift: 'Shift', alt: 'Alt', ctrl: 'Ctrl', enter: '↵', backspace: 'Backspace', delete: 'Del', esc: 'Esc', tab: 'Tab',
  up: '↑', down: '↓', left: '←', right: '→', space: 'Space',
};

/** Display parts for <Kbd>: comboParts('mod+shift+c', 'darwin') → ['⌘','⇧','C']. */
export function comboParts(combo: string, platform: Platform): string[] {
  const table = platform === 'darwin' ? MAC_SYMBOLS : WIN_SYMBOLS;
  return combo.split('+').map((p) => {
    const lower = p.toLowerCase();
    if (table[lower]) return table[lower]!;
    return p.length === 1 ? p.toUpperCase() : p;
  });
}

/** Inline label: "⌘⇧C" on mac, "Ctrl+Shift+C" elsewhere. */
export function comboLabel(combo: string, platform: Platform): string {
  const parts = comboParts(combo, platform);
  return platform === 'darwin' ? parts.join('') : parts.join('+');
}
