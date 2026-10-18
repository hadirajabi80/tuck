// Tuck shared domain types. Imported by main, preload and renderer. No electron/node imports.

export type Platform = 'win32' | 'darwin';
export type WindowKind = 'popup' | 'settings';

export type ClipKind = 'text' | 'link' | 'color' | 'code' | 'image' | 'files';

/** Popup filter chips. 'snippets' is served by snippets:list, not clips:list. */
export type FilterId = 'all' | 'pinned' | 'text' | 'images' | 'links' | 'files' | 'colors' | 'code' | 'snippets';
export type ClipFilterId = Exclude<FilterId, 'snippets'>;

export interface ClipImageMeta {
  width: number;
  height: number;
  bytes: number;          // stored PNG bytes
  file: string;           // relative to userData/images; load via tuck://img/full/<id>
  thumb: string;          // relative to userData/images/thumbs; load via tuck://img/thumb/<id>
  thumbWidth: number;
  thumbHeight: number;
}

export interface ClipMeta {
  url?: string;           // normalised URL for 'link'
  colorHex?: string;      // #RRGGBB[AA] for 'color'
  language?: string;      // guess for 'code' ('json','ts','py',…), '' unknown
  lineCount?: number;
  wordCount?: number;
  charCount?: number;
  fileCount?: number;
}

/** Lightweight row used by lists. Never carries html/rtf. */
export interface ClipSummary {
  id: string;
  kind: ClipKind;
  preview: string;        // single line, <= 200 chars. Image: "Image 1280×720". Files: first path.
  hasHtml: boolean;
  hasRtf: boolean;
  image: ClipImageMeta | null;
  files: string[] | null;
  byteSize: number;
  sourceApp: string | null;
  pinned: boolean;
  pinnedAt: number | null;
  copyCount: number;
  createdAt: number;      // epoch ms, first copy
  updatedAt: number;      // epoch ms, last copy/edit/paste — list sort key
  lastPastedAt: number | null;
  groupIds: string[];
  meta: ClipMeta;
}

/** Full clip, returned by clips:get. */
export interface Clip extends ClipSummary {
  text: string | null;    // text-family kinds; file paths joined by '\n'; null for images
  html: string | null;
  rtf: string | null;
  hash: string;
}

export interface ClipQuery {
  filter: ClipFilterId;
  groupId?: string | null;
  query: string;
  offset: number;
  limit: number;          // 1..500
  excludePinned?: boolean;
}

export interface ClipPage {
  items: ClipSummary[];
  total: number;          // matches ignoring offset/limit
  offset: number;
}

export interface ClipUpdate {
  id: string;
  text: string;           // html/rtf cleared; kind/meta/preview/hash re-derived
}

export const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface Group {
  id: string;
  name: string;
  color: GroupColor | null;
  icon: string | null;    // lucide icon name
  sortOrder: number;
  createdAt: number;
  clipCount: number;
}

export interface GroupInput {
  name: string;
  color?: GroupColor | null;
  icon?: string | null;
}

export interface Snippet {
  id: string;
  title: string;
  body: string;
  keyword: string | null;
  groupId: string | null;
  sortOrder: number;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetInput {
  title: string;
  body: string;
  keyword?: string | null;
  groupId?: string | null;
}

export type TransformId =
  | 'upper' | 'lower' | 'title' | 'trim' | 'collapseWhitespace' | 'removeLineBreaks'
  | 'jsonPretty' | 'jsonMinify' | 'stripFormatting';

export const TRANSFORMS: ReadonlyArray<{ id: TransformId; label: string; key: string }> = [
  { id: 'upper', label: 'UPPERCASE', key: 'U' },
  { id: 'lower', label: 'lowercase', key: 'L' },
  { id: 'title', label: 'Title Case', key: 'T' },
  { id: 'trim', label: 'Trim whitespace', key: 'W' },
  { id: 'collapseWhitespace', label: 'Collapse whitespace', key: 'C' },
  { id: 'removeLineBreaks', label: 'Remove line breaks', key: 'B' },
  { id: 'jsonPretty', label: 'JSON pretty', key: 'J' },
  { id: 'jsonMinify', label: 'JSON minify', key: 'M' },
  { id: 'stripFormatting', label: 'Plain text only', key: 'P' },
];

export type PasteRequest =
  | { type: 'clip'; clipId: string; plain?: boolean; transform?: TransformId | null }
  | { type: 'clips'; clipIds: string[]; separator?: string; plain?: boolean; transform?: TransformId | null }
  | { type: 'snippet'; snippetId: string }
  | { type: 'text'; text: string; html?: string | null };

export interface PasteResult {
  ok: boolean;
  /** 'accessibility': macOS permission missing — content was still placed on the clipboard. */
  error?: 'accessibility' | 'not-found' | 'clipboard' | 'keystroke' | 'unknown';
  message?: string;
}

export type ShortcutId = 'openPopup' | 'pasteLastPlain' | 'toggleCapture';

export interface ShortcutStatus {
  id: ShortcutId;
  accelerator: string;    // Electron accelerator, '' = unbound
  registered: boolean;
  error: string | null;
}

export interface ShortcutSetResult {
  ok: boolean;
  status: ShortcutStatus;
  error?: 'invalid' | 'conflict-internal' | 'conflict-system' | 'unknown';
  message?: string;
}

export interface CaptureState {
  paused: boolean;
  pausedAt: number | null;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export type PopupPosition = 'cursor' | 'center' | 'remember';
export type SettingsSection = 'general' | 'shortcuts' | 'history' | 'appearance' | 'privacy' | 'about';

export interface Settings {
  general: {
    launchAtLogin: boolean;
    hideOnBlur: boolean;
    moveToTopOnPaste: boolean;
    pasteDelayMs: number;        // 0..1000
    mergeSeparator: string;
    showSourceApp: boolean;
  };
  shortcuts: Record<ShortcutId, string>;
  history: {
    maxItems: number;            // 50..100000
    expireDays: number;          // 0 = never, 0..3650
    dedupe: boolean;
    captureImages: boolean;
    captureFiles: boolean;
    maxImageBytes: number;
    pollIntervalMs: number;      // 100..2000
  };
  appearance: {
    theme: ThemeMode;
    density: Density;
    vibrancy: boolean;
    previewVisible: boolean;
    popupPosition: PopupPosition;
    showQuickPasteBadges: 'always' | 'modifier' | 'never';
    /** Popup size the user resized to. Width is remembered separately with and without the preview pane. */
    popupWidth: number;          // preview on, POPUP_SIZE.minWidth..maxWidth
    popupListWidth: number;      // preview off, POPUP_SIZE.minListWidth..maxWidth
    popupHeight: number;         // POPUP_SIZE.minHeight..maxHeight
  };
  privacy: {
    skipConcealed: boolean;
    ignoredApps: string[];       // Win: exe basename (case-insensitive); mac: app name
    ignorePatterns: string[];    // regex sources; matching text clips are not captured
  };
  updates: {
    autoCheck: boolean;          // check GitHub Releases ~10 s after launch, then every 6 h
    autoDownload: boolean;       // download a found update in the background
  };
}

/** Popup window size: defaults and resize limits (px). */
export const POPUP_SIZE = {
  width: 760, listWidth: 480, height: 460,
  minWidth: 480, minListWidth: 260, minHeight: 240,
  maxWidth: 1600, maxHeight: 1200,
} as const;

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function defaultSettings(platform: Platform): Settings {
  const mac = platform === 'darwin';
  return {
    general: { launchAtLogin: true, hideOnBlur: true, moveToTopOnPaste: true, pasteDelayMs: 60, mergeSeparator: '\n', showSourceApp: true },
    shortcuts: { openPopup: mac ? 'Command+Shift+V' : 'Control+`', pasteLastPlain: '', toggleCapture: '' },
    history: { maxItems: 5000, expireDays: 90, dedupe: true, captureImages: true, captureFiles: true, maxImageBytes: 25 * 1024 * 1024, pollIntervalMs: 200 },
    appearance: {
      theme: 'system', density: 'comfortable', vibrancy: true, previewVisible: true, popupPosition: 'cursor', showQuickPasteBadges: 'modifier',
      popupWidth: POPUP_SIZE.width, popupListWidth: POPUP_SIZE.listWidth, popupHeight: POPUP_SIZE.height,
    },
    privacy: { skipConcealed: true, ignoredApps: [], ignorePatterns: [] },
    updates: { autoCheck: true, autoDownload: true },
  };
}

export interface Stats {
  totalClips: number;
  pinnedClips: number;
  imageClips: number;
  dbBytes: number;
  imagesBytes: number;
  oldestAt: number | null;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  isPackaged: boolean;
  userDataPath: string;
  dbPath: string;
  imagesPath: string;
  accessibilityTrusted: boolean | null;   // null on Windows
  launchAtLoginSupported: boolean;
}

export interface ExportRequest { includeImages: boolean }
export interface ExportResult { ok: boolean; canceled: boolean; path?: string; clips?: number; error?: string }
export interface ImportResult { ok: boolean; canceled: boolean; imported: number; skipped: number; groups: number; snippets: number; error?: string }

// ---- Ditto import (DESIGN.md section I) ----

export interface DittoDetectResult { found: boolean; path: string | null }
export interface DittoInspectResult { ok: boolean; path: string; clips: number; groups: number; pinned: number; error?: DittoImportError }
export type DittoImportError = 'canceled' | 'unrecognized' | 'not-ditto' | 'read-failed' | 'unknown';
export interface DittoImportRequest {
  /** null/undefined → main opens the file dialog. */
  path?: string | null;
  includeImages: boolean;
  includeGroups: boolean;
}
export interface DittoImportResult {
  ok: boolean;
  canceled: boolean;
  imported: number;
  merged: number;
  skipped: number;
  groups: number;
  images: number;
  error?: DittoImportError;
  message?: string;
}
export interface ImportProgressEvent { source: 'ditto' | 'tuck'; done: number; total: number }

// ---- Auto-update (electron-updater, GitHub Releases) ----

export type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error' | 'unsupported';

export interface UpdateRelease {
  version: string;
  releaseNotes: string | null;   // plain text (HTML stripped)
  releaseDate: string | null;    // ISO 8601
}

/** Snapshot broadcast on updates:changed and returned by every updates:* channel. */
export type UpdateState = {
  currentVersion: string;
  lastCheckedAt: number | null;  // epoch ms of the last completed check
} & (
  | { status: 'idle' }
  | { status: 'checking' }
  | ({ status: 'available' } & UpdateRelease)
  | { status: 'not-available' }
  | { status: 'downloading'; version: string; percent: number; bytesPerSecond: number; transferred: number; total: number }
  | ({ status: 'downloaded' } & UpdateRelease)
  | { status: 'error'; message: string }
  | { status: 'unsupported'; message: string }
);

// ---- Events ----

export interface ClipsChangedEvent {
  reason: 'added' | 'updated' | 'deleted' | 'cleared' | 'imported' | 'restored' | 'pasted';
  ids: string[];
}

export interface PopupShownEvent {
  trigger: 'hotkey' | 'tray' | 'second-instance' | 'api';
  filter?: FilterId;
}

export interface NotifyEvent {
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  durationMs?: number;   // default 3000
}

export const LIMITS = {
  previewChars: 200,
  listPageSize: 100,
  maxHtmlBytes: 512 * 1024,
  maxRtfBytes: 512 * 1024,
  maxTextBytes: 4 * 1024 * 1024,
  thumbMaxSide: 240,
  undoRingSize: 20,
  undoWindowMs: 60_000,
} as const;
