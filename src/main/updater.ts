// Auto-update: electron-updater against GitHub Releases (electron-builder `publish: github`, latest.yml).
//
// Only active in a packaged build (app.isPackaged); development builds report status 'unsupported'.
// On boot: first check after ~10 s, then every 6 h, while settings.updates.autoCheck is on. A found update is
// downloaded in the background when settings.updates.autoDownload is on; once downloaded we show a native
// notification + a tray item, and it installs either on "Restart to update" (silent install, relaunch) or the
// next time Tuck quits (autoInstallOnAppQuit).
//
// macOS: Squirrel.Mac only accepts signed apps (and a zip target); unsigned builds end in the 'error' state,
// which the About card shows.
//
// QA hook: TUCK_UPDATE_FEED_URL=<url> (packaged builds) reads latest.yml from a generic HTTP server instead of
// GitHub — e.g. `npx http-server dist` with a hand-edited latest.yml carrying a higher version.
import { app, Notification, shell } from 'electron';
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater';
import type { Settings, UpdateRelease, UpdateState } from '../shared/types';
import { logger } from './log';
import { friendlyUpdateError, releaseNotesText } from './updateText';

const log = logger('updater');

const FIRST_CHECK_DELAY_MS = 10_000;
const RELEASES_URL = 'https://github.com/hadirajabi80/tuck/releases/latest';
/**
 * macOS builds are not signed with an Apple Developer ID, and Squirrel.Mac refuses to install an update
 * whose signature it can't validate. On macOS we therefore only check and notify; "Download" opens the
 * GitHub release page and the user installs the new DMG themselves.
 */
const MANUAL_INSTALL = process.platform === 'darwin';
const wantAutoDownload = (s: Settings): boolean => !MANUAL_INSTALL && s.updates.autoDownload;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type Phase = DistributiveOmit<UpdateState, 'currentVersion' | 'lastCheckedAt'>;

export interface UpdaterDeps {
  settings: () => Settings;
  /** Called on every state change (broadcast to renderers, refresh tray). */
  onChange: (state: UpdateState) => void;
  /** Called right before quitAndInstall so close-prevention logic lets every window close. */
  beforeInstall: () => void;
}

let deps: UpdaterDeps | null = null;
let active = false;
let state: UpdateState = { status: 'idle', currentVersion: '', lastCheckedAt: null };
let pending: UpdateRelease | null = null;
let firstTimer: NodeJS.Timeout | null = null;
let intervalTimer: NodeJS.Timeout | null = null;
let readyNotification: Notification | null = null; // keep a reference: GC'd notifications lose their click handler
let installing = false;

function setState(phase: Phase, lastCheckedAt: number | null = state.lastCheckedAt): void {
  state = { ...phase, currentVersion: state.currentVersion, lastCheckedAt } as UpdateState;
  try {
    deps?.onChange(getUpdateState());
  } catch (err) {
    log.warn('onChange failed', err);
  }
}

function toRelease(info: UpdateInfo): UpdateRelease {
  return {
    version: info.version,
    releaseNotes: releaseNotesText(info.releaseNotes),
    releaseDate: info.releaseDate || null,
  };
}

export function getUpdateState(): UpdateState {
  return structuredClone(state);
}

/** Version of a downloaded update waiting to be installed, else null (tray item). */
export function readyUpdateVersion(): string | null {
  return state.status === 'downloaded' ? state.version : null;
}

export function updatesSupported(): boolean {
  return active;
}

export function initUpdater(d: UpdaterDeps): void {
  deps = d;
  state = { status: 'idle', currentVersion: app.getVersion(), lastCheckedAt: null };
  if (!app.isPackaged) {
    state = { ...state, status: 'unsupported', message: 'Updates are checked in the installed app — this is a development build.' };
    log.info('inactive (development build)');
    return;
  }
  active = true;

  autoUpdater.logger = {
    info: (m?: unknown) => log.info(String(m)),
    warn: (m?: unknown) => log.warn(String(m)),
    error: (m?: unknown) => log.error(String(m)),
    debug: (m: string) => log.debug(m),
  };
  autoUpdater.autoDownload = wantAutoDownload(d.settings());
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;

  const feed = process.env['TUCK_UPDATE_FEED_URL'];
  if (feed) {
    log.warn(`TUCK_UPDATE_FEED_URL: reading updates from ${feed}`);
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  }

  autoUpdater.on('checking-for-update', () => setState({ status: 'checking' }));
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    pending = toRelease(info);
    log.info(`update ${info.version} available (current ${state.currentVersion})`);
    if (autoUpdater.autoDownload) {
      const total = info.files?.[0]?.size ?? 0;
      setState({ status: 'downloading', version: info.version, percent: 0, bytesPerSecond: 0, transferred: 0, total }, Date.now());
    } else {
      setState({ status: 'available', ...pending }, Date.now());
      if (MANUAL_INSTALL) notifyAvailable(info.version);
    }
  });
  autoUpdater.on('update-not-available', () => setState({ status: 'not-available' }, Date.now()));
  autoUpdater.on('download-progress', (p: ProgressInfo) => {
    setState({
      status: 'downloading',
      version: pending?.version ?? '',
      percent: Math.max(0, Math.min(100, p.percent || 0)),
      bytesPerSecond: p.bytesPerSecond || 0,
      transferred: p.transferred || 0,
      total: p.total || 0,
    });
  });
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    const release = { ...(pending ?? {}), ...toRelease(info) };
    pending = release;
    log.info(`update ${info.version} downloaded — installs on restart/quit`);
    setState({ status: 'downloaded', ...release });
    stopTimers(); // nothing more to look for until the user restarts
    notifyReady(release.version);
  });
  autoUpdater.on('error', (err: unknown) => {
    log.warn('update error:', err instanceof Error ? err.message.split('\n')[0] : err);
    installing = false;
    if (state.status === 'downloaded') return; // keep offering the downloaded update (e.g. installer failed to start)
    setState({ status: 'error', message: friendlyUpdateError(err) });
  });

  applyUpdateSettings(d.settings());
  log.info(`active (current ${state.currentVersion}, autoCheck=${d.settings().updates.autoCheck}, autoDownload=${autoUpdater.autoDownload})`);
}

function stopTimers(): void {
  if (firstTimer) clearTimeout(firstTimer);
  if (intervalTimer) clearInterval(intervalTimer);
  firstTimer = null;
  intervalTimer = null;
}

/** Re-applies settings.updates (call on settings change). */
export function applyUpdateSettings(s: Settings): void {
  if (!active) return;
  autoUpdater.autoDownload = wantAutoDownload(s);
  const wantTimers = s.updates.autoCheck && state.status !== 'downloaded';
  if (!wantTimers) {
    stopTimers();
    return;
  }
  if (firstTimer || intervalTimer) return; // already scheduled
  firstTimer = setTimeout(() => {
    firstTimer = null;
    void checkForUpdates();
  }, FIRST_CHECK_DELAY_MS);
  intervalTimer = setInterval(() => void checkForUpdates(), CHECK_INTERVAL_MS);
}

/** Starts a check; resolves with the state right after starting it (progress arrives via onChange). */
export async function checkForUpdates(): Promise<UpdateState> {
  if (!active || !deps) return getUpdateState();
  if (state.status === 'checking' || state.status === 'downloading' || state.status === 'downloaded') return getUpdateState();
  autoUpdater.autoDownload = wantAutoDownload(deps.settings());
  setState({ status: 'checking' });
  autoUpdater
    .checkForUpdates()
    .then((res) => {
      // Download failures are reported through the 'error' event; don't leak an unhandled rejection.
      res?.downloadPromise?.catch(() => {});
    })
    .catch(() => {
      /* reported through the 'error' event */
    });
  return getUpdateState();
}

/** Downloads an 'available' update (autoDownload off). */
export async function downloadUpdate(): Promise<UpdateState> {
  if (!active) return getUpdateState();
  if (state.status !== 'available') return getUpdateState();
  if (MANUAL_INSTALL) {
    void shell.openExternal(RELEASES_URL);
    return getUpdateState();
  }
  const { version } = state;
  setState({ status: 'downloading', version, percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 });
  autoUpdater.downloadUpdate().catch(() => {
    /* reported through the 'error' event */
  });
  return getUpdateState();
}

/** Quits, runs the NSIS installer silently and relaunches Tuck. */
export function installUpdate(): void {
  if (!active || state.status !== 'downloaded' || installing) return;
  installing = true;
  log.info(`installing ${state.version} now`);
  try {
    deps?.beforeInstall();
  } catch (err) {
    log.warn('beforeInstall failed', err);
  }
  // setImmediate: let the IPC reply / menu click finish before the app starts tearing down.
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(true, true);
    } catch (err) {
      installing = false;
      log.error('quitAndInstall failed', err);
      setState({ status: 'error', message: friendlyUpdateError(err) });
    }
  });
}

/** macOS: tell the user a new version exists; clicking opens the release page to download it. */
function notifyAvailable(version: string): void {
  if (!Notification.isSupported()) return;
  try {
    const n = new Notification({ title: `Tuck ${version} is available`, body: 'Click to download it from GitHub.' });
    n.on('click', () => void shell.openExternal(RELEASES_URL));
    n.show();
  } catch (err) {
    log.warn('notification failed', err);
  }
}

function notifyReady(version: string): void {
  if (!Notification.isSupported()) return;
  try {
    readyNotification?.close();
    readyNotification = new Notification({
      title: `Tuck ${version} is ready — restart to update`,
      body: 'Click to restart now. Otherwise it installs the next time Tuck quits.',
    });
    readyNotification.on('click', () => installUpdate());
    readyNotification.show();
  } catch (err) {
    log.warn('notification failed', err);
  }
}

export function stopUpdater(): void {
  stopTimers();
  readyNotification = null;
}
