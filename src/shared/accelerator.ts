// Electron accelerator helpers: build from KeyboardEvent, validate, and pretty-print.
// Pure module — no electron/node imports. See DESIGN.md section D.
import type { Platform } from './types';

export interface KeyEventLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

type Modifier = 'Control' | 'Alt' | 'Shift' | 'Command' | 'Super';

/** KeyboardEvent.code values that are modifiers on their own. */
const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'CapsLock', 'Fn', 'FnLock', 'NumLock', 'ScrollLock',
]);

/** Non-alphanumeric KeyboardEvent.code → Electron accelerator key name. */
const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
  Enter: 'Return', NumpadEnter: 'Return', Escape: 'Escape',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec',
  PrintScreen: 'PrintScreen',
};

const NAMED_KEYS = new Set([
  'Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Return', 'Escape', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'PrintScreen', 'Plus',
  'numadd', 'numsub', 'nummult', 'numdiv', 'numdec',
]);
const PUNCTUATION_KEYS = new Set(['`', '-', '=', '[', ']', '\\', ';', "'", ',', '.', '/']);

/** Accepted spellings of modifiers (lower-case) → canonical modifier for the platform. */
function canonicalModifier(token: string, platform: Platform): Modifier | null {
  const mac = platform === 'darwin';
  switch (token.toLowerCase()) {
    case 'control': case 'ctrl': return 'Control';
    case 'alt': case 'option': return 'Alt';
    case 'shift': return 'Shift';
    case 'command': case 'cmd': return mac ? 'Command' : null;
    case 'super': case 'meta': return mac ? 'Command' : 'Super';
    case 'commandorcontrol': case 'cmdorctrl': return mac ? 'Command' : 'Control';
    default: return null;
  }
}

const MOD_ORDER: Modifier[] = ['Control', 'Alt', 'Shift', 'Command', 'Super'];

function isFunctionKey(key: string): boolean {
  const m = /^F(\d{1,2})$/.exec(key);
  return !!m && Number(m[1]) >= 1 && Number(m[1]) <= 24;
}

/** Normalises a key token to its canonical accelerator spelling, or null if unknown. */
function canonicalKey(token: string): string | null {
  if (/^[a-z]$/i.test(token)) return token.toUpperCase();
  if (/^[0-9]$/.test(token)) return token;
  if (/^f\d{1,2}$/i.test(token)) { const k = token.toUpperCase(); return isFunctionKey(k) ? k : null; }
  if (/^num[0-9]$/i.test(token)) return token.toLowerCase();
  if (PUNCTUATION_KEYS.has(token)) return token;
  const lower = token.toLowerCase();
  for (const k of NAMED_KEYS) if (k.toLowerCase() === lower) return k;
  if (lower === 'enter') return 'Return';
  if (lower === 'esc') return 'Escape';
  if (lower === 'del') return 'Delete';
  if (lower === 'ins') return 'Insert';
  if (lower === 'pgup') return 'PageUp';
  if (lower === 'pgdn') return 'PageDown';
  return null;
}

/** Maps KeyboardEvent.code to an accelerator key name (layout-independent), or null. */
function keyFromCode(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code) && isFunctionKey(code)) return code;
  return CODE_TO_KEY[code] ?? null;
}

/**
 * Builds an Electron accelerator from a keydown event, e.g. "Control+Shift+V".
 * Returns null for modifier-only presses and unsupported keys.
 */
export function fromKeyboardEvent(e: KeyEventLike, platform: Platform): string | null {
  if (MODIFIER_CODES.has(e.code)) return null;
  const key = keyFromCode(e.code);
  if (!key) return null;
  const mods: Modifier[] = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push(platform === 'darwin' ? 'Command' : 'Super');
  return [...mods, key].join('+');
}

interface Parsed { mods: Modifier[]; key: string }

/** Splits "Control+Shift+=" style strings; tolerates a trailing "+" key ("Control++" → key "Plus"). */
function parse(accel: string, platform: Platform): { ok: true; value: Parsed } | { ok: false; reason: string } {
  const raw = accel.trim();
  if (!raw) return { ok: false, reason: 'Empty shortcut' };
  let tokens = raw.split('+');
  if (raw.endsWith('++')) tokens = [...raw.slice(0, -2).split('+'), 'Plus'];
  else if (raw === '+') tokens = ['Plus'];
  if (tokens.some((t) => t.trim() === '')) return { ok: false, reason: 'Malformed shortcut' };
  tokens = tokens.map((t) => t.trim());
  const keyToken = tokens[tokens.length - 1]!;
  const mods: Modifier[] = [];
  for (const t of tokens.slice(0, -1)) {
    const m = canonicalModifier(t, platform);
    if (!m) {
      if (canonicalKey(t)) return { ok: false, reason: 'Only one non-modifier key is allowed' };
      return { ok: false, reason: `Unknown modifier "${t}"` };
    }
    if (mods.includes(m)) return { ok: false, reason: `Duplicate modifier "${t}"` };
    mods.push(m);
  }
  if (canonicalModifier(keyToken, platform)) return { ok: false, reason: 'Needs a non-modifier key' };
  const key = canonicalKey(keyToken);
  if (!key) return { ok: false, reason: `Unsupported key "${keyToken}"` };
  mods.sort((a, b) => MOD_ORDER.indexOf(a) - MOD_ORDER.indexOf(b));
  return { ok: true, value: { mods, key } };
}

/**
 * Validates an accelerator for global registration.
 * '' (unbound) is valid. Otherwise requires at least one modifier other than Shift, unless the key is F1..F24.
 */
export function validate(accel: string, platform: Platform): { ok: true } | { ok: false; reason: string } {
  if (accel.trim() === '') return { ok: true };
  const p = parse(accel, platform);
  if (!p.ok) return p;
  const { mods, key } = p.value;
  if (isFunctionKey(key)) return { ok: true };
  if (mods.length === 0) return { ok: false, reason: 'Needs a modifier (Ctrl, Alt, Shift, Win/⌘)' };
  if (mods.length === 1 && mods[0] === 'Shift') return { ok: false, reason: 'Shift alone is not enough — add Ctrl, Alt or Win/⌘' };
  return { ok: true };
}

/** Canonical form ("ctrl+shift+v" → "Control+Shift+V"), or null if unparseable. */
export function normalize(accel: string, platform: Platform): string | null {
  if (accel.trim() === '') return '';
  const p = parse(accel, platform);
  return p.ok ? [...p.value.mods, p.value.key].join('+') : null;
}

const MAC_MOD: Record<Modifier, string> = { Control: '⌃', Alt: '⌥', Shift: '⇧', Command: '⌘', Super: '⌘' };
const WIN_MOD: Record<Modifier, string> = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Command: 'Win', Super: 'Win' };
/** macOS displays modifiers in ⌃⌥⇧⌘ order. */
const MAC_ORDER: Modifier[] = ['Control', 'Alt', 'Shift', 'Command', 'Super'];

const MAC_KEY: Record<string, string> = {
  Return: '↩', Backspace: '⌫', Delete: '⌦', Escape: '⎋', Tab: '⇥', Space: 'Space',
  Up: '↑', Down: '↓', Left: '←', Right: '→', PageUp: '⇞', PageDown: '⇟', Home: '↖', End: '↘', Plus: '+',
};
const WIN_KEY: Record<string, string> = {
  Return: 'Enter', Escape: 'Esc', Delete: 'Del', Insert: 'Ins', PageUp: 'PgUp', PageDown: 'PgDn',
  Up: '↑', Down: '↓', Left: '←', Right: '→', Plus: '+', PrintScreen: 'PrtSc',
};

function prettyKey(key: string, platform: Platform): string {
  const num = /^num([0-9])$/.exec(key);
  if (num) return `Num ${num[1]}`;
  const numOps: Record<string, string> = { numadd: 'Num +', numsub: 'Num −', nummult: 'Num ×', numdiv: 'Num ÷', numdec: 'Num .' };
  if (numOps[key]) return numOps[key]!;
  return (platform === 'darwin' ? MAC_KEY[key] : WIN_KEY[key]) ?? key;
}

/** Display parts for <Kbd>: ["⌘","⇧","V"] / ["Ctrl","Shift","V"]. Unparseable input returns [accel]. Empty → []. */
export function prettyParts(accel: string, platform: Platform): string[] {
  if (accel.trim() === '') return [];
  const p = parse(accel, platform);
  if (!p.ok) return [accel];
  const mac = platform === 'darwin';
  const mods = mac ? [...p.value.mods].sort((a, b) => MAC_ORDER.indexOf(a) - MAC_ORDER.indexOf(b)) : p.value.mods;
  return [...mods.map((m) => (mac ? MAC_MOD[m] : WIN_MOD[m])), prettyKey(p.value.key, platform)];
}

/** Human string: "Ctrl+Shift+V" on Windows, "⌘⇧V" on macOS. Empty accelerator → ''. */
export function pretty(accel: string, platform: Platform): string {
  const parts = prettyParts(accel, platform);
  return platform === 'darwin' ? parts.join('') : parts.join('+');
}
