// Retention: unpinned clips beyond history.maxItems (by updated_at) or older than history.expireDays are removed
// together with their image files. Runs after inserts (throttled) and hourly.
import { emit } from '../ipc/typed';
import { r } from '../context';
import { imageStore } from '../images/imageStore';
import { logger } from '../log';
import { settings } from '../settings/settingsStore';

const log = logger('retention');
const HOUR = 3_600_000;
const AFTER_INSERT_THROTTLE_MS = 2000;

let timer: NodeJS.Timeout | null = null;
let lastRun = 0;
let pending: NodeJS.Timeout | null = null;

export function enforceRetention(): number {
  lastRun = Date.now();
  try {
    const { maxItems, expireDays } = settings().get().history;
    const ids = r().clips.retentionCandidates(maxItems, expireDays);
    if (!ids.length) return 0;
    const imageIds = r().clips.deleteHard(ids);
    for (const id of imageIds) imageStore().delete(id);
    log.info(`removed ${ids.length} clips (maxItems=${maxItems}, expireDays=${expireDays})`);
    emit('clips:changed', { reason: 'deleted', ids });
    return ids.length;
  } catch (err) {
    log.error('retention failed', err);
    return 0;
  }
}

/** Throttled run after a capture/insert. */
export function retentionAfterInsert(): void {
  if (pending) return;
  const wait = Math.max(0, AFTER_INSERT_THROTTLE_MS - (Date.now() - lastRun));
  pending = setTimeout(() => {
    pending = null;
    enforceRetention();
  }, wait);
}

export function scheduleRetention(): void {
  if (timer) clearInterval(timer);
  timer = setInterval(enforceRetention, HOUR);
  timer.unref?.();
  enforceRetention();
}

export function stopRetention(): void {
  if (timer) clearInterval(timer);
  if (pending) clearTimeout(pending);
  timer = null;
  pending = null;
}
