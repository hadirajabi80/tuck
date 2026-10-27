import { describe, expect, it } from 'vitest';
import { allowRemoteDesktopCopy, isRemoteDesktopApp } from './remoteDesktop';

describe('Remote Desktop capture policy', () => {
  it('recognises Remote Desktop clients case-insensitively', () => {
    expect(isRemoteDesktopApp('mstsc.exe')).toBe(true);
    expect(isRemoteDesktopApp('MSTSC.EXE')).toBe(true);
    expect(isRemoteDesktopApp('msrdc.exe')).toBe(true);
    expect(isRemoteDesktopApp('RemtermRdp.exe')).toBe(true); // Remterm's RDP session process
    expect(isRemoteDesktopApp('Remterm.exe')).toBe(true);
    expect(isRemoteDesktopApp('SomeRemoteViewer.exe')).toBe(true); // name heuristic
    expect(isRemoteDesktopApp('wfica32.exe')).toBe(true);
    expect(isRemoteDesktopApp('chrome.exe')).toBe(false);
    expect(isRemoteDesktopApp('KeePass.exe')).toBe(false);
    expect(isRemoteDesktopApp('Bitwarden.exe')).toBe(false);
    expect(isRemoteDesktopApp('1Password.exe')).toBe(false);
    expect(isRemoteDesktopApp(null)).toBe(false);
  });

  it('saves copies Remote Desktop marks as "no history"', () => {
    expect(allowRemoteDesktopCopy('no-history', 'mstsc.exe', 'mstsc.exe', true)).toBe(true);
    expect(allowRemoteDesktopCopy('no-history', null, 'mstsc.exe', true)).toBe(true); // owner unknown, RDP in front
  });

  it('never saves content with the password-manager "exclude" marker, even over Remote Desktop', () => {
    expect(allowRemoteDesktopCopy('exclude', 'mstsc.exe', 'mstsc.exe', true)).toBe(false);
  });

  it('keeps skipping private content from other apps, and honours the setting', () => {
    expect(allowRemoteDesktopCopy('no-history', 'KeePass.exe', 'KeePass.exe', true)).toBe(false);
    expect(allowRemoteDesktopCopy('no-history', 'mstsc.exe', 'mstsc.exe', false)).toBe(false);
  });
});
