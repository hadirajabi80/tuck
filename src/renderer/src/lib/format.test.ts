import { describe, expect, it } from 'vitest';
import { appLabel, basename, dateSection, dirname, extname, formatBytes, formatCount, fullDateTime, hostname, plural, relativeTime } from './format';

// Fixed "now": Sunday 2026-10-18 15:00 local time.
const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime();
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();

describe('dateSection', () => {
  it('buckets by local calendar day', () => {
    expect(dateSection(at(2026, 10, 18, 0, 1), NOW)).toBe('today');
    expect(dateSection(at(2026, 10, 17, 23, 59), NOW)).toBe('yesterday');
    expect(dateSection(at(2026, 10, 17, 0, 0), NOW)).toBe('yesterday');
    expect(dateSection(at(2026, 10, 16), NOW)).toBe('week');
    expect(dateSection(at(2026, 10, 12, 0, 0), NOW)).toBe('week');
    expect(dateSection(at(2026, 10, 11, 23, 0), NOW)).toBe('earlier');
  });
});

describe('relativeTime', () => {
  it('uses compact units today', () => {
    expect(relativeTime(NOW - 10_000, NOW)).toBe('now');
    expect(relativeTime(NOW - 4 * 60_000, NOW)).toBe('4m');
    expect(relativeTime(NOW - 3 * 3_600_000, NOW)).toBe('3h');
  });
  it('uses Yesterday, weekday, then dates', () => {
    expect(relativeTime(at(2026, 10, 17, 9), NOW)).toBe('Yesterday');
    expect(relativeTime(at(2026, 10, 14), NOW)).toBe('Wed');
    expect(relativeTime(at(2026, 9, 2), NOW)).toBe('Sep 2');
    expect(relativeTime(at(2025, 12, 24), NOW)).toBe('Dec 24, 2025');
  });
  it('never returns 0m', () => {
    expect(relativeTime(NOW - 50_000, NOW)).toBe('1m');
  });
});

describe('fullDateTime', () => {
  it('formats the preview header times', () => {
    expect(fullDateTime(NOW - 5_000, NOW)).toBe('Just now');
    expect(fullDateTime(NOW - 12 * 60_000, NOW)).toBe('12 min ago');
    expect(fullDateTime(at(2026, 10, 18, 9, 5), NOW)).toBe('Today at 09:05');
    expect(fullDateTime(at(2026, 10, 17, 21, 30), NOW)).toBe('Yesterday at 21:30');
    expect(fullDateTime(at(2026, 3, 4, 8, 0), NOW)).toBe('Mar 4, 2026 at 08:00');
  });
});

describe('sizes and counts', () => {
  it('formatBytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(980)).toBe('980 B');
    expect(formatBytes(12 * 1024)).toBe('12 KB');
    expect(formatBytes(1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatBytes(-1)).toBe('—');
  });
  it('formatCount / plural', () => {
    expect(formatCount(1284)).toBe('1,284');
    expect(plural(1, 'clip')).toBe('1 clip');
    expect(plural(1284, 'clip')).toBe('1,284 clips');
  });
});

describe('names and paths', () => {
  it('appLabel maps executables to friendly names', () => {
    expect(appLabel('Code.exe')).toBe('VS Code');
    expect(appLabel('WINWORD.EXE')).toBe('Word');
    expect(appLabel('Safari')).toBe('Safari');
    expect(appLabel(null)).toBe('');
  });
  it('hostname strips www and tolerates garbage', () => {
    expect(hostname('https://www.figma.com/file/x')).toBe('figma.com');
    expect(hostname('not a url')).toBe('');
  });
  it('path helpers handle Windows and POSIX paths', () => {
    expect(basename('C:\\Users\\alex\\Q3 Plan.docx')).toBe('Q3 Plan.docx');
    expect(dirname('C:\\Users\\alex\\Q3 Plan.docx')).toBe('C:\\Users\\alex');
    expect(basename('/Users/alex/notes.md')).toBe('notes.md');
    expect(extname('/Users/alex/Archive.TAR')).toBe('tar');
    expect(extname('/Users/alex/src')).toBe('');
  });
});
