// Lazy, guarded koffi loader. Every native binding goes through this so a missing/broken koffi binary
// degrades features (fallback paths) instead of crashing the app.
import { logger } from '../log';

type Koffi = typeof import('koffi');

const log = logger('native');
let cached: Koffi | null | undefined;

export function getKoffi(): Koffi | null {
  if (cached !== undefined) return cached;
  try {
    // Plain require keeps koffi external (it is the only runtime dependency and lives in app.asar.unpacked).
    cached = require('koffi') as Koffi;
  } catch (err) {
    log.warn('koffi unavailable — native features use fallbacks:', (err as Error).message);
    cached = null;
  }
  return cached;
}

/** Runs a binding factory once; logs and caches null on failure. */
export function lazyBinding<T>(name: string, factory: (koffi: Koffi) => T): () => T | null {
  let value: T | null | undefined;
  return () => {
    if (value !== undefined) return value;
    const k = getKoffi();
    if (!k) return (value = null);
    try {
      value = factory(k);
    } catch (err) {
      log.warn(`binding ${name} failed:`, (err as Error).message);
      value = null;
    }
    return value;
  };
}
