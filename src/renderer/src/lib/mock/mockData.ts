// Seed data for the browser mock: ~60 clips of every kind, 3 collections, 4 snippets.
import { analyzeText, filesPreview, imagePreview, makePreview, textStats } from '@shared/detect';
import type { Clip, ClipKind, Group, Platform, Snippet } from '@shared/types';
import type { MockImageStyle } from './mockImages';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export interface MockImageInfo { style: MockImageStyle }

interface SeedText { text: string; age: number; app?: string; pinned?: boolean; groups?: string[]; copies?: number; html?: boolean; pastedAgo?: number }
interface SeedImage { image: MockImageStyle; w: number; h: number; age: number; app?: string; pinned?: boolean; groups?: string[] }
interface SeedFiles { files: string[]; age: number; app?: string; pinned?: boolean; groups?: string[] }
type Seed = SeedText | SeedImage | SeedFiles;

let counter = 0;
/** Deterministic uuid-shaped ids (main validates /^[0-9a-f-]{36}$/ for image ids). */
export function mockId(): string {
  counter++;
  return `7c0ffee0-0000-4000-8000-${counter.toString(16).padStart(12, '0')}`;
}

export function hashOf(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function seeds(platform: Platform): Seed[] {
  const win = platform !== 'darwin';
  const p = (w: string, m: string) => (win ? w : m);
  const editor = p('Code.exe', 'Code');
  const browser = p('chrome.exe', 'Google Chrome');
  const slack = p('slack.exe', 'Slack');
  const term = p('WindowsTerminal.exe', 'Terminal');
  const figma = p('Figma.exe', 'Figma');
  const explorer = p('explorer.exe', 'Finder');
  const word = p('WINWORD.EXE', 'Microsoft Word');
  const notes = p('notepad.exe', 'Notes');
  const shot = p('SnippingTool.exe', 'Screenshot');
  const home = p('C:\\Users\\alex', '/Users/alex');
  const sep = win ? '\\' : '/';
  const path = (...parts: string[]) => [home, ...parts].join(sep);

  return [
    { text: 'https://github.com/tuck-app/tuck/pull/142', age: 1, app: browser, groups: ['work'] },
    { text: 'Can you take a look at the release notes before 4pm? I left comments on the migration section.', age: 3, app: slack },
    { text: '#5B5BD6', age: 6, app: figma, groups: ['design'], copies: 7 },
    {
      text: `export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as T;
}`, age: 9, app: editor, groups: ['work'],
    },
    { image: 'screenshot', w: 1920, h: 1080, age: 14, app: shot },
    { text: 'npm run build && npx electron-builder --win nsis', age: 18, app: term, copies: 3 },
    { text: 'alex.morgan@northwind.dev', age: 24, app: p('OUTLOOK.EXE', 'Mail'), pinned: true, copies: 12 },
    {
      text: `{
  "name": "tuck",
  "version": "0.1.0",
  "private": true,
  "scripts": { "dev": "electron-vite dev", "build": "electron-vite build" },
  "dependencies": { "koffi": "^3.3.3" },
  "features": ["search", "pins", "collections", "snippets"],
  "limits": { "maxItems": 5000, "expireDays": 90 }
}`, age: 31, app: editor,
    },
    { files: [path('Documents', 'Q3 Planning.docx'), path('Documents', 'Budget 2026.xlsx'), path('Desktop', 'roadmap.pdf')], age: 38, app: explorer },
    { text: 'rgb(42, 160, 125)', age: 44, app: browser, groups: ['design'] },
    { text: 'The fastest way to get better at something is to do it badly, often, and in public.', age: 52, app: p('msedge.exe', 'Safari') },
    { text: 'https://www.figma.com/file/8xQe2/Tuck-Popup?node-id=12-3', age: 61, app: figma, groups: ['design'] },
    {
      text: `SELECT c.id, c.preview, c.updated_at, COUNT(g.group_id) AS groups
FROM clips c
LEFT JOIN clip_groups g ON g.clip_id = c.id
WHERE c.pinned = 0 AND c.kind IN ('text', 'link')
GROUP BY c.id
ORDER BY c.updated_at DESC
LIMIT 100;`, age: 75, app: p('datagrip64.exe', 'DataGrip'), groups: ['work'],
    },
    { text: 'Meeting moved to Thursday 10:30 — same room (Fjord, 3rd floor).', age: 92, app: slack, html: true },
    { image: 'chart', w: 1200, h: 720, age: 110, app: browser, groups: ['work'] },
    { text: '4111 1111 1111 1111', age: 130, app: notes },
    { text: 'hsl(250, 60%, 62%)', age: 150, app: editor, groups: ['design'] },
    { text: 'Tracking number: 1Z 999 AA1 01 2345 6784', age: 175, app: browser },
    {
      text: `def chunked(items, size=200):
    """Yield successive chunks of size from items."""
    for i in range(0, len(items), size):
        yield items[i:i + size]`, age: 205, app: editor,
    },
    { text: 'https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API', age: 240, app: browser, groups: ['reading'] },
    { text: 'Ship it. We can iterate on the empty states next sprint.', age: 290, app: slack, pinned: true },
    { text: '#FF6B6B', age: 330, app: figma },
    { files: [path('Pictures', 'Screenshots', 'popup-dark.png')], age: 380, app: explorer },
    { text: '  Trailing   whitespace   example   with   extra   spaces  ', age: 420, app: notes },
    // yesterday
    { text: 'Hi team — quick reminder that the design review is tomorrow at 2pm. Please add your agenda items to the doc.', age: 22 * HOUR / MIN + 60, app: word, html: true },
    { image: 'photo', w: 2400, h: 1600, age: 26 * HOUR / MIN, app: browser, groups: ['reading'] },
    { text: 'https://news.ycombinator.com/item?id=41234567', age: 27 * HOUR / MIN, app: browser, groups: ['reading'] },
    { text: 'git rebase -i HEAD~5', age: 28 * HOUR / MIN, app: term, pinned: true, copies: 9 },
    { text: '#0E0E12', age: 29 * HOUR / MIN, app: figma, groups: ['design'] },
    {
      text: `interface ClipSummary {
  id: string;
  kind: ClipKind;
  preview: string;
  pinned: boolean;
  updatedAt: number;
}`, age: 30 * HOUR / MIN, app: editor,
    },
    { text: 'Order #A-20931 confirmed. Estimated delivery: Oct 21.', age: 31 * HOUR / MIN, app: p('OUTLOOK.EXE', 'Mail') },
    { text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Donec sed odio dui. Nullam quis risus eget urna mollis ornare vel eu leo.', age: 33 * HOUR / MIN, app: word },
    { files: [path('Projects', 'tuck', 'src'), path('Projects', 'tuck', 'package.json')], age: 34 * HOUR / MIN, app: explorer, groups: ['work'] },
    { text: 'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', age: 36 * HOUR / MIN, app: p('Spotify.exe', 'Spotify') },
    // this week
    { image: 'logo', w: 1024, h: 1024, age: 3 * DAY / MIN, app: figma, pinned: true, groups: ['design'] },
    { text: 'docker compose up -d --build api worker', age: 3 * DAY / MIN + 40, app: term, groups: ['work'] },
    { text: 'Thanks so much! That fixed it. For anyone else: the trick was clearing the cache *before* re-running the migration.', age: 3 * DAY / MIN + 90, app: slack },
    { text: '#E2A336', age: 3 * DAY / MIN + 200, app: figma },
    {
      text: `.row {
  display: grid;
  grid-template-columns: 18px 28px 1fr auto;
  align-items: center;
  height: 44px;
  border-radius: var(--r-md);
}`, age: 4 * DAY / MIN, app: editor, groups: ['design'],
    },
    { text: 'https://linear.app/tuck/issue/TUC-88/quick-paste-badges-flicker-on-modifier-release', age: 4 * DAY / MIN + 30, app: browser, groups: ['work'] },
    { text: 'Wi-Fi: Northwind-Guest / password: correct-horse-battery-staple', age: 4 * DAY / MIN + 300, app: notes, pinned: true },
    { image: 'diagram', w: 1600, h: 900, age: 5 * DAY / MIN, app: p('mspaint.exe', 'Preview'), groups: ['work'] },
    { text: 'Get-ChildItem -Recurse -Filter *.log | Remove-Item -WhatIf', age: 5 * DAY / MIN + 50, app: p('pwsh.exe', 'Terminal') },
    { text: 'Postal address: 221B Baker Street, London NW1 6XE', age: 5 * DAY / MIN + 120, app: word },
    { text: '1. Capture  2. Search  3. Paste — that\'s the whole loop.', age: 6 * DAY / MIN, app: notes },
    // earlier
    { text: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', age: 9 * DAY / MIN, app: browser, groups: ['reading'] },
    { text: '#30A46C', age: 10 * DAY / MIN, app: figma, groups: ['design'] },
    { files: [path('Downloads', 'Tuck-Setup-0.1.0.exe')], age: 12 * DAY / MIN, app: explorer },
    {
      text: `const result = await window.api.invoke('clips:list', {
  filter: 'all',
  query: '',
  offset: 0,
  limit: 100,
});
console.log(result.total);`, age: 14 * DAY / MIN, app: editor,
    },
    { image: 'palette', w: 1200, h: 400, age: 16 * DAY / MIN, app: figma, groups: ['design'] },
    { text: 'Remember: retention never deletes pinned clips.', age: 19 * DAY / MIN, app: notes },
    { text: 'https://en.wikipedia.org/wiki/Clipboard_manager', age: 23 * DAY / MIN, app: browser, groups: ['reading'] },
    { text: 'Kind regards,\nAlex Morgan\nProduct Engineer · Northwind', age: 27 * DAY / MIN, app: word },
    { text: 'rgba(91, 91, 214, 0.22)', age: 31 * DAY / MIN, app: editor },
    { text: 'ssh deploy@10.0.4.12 -p 2222', age: 38 * DAY / MIN, app: term },
    { image: 'screenshot', w: 1440, h: 900, age: 45 * DAY / MIN, app: shot },
    { text: 'The quick brown fox jumps over the lazy dog.', age: 60 * DAY / MIN, app: notes },
    { text: 'https://react.dev/reference/react/useSyncExternalStore', age: 75 * DAY / MIN, app: browser },
    { files: [path('Music', 'Focus.m4a'), path('Music', 'Ambient.flac'), path('Music', 'Rain.mp3'), path('Music', 'Waves.wav')], age: 90 * DAY / MIN, app: explorer },
    { text: 'Ce texte est en français — avec des accents : é, è, à, ç, ô.', age: 120 * DAY / MIN, app: word },
    { text: '日本語のテキストもちゃんと検索できます。', age: 200 * DAY / MIN, app: notes },
    { text: 'TODO: rename `clips_fts` triggers after the v2 migration lands', age: 400 * DAY / MIN, app: editor },
  ];
}

export interface MockSeed {
  clips: Clip[];
  images: Map<string, MockImageInfo>;
  groups: Omit<Group, 'clipCount'>[];
  snippets: Snippet[];
}

export function buildClipFromText(id: string, text: string, now: number, extra: Partial<Clip> = {}): Clip {
  const { kind, meta } = analyzeText(text);
  return {
    id, kind, preview: makePreview(text), hasHtml: false, hasRtf: false, image: null, files: null,
    byteSize: new TextEncoder().encode(text).length, sourceApp: null, pinned: false, pinnedAt: null, copyCount: 1,
    createdAt: now, updatedAt: now, lastPastedAt: null, groupIds: [], meta, text, html: null, rtf: null,
    hash: hashOf(`${kind}\0${text}`), ...extra,
  };
}

export function seedMock(platform: Platform, now: number = Date.now()): MockSeed {
  const groups: Omit<Group, 'clipCount'>[] = [
    { id: 'g-work', name: 'Work', color: 'blue', icon: 'briefcase', sortOrder: 0, createdAt: now - 90 * DAY },
    { id: 'g-design', name: 'Design tokens', color: 'violet', icon: 'palette', sortOrder: 1, createdAt: now - 60 * DAY },
    { id: 'g-reading', name: 'Reading list', color: 'green', icon: 'book-open', sortOrder: 2, createdAt: now - 30 * DAY },
  ];
  const gid = (k: string) => `g-${k}`;
  const images = new Map<string, MockImageInfo>();
  const clips: Clip[] = [];

  for (const s of seeds(platform)) {
    const id = mockId();
    const at = now - s.age * MIN;
    const common = {
      sourceApp: s.app ?? null,
      pinned: !!s.pinned,
      pinnedAt: s.pinned ? at + MIN : null,
      createdAt: at - ('copies' in s && s.copies ? 5 * DAY : 0),
      updatedAt: at,
      groupIds: (s.groups ?? []).map(gid),
    };
    if ('text' in s) {
      const html = s.html ? `<p>${s.text}</p>` : null;
      clips.push(buildClipFromText(id, s.text, at, {
        ...common, copyCount: s.copies ?? 1, hasHtml: !!html, html,
        lastPastedAt: s.copies && s.copies > 2 ? at + 30_000 : null,
      }));
    } else if ('image' in s) {
      const tw = s.w >= s.h ? 240 : Math.round((240 * s.w) / s.h);
      const th = s.h > s.w ? 240 : Math.round((240 * s.h) / s.w);
      const bytes = Math.round(s.w * s.h * 0.9);
      images.set(id, { style: s.image });
      clips.push({
        id, kind: 'image' as ClipKind, preview: imagePreview(s.w, s.h), hasHtml: false, hasRtf: false,
        image: { width: s.w, height: s.h, bytes, file: `${id}.png`, thumb: `${id}.png`, thumbWidth: tw, thumbHeight: th },
        files: null, byteSize: bytes, copyCount: 1, lastPastedAt: null, meta: {}, text: null, html: null, rtf: null,
        hash: hashOf(`image\0${id}`), ...common,
      });
    } else {
      const text = s.files.join('\n');
      clips.push({
        id, kind: 'files', preview: filesPreview(s.files), hasHtml: false, hasRtf: false, image: null, files: s.files,
        byteSize: text.length, copyCount: 1, lastPastedAt: null, meta: { fileCount: s.files.length, ...textStats(text) },
        text, html: null, rtf: null, hash: hashOf(`files\0${text}`), ...common,
      });
    }
  }

  const snippets: Snippet[] = [
    { id: 's-sig', title: 'Email signature', body: 'Kind regards,\nAlex Morgan\nProduct Engineer · Northwind\n+1 (555) 014-2290', keyword: ';sig', groupId: null, sortOrder: 0, usageCount: 42, createdAt: now - 80 * DAY, updatedAt: now - 2 * DAY },
    { id: 's-meet', title: 'Meeting link', body: 'Join the call: https://meet.northwind.dev/alex-morgan', keyword: ';meet', groupId: 'g-work', sortOrder: 1, usageCount: 17, createdAt: now - 50 * DAY, updatedAt: now - 5 * DAY },
    { id: 's-bug', title: 'Bug report template', body: '**Steps to reproduce**\n1. \n2. \n\n**Expected**\n\n**Actual**\n\n**Version / OS**\n', keyword: ';bug', groupId: 'g-work', sortOrder: 2, usageCount: 6, createdAt: now - 40 * DAY, updatedAt: now - 12 * DAY },
    { id: 's-addr', title: 'Shipping address', body: 'Alex Morgan\n221B Baker Street\nLondon NW1 6XE\nUnited Kingdom', keyword: ';addr', groupId: null, sortOrder: 3, usageCount: 3, createdAt: now - 20 * DAY, updatedAt: now - 20 * DAY },
  ];

  return { clips, images, groups, snippets };
}

/** A few extra clips used when the mock "imports" from Ditto. */
export const DITTO_SAMPLE_TEXTS = [
  'Imported from Ditto: weekly standup notes',
  'https://ditto-cp.sourceforge.io/',
  '#1E90FF',
  'SELECT * FROM Main WHERE bIsGroup = 0 ORDER BY lDate DESC;',
  'Old address: 742 Evergreen Terrace, Springfield',
  'Ditto group: Templates → Reply: "Thanks, looking into it!"',
];
