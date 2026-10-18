import { describe, expect, it } from 'vitest';
import { TRANSFORMS } from './types';
import { applyTransform, isTransformId, transformText } from './transforms';

describe('transforms', () => {
  it('upper / lower', () => {
    expect(applyTransform('upper', 'Hello wörld')).toBe('HELLO WÖRLD');
    expect(applyTransform('lower', 'Hello WÖRLD')).toBe('hello wörld');
  });
  it('title case keeps apostrophes and handles hyphens', () => {
    expect(applyTransform('title', "the QUICK brown fox's well-known tale")).toBe("The Quick Brown Fox's Well-Known Tale");
    expect(applyTransform('title', 'hello\nworld (again)')).toBe('Hello\nWorld (Again)');
    expect(applyTransform('title', "don't stop")).toBe("Don't Stop");
  });
  it('trim', () => {
    expect(applyTransform('trim', '  \n hi there \t\n')).toBe('hi there');
  });
  it('collapseWhitespace', () => {
    expect(applyTransform('collapseWhitespace', '  a \t b\n\n c  ')).toBe('a b c');
  });
  it('removeLineBreaks', () => {
    expect(applyTransform('removeLineBreaks', 'line one\r\nline two  \n  line three\n')).toBe('line one line two line three');
    expect(applyTransform('removeLineBreaks', 'keeps  double  spaces')).toBe('keeps  double  spaces');
  });
  it('jsonPretty / jsonMinify', () => {
    expect(applyTransform('jsonPretty', '{"a":1,"b":[1,2]}')).toBe('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
    expect(applyTransform('jsonMinify', '{\n  "a": 1,\n  "b": [1, 2]\n}\n')).toBe('{"a":1,"b":[1,2]}');
    expect(applyTransform('jsonMinify', '\u{FEFF}{"a": 1}')).toBe('{"a":1}');
  });
  it('JSON transforms on invalid input leave text unchanged and report an error', () => {
    expect(applyTransform('jsonPretty', 'not json')).toBe('not json');
    const r = transformText('jsonMinify', '{bad');
    expect(r.ok).toBe(false);
    expect(transformText('jsonPretty', '   ').ok).toBe(false);
  });
  it('stripFormatting removes zero-width chars and normalises NBSP', () => {
    expect(applyTransform('stripFormatting', 'a\u{200B}b\u{A0}c\u{FEFF}')).toBe('ab c');
  });
  it('every declared transform is implemented', () => {
    for (const t of TRANSFORMS) {
      expect(isTransformId(t.id)).toBe(true);
      expect(transformText(t.id, '{"x": "y"}').ok).toBe(true);
    }
    expect(isTransformId('nope')).toBe(false);
    expect(new Set(TRANSFORMS.map((t) => t.key)).size).toBe(TRANSFORMS.length);
  });
});
