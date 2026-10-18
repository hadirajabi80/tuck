// In-memory mock of the whole IPC contract, used when window.api is undefined (`npm run dev:ui` in a browser).
// Seeded lazily with ~60 clips of every kind, 3 collections and 4 snippets; emits the same events main would.
// Dev helpers are exposed on window.tuckMock (addClip, showPopup, setPaused, setAccessibility).
import { subsequenceScore } from '@shared/detect';
import type {
  EventChannel, EventPayload, InvokeChannel, InvokeReq, InvokeRes, TuckApi,
} from '@shared/ipc';
import { imageUrl } from '@shared/ipc';
import { normalize, validate } from '@shared/accelerator';
import { applyTransform } from '@shared/transforms';
import {
  defaultSettings, LIMITS, type CaptureState, type Clip, type ClipQuery, type ClipSummary, type DeepPartial, type Group,
  type Settings, type ShortcutId, type ShortcutStatus, type Snippet,
} from '@shared/types';
import { buildClipFromText, DITTO_SAMPLE_TEXTS, hashOf, mockId, seedMock, type MockImageInfo } from './mock/mockData';
import { renderMockImage } from './mock/mockImages';

const platform: TuckApi['platform'] = /Mac/i.test(globalThis.navigator?.platform ?? '') ? 'darwin' : 'win32';
const windowKind: TuckApi['windowKind'] = globalThis.location?.hash.startsWith('#/settings') ? 'settings' : 'popup';

// ------------------------------------------------------------------ state (lazy)

interface MockState {
  clips: Clip[];
  images: Map<string, MockImageInfo>;
  groups: Omit<Group, 'clipCount'>[];
  snippets: Snippet[];
  settings: Settings;
  capture: CaptureState;
  shortcutErrors: Partial<Record<ShortcutId, string>>;
  undo: Array<{ clips: Clip[]; at: number }>;
  accessibilityTrusted: boolean | null;
  clipboard: string;
}

let state: MockState | null = null;

function s(): MockState {
  if (state) return state;
  const seed = seedMock(platform);
  state = {
    ...seed,
    settings: defaultSettings(platform),
    capture: { paused: false, pausedAt: null },
    shortcutErrors: {},
    undo: [],
    accessibilityTrusted: platform === 'darwin' ? false : null,
    clipboard: '',
  };
  return state;
}

// ------------------------------------------------------------------ events

type Listener = (payload: unknown) => void;
const listeners = new Map<EventChannel, Set<Listener>>();

function emit<E extends EventChannel>(channel: E, payload: EventPayload<E>): void {
  // async like real IPC
  setTimeout(() => listeners.get(channel)?.forEach((l) => l(payload)), 0);
}

// ------------------------------------------------------------------ helpers

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function summary(c: Clip): ClipSummary {
  const { text: _t, html: _h, rtf: _r, hash: _x, ...rest } = c;
  return { ...rest, groupIds: [...rest.groupIds] };
}

function matchesFilter(c: Clip, q: ClipQuery): boolean {
  if (q.excludePinned && c.pinned) return false;
  if (q.groupId && !c.groupIds.includes(q.groupId)) return false;
  switch (q.filter) {
    case 'all': return true;
    case 'pinned': return c.pinned;
    case 'text': return c.kind === 'text' || c.kind === 'link' || c.kind === 'color' || c.kind === 'code';
    case 'images': return c.kind === 'image';
    case 'links': return c.kind === 'link';
    case 'files': return c.kind === 'files';
    case 'colors': return c.kind === 'color';
    case 'code': return c.kind === 'code';
    default: return true;
  }
}

function listClips(q: ClipQuery): { items: ClipSummary[]; total: number; offset: number } {
  const st = s();
  const pool = st.clips.filter((c) => matchesFilter(c, q));
  const order = (a: Clip, b: Clip) =>
    q.filter === 'pinned' ? (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) : b.updatedAt - a.updatedAt;
  const query = q.query.trim().toLowerCase();
  let result: Clip[];
  if (!query) {
    result = [...pool].sort(order);
  } else {
    const hay = (c: Clip) => (c.text ?? c.preview).toLowerCase();
    const exact = pool.filter((c) => hay(c).includes(query)).sort((a, b) => b.updatedAt - a.updatedAt);
    result = exact;
    if (!/\s/.test(query)) {
      const seen = new Set(exact.map((c) => c.id));
      const fuzzy = pool
        .filter((c) => !seen.has(c.id))
        .map((c) => ({ c, score: subsequenceScore(query, c.preview) }))
        .filter((x) => x.score > query.length * 1.6)
        .sort((a, b) => b.score - a.score)
        .map((x) => x.c);
      result = [...exact, ...fuzzy];
    }
  }
  const limit = Math.max(1, Math.min(500, q.limit));
  return { items: result.slice(q.offset, q.offset + limit).map(summary), total: result.length, offset: q.offset };
}

function findClip(id: string): Clip {
  const c = s().clips.find((x) => x.id === id);
  if (!c) throw new Error(`mock: clip ${id} not found`);
  return c;
}

function groupsWithCounts(): Group[] {
  const st = s();
  return [...st.groups]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({ ...g, clipCount: st.clips.filter((c) => c.groupIds.includes(g.id)).length }));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(patch)) return (patch === undefined ? base : patch) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? deepMerge(out[k], v) : v;
  return out as T;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v)));

function sanitize(st: Settings): Settings {
  st.general.pasteDelayMs = clamp(st.general.pasteDelayMs, 0, 1000);
  st.history.maxItems = clamp(st.history.maxItems, 50, 100000);
  st.history.expireDays = clamp(st.history.expireDays, 0, 3650);
  st.history.pollIntervalMs = clamp(st.history.pollIntervalMs, 100, 2000);
  st.history.maxImageBytes = clamp(st.history.maxImageBytes, 1024 * 1024, 200 * 1024 * 1024);
  return st;
}

/** Combos the mock pretends another application already owns. */
const SYSTEM_TAKEN = new Set([
  'Control+Alt+Delete', 'Control+Shift+Escape', 'Alt+Tab', 'Alt+F4', 'Super+L', 'Super+D', 'Super+E', 'Super+V',
  'Control+C', 'Control+V', 'Control+X', 'Control+Shift+S', 'Command+Space', 'Command+Tab', 'Command+Q', 'Command+C', 'Command+V',
]);

function shortcutStatuses(): ShortcutStatus[] {
  const st = s();
  return (Object.keys(st.settings.shortcuts) as ShortcutId[]).map((id) => {
    const accelerator = st.settings.shortcuts[id];
    const error = st.shortcutErrors[id] ?? null;
    return { id, accelerator, registered: accelerator !== '' && !error, error };
  });
}


function newClipText(text: string, app: string | null = null): Clip {
  const st = s();
  const now = Date.now();
  const hash = hashOf(`${text}`);
  const existing = st.clips.find((c) => c.text === text);
  if (existing) {
    existing.updatedAt = now;
    existing.copyCount += 1;
    emit('clips:changed', { reason: 'updated', ids: [existing.id] });
    return existing;
  }
  const clip = buildClipFromText(mockId(), text, now, { sourceApp: app, hash });
  st.clips.unshift(clip);
  emit('clips:changed', { reason: 'added', ids: [clip.id] });
  return clip;
}

function pasteText(ids: string[], separator: string, transform: string | null | undefined): string {
  const parts = ids.map((id) => {
    const c = s().clips.find((x) => x.id === id);
    return c?.text ?? c?.preview ?? '';
  });
  const text = parts.join(separator);
  return transform ? applyTransform(transform as Parameters<typeof applyTransform>[0], text) : text;
}

let importRunning = false;

// ------------------------------------------------------------------ handlers

type Handlers = { [C in InvokeChannel]: (req: InvokeReq<C>) => InvokeRes<C> | Promise<InvokeRes<C>> };

const handlers: Handlers = {
  // ---- clips
  'clips:list': async (q) => {
    if (q.query.trim()) await sleep(20 + Math.random() * 40);
    return listClips(q);
  },
  'clips:get': (req) => {
    const c = s().clips.find((x) => x.id === req.id);
    return c ? { ...c, groupIds: [...c.groupIds] } : null;
  },
  'clips:update': (req) => {
    const c = findClip(req.id);
    const next = buildClipFromText(c.id, req.text, Date.now(), {
      sourceApp: c.sourceApp, pinned: c.pinned, pinnedAt: c.pinnedAt, copyCount: c.copyCount, createdAt: c.createdAt,
      lastPastedAt: c.lastPastedAt, groupIds: c.groupIds,
    });
    Object.assign(c, next);
    emit('clips:changed', { reason: 'updated', ids: [c.id] });
    return { ...c };
  },
  'clips:pin': (req) => {
    const c = findClip(req.id);
    c.pinned = req.pinned;
    c.pinnedAt = req.pinned ? Date.now() : null;
    emit('clips:changed', { reason: 'updated', ids: [c.id] });
    return summary(c);
  },
  'clips:setGroups': (req) => {
    const c = findClip(req.id);
    c.groupIds = [...new Set(req.groupIds)];
    emit('clips:changed', { reason: 'updated', ids: [c.id] });
    emit('groups:changed', { ids: c.groupIds });
    return summary(c);
  },
  'clips:delete': (req) => {
    const st = s();
    const ids = new Set(req.ids);
    const removed = st.clips.filter((c) => ids.has(c.id));
    st.clips = st.clips.filter((c) => !ids.has(c.id));
    if (removed.length) {
      st.undo.push({ clips: removed, at: Date.now() });
      if (st.undo.length > LIMITS.undoRingSize) st.undo.shift();
      emit('clips:changed', { reason: 'deleted', ids: removed.map((c) => c.id) });
    }
    return { deleted: removed.length };
  },
  'clips:undoDelete': () => {
    const st = s();
    const last = st.undo.pop();
    if (!last || Date.now() - last.at > LIMITS.undoWindowMs) return { restored: 0 };
    st.clips.push(...last.clips);
    st.clips.sort((a, b) => b.updatedAt - a.updatedAt);
    emit('clips:changed', { reason: 'restored', ids: last.clips.map((c) => c.id) });
    return { restored: last.clips.length };
  },
  'clips:clear': (req) => {
    const st = s();
    const before = st.clips.length;
    st.clips = req.includePinned ? [] : st.clips.filter((c) => c.pinned);
    st.undo = [];
    emit('clips:changed', { reason: 'cleared', ids: [] });
    return { deleted: before - st.clips.length };
  },
  'clips:createText': (req) => ({ ...newClipText(req.text) }),
  'clips:copy': (req) => {
    const c = findClip(req.id);
    s().clipboard = c.text ?? c.preview;
    try { void globalThis.navigator?.clipboard?.writeText(s().clipboard).catch(() => {}); } catch { /* ignore */ }
    return { ok: true };
  },

  // ---- groups
  'groups:list': () => groupsWithCounts(),
  'groups:create': (req) => {
    const st = s();
    const g = { id: `g-${mockId().slice(-6)}`, name: req.name.trim() || 'Untitled', color: req.color ?? 'gray', icon: req.icon ?? null, sortOrder: st.groups.length, createdAt: Date.now() };
    st.groups.push(g);
    emit('groups:changed', { ids: [g.id] });
    return { ...g, clipCount: 0 };
  },
  'groups:update': (req) => {
    const g = s().groups.find((x) => x.id === req.id);
    if (!g) throw new Error('mock: group not found');
    if (req.name !== undefined) g.name = req.name;
    if (req.color !== undefined) g.color = req.color;
    if (req.icon !== undefined) g.icon = req.icon;
    emit('groups:changed', { ids: [g.id] });
    return groupsWithCounts().find((x) => x.id === g.id)!;
  },
  'groups:delete': (req) => {
    const st = s();
    st.groups = st.groups.filter((g) => g.id !== req.id);
    for (const c of st.clips) c.groupIds = c.groupIds.filter((g) => g !== req.id);
    emit('groups:changed', { ids: [req.id] });
    emit('clips:changed', { reason: 'updated', ids: [] });
    return { ok: true };
  },
  'groups:reorder': (req) => {
    const st = s();
    req.ids.forEach((id, i) => { const g = st.groups.find((x) => x.id === id); if (g) g.sortOrder = i; });
    emit('groups:changed', { ids: req.ids });
    return groupsWithCounts();
  },

  // ---- snippets
  'snippets:list': (req) => {
    const q = (req.query ?? '').trim().toLowerCase();
    const all = [...s().snippets].sort((a, b) => a.sortOrder - b.sortOrder);
    if (!q) return all;
    return all.filter((sn) => `${sn.title}\n${sn.keyword ?? ''}\n${sn.body}`.toLowerCase().includes(q) || subsequenceScore(q, sn.title) > q.length * 1.6);
  },
  'snippets:create': (req) => {
    const st = s();
    const now = Date.now();
    const sn: Snippet = { id: `s-${mockId().slice(-8)}`, title: req.title, body: req.body, keyword: req.keyword ?? null, groupId: req.groupId ?? null, sortOrder: st.snippets.length, usageCount: 0, createdAt: now, updatedAt: now };
    st.snippets.push(sn);
    emit('snippets:changed', { ids: [sn.id] });
    return { ...sn };
  },
  'snippets:update': (req) => {
    const sn = s().snippets.find((x) => x.id === req.id);
    if (!sn) throw new Error('mock: snippet not found');
    if (req.title !== undefined) sn.title = req.title;
    if (req.body !== undefined) sn.body = req.body;
    if (req.keyword !== undefined) sn.keyword = req.keyword;
    if (req.groupId !== undefined) sn.groupId = req.groupId;
    sn.updatedAt = Date.now();
    emit('snippets:changed', { ids: [sn.id] });
    return { ...sn };
  },
  'snippets:delete': (req) => {
    const st = s();
    st.snippets = st.snippets.filter((x) => x.id !== req.id);
    emit('snippets:changed', { ids: [req.id] });
    return { ok: true };
  },

  // ---- paste
  'paste:perform': async (req) => {
    const st = s();
    await sleep(30);
    let ids: string[] = [];
    let text = '';
    if (req.type === 'clip') { ids = [req.clipId]; text = pasteText(ids, '', req.transform); }
    else if (req.type === 'clips') { ids = req.clipIds; text = pasteText(ids, req.separator ?? st.settings.general.mergeSeparator, req.transform); }
    else if (req.type === 'snippet') {
      const sn = st.snippets.find((x) => x.id === req.snippetId);
      if (!sn) return { ok: false, error: 'not-found' };
      sn.usageCount++;
      text = sn.body;
    } else text = req.text;
    st.clipboard = text;
    if (st.accessibilityTrusted === false) {
      return { ok: false, error: 'accessibility', message: 'Tuck needs Accessibility permission to paste. The clip is on your clipboard.' };
    }
    const now = Date.now();
    for (const id of ids) {
      const c = st.clips.find((x) => x.id === id);
      if (c) { c.lastPastedAt = now; if (st.settings.general.moveToTopOnPaste) c.updatedAt = now; }
    }
    if (ids.length) emit('clips:changed', { reason: 'pasted', ids });
    const label = text.replace(/\s+/g, ' ').trim().slice(0, 48);
    emit('app:notify', { level: 'success', message: `Mock paste: “${label}${text.length > 48 ? '…' : ''}”`, durationMs: 2200 });
    emit('popup:hidden', { reason: 'paste' });
    return { ok: true };
  },

  // ---- popup
  'popup:ready': () => {
    setTimeout(() => emit('popup:shown', { trigger: 'api' }), 30);
  },
  'popup:hide': (req) => {
    emit('popup:hidden', { reason: req.reason });
    // In the browser there is no window to hide: "re-show" shortly after so the UI stays usable.
    if (req.reason === 'escape' || req.reason === 'action') {
      emit('app:notify', { level: 'info', message: 'Mock: popup hidden — showing again', durationMs: 1400 });
      setTimeout(() => emit('popup:shown', { trigger: 'hotkey' }), 500);
    }
  },
  'popup:setLayout': () => {},

  // ---- settings
  'settings:get': () => structuredClone(s().settings),
  'settings:set': (patch: DeepPartial<Settings>) => {
    const st = s();
    st.settings = sanitize(deepMerge(st.settings, patch));
    emit('settings:changed', structuredClone(st.settings));
    return structuredClone(st.settings);
  },
  'settings:reset': () => {
    const st = s();
    st.settings = defaultSettings(platform);
    st.shortcutErrors = {};
    emit('settings:changed', structuredClone(st.settings));
    emit('shortcuts:changed', shortcutStatuses());
    return structuredClone(st.settings);
  },
  'settings:openWindow': (req) => {
    const url = `${location.pathname}#/settings`;
    if (windowKind === 'settings') emit('settings:navigate', { section: req.section ?? 'general' });
    else window.open(url, 'tuck-settings', 'width=920,height=640');
  },
  'settings:closeWindow': () => {},

  // ---- shortcuts
  'shortcuts:status': () => shortcutStatuses(),
  'shortcuts:set': (req) => {
    const st = s();
    const current = (): ShortcutStatus => shortcutStatuses().find((x) => x.id === req.id)!;
    const v = validate(req.accelerator, platform);
    if (!v.ok) return { ok: false, status: current(), error: 'invalid', message: v.reason };
    const accel = normalize(req.accelerator, platform) ?? req.accelerator;
    const other = (Object.keys(st.settings.shortcuts) as ShortcutId[]).find((id) => id !== req.id && accel !== '' && st.settings.shortcuts[id] === accel);
    if (other) return { ok: false, status: current(), error: 'conflict-internal', message: `Already used by another Tuck shortcut` };
    if (SYSTEM_TAKEN.has(accel)) return { ok: false, status: current(), error: 'conflict-system', message: 'Already in use by another app' };
    st.settings.shortcuts[req.id] = accel;
    delete st.shortcutErrors[req.id];
    const statuses = shortcutStatuses();
    emit('shortcuts:changed', statuses);
    emit('settings:changed', structuredClone(st.settings));
    return { ok: true, status: statuses.find((x) => x.id === req.id)! };
  },
  'shortcuts:setRecording': () => {},

  // ---- capture
  'capture:getState': () => ({ ...s().capture }),
  'capture:setPaused': (req) => {
    const st = s();
    st.capture = { paused: req.paused, pausedAt: req.paused ? Date.now() : null };
    emit('capture:changed', { ...st.capture });
    return { ...st.capture };
  },

  // ---- data
  'data:export': async (req) => {
    await sleep(500);
    const n = s().clips.length;
    return { ok: true, canceled: false, path: platform === 'darwin' ? '/Users/alex/Desktop/tuck-export.json' : 'C:\\Users\\alex\\Desktop\\tuck-export.json', clips: req.includeImages ? n : n - s().images.size };
  },
  'data:import': async () => {
    await sleep(700);
    for (let i = 0; i < 3; i++) newClipText(`Imported clip ${i + 1} from Tuck export`);
    emit('clips:changed', { reason: 'imported', ids: [] });
    return { ok: true, canceled: false, imported: 3, skipped: 12, groups: 1, snippets: 0 };
  },
  'stats:get': () => {
    const st = s();
    const imgs = st.clips.filter((c) => c.kind === 'image');
    return {
      totalClips: st.clips.length,
      pinnedClips: st.clips.filter((c) => c.pinned).length,
      imageClips: imgs.length,
      dbBytes: st.clips.reduce((n, c) => n + (c.kind === 'image' ? 512 : c.byteSize), 0) + 96 * 1024,
      imagesBytes: imgs.reduce((n, c) => n + (c.image?.bytes ?? 0), 0),
      oldestAt: st.clips.reduce<number | null>((m, c) => (m === null || c.createdAt < m ? c.createdAt : m), null),
    };
  },

  // ---- Ditto
  'data:detectDitto': async () => {
    await sleep(250);
    return { found: platform === 'win32', path: platform === 'win32' ? 'C:\\Users\\alex\\AppData\\Roaming\\Ditto\\Ditto.db' : null };
  },
  'data:pickDittoFile': async () => {
    await sleep(300);
    return { canceled: false, path: platform === 'darwin' ? '/Users/alex/Downloads/Ditto.zdb' : 'E:\\Backups\\Ditto.zdb' };
  },
  'data:inspectDitto': async (req) => {
    await sleep(650);
    if (/\.txt$/i.test(req.path)) return { ok: false, path: req.path, clips: 0, groups: 0, pinned: 0, error: 'unrecognized' };
    return { ok: true, path: req.path, clips: 7342, groups: 6, pinned: 41 };
  },
  'data:importDitto': async (req) => {
    if (importRunning) return { ok: false, canceled: false, imported: 0, merged: 0, skipped: 0, groups: 0, images: 0, error: 'unknown', message: 'An import is already running' };
    importRunning = true;
    try {
      const total = 7342;
      for (let done = 0; done < total; done = Math.min(total, done + 200)) {
        emit('data:importProgress', { source: 'ditto', done, total });
        await sleep(90);
      }
      emit('data:importProgress', { source: 'ditto', done: total, total });
      const st = s();
      if (req.includeGroups && !st.groups.some((g) => g.name === 'Ditto: Templates')) {
        st.groups.push({ id: 'g-ditto', name: 'Ditto: Templates', color: 'orange', icon: null, sortOrder: st.groups.length, createdAt: Date.now() });
      }
      DITTO_SAMPLE_TEXTS.forEach((t, i) => {
        const c = buildClipFromText(mockId(), t, Date.now() - (40 + i * 3) * 86_400_000, { groupIds: req.includeGroups && i === 5 ? ['g-ditto'] : [] });
        st.clips.push(c);
      });
      st.clips.sort((a, b) => b.updatedAt - a.updatedAt);
      emit('clips:changed', { reason: 'imported', ids: [] });
      emit('groups:changed', { ids: [] });
      return { ok: true, canceled: false, imported: 7105, merged: 188, skipped: 49, groups: req.includeGroups ? 6 : 0, images: req.includeImages ? 312 : 0 };
    } finally {
      importRunning = false;
    }
  },

  // ---- app
  'app:getInfo': () => ({
    name: 'Tuck', version: '0.1.0', platform, arch: 'x64', electron: '44.9.0', chrome: '146.0.7520.0', node: '24.22.0',
    isPackaged: false,
    userDataPath: platform === 'darwin' ? '/Users/alex/Library/Application Support/Tuck' : 'C:\\Users\\alex\\AppData\\Roaming\\Tuck',
    dbPath: platform === 'darwin' ? '/Users/alex/Library/Application Support/Tuck/tuck.db' : 'C:\\Users\\alex\\AppData\\Roaming\\Tuck\\tuck.db',
    imagesPath: platform === 'darwin' ? '/Users/alex/Library/Application Support/Tuck/images' : 'C:\\Users\\alex\\AppData\\Roaming\\Tuck\\images',
    accessibilityTrusted: s().accessibilityTrusted,
    launchAtLoginSupported: false,
  }),
  'app:openExternal': (req) => { window.open(req.url, '_blank', 'noopener'); },
  'app:revealPath': (req) => { emit('app:notify', { level: 'info', message: `Mock: reveal ${req.path}` }); },
  'app:requestAccessibility': async () => {
    await sleep(400);
    const st = s();
    if (st.accessibilityTrusted === false) st.accessibilityTrusted = true;
    return { trusted: s().accessibilityTrusted !== false };
  },
  'app:quit': () => { emit('app:notify', { level: 'info', message: 'Mock: quit' }); },
  'app:relaunch': () => { location.reload(); },
};

// ------------------------------------------------------------------ public api

export const mockApi: TuckApi = {
  platform,
  windowKind,
  invoke: (async (channel: InvokeChannel, ...args: unknown[]) => {
    const fn = handlers[channel] as ((req: unknown) => unknown) | undefined;
    if (!fn) throw new Error(`mockApi: unknown channel "${channel}"`);
    await sleep(4 + Math.random() * 10);
    return structuredCloneSafe(await fn(args[0]));
  }) as TuckApi['invoke'],
  on: (channel, listener) => {
    let set = listeners.get(channel);
    if (!set) { set = new Set(); listeners.set(channel, set); }
    const l = listener as Listener;
    set.add(l);
    return () => { set.delete(l); };
  },
};

function structuredCloneSafe<T>(v: T): T {
  return v === undefined ? v : structuredClone(v);
}

/** Image source for the mock; falls back to the tuck:// url for unknown ids. */
export function mockImageUrl(id: string, variant: 'full' | 'thumb'): string {
  const info = s().images.get(id);
  const clip = s().clips.find((c) => c.id === id);
  if (!info || !clip?.image) return imageUrl(id, variant);
  const { width, height, thumbWidth, thumbHeight } = clip.image;
  const scale = variant === 'full' ? Math.min(1, 1280 / Math.max(width, height)) : 1;
  const w = variant === 'full' ? width * scale : thumbWidth * 2;
  const h = variant === 'full' ? height * scale : thumbHeight * 2;
  return renderMockImage(`${id}:${variant}`, info.style, w, h);
}

// Dev helpers for poking the mock from the browser console.
if (typeof window !== 'undefined' && !window.api) {
  (window as unknown as { tuckMock: unknown }).tuckMock = {
    addClip: (text: string, app = 'Code.exe') => newClipText(text, app),
    showPopup: () => emit('popup:shown', { trigger: 'hotkey' }),
    setPaused: (paused: boolean) => handlers['capture:setPaused']({ paused }),
    setAccessibility: (trusted: boolean) => { s().accessibilityTrusted = trusted; },
    notify: (message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') => emit('app:notify', { level, message }),
    state: () => s(),
  };
}
