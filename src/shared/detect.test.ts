import { describe, expect, it } from 'vitest';
import {
  analyzeCode, analyzeText, detectKind, detectLink, filesPreview, guessLanguage, imagePreview, makePreview,
  parseColor, subsequenceScore, textStats,
} from './detect';

describe('detectLink', () => {
  it('accepts single URLs and normalises them', () => {
    expect(detectLink('https://example.com')).toBe('https://example.com/');
    expect(detectLink('  http://example.com/a?b=1#c  ')).toBe('http://example.com/a?b=1#c');
    expect(detectLink('www.example.com/path')).toBe('https://www.example.com/path');
    expect(detectLink('http://localhost:5173/x')).toBe('http://localhost:5173/x');
    expect(detectLink('mailto:someone@example.com')).toBe('mailto:someone@example.com');
    expect(detectLink('file:///C:/Users/a.txt')).toBe('file:///C:/Users/a.txt');
  });
  it('rejects prose, multiple tokens and bare words', () => {
    expect(detectLink('see https://example.com')).toBeNull();
    expect(detectLink('example.com')).toBeNull();
    expect(detectLink('readme.md')).toBeNull();
    expect(detectLink('https://')).toBeNull();
    expect(detectLink('http://nodot')).toBeNull();
    expect(detectLink('')).toBeNull();
  });
});

describe('parseColor', () => {
  it('parses hex forms', () => {
    expect(parseColor('#fff')).toBe('#FFFFFF');
    expect(parseColor('#5b5bd6')).toBe('#5B5BD6');
    expect(parseColor('#5b5bd680')).toBe('#5B5BD680');
    expect(parseColor('#5b5bd6ff')).toBe('#5B5BD6');
    expect(parseColor('#f008')).toBe('#FF000088');
    expect(parseColor(' #abc; ')).toBe('#AABBCC');
  });
  it('parses rgb()/rgba()', () => {
    expect(parseColor('rgb(91, 91, 214)')).toBe('#5B5BD6');
    expect(parseColor('rgba(0,0,0,0.5)')).toBe('#00000080');
    expect(parseColor('rgb(255 0 0 / 50%)')).toBe('#FF000080');
    expect(parseColor('rgb(100%, 0%, 0%)')).toBe('#FF0000');
  });
  it('parses hsl()/hsla()', () => {
    expect(parseColor('hsl(0, 100%, 50%)')).toBe('#FF0000');
    expect(parseColor('hsl(120deg 100% 25%)')).toBe('#008000');
    expect(parseColor('hsla(240, 100%, 50%, 0.5)')).toBe('#0000FF80');
  });
  it('rejects non-colours', () => {
    expect(parseColor('red')).toBeNull();
    expect(parseColor('#ggg')).toBeNull();
    expect(parseColor('#12345')).toBeNull();
    expect(parseColor('deadbeef')).toBeNull();
    expect(parseColor('rgb(300, 0, 0)')).toBeNull();
    expect(parseColor('rgb(1,2)')).toBeNull();
    expect(parseColor('hsl(0, 100, 50)')).toBeNull();
    expect(parseColor('color: #fff')).toBeNull();
  });
});

describe('code detection', () => {
  const cases: Array<[string, string]> = [
    ['{"name": "tuck", "version": 1}', 'json'],
    ['[{"a": 1}, {"a": 2}]', 'json'],
    ['const x = require("fs");\nconsole.log(x);', 'js'],
    ['export function add(a: number, b: number): number {\n  return a + b;\n}', 'ts'],
    ['interface Foo {\n  bar: string;\n}', 'ts'],
    ['def hello(name):\n    print(f"hi {name}")\n', 'py'],
    ['import os\nfrom pathlib import Path\n\nfor p in Path(".").iterdir():\n    print(p)', 'py'],
    ['<!DOCTYPE html>\n<html><body><p>Hi</p></body></html>', 'html'],
    ['<?xml version="1.0"?>\n<root><a/></root>', 'xml'],
    ['.btn {\n  color: red;\n  padding: 4px;\n}', 'css'],
    ['SELECT id, name FROM users WHERE id = 1 ORDER BY name;', 'sql'],
    ['#!/bin/bash\necho "hi"', 'sh'],
    ['git commit -m "fix" && git push origin main', 'sh'],
    ['Get-ChildItem -Recurse | Where-Object { $_.Length -gt 1MB }', 'ps1'],
    ['#include <stdio.h>\nint main(void) {\n  printf("hi");\n  return 0;\n}', 'c'],
    ['#include <iostream>\nint main() { std::cout << "hi"; }', 'cpp'],
    ['using System;\nnamespace Demo {\n  class P { static void Main() { Console.WriteLine("x"); } }\n}', 'cs'],
    ['public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}', 'java'],
    ['package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("hi")\n}', 'go'],
    ['fn main() {\n    let mut v = vec![1, 2];\n    println!("{:?}", v);\n}', 'rust'],
    ['<?php\necho $name;', 'php'],
    ['server:\n  port: 8080\n  host: localhost\nlogging:\n  level: debug', 'yaml'],
  ];
  for (const [src, lang] of cases) {
    it(`detects ${lang}: ${src.slice(0, 30).replace(/\n/g, '⏎')}`, () => {
      expect(analyzeCode(src)).toEqual({ code: true, language: lang });
      expect(detectKind(src)).toBe('code');
    });
  }
  it('does not flag prose as code', () => {
    const prose = [
      'Let me know if you want to grab lunch tomorrow.',
      'Hello world',
      'The function of the committee is to review proposals (see appendix).',
      'Note: the meeting moved to 3pm.\nAgenda: budget, hiring.\nLocation: room 4.',
      'Dear team,\n\nThanks for all the hard work this quarter. We shipped a lot!\n\nBest,\nSam',
      'git is a version control system',
      '1. Buy milk\n2. Call mom\n3. Finish report',
      '[1]',
      'for the record, I disagree',
    ];
    for (const p of prose) {
      expect({ p, ...analyzeCode(p) }).toEqual({ p, code: false, language: '' });
      expect(detectKind(p)).toBe('text');
    }
  });
  it('guessLanguage returns empty for non-code', () => {
    expect(guessLanguage('just words')).toBe('');
  });
});

describe('detectKind / analyzeText', () => {
  it('assigns kinds', () => {
    expect(detectKind('#5B5BD6')).toBe('color');
    expect(detectKind('https://tuck.app')).toBe('link');
    expect(detectKind('plain old text')).toBe('text');
  });
  it('fills meta', () => {
    expect(analyzeText('https://tuck.app/x').meta).toMatchObject({ url: 'https://tuck.app/x', lineCount: 1, wordCount: 1 });
    expect(analyzeText('rgb(0,0,0)').meta.colorHex).toBe('#000000');
    expect(analyzeText('{"a": [1, 2]}').meta.language).toBe('json');
    const t = analyzeText('two words\nand more');
    expect(t).toEqual({ kind: 'text', meta: { lineCount: 2, wordCount: 4, charCount: 18 } });
  });
});

describe('textStats', () => {
  it('counts lines, words and code points', () => {
    expect(textStats('')).toEqual({ lineCount: 0, wordCount: 0, charCount: 0 });
    expect(textStats('a\nb\n')).toEqual({ lineCount: 2, wordCount: 2, charCount: 4 });
    expect(textStats('a\r\nb\rc')).toEqual({ lineCount: 3, wordCount: 3, charCount: 6 });
    expect(textStats('😀 ok')).toEqual({ lineCount: 1, wordCount: 2, charCount: 4 });
  });
});

describe('previews', () => {
  it('collapses whitespace to one line', () => {
    expect(makePreview('  hello\n\n  world\t!  ')).toBe('hello world !');
  });
  it('truncates to max code points with an ellipsis', () => {
    const p = makePreview('x'.repeat(500));
    expect([...p].length).toBe(200);
    expect(p.endsWith('…')).toBe(true);
    expect(makePreview('abcdef', 4)).toBe('abc…');
    expect(makePreview('abcd', 4)).toBe('abcd');
    expect(makePreview('ab cd ef', 4)).toBe('ab…');
  });
  it('never splits surrogate pairs', () => {
    const p = makePreview('😀'.repeat(300), 10);
    expect([...p]).toHaveLength(10);
    expect(p).toBe(`${'😀'.repeat(9)}…`);
  });
  it('image and files previews', () => {
    expect(imagePreview(1280, 720)).toBe('Image 1280×720');
    expect(filesPreview(['C:\\a\\b.txt', 'C:\\c.txt'])).toBe('C:\\a\\b.txt');
    expect(filesPreview([])).toBe('');
  });
});

describe('subsequenceScore', () => {
  it('returns 0 for non-matches and empty query', () => {
    expect(subsequenceScore('xyz', 'hello world')).toBe(0);
    expect(subsequenceScore('', 'hello')).toBe(0);
    expect(subsequenceScore('hello', '')).toBe(0);
    expect(subsequenceScore('toolong', 'tool')).toBe(0);
  });
  it('matches case-insensitive subsequences', () => {
    expect(subsequenceScore('hw', 'Hello World')).toBeGreaterThan(0);
    expect(subsequenceScore('HELLO', 'hello')).toBeGreaterThan(0);
  });
  it('ranks contiguous and word-start matches higher', () => {
    const contiguous = subsequenceScore('clip', 'clipboard manager');
    const scattered = subsequenceScore('clip', 'calm lip');
    expect(contiguous).toBeGreaterThan(scattered);
    const wordStarts = subsequenceScore('gfw', 'GetForegroundWindow');
    const middle = subsequenceScore('gfw', 'bigfoot walks');
    expect(wordStarts).toBeGreaterThan(middle);
    expect(subsequenceScore('abc', 'abc')).toBeGreaterThan(subsequenceScore('abc', 'xxxxxxxxxxxxabc'));
  });
});
