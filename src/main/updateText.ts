// Pure helpers for the auto-updater: turn electron-updater's release notes and (often very long) error
// messages into short plain text for the UI. No electron imports, so they are unit-testable.

export interface ReleaseNoteLike {
  version?: string;
  note?: string | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };

/** HTML (GitHub renders release bodies as HTML) → plain text with paragraph breaks kept. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '\n• ')
    .replace(/<\/\s*(p|div|h[1-6]|ul|ol|pre|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      const key = e.toLowerCase();
      if (key in ENTITIES) return ENTITIES[key]!;
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16));
      if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10));
      return m;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** electron-updater gives a string or (fullChangelog) an array of { version, note }. */
export function releaseNotesText(notes: string | ReadonlyArray<ReleaseNoteLike> | null | undefined, maxChars = 4000): string | null {
  if (!notes) return null;
  const text =
    typeof notes === 'string'
      ? htmlToText(notes)
      : notes
          .map((n) => [n.version ? `v${n.version}` : '', n.note ? htmlToText(n.note) : ''].filter(Boolean).join('\n'))
          .filter(Boolean)
          .join('\n\n');
  if (!text) return null;
  return text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text;
}

/** Maps an updater error to one short user-facing sentence. */
export function friendlyUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : String(err ?? '');
  const msg = raw || 'Unknown error';
  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED/i.test(msg)) return 'You appear to be offline. Check your connection and try again.';
  if (/ETIMEDOUT|ERR_TIMED_OUT|ESOCKETTIMEDOUT|ECONNRESET|ERR_CONNECTION/i.test(msg)) return 'Couldn’t reach GitHub. Try again in a moment.';
  if (/No published versions|Unable to find latest version|latest\.yml|status code 404|HttpError: 404/i.test(msg)) return 'No update information was found for this platform yet.';
  if (/status code 403|rate limit/i.test(msg)) return 'GitHub is limiting requests right now. Try again later.';
  if (/sha512 checksum mismatch|checksum/i.test(msg)) return 'The downloaded update was corrupted. Try again.';
  if (/Could not get code signature|code sign|not signed|signature/i.test(msg)) return 'This build can’t update itself because it isn’t code-signed. Download the new version from GitHub instead.';
  const first = msg.split(/\r?\n/)[0]!.trim();
  return first.length > 200 ? `${first.slice(0, 199)}…` : first;
}
