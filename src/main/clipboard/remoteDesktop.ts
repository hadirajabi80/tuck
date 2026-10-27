// Remote Desktop clients mark everything they bring over from a remote session with
// CanIncludeInClipboardHistory = 0 (Windows' own clipboard history skips it). Tuck still saves those copies
// when privacy.captureRemoteDesktop is on — but never content with the stronger "exclude" markers that
// password managers set, which Remote Desktop forwards from the remote machine as well.
import type { ConcealedReason } from './concealed';

/** Exe names (lower-case) of Remote Desktop / remote-session clients that own redirected clipboard data. */
export const REMOTE_DESKTOP_APPS: ReadonlySet<string> = new Set([
  'mstsc.exe', // Remote Desktop Connection
  'msrdc.exe', // Remote Desktop client / Windows App (AVD, Windows 365)
  'msrdcw.exe',
  'windows365.exe',
  'rdcman.exe', // Remote Desktop Connection Manager
  'mremoteng.exe',
  'remotedesktopmanager.exe', // Devolutions
  'remotedesktopmanager64.exe',
  'vmconnect.exe', // Hyper-V enhanced session
]);

export function isRemoteDesktopApp(exe: string | null | undefined): boolean {
  return !!exe && REMOTE_DESKTOP_APPS.has(exe.toLowerCase());
}

/** True when private-marked content should be captured anyway because it came over Remote Desktop. */
export function allowRemoteDesktopCopy(
  reason: ConcealedReason,
  owner: string | null,
  foreground: string | null,
  enabled: boolean,
): boolean {
  if (!enabled || reason !== 'no-history') return false;
  return isRemoteDesktopApp(owner) || isRemoteDesktopApp(foreground);
}
