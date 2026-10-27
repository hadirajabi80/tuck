// Remote Desktop clients mark everything they bring over from a remote session with
// CanIncludeInClipboardHistory = 0 (Windows' own clipboard history skips it). Tuck still saves those copies
// when privacy.captureRemoteDesktop is on — but never content with the stronger "exclude" markers that
// password managers set, which Remote Desktop forwards from the remote machine as well.
import type { ConcealedReason } from './concealed';

/** Exe names (lower-case) of known remote-session clients that own redirected clipboard data. */
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
  'remterm.exe', // Remterm (RDP sessions run in RemtermRdp.exe, matched below)
  'remtermrdp.exe',
  'wfica32.exe', // Citrix Workspace
  'cdviewer.exe',
  'vmware-view.exe', // VMware Horizon
  'anydesk.exe',
  'teamviewer.exe',
  'rustdesk.exe',
  'parsecd.exe',
  'royalts.exe', // Royal TS
  'termius.exe',
  'wfreerdp.exe', // FreeRDP
]);

/**
 * Third-party tools usually embed the Remote Desktop control in their own exe (e.g. RemtermRdp.exe), so
 * besides the list, any exe whose name says "rdp" or "remote" counts. Password managers never match this.
 */
const REMOTE_NAME = /rdp|remote|mstsc|vnc/i;

export function isRemoteDesktopApp(exe: string | null | undefined): boolean {
  if (!exe) return false;
  return REMOTE_DESKTOP_APPS.has(exe.toLowerCase()) || REMOTE_NAME.test(exe);
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
