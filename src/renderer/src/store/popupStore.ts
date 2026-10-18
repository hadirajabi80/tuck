// Popup state (DESIGN.md §E "State"). Lists are fetched from main in pages; every request carries a
// requestId and stale responses are dropped. Selection is restored by id after each refresh.
import { create } from 'zustand';
import type {
  Clip, ClipFilterId, ClipSummary, FilterId, PasteRequest, PasteResult, PopupShownEvent, Snippet, SnippetInput, TransformId,
} from '@shared/types';
import { LIMITS } from '@shared/types';
import { api } from '@/lib/api';
import { focusSearch } from '@/lib/focus';
import { buildRows, moveId, rangeIds, selectableIds, type ListRow } from '@/lib/sections';
import { plural } from '@/lib/format';
import { useSettings } from './settingsStore';
import { toast } from './toastStore';

export const FILTERS: ReadonlyArray<{ id: FilterId; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pinned', label: 'Pinned' },
  { id: 'text', label: 'Text' },
  { id: 'images', label: 'Images' },
  { id: 'links', label: 'Links' },
  { id: 'files', label: 'Files' },
  { id: 'colors', label: 'Colors' },
  { id: 'code', label: 'Code' },
  { id: 'snippets', label: 'Snippets' },
];

export type MenuState =
  | { kind: 'none' }
  | { kind: 'context'; x: number; y: number; id: string }
  | { kind: 'transform' }
  | { kind: 'group' }
  | { kind: 'collections' }
  | { kind: 'help' };

export type EditingState = null | 'clip' | 'snippet' | 'newSnippet' | 'saveSnippet';

const PAGE = LIMITS.listPageSize;
const PINNED_LIMIT = 50;

export interface PopupState {
  query: string;
  filter: FilterId;
  groupId: string | null;
  items: ClipSummary[];
  pinned: ClipSummary[];
  total: number;
  pinnedTotal: number;
  snippets: Snippet[];
  loading: boolean;
  loadingMore: boolean;
  /** Set once the first response arrives (avoids flashing empty states). */
  loaded: boolean;
  requestId: number;
  rows: ListRow[];
  selectedId: string | null;
  multi: Set<string>;
  anchorId: string | null;
  removing: Set<string>;
  previewVisible: boolean;
  editing: EditingState;
  menu: MenuState;
  lastTransform: TransformId | null;
  modifierHeld: boolean;
  /** First (up to) 9 selectable ids in the viewport — quick-paste targets. */
  quickIds: string[];
  /** Bumped to ask the list to scroll to the top (popup shown, filter change). */
  scrollNonce: number;
  detail: Clip | null;
  accessibilityNeeded: boolean;
  lastDeletedSnippet: Snippet | null;

  setQuery: (q: string) => void;
  setFilter: (f: FilterId) => void;
  cycleFilter: (dir: 1 | -1) => void;
  setGroup: (id: string | null) => void;
  refresh: (opts?: { keepCount?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  moveSelection: (delta: number, extend?: boolean) => void;
  selectEdge: (edge: 'first' | 'last') => void;
  select: (id: string, mode?: 'single' | 'toggle' | 'range') => void;
  toggleMulti: () => void;
  selectAll: () => void;
  clearMulti: () => void;
  paste: (opts?: { plain?: boolean; transform?: TransformId | null; id?: string }) => Promise<void>;
  quickPaste: (n: number) => Promise<void>;
  copy: (id?: string) => Promise<void>;
  pin: (id?: string) => Promise<void>;
  remove: (ids?: string[]) => Promise<void>;
  undo: () => Promise<void>;
  startEdit: () => void;
  cancelEdit: () => void;
  saveEdit: (text: string) => Promise<void>;
  saveAsSnippet: (title: string, keyword?: string | null) => Promise<void>;
  saveSnippet: (id: string | null, input: SnippetInput) => Promise<void>;
  newSnippet: () => void;
  togglePreview: () => void;
  openMenu: (m: MenuState) => void;
  closeMenu: () => void;
  setModifierHeld: (held: boolean) => void;
  setQuickIds: (ids: string[]) => void;
  setClipGroups: (id: string, groupIds: string[]) => Promise<void>;
  onShown: (e: PopupShownEvent) => void;
}

// ---------------------------------------------------------------- helpers

let reqCounter = 0;
let detailReq = 0;
let queryTimer: ReturnType<typeof setTimeout> | null = null;
let changeTimer: ReturnType<typeof setTimeout> | null = null;
/** Set by setQuery: the next list response selects its first row and scrolls to the top. */
let resetSelectionOnNext = false;

function computeRows(s: Pick<PopupState, 'filter' | 'query' | 'pinned' | 'items' | 'snippets'>): ListRow[] {
  return buildRows({ filter: s.filter, query: s.query, pinned: s.pinned, items: s.items, snippets: s.snippets });
}

function idsOf(s: Pick<PopupState, 'rows'>): string[] {
  return selectableIds(s.rows);
}

export function findClip(s: Pick<PopupState, 'items' | 'pinned'>, id: string | null): ClipSummary | undefined {
  if (!id) return undefined;
  return s.pinned.find((c) => c.id === id) ?? s.items.find((c) => c.id === id);
}

export function findSnippet(s: Pick<PopupState, 'snippets'>, id: string | null): Snippet | undefined {
  return id ? s.snippets.find((x) => x.id === id) : undefined;
}

/** Ids the next action applies to: the multi-selection in display order, else the selected row. */
export function targetIds(s: Pick<PopupState, 'rows' | 'multi' | 'selectedId'>): string[] {
  if (s.multi.size) return idsOf(s).filter((id) => s.multi.has(id));
  return s.selectedId ? [s.selectedId] : [];
}

const TEXT_KINDS = new Set(['text', 'link', 'color', 'code']);

function pasteErrorMessage(r: PasteResult): string {
  switch (r.error) {
    case 'accessibility': return 'Copied to clipboard — allow Tuck under Accessibility to paste automatically.';
    case 'not-found': return 'That clip no longer exists.';
    case 'clipboard': return 'Couldn’t write to the clipboard. Try again.';
    case 'keystroke': return 'Copied to clipboard — couldn’t send the paste keystroke. Paste manually.';
    default: return r.message || 'Paste failed.';
  }
}

async function loadDetail(id: string | null): Promise<void> {
  const my = ++detailReq;
  const st = usePopup.getState();
  if (!id || st.filter === 'snippets') {
    if (st.detail) usePopup.setState({ detail: null });
    return;
  }
  const summary = findClip(st, id);
  if (!summary) return;
  if (st.detail?.id === id && st.detail.updatedAt === summary.updatedAt && st.detail.pinned === summary.pinned && st.detail.groupIds.join() === summary.groupIds.join()) return;
  try {
    const clip = await api.invoke('clips:get', { id });
    if (my !== detailReq) return;
    usePopup.setState({ detail: clip });
  } catch (err) {
    console.error('[tuck] clips:get failed', err);
  }
}

// ---------------------------------------------------------------- store

export const usePopup = create<PopupState>((set, get) => {
  /** Applies new lists + restores selection by id. */
  const applyLists = (patch: Partial<PopupState>) => {
    const s = { ...get(), ...patch };
    const rows = computeRows(s);
    const ids = selectableIds(rows);
    const idSet = new Set(ids);
    let selectedId = s.selectedId && idSet.has(s.selectedId) ? s.selectedId : (ids[0] ?? null);
    if (s.editing === 'newSnippet') selectedId = s.selectedId;
    const multi = new Set([...s.multi].filter((id) => idSet.has(id)));
    set({ ...patch, rows, selectedId, multi });
    void loadDetail(selectedId);
  };

  const takeReset = (): Partial<PopupState> => {
    if (!resetSelectionOnNext) return {};
    resetSelectionOnNext = false;
    return { selectedId: null, scrollNonce: get().scrollNonce + 1 };
  };

  const scheduleRefresh = (ms: number, keepCount = false) => {
    if (queryTimer) clearTimeout(queryTimer);
    queryTimer = setTimeout(() => void get().refresh({ keepCount }), ms);
  };

  return {
    query: '',
    filter: 'all',
    groupId: null,
    items: [],
    pinned: [],
    total: 0,
    pinnedTotal: 0,
    snippets: [],
    loading: false,
    loadingMore: false,
    loaded: false,
    requestId: 0,
    rows: [],
    selectedId: null,
    multi: new Set(),
    anchorId: null,
    removing: new Set(),
    previewVisible: true,
    editing: null,
    menu: { kind: 'none' },
    lastTransform: null,
    modifierHeld: false,
    quickIds: [],
    scrollNonce: 0,
    detail: null,
    accessibilityNeeded: false,
    lastDeletedSnippet: null,

    setQuery: (query) => {
      resetSelectionOnNext = true;
      set({ query, multi: new Set() });
      scheduleRefresh(40);
    },

    setFilter: (filter) => {
      if (filter === get().filter) return;
      set({ filter, selectedId: null, multi: new Set(), editing: null, scrollNonce: get().scrollNonce + 1, detail: null, loaded: false });
      applyLists({ items: [], pinned: [], total: 0, pinnedTotal: 0 });
      scheduleRefresh(0);
    },

    cycleFilter: (dir) => {
      const i = FILTERS.findIndex((f) => f.id === get().filter);
      const next = FILTERS[(i + dir + FILTERS.length) % FILTERS.length]!;
      get().setFilter(next.id);
    },

    setGroup: (groupId) => {
      set({ groupId, selectedId: null, multi: new Set(), scrollNonce: get().scrollNonce + 1 });
      if (get().filter === 'snippets') set({ filter: 'all' });
      scheduleRefresh(0);
    },

    refresh: async ({ keepCount = false } = {}) => {
      const id = ++reqCounter;
      const { filter, query, groupId, items } = get();
      set({ requestId: id, loading: true });
      try {
        if (filter === 'snippets') {
          const snippets = await api.invoke('snippets:list', { query });
          if (id !== reqCounter) return;
          applyLists({ ...takeReset(), snippets, items: [], pinned: [], total: snippets.length, pinnedTotal: 0, loading: false, loaded: true });
          return;
        }
        const limit = keepCount ? Math.min(500, Math.max(PAGE, items.length)) : PAGE;
        if (filter === 'all') {
          const [p, r] = await Promise.all([
            api.invoke('clips:list', { filter: 'pinned', groupId, query, offset: 0, limit: PINNED_LIMIT }),
            api.invoke('clips:list', { filter: 'all', groupId, query, offset: 0, limit, excludePinned: true }),
          ]);
          if (id !== reqCounter) return;
          applyLists({ ...takeReset(), pinned: p.items, pinnedTotal: p.total, items: r.items, total: r.total, loading: false, loaded: true });
        } else {
          const r = await api.invoke('clips:list', { filter: filter as ClipFilterId, groupId, query, offset: 0, limit });
          if (id !== reqCounter) return;
          applyLists({ ...takeReset(), pinned: [], pinnedTotal: 0, items: r.items, total: r.total, loading: false, loaded: true });
        }
      } catch (err) {
        if (id !== reqCounter) return;
        console.error('[tuck] refresh failed', err);
        set({ loading: false, loaded: true });
        toast('Couldn’t load your clips', 'error');
      }
    },

    loadMore: async () => {
      const s = get();
      if (s.loadingMore || s.loading || s.filter === 'snippets' || s.items.length >= s.total) return;
      const id = reqCounter;
      set({ loadingMore: true });
      try {
        const q = { filter: (s.filter === 'all' ? 'all' : s.filter) as ClipFilterId, groupId: s.groupId, query: s.query, offset: s.items.length, limit: PAGE, excludePinned: s.filter === 'all' };
        const r = await api.invoke('clips:list', q);
        if (id !== reqCounter) return;
        const known = new Set(get().items.map((c) => c.id));
        applyLists({ items: [...get().items, ...r.items.filter((c) => !known.has(c.id))], total: r.total });
      } finally {
        set({ loadingMore: false });
      }
    },

    moveSelection: (delta, extend = false) => {
      const s = get();
      const ids = idsOf(s);
      const next = moveId(ids, s.selectedId, delta);
      if (!next) return;
      if (extend) {
        const anchor = (s.multi.size && s.anchorId) || s.selectedId || next;
        set({ selectedId: next, anchorId: anchor, multi: new Set(rangeIds(ids, anchor, next)) });
      } else {
        set({ selectedId: next, anchorId: next });
      }
      void loadDetail(next);
    },

    selectEdge: (edge) => {
      const ids = idsOf(get());
      const id = edge === 'first' ? ids[0] : ids[ids.length - 1];
      if (id) { set({ selectedId: id, anchorId: id }); void loadDetail(id); }
    },

    select: (id, mode = 'single') => {
      const s = get();
      if (mode === 'single') {
        set({ selectedId: id, anchorId: id, multi: new Set() });
      } else if (mode === 'toggle') {
        const multi = new Set(s.multi);
        if (!multi.size && s.selectedId && s.selectedId !== id) multi.add(s.selectedId);
        if (multi.has(id)) multi.delete(id); else multi.add(id);
        set({ selectedId: id, anchorId: id, multi });
      } else {
        const anchor = s.anchorId ?? s.selectedId ?? id;
        set({ selectedId: id, multi: new Set(rangeIds(idsOf(s), anchor, id)) });
      }
      if (s.editing && s.editing !== 'newSnippet') set({ editing: null });
      void loadDetail(id);
    },

    toggleMulti: () => {
      const s = get();
      if (!s.selectedId) return;
      const multi = new Set(s.multi);
      if (multi.has(s.selectedId)) multi.delete(s.selectedId); else multi.add(s.selectedId);
      set({ multi, anchorId: s.selectedId });
    },

    selectAll: () => set({ multi: new Set(idsOf(get())) }),
    clearMulti: () => set({ multi: new Set() }),

    paste: async ({ plain = false, transform = null, id } = {}) => {
      const s = get();
      let req: PasteRequest;
      if (s.filter === 'snippets') {
        const sid = id ?? s.selectedId;
        if (!sid) return;
        req = { type: 'snippet', snippetId: sid };
      } else {
        const ids = id ? [id] : targetIds(s);
        if (!ids.length) return;
        const separator = useSettings.getState().settings?.general.mergeSeparator ?? '\n';
        req = ids.length > 1
          ? { type: 'clips', clipIds: ids, separator, plain, transform }
          : { type: 'clip', clipId: ids[0]!, plain, transform };
      }
      if (transform) set({ lastTransform: transform });
      try {
        const r = await api.invoke('paste:perform', req);
        if (!r.ok) {
          if (r.error === 'accessibility') {
            set({ accessibilityNeeded: true });
            toast(pasteErrorMessage(r), 'warning', { label: 'Grant', onClick: () => void requestAccessibility() }, 7000);
          } else {
            toast(pasteErrorMessage(r), r.error === 'keystroke' ? 'warning' : 'error');
            if (r.error === 'not-found') void get().refresh({ keepCount: true });
          }
        } else if (s.multi.size) {
          set({ multi: new Set() });
        }
      } catch (err) {
        console.error('[tuck] paste failed', err);
        toast('Paste failed.', 'error');
      }
    },

    quickPaste: async (n) => {
      const id = get().quickIds[n];
      if (id) await get().paste({ id });
    },

    copy: async (id) => {
      const s = get();
      const target = id ?? s.selectedId;
      if (!target) return;
      try {
        if (s.filter === 'snippets') {
          const sn = findSnippet(s, target);
          if (sn) await navigator.clipboard?.writeText(sn.body).catch(() => {});
        } else {
          await api.invoke('clips:copy', { id: target });
        }
        await api.invoke('popup:hide', { reason: 'action' });
      } catch {
        toast('Couldn’t copy to the clipboard', 'error');
      }
    },

    pin: async (id) => {
      const s = get();
      if (s.filter === 'snippets') return;
      const target = id ?? s.selectedId;
      const clip = findClip(s, target);
      if (!clip) return;
      const pinned = !clip.pinned;
      // optimistic
      const mark = (c: ClipSummary) => (c.id === clip.id ? { ...c, pinned, pinnedAt: pinned ? Date.now() : null } : c);
      applyLists({ items: s.items.map(mark), pinned: s.pinned.map(mark) });
      try {
        await api.invoke('clips:pin', { id: clip.id, pinned });
        scheduleRefresh(0, true);
      } catch {
        toast('Couldn’t update the pin', 'error');
        void get().refresh({ keepCount: true });
      }
    },

    remove: async (ids) => {
      const s = get();
      if (s.filter === 'snippets') {
        const sn = findSnippet(s, ids?.[0] ?? s.selectedId);
        if (!sn) return;
        const order = idsOf(s);
        const nextId = order[order.indexOf(sn.id) + 1] ?? order[order.indexOf(sn.id) - 1] ?? null;
        await api.invoke('snippets:delete', { id: sn.id });
        set({ lastDeletedSnippet: sn, selectedId: nextId, editing: null });
        toast(`Deleted “${sn.title}”`, 'info', { label: 'Undo', onClick: () => void get().undo() }, 6000);
        void get().refresh();
        return;
      }
      const targets = ids ?? targetIds(s);
      if (!targets.length) return;
      const order = idsOf(s);
      const targetSet = new Set(targets);
      const lastIdx = Math.max(...targets.map((t) => order.indexOf(t)));
      const after = order.slice(lastIdx + 1).find((x) => !targetSet.has(x)) ?? [...order].reverse().find((x) => !targetSet.has(x)) ?? null;
      set({ removing: new Set(targets), editing: null });
      await new Promise((r) => setTimeout(r, 120));
      try {
        const { deleted } = await api.invoke('clips:delete', { ids: targets });
        const items = get().items.filter((c) => !targetSet.has(c.id));
        const pinned = get().pinned.filter((c) => !targetSet.has(c.id));
        set({ selectedId: after, multi: new Set() });
        applyLists({ items, pinned, total: Math.max(0, get().total - deleted), removing: new Set() });
        toast(deleted === 1 ? 'Deleted' : `Deleted ${plural(deleted, 'clip')}`, 'info', { label: 'Undo', onClick: () => void get().undo() }, 6000);
      } catch {
        set({ removing: new Set() });
        toast('Couldn’t delete', 'error');
      }
    },

    undo: async () => {
      const s = get();
      if (s.lastDeletedSnippet) {
        const sn = s.lastDeletedSnippet;
        set({ lastDeletedSnippet: null });
        const created = await api.invoke('snippets:create', { title: sn.title, body: sn.body, keyword: sn.keyword, groupId: sn.groupId });
        if (get().filter === 'snippets') { set({ selectedId: created.id }); void get().refresh(); }
        toast('Snippet restored', 'success');
        return;
      }
      try {
        const { restored } = await api.invoke('clips:undoDelete');
        if (restored) {
          toast(restored === 1 ? 'Restored' : `Restored ${plural(restored, 'clip')}`, 'success');
          void get().refresh({ keepCount: true });
        } else {
          toast('Nothing to undo', 'info', undefined, 1600);
        }
      } catch {
        toast('Undo failed', 'error');
      }
    },

    startEdit: () => {
      const s = get();
      if (s.filter === 'snippets') {
        if (s.selectedId) set({ editing: 'snippet', menu: { kind: 'none' } });
        return;
      }
      const clip = findClip(s, s.selectedId);
      if (!clip) return;
      if (!TEXT_KINDS.has(clip.kind)) {
        toast(clip.kind === 'image' ? 'Images can’t be edited' : 'Only text clips can be edited', 'info', undefined, 2000);
        return;
      }
      if (!s.previewVisible) get().togglePreview();
      set({ editing: 'clip', menu: { kind: 'none' } });
    },

    cancelEdit: () => {
      const wasNew = get().editing === 'newSnippet';
      set({ editing: null });
      if (wasNew) applyLists({});
      focusSearch();
    },

    saveEdit: async (text) => {
      const s = get();
      const id = s.selectedId;
      if (!id) return;
      try {
        const clip = await api.invoke('clips:update', { id, text });
        set({ editing: null, detail: clip });
        toast('Saved', 'success', undefined, 1500);
        void get().refresh({ keepCount: true });
      } catch {
        toast('Couldn’t save the edit', 'error');
      }
      focusSearch();
    },

    saveAsSnippet: async (title, keyword = null) => {
      const s = get();
      const body = s.detail?.id === s.selectedId ? s.detail?.text : null;
      if (!body) { toast('Only text clips can become snippets', 'info'); set({ editing: null }); return; }
      try {
        await api.invoke('snippets:create', { title: title.trim() || body.slice(0, 40), body, keyword: keyword || null });
        set({ editing: null });
        toast('Saved as snippet', 'success', { label: 'Show', onClick: () => get().setFilter('snippets') });
      } catch {
        toast('Couldn’t save the snippet', 'error');
      }
      focusSearch();
    },

    saveSnippet: async (id, input) => {
      try {
        const sn = id ? await api.invoke('snippets:update', { id, ...input }) : await api.invoke('snippets:create', input);
        set({ editing: null, selectedId: sn.id });
        await get().refresh();
        set({ selectedId: sn.id });
        toast(id ? 'Snippet saved' : 'Snippet created', 'success', undefined, 1500);
      } catch {
        toast('Couldn’t save the snippet', 'error');
      }
      focusSearch();
    },

    newSnippet: () => {
      if (get().filter !== 'snippets') get().setFilter('snippets');
      if (!get().previewVisible) get().togglePreview();
      set({ editing: 'newSnippet', selectedId: null, menu: { kind: 'none' } });
    },

    togglePreview: () => {
      const previewVisible = !get().previewVisible;
      set({ previewVisible, editing: previewVisible ? get().editing : null });
      void api.invoke('popup:setLayout', { previewVisible }).catch(() => {});
      void useSettings.getState().set({ appearance: { previewVisible } });
    },

    openMenu: (menu) => set({ menu }),
    closeMenu: () => {
      set({ menu: { kind: 'none' } });
      focusSearch();
    },

    setModifierHeld: (modifierHeld) => { if (get().modifierHeld !== modifierHeld) set({ modifierHeld }); },
    setQuickIds: (quickIds) => {
      const prev = get().quickIds;
      if (prev.length === quickIds.length && prev.every((x, i) => x === quickIds[i])) return;
      set({ quickIds });
    },

    setClipGroups: async (id, groupIds) => {
      const s = get();
      const mark = (c: ClipSummary) => (c.id === id ? { ...c, groupIds } : c);
      applyLists({ items: s.items.map(mark), pinned: s.pinned.map(mark) });
      try {
        await api.invoke('clips:setGroups', { id, groupIds });
        if (s.groupId) scheduleRefresh(0, true);
      } catch {
        toast('Couldn’t update collections', 'error');
      }
    },

    onShown: (e) => {
      set({
        query: '', selectedId: null, multi: new Set(), anchorId: null, editing: null, menu: { kind: 'none' },
        modifierHeld: false, scrollNonce: get().scrollNonce + 1, removing: new Set(),
      });
      if (e.filter && e.filter !== get().filter) set({ filter: e.filter });
      void get().refresh();
      focusSearch();
    },
  };
});

async function requestAccessibility(): Promise<void> {
  try {
    const { trusted } = await api.invoke('app:requestAccessibility');
    usePopup.setState({ accessibilityNeeded: !trusted });
    void useSettings.getState().refreshAppInfo();
    if (trusted) toast('Accessibility granted — paste works now', 'success');
  } catch {
    /* ignore */
  }
}
export { requestAccessibility };

let subscribed = false;
/** Wires main events to the popup store (once). */
export function initPopupSync(): void {
  if (subscribed) return;
  subscribed = true;
  api.on('popup:shown', (e) => usePopup.getState().onShown(e));
  api.on('popup:hidden', () => usePopup.setState({ modifierHeld: false, menu: { kind: 'none' } }));
  const onChange = () => {
    if (changeTimer) clearTimeout(changeTimer);
    changeTimer = setTimeout(() => void usePopup.getState().refresh({ keepCount: true }), 50);
  };
  api.on('clips:changed', (e) => { if (usePopup.getState().filter !== 'snippets') onChange(); void e; });
  api.on('snippets:changed', () => { if (usePopup.getState().filter === 'snippets') onChange(); });
  api.on('app:notify', (n) => toast(n.message, n.level, undefined, n.durationMs));
  const prefs = useSettings.getState().settings;
  if (prefs) usePopup.setState({ previewVisible: prefs.appearance.previewVisible });
  // Take the persisted preview preference once settings arrive.
  const unsub = useSettings.subscribe((st) => {
    if (st.settings) {
      usePopup.setState({ previewVisible: st.settings.appearance.previewVisible });
      unsub();
    }
  });
  void usePopup.getState().refresh();
}

