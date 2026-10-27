// Polling clipboard watcher: native change counter → 60 ms debounce → own-change / pause / concealed /
// ignored-app / ignore-pattern checks → reader → onCapture. Errors are logged; the loop never stops.
import type { CaptureState, Settings } from '../../shared/types';
import { logger } from '../log';
import { changeCounterMode, currentChangeCount } from './changeCounter';
import { concealedReason } from './concealed';
import { allowRemoteDesktopCopy } from './remoteDesktop';
import { readClipboard, type ReadResult } from './reader';
import { snapshot } from './systemClipboard';
import { clipboardOwnerApp, currentSourceApp } from './sourceApp';

const log = logger('watcher');
const DEBOUNCE_MS = 60;
const OWN_CHANGE_MAX_MS = 1500;
const OWN_CHANGE_TAIL_MS = 150;

export interface WatcherDeps {
  settings: () => Settings;
  onCapture: (r: ReadResult) => void | Promise<void>;
  onStateChange?: (s: CaptureState) => void;
}

export class ClipboardWatcher {
  private timer: NodeJS.Timeout | null = null;
  private debounce: NodeJS.Timeout | null = null;
  private last = 0;
  private processing = false;
  private pendingWhileProcessing = false;
  private ownUntil = 0;
  private ownDepth = 0;
  private state: CaptureState = { paused: false, pausedAt: null };
  private intervalMs = 200;
  captured = 0;

  private polling = false;

  constructor(private readonly deps: WatcherDeps) {}

  async start(): Promise<void> {
    this.stop();
    this.intervalMs = this.deps.settings().history.pollIntervalMs;
    try {
      this.last = await currentChangeCount();
    } catch (err) {
      log.warn('initial change count failed', err);
    }
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
    log.info(`running (poll ${this.intervalMs} ms, counter ${changeCounterMode()})`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.debounce) clearTimeout(this.debounce);
    this.timer = null;
    this.debounce = null;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  setPollInterval(ms: number): void {
    if (ms === this.intervalMs || !this.timer) return;
    this.intervalMs = ms;
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.poll(), ms);
    log.info(`poll interval ${ms} ms`);
  }

  getState(): CaptureState {
    return { ...this.state };
  }

  setPaused(paused: boolean): CaptureState {
    if (paused !== this.state.paused) {
      this.state = { paused, pausedAt: paused ? Date.now() : null };
      log.info(paused ? 'capture paused' : 'capture resumed');
      this.deps.onStateChange?.(this.getState());
    }
    return this.getState();
  }

  /** Called by the writer before it touches the clipboard. */
  beginOwnChange(): void {
    this.ownDepth++;
    this.ownUntil = Date.now() + OWN_CHANGE_MAX_MS;
  }

  /** Called after the write: adopt the new counter value and absorb late bumps for a moment. */
  async endOwnChange(): Promise<void> {
    try {
      this.last = await currentChangeCount();
    } catch {
      /* ignore */
    }
    this.ownDepth = Math.max(0, this.ownDepth - 1);
    if (this.ownDepth === 0) this.ownUntil = Date.now() + OWN_CHANGE_TAIL_MS;
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    let count: number;
    try {
      count = await currentChangeCount();
    } catch (err) {
      log.warn('change count failed', err);
      return;
    } finally {
      this.polling = false;
    }
    if (count === this.last) return;
    this.last = count;
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => {
      this.debounce = null;
      void this.process();
    }, DEBOUNCE_MS);
  }

  private async process(): Promise<void> {
    if (this.processing) {
      this.pendingWhileProcessing = true;
      return;
    }
    this.processing = true;
    try {
      await this.handleChange();
    } catch (err) {
      log.error('capture failed', err);
    } finally {
      this.processing = false;
      if (this.pendingWhileProcessing) {
        this.pendingWhileProcessing = false;
        void this.process();
      }
    }
  }

  private async handleChange(): Promise<void> {
    if (this.ownDepth > 0 || Date.now() < this.ownUntil) {
      log.debug('own change skipped');
      return;
    }
    if (this.state.paused) return;
    const s = this.deps.settings();
    const snap = await snapshot();
    if (s.privacy.skipConcealed) {
      const reason = await concealedReason(snap);
      if (reason) {
        const owner = clipboardOwnerApp();
        const front = await currentSourceApp();
        if (!allowRemoteDesktopCopy(reason, owner, front, s.privacy.captureRemoteDesktop)) {
          log.info(`private content skipped (${reason}; owner ${owner ?? '?'}, app ${front ?? '?'})`);
          return;
        }
        log.info(`Remote Desktop copy saved despite its no-history marker (owner ${owner ?? '?'})`);
      }
    }
    const app = await currentSourceApp();
    if (app && s.privacy.ignoredApps.some((a) => a.toLowerCase() === app.toLowerCase())) {
      log.info(`ignored app ${app}`);
      return;
    }
    const read = await readClipboard(s, app, snap);
    if (!read) {
      // Make "my copy didn't show up" diagnosable: which app put what on the clipboard.
      log.info(`clipboard changed but nothing readable (owner ${clipboardOwnerApp() ?? '?'}, app ${app ?? '?'}, types ${snap.types.join(', ') || 'none'})`);
      return;
    }
    if (read.input.text !== null && read.input.kind !== 'files' && s.privacy.ignorePatterns.length) {
      for (const src of s.privacy.ignorePatterns) {
        try {
          if (new RegExp(src).test(read.input.text)) {
            log.info('text matched an ignore pattern');
            return;
          }
        } catch {
          /* invalid pattern — the settings UI flags it */
        }
      }
    }
    await this.deps.onCapture(read);
    this.captured++;
  }
}

let instance: ClipboardWatcher | null = null;

export function initWatcher(deps: WatcherDeps): ClipboardWatcher {
  instance = new ClipboardWatcher(deps);
  return instance;
}

export function watcher(): ClipboardWatcher {
  if (!instance) throw new Error('watcher not initialised');
  return instance;
}
