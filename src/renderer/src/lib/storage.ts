// localStorage wrappers — storage can throw (sandboxed/opaque origins, quota), never let that break the UI.

export function readFlag(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeFlag(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    /* ignore */
  }
}

export const STORAGE_KEYS = {
  dittoCardDismissed: 'tuck.dittoCard.dismissed',
} as const;
