import { describe, expect, it } from 'vitest';
import { comboLabel, comboParts, isDeleteCombo, isMod, matchCombo, quickPasteIndex, type ModKeyEvent } from './keys';
import { tokenize, tokenLines } from './highlight';

const ev = (key: string, code: string, mods: Partial<Pick<ModKeyEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {}): ModKeyEvent => ({
  key, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods,
});

describe('isMod', () => {
  it('is Ctrl on Windows and Cmd on macOS', () => {
    expect(isMod(ev('a', 'KeyA', { ctrlKey: true }), 'win32')).toBe(true);
    expect(isMod(ev('a', 'KeyA', { ctrlKey: true }), 'darwin')).toBe(false);
    expect(isMod(ev('a', 'KeyA', { metaKey: true }), 'darwin')).toBe(true);
  });
});

describe('quickPasteIndex', () => {
  it('maps Ctrl/Cmd+1..9 to 0..8 using the physical key', () => {
    expect(quickPasteIndex(ev('1', 'Digit1', { ctrlKey: true }), 'win32')).toBe(0);
    expect(quickPasteIndex(ev('&', 'Digit9', { ctrlKey: true }), 'win32')).toBe(8);
    expect(quickPasteIndex(ev('3', 'Numpad3', { metaKey: true }), 'darwin')).toBe(2);
  });
  it('ignores 0, missing modifier and extra modifiers', () => {
    expect(quickPasteIndex(ev('0', 'Digit0', { ctrlKey: true }), 'win32')).toBe(-1);
    expect(quickPasteIndex(ev('1', 'Digit1'), 'win32')).toBe(-1);
    expect(quickPasteIndex(ev('1', 'Digit1', { ctrlKey: true, shiftKey: true }), 'win32')).toBe(-1);
  });
});

describe('matchCombo', () => {
  it('matches mod combos exactly', () => {
    expect(matchCombo(ev('p', 'KeyP', { ctrlKey: true }), 'mod+p', 'win32')).toBe(true);
    expect(matchCombo(ev('P', 'KeyP', { ctrlKey: true, shiftKey: true }), 'mod+p', 'win32')).toBe(false);
    expect(matchCombo(ev('C', 'KeyC', { ctrlKey: true, shiftKey: true }), 'mod+shift+c', 'win32')).toBe(true);
    expect(matchCombo(ev('.', 'Period', { metaKey: true }), 'mod+.', 'darwin')).toBe(true);
    expect(matchCombo(ev(' ', 'Space', { ctrlKey: true }), 'mod+space', 'win32')).toBe(true);
  });
  it('falls back to the physical key for non-US layouts', () => {
    expect(matchCombo(ev('п', 'KeyG', { ctrlKey: true }), 'mod+g', 'win32')).toBe(true);
  });
});

describe('isDeleteCombo', () => {
  it('Delete on Windows only when the input has nothing to delete forward', () => {
    expect(isDeleteCombo(ev('Delete', 'Delete'), 'win32', true)).toBe(true);
    expect(isDeleteCombo(ev('Delete', 'Delete'), 'win32', false)).toBe(false);
  });
  it('Cmd+Backspace on macOS', () => {
    expect(isDeleteCombo(ev('Backspace', 'Backspace', { metaKey: true }), 'darwin', false)).toBe(true);
    expect(isDeleteCombo(ev('Backspace', 'Backspace'), 'darwin', true)).toBe(false);
  });
});

describe('comboParts / comboLabel', () => {
  it('renders platform symbols', () => {
    expect(comboParts('mod+shift+c', 'darwin')).toEqual(['⌘', '⇧', 'C']);
    expect(comboParts('mod+shift+c', 'win32')).toEqual(['Ctrl', 'Shift', 'C']);
    expect(comboLabel('mod+enter', 'win32')).toBe('Ctrl+↵');
    expect(comboLabel('mod+,', 'darwin')).toBe('⌘,');
  });
});

describe('highlight', () => {
  it('tokenizes JSON keys, strings and numbers', () => {
    const toks = tokenize('{ "a": "b", "n": 12 }', 'json').filter((t) => t.t !== 'plain' && t.t !== 'punct');
    expect(toks).toEqual([
      { t: 'key', v: '"a"' }, { t: 'string', v: '"b"' }, { t: 'key', v: '"n"' }, { t: 'number', v: '12' },
    ]);
  });
  it('recognises keywords case-insensitively in SQL and comments', () => {
    const toks = tokenize('select 1 -- hi', 'sql');
    expect(toks[0]).toEqual({ t: 'keyword', v: 'select' });
    expect(toks[toks.length - 1]).toEqual({ t: 'comment', v: '-- hi' });
  });
  it('splits multi-line tokens into lines', () => {
    const lines = tokenLines(tokenize('/* a\nb */\nx', 'ts'));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual([{ t: 'comment', v: '/* a' }]);
    expect(lines[2]).toEqual([{ t: 'plain', v: 'x' }]);
  });
});
