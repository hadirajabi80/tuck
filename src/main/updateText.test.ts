import { describe, expect, it } from 'vitest';
import { friendlyUpdateError, htmlToText, releaseNotesText } from './updateText';

describe('update text helpers', () => {
  it('turns GitHub release HTML into plain text', () => {
    expect(htmlToText('<h2>What&#39;s new</h2><ul><li>Faster search</li><li>Fix &amp; polish</li></ul>')).toBe("What's new\n\n• Faster search\n• Fix & polish");
    expect(htmlToText('<p>One<br>Two</p>')).toBe('One\nTwo');
  });

  it('normalises release notes of every shape', () => {
    expect(releaseNotesText(null)).toBeNull();
    expect(releaseNotesText('')).toBeNull();
    expect(releaseNotesText('<p>Hello</p>')).toBe('Hello');
    expect(releaseNotesText([{ version: '0.1.2', note: '<p>B</p>' }, { version: '0.1.1', note: null }])).toBe('v0.1.2\nB\n\nv0.1.1');
    expect(releaseNotesText('x'.repeat(50), 10)).toHaveLength(10);
  });

  it('maps updater errors to short messages', () => {
    expect(friendlyUpdateError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/offline/);
    expect(friendlyUpdateError(new Error('Cannot find latest.yml in the latest release artifacts (https://github.com/x/y/releases/download/v0.1.1/latest.yml): HttpError: 404\n"method: GET url: ..."'))).toMatch(/No update information/);
    expect(friendlyUpdateError(new Error('sha512 checksum mismatch, expected abc'))).toMatch(/corrupted/);
    expect(friendlyUpdateError(new Error(`first line\n${'headers '.repeat(100)}`))).toBe('first line');
    expect(friendlyUpdateError('x'.repeat(500))).toHaveLength(200);
    expect(friendlyUpdateError(undefined)).toBe('Unknown error');
  });
});
