// Pure formatting helpers (time, sizes, counts, app names). No DOM access — unit-tested.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export type DateSection = 'today' | 'yesterday' | 'week' | 'earlier';

export const SECTION_LABELS: Record<DateSection | 'pinned' | 'results', string> = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'This week',
  earlier: 'Earlier',
  results: 'Results',
};

/** Local midnight of the day containing `ts`. */
export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Bucket for the sticky section headers: Today / Yesterday / This week (last 7 days) / Earlier. */
export function dateSection(ts: number, now: number = Date.now()): DateSection {
  const today = startOfDay(now);
  if (ts >= today) return 'today';
  const yesterday = startOfDay(today - 1);
  if (ts >= yesterday) return 'yesterday';
  if (ts >= startOfDay(today - 6 * DAY)) return 'week';
  return 'earlier';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Compact relative time for list rows: "now", "4m", "3h", "Yesterday", "Tue", "Oct 12", "Oct 12, 2024". */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 45_000) return 'now';
  if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))}m`;
  const section = dateSection(ts, now);
  if (section === 'today') return `${Math.floor(diff / HOUR)}h`;
  if (section === 'yesterday') return 'Yesterday';
  const d = new Date(ts);
  if (section === 'week') return WEEKDAYS[d.getDay()]!;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return sameYear ? `${MONTHS[d.getMonth()]} ${d.getDate()}` : `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Longer form for the preview header: "Today at 14:32", "Yesterday at 09:10", "Oct 12, 2026 at 14:32". */
export function fullDateTime(ts: number, now: number = Date.now()): string {
  const d = new Date(ts);
  const section = dateSection(ts, now);
  if (section === 'today') {
    const diff = now - ts;
    if (diff < 45_000) return 'Just now';
    if (diff < HOUR) return `${Math.max(1, Math.round(diff / MINUTE))} min ago`;
    return `Today at ${clock(d)}`;
  }
  if (section === 'yesterday') return `Yesterday at ${clock(d)}`;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} at ${clock(d)}`;
}

/** Short date for stats: "Oct 12, 2026". */
export function shortDate(ts: number): string {
  const d = new Date(ts);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "0 B", "980 B", "12 KB", "3.4 MB", "1.2 GB". */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1000) return `${Math.round(bytes)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) { v /= 1024; i++; }
  const digits = v < 10 ? 1 : 0;
  return `${v.toFixed(digits).replace(/\.0$/, '')} ${units[i]}`;
}

const NUMBER = new Intl.NumberFormat('en-US');
/** "1,284". */
export function formatCount(n: number): string {
  return NUMBER.format(n);
}

/** "1 clip" / "1,284 clips". */
export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

const APP_NAMES: Record<string, string> = {
  code: 'VS Code', 'code - insiders': 'VS Code Insiders', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox',
  winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', outlook: 'Outlook', onenote: 'OneNote',
  explorer: 'File Explorer', windowsterminal: 'Terminal', wt: 'Terminal', cmd: 'Command Prompt',
  powershell: 'PowerShell', pwsh: 'PowerShell', notepad: 'Notepad', 'notepad++': 'Notepad++',
  slack: 'Slack', figma: 'Figma', discord: 'Discord', teams: 'Teams', 'ms-teams': 'Teams', spotify: 'Spotify',
  idea64: 'IntelliJ IDEA', devenv: 'Visual Studio', obsidian: 'Obsidian', notion: 'Notion', snippingtool: 'Snipping Tool',
  mspaint: 'Paint', photoshop: 'Photoshop', postman: 'Postman', datagrip64: 'DataGrip',
};

/** Friendly source-app label: "Code.exe" → "VS Code", "WINWORD.EXE" → "Word", "Safari" → "Safari". */
export function appLabel(sourceApp: string | null | undefined): string {
  if (!sourceApp) return '';
  const base = sourceApp.replace(/\.(exe|app)$/i, '');
  return APP_NAMES[base.toLowerCase()] ?? base;
}

/** Hostname without "www." or '' when unparseable. */
export function hostname(url: string | undefined | null): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** Last path segment for Windows or POSIX paths. */
export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** Directory part of a path ('' if none). */
export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
  return i > 0 ? path.slice(0, i) : '';
}

/** Lower-case extension without the dot ('' when none). */
export function extname(path: string): string {
  const b = basename(path);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}
