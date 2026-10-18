import { describe, expect, it } from 'vitest';
import { fromKeyboardEvent, normalize, pretty, prettyParts, validate } from './accelerator';

const ev = (code: string, mods: Partial<{ ctrl: boolean; shift: boolean; alt: boolean; meta: boolean }> = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt,
  metaKey: !!mods.meta,
});

describe('fromKeyboardEvent', () => {
  it('builds accelerators in canonical modifier order', () => {
    expect(fromKeyboardEvent(ev('KeyV', { ctrl: true, shift: true }), 'win32')).toBe('Control+Shift+V');
    expect(fromKeyboardEvent(ev('KeyV', { meta: true, shift: true }), 'darwin')).toBe('Shift+Command+V');
    expect(fromKeyboardEvent(ev('KeyV', { meta: true, alt: true, ctrl: true, shift: true }), 'win32')).toBe('Control+Alt+Shift+Super+V');
  });
  it('maps punctuation and named keys from KeyboardEvent.code', () => {
    expect(fromKeyboardEvent(ev('Backquote', { ctrl: true }), 'win32')).toBe('Control+`');
    expect(fromKeyboardEvent(ev('Space', { ctrl: true, shift: true }), 'win32')).toBe('Control+Shift+Space');
    expect(fromKeyboardEvent(ev('Enter', { alt: true }), 'win32')).toBe('Alt+Return');
    expect(fromKeyboardEvent(ev('ArrowUp', { ctrl: true }), 'win32')).toBe('Control+Up');
    expect(fromKeyboardEvent(ev('Digit1', { ctrl: true }), 'win32')).toBe('Control+1');
    expect(fromKeyboardEvent(ev('Numpad5', { ctrl: true }), 'win32')).toBe('Control+num5');
    expect(fromKeyboardEvent(ev('F12'), 'win32')).toBe('F12');
    for (const [code, key] of [['Minus', '-'], ['Equal', '='], ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\'], ['Semicolon', ';'], ['Quote', "'"], ['Comma', ','], ['Period', '.'], ['Slash', '/']]) {
      expect(fromKeyboardEvent(ev(code!, { ctrl: true }), 'win32')).toBe(`Control+${key}`);
    }
  });
  it('returns null for modifier-only and unknown keys', () => {
    expect(fromKeyboardEvent(ev('ShiftLeft', { shift: true }), 'win32')).toBeNull();
    expect(fromKeyboardEvent(ev('MetaLeft', { meta: true }), 'darwin')).toBeNull();
    expect(fromKeyboardEvent(ev('ControlRight', { ctrl: true }), 'win32')).toBeNull();
    expect(fromKeyboardEvent(ev('IntlRo', { ctrl: true }), 'win32')).toBeNull();
  });
});

describe('validate', () => {
  it('accepts normal shortcuts and unbound', () => {
    expect(validate('Control+`', 'win32')).toEqual({ ok: true });
    expect(validate('Command+Shift+V', 'darwin')).toEqual({ ok: true });
    expect(validate('CommandOrControl+Shift+Space', 'win32')).toEqual({ ok: true });
    expect(validate('F9', 'win32')).toEqual({ ok: true });
    expect(validate('Shift+F24', 'darwin')).toEqual({ ok: true });
    expect(validate('', 'win32')).toEqual({ ok: true });
  });
  it('rejects missing modifiers, Shift-only, unknown keys and malformed input', () => {
    expect(validate('V', 'win32').ok).toBe(false);
    expect(validate('Shift+V', 'win32').ok).toBe(false);
    expect(validate('Control+Shift', 'win32').ok).toBe(false);
    expect(validate('Control+Foo', 'win32').ok).toBe(false);
    expect(validate('Control++V', 'win32').ok).toBe(false);
    expect(validate('Control+Control+V', 'win32').ok).toBe(false);
    expect(validate('Control+A+B', 'win32').ok).toBe(false);
    expect(validate('Command+V', 'win32').ok).toBe(false);
    expect(validate('F25', 'win32').ok).toBe(false);
  });
  it('gives a reason', () => {
    const r = validate('V', 'win32');
    expect(r.ok === false && r.reason.length > 0).toBe(true);
  });
  it('round-trips everything fromKeyboardEvent produces', () => {
    const codes = ['KeyA', 'Digit0', 'F5', 'Space', 'Backquote', 'Slash', 'ArrowLeft', 'PageDown', 'Numpad3', 'NumpadAdd'];
    for (const code of codes) {
      const a = fromKeyboardEvent(ev(code, { ctrl: true, alt: true }), 'win32')!;
      expect(validate(a, 'win32')).toEqual({ ok: true });
      expect(normalize(a, 'win32')).toBe(a);
    }
  });
});

describe('normalize', () => {
  it('canonicalises spelling and order', () => {
    expect(normalize('shift+ctrl+v', 'win32')).toBe('Control+Shift+V');
    expect(normalize('CmdOrCtrl+Shift+V', 'darwin')).toBe('Shift+Command+V');
    expect(normalize('Control++', 'win32')).toBe('Control+Plus');
    expect(normalize('Ctrl+Esc', 'win32')).toBe('Control+Escape');
    expect(normalize('nonsense+', 'win32')).toBeNull();
  });
});

describe('pretty / prettyParts', () => {
  it('formats for Windows', () => {
    expect(pretty('Control+Shift+V', 'win32')).toBe('Ctrl+Shift+V');
    expect(pretty('Control+`', 'win32')).toBe('Ctrl+`');
    expect(pretty('Super+Alt+Return', 'win32')).toBe('Alt+Win+Enter');
    expect(prettyParts('Control+Shift+Space', 'win32')).toEqual(['Ctrl', 'Shift', 'Space']);
  });
  it('formats for macOS with symbols in ⌃⌥⇧⌘ order', () => {
    expect(pretty('Command+Shift+V', 'darwin')).toBe('⇧⌘V');
    expect(prettyParts('Command+Shift+V', 'darwin')).toEqual(['⇧', '⌘', 'V']);
    expect(prettyParts('Control+Command+V', 'darwin')).toEqual(['⌃', '⌘', 'V']);
    expect(pretty('Alt+Return', 'darwin')).toBe('⌥↩');
    expect(pretty('CommandOrControl+Backspace', 'darwin')).toBe('⌘⌫');
  });
  it('handles empty and invalid input', () => {
    expect(pretty('', 'win32')).toBe('');
    expect(prettyParts('', 'darwin')).toEqual([]);
    expect(prettyParts('Bogus+Key', 'win32')).toEqual(['Bogus+Key']);
  });
});
