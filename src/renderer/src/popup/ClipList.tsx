import { Filter, Image as ImageIcon, Layers, Pin, ScrollText, SearchX } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { pretty } from '@shared/accelerator';
import { api } from '@/lib/api';
import { comboLabel } from '@/lib/keys';
import type { ListRow } from '@/lib/sections';
import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { Kbd } from '@/components/Kbd';
import { Spinner } from '@/components/Spinner';
import { VirtualList, type VirtualListHandle } from '@/components/VirtualList';
import { useGroups } from '@/store/groupsStore';
import { usePopup } from '@/store/popupStore';
import { useSettings } from '@/store/settingsStore';
import { ClipRow } from './ClipRow';
import { SectionHeader } from './SectionHeader';
import { SnippetRow } from './SnippetRow';
import styles from './ClipList.module.css';

const HEADER_H = 24;

export function ClipList() {
  const rows = usePopup((s) => s.rows);
  const selectedId = usePopup((s) => s.selectedId);
  const multi = usePopup((s) => s.multi);
  const removing = usePopup((s) => s.removing);
  const scrollNonce = usePopup((s) => s.scrollNonce);
  const loaded = usePopup((s) => s.loaded);
  const loadingMore = usePopup((s) => s.loadingMore);
  const quickIds = usePopup((s) => s.quickIds);
  const modifierHeld = usePopup((s) => s.modifierHeld);
  const filter = usePopup((s) => s.filter);
  const query = usePopup((s) => s.query);
  const total = usePopup((s) => s.total);
  const density = useSettings((s) => s.settings?.appearance.density ?? 'comfortable');
  const badgeMode = useSettings((s) => s.settings?.appearance.showQuickPasteBadges ?? 'modifier');
  const showSourceApp = useSettings((s) => s.settings?.general.showSourceApp ?? true);
  const rowH = density === 'compact' ? 36 : 44;
  const listRef = useRef<VirtualListHandle>(null);
  const [range, setRange] = useState<[number, number]>([0, 0]);

  const itemHeight = useCallback((r: ListRow) => (r.type === 'header' ? HEADER_H : rowH), [rowH]);
  const isSticky = useCallback((r: ListRow) => r.type === 'header', []);
  const getKey = useCallback((r: ListRow) => r.id, []);

  // Keep the selection visible.
  useEffect(() => {
    if (!selectedId) return;
    const i = rows.findIndex((r) => r.id === selectedId);
    if (i >= 0) listRef.current?.scrollToIndex(i);
  }, [selectedId, rows]);

  useEffect(() => { listRef.current?.scrollToTop(); }, [scrollNonce]);

  // Quick-paste targets = first 9 selectable rows in the viewport.
  useEffect(() => {
    const ids: string[] = [];
    for (let i = range[0]; i < rows.length && ids.length < 9; i++) {
      const r = rows[i]!;
      if (i > range[1] + 1 && ids.length) break;
      if (r.type !== 'header') ids.push(r.id);
    }
    usePopup.getState().setQuickIds(ids);
  }, [rows, range]);

  const onRangeChange = useCallback((first: number, last: number) => setRange([first, last]), []);
  const onEndReached = useCallback(() => void usePopup.getState().loadMore(), []);

  const showBadges = badgeMode === 'always' || (badgeMode === 'modifier' && modifierHeld);
  const multiMode = multi.size > 0;
  const quickIndex = useMemo(() => new Map(quickIds.map((id, i) => [id, i])), [quickIds]);

  const onRowClick = useCallback((id: string, e: MouseEvent) => {
    const st = usePopup.getState();
    const mod = api.platform === 'darwin' ? e.metaKey : e.ctrlKey;
    if (e.altKey) { void openExternally(id); return; }
    st.select(id, e.shiftKey ? 'range' : mod ? 'toggle' : 'single');
  }, []);
  const onRowDoubleClick = useCallback((id: string) => void usePopup.getState().paste({ id }), []);
  const onRowContextMenu = useCallback((id: string, e: MouseEvent) => {
    e.preventDefault();
    const st = usePopup.getState();
    if (!st.multi.has(id)) st.select(id, 'single');
    st.openMenu({ kind: 'context', x: e.clientX, y: e.clientY, id });
  }, []);
  const onPin = useCallback((id: string) => void usePopup.getState().pin(id), []);

  const posInSet = useMemo(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const r of rows) if (r.type !== 'header') m.set(r.id, ++n);
    return { map: m, size: n };
  }, [rows]);

  const renderItem = useCallback(
    (r: ListRow, _i: number, style: React.CSSProperties) => {
      if (r.type === 'header') return <SectionHeader key={r.id} label={r.label} style={style} />;
      const q = quickIndex.get(r.id) ?? -1;
      const common = {
        style, selected: r.id === selectedId, multiSelected: multi.has(r.id), multiMode, quickIndex: q,
        showBadge: showBadges && q >= 0 && !multiMode, removing: removing.has(r.id),
        posInSet: posInSet.map.get(r.id) ?? 0, setSize: posInSet.size,
        onClick: onRowClick, onDoubleClick: onRowDoubleClick, onContextMenu: onRowContextMenu,
      };
      if (r.type === 'snippet') return <SnippetRow key={r.id} snippet={r.snippet} {...common} />;
      return <ClipRow key={r.id} clip={r.clip} showSourceApp={showSourceApp} onPin={onPin} {...common} />;
    },
    [quickIndex, selectedId, multi, multiMode, showBadges, removing, posInSet, onRowClick, onRowDoubleClick, onRowContextMenu, onPin, showSourceApp],
  );

  const renderSticky = useCallback((r: ListRow) => (r.type === 'header' ? <SectionHeader label={r.label} sticky /> : null), []);

  if (loaded && rows.length === 0) {
    return (
      <div className={styles.list} id="clip-list" role="listbox" aria-label="Clips">
        <ListEmpty filter={filter} query={query} />
      </div>
    );
  }

  return (
    <div className={styles.list}>
      <VirtualList
        ref={listRef}
        id="clip-list"
        role="listbox"
        aria-label={filter === 'snippets' ? 'Snippets' : 'Clips'}
        aria-multiselectable="true"
        items={rows}
        itemHeight={itemHeight}
        getKey={getKey}
        renderItem={renderItem}
        isSticky={isSticky}
        renderSticky={renderSticky}
        stickyHeight={HEADER_H}
        onEndReached={rows.length < total ? onEndReached : undefined}
        onRangeChange={onRangeChange}
        className={styles.scroller}
        footer={loadingMore ? <div className={styles.more}><Spinner size={12} /> Loading more…</div> : <div className={styles.endPad} />}
        footerHeight={loadingMore ? 32 : 6}
      />
    </div>
  );
}

async function openExternally(id: string): Promise<void> {
  const clip = await api.invoke('clips:get', { id });
  if (!clip) return;
  if (clip.kind === 'link' && clip.meta.url) await api.invoke('app:openExternal', { url: clip.meta.url });
  else if (clip.kind === 'files' && clip.files?.[0]) await api.invoke('app:revealPath', { path: clip.files[0] });
  else usePopup.getState().select(id, 'single');
}

function ListEmpty({ filter, query }: { filter: string; query: string }) {
  const groupId = usePopup((s) => s.groupId);
  const group = useGroups((s) => s.groups.find((g) => g.id === groupId));
  const setFilter = usePopup((s) => s.setFilter);
  const setGroup = usePopup((s) => s.setGroup);
  const settings = useSettings((s) => s.settings);
  const platform = api.platform;
  const mod = (c: string) => <Kbd parts={[comboLabel(c, platform)]} />;

  if (query.trim()) {
    const narrowed = filter !== 'all' || !!groupId;
    return (
      <EmptyState
        icon={SearchX}
        title={`No matches for “${query.trim()}”`}
        description={narrowed ? `Nothing in ${group ? group.name : 'this filter'} matches.` : 'Try a shorter or different search.'}
        action={narrowed ? <Button size="sm" icon={Filter} onClick={() => { setGroup(null); setFilter('all'); }}>Search all</Button> : undefined}
      />
    );
  }
  if (filter === 'snippets') return <EmptyState icon={ScrollText} title="No snippets yet" description={<>Create a snippet with {mod('mod+n')}.</>} />;
  if (groupId) return <EmptyState icon={Layers} title={group ? `${group.name} is empty` : 'This collection is empty'} description={<>Add clips with {mod('mod+g')}.</>} />;
  if (filter === 'pinned') return <EmptyState icon={Pin} title="No pinned clips" description={<>Pin clips you reuse with {mod('mod+p')}. Pinned clips never expire.</>} />;
  if (filter === 'images' && settings && !settings.history.captureImages) {
    return (
      <EmptyState
        icon={ImageIcon}
        title="Image capture is off"
        description="Enable it in Settings › History."
        action={<Button size="sm" onClick={() => void api.invoke('settings:openWindow', { section: 'history' })}>Open Settings</Button>}
      />
    );
  }
  if (filter !== 'all') {
    const names: Record<string, string> = { text: 'text', images: 'images', links: 'links', files: 'files', colors: 'colors', code: 'code' };
    return <EmptyState icon={Filter} title={`No ${names[filter] ?? 'clips'} yet`} description="Copied items of this kind show up here." />;
  }
  const hotkey = settings?.shortcuts.openPopup ? pretty(settings.shortcuts.openPopup, platform) : '';
  return (
    <EmptyState
      illustration
      title="Nothing tucked away yet"
      description={<>Copy anything — it shows up here.{hotkey && <> Press <Kbd parts={[hotkey]} /> any time.</>}</>}
    />
  );
}
