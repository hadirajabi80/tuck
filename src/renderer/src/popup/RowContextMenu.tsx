import {
  ClipboardCopy, CornerDownLeft, ExternalLink, FolderOpen, Layers, Pencil, Pin, PinOff, ScrollText, Trash2, Type, WandSparkles,
} from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { TRANSFORMS, type ClipSummary } from '@shared/types';
import { api } from '@/lib/api';
import { comboParts } from '@/lib/keys';
import { plural } from '@/lib/format';
import { ContextMenu } from '@/components/ContextMenu';
import type { MenuItem } from '@/components/Menu';
import { groupColorVar, useGroups } from '@/store/groupsStore';
import { findClip, targetIds, usePopup } from '@/store/popupStore';
import { useSettings } from '@/store/settingsStore';

const TEXT_KINDS = new Set(['text', 'link', 'color', 'code']);

/** Collections submenu / GroupMenu items for one clip. */
export function useGroupItems(clip: ClipSummary | undefined): MenuItem[] {
  const groups = useGroups((s) => s.groups);
  const createGroup = useGroups((s) => s.create);
  const setClipGroups = usePopup((s) => s.setClipGroups);
  return useMemo<MenuItem[]>(() => {
    if (!clip) return [];
    const items: MenuItem[] = groups.map((g) => ({
      type: 'checkbox',
      id: g.id,
      label: g.name,
      dot: groupColorVar(g.color),
      checked: clip.groupIds.includes(g.id),
      keepOpen: true,
      onSelect: () => {
        const cur = usePopup.getState();
        const latest = findClip(cur, clip.id) ?? clip;
        const next = latest.groupIds.includes(g.id) ? latest.groupIds.filter((x) => x !== g.id) : [...latest.groupIds, g.id];
        void setClipGroups(clip.id, next);
      },
    }));
    if (items.length) items.push({ type: 'separator', id: 'sep-new' });
    items.push({
      type: 'create', id: 'new', label: 'New collection…', placeholder: 'Collection name',
      onCreate: (name) => {
        void createGroup(name).then((g) => {
          if (!g) return;
          const latest = findClip(usePopup.getState(), clip.id) ?? clip;
          void setClipGroups(clip.id, [...latest.groupIds, g.id]);
        });
      },
    });
    return items;
  }, [clip, groups, createGroup, setClipGroups]);
}

export function RowContextMenu() {
  const menu = usePopup((s) => s.menu);
  const clip = usePopup((s) => (s.menu.kind === 'context' ? findClip(s, s.menu.id) : undefined));
  const multi = usePopup((s) => s.multi);
  const rows = usePopup((s) => s.rows);
  const selectedId = usePopup((s) => s.selectedId);
  const multiIds = useMemo(() => (multi.size > 1 ? targetIds({ rows, multi, selectedId }) : []), [multi, rows, selectedId]);
  const closeMenu = usePopup((s) => s.closeMenu);
  const imagesPath = useSettings((s) => s.appInfo?.imagesPath);
  const groupItems = useGroupItems(clip);
  const platform = api.platform;
  const k = useCallback((c: string) => comboParts(c, platform), [platform]);

  const items = useMemo<MenuItem[]>(() => {
    const st = () => usePopup.getState();
    if (!clip) return [];
    if (multiIds.length > 1 && multiIds.includes(clip.id)) {
      const n = multiIds.length;
      return [
        { id: 'paste', label: `Paste ${n} merged`, icon: CornerDownLeft, shortcut: ['↵'], onSelect: () => void st().paste() },
        { id: 'plain', label: 'Paste merged as plain text', icon: Type, shortcut: k('shift+enter'), onSelect: () => void st().paste({ plain: true }) },
        { id: 'pasteAs', type: 'submenu', label: 'Paste merged as', icon: WandSparkles, items: TRANSFORMS.map((t) => ({ id: t.id, label: t.label, accessKey: t.key, onSelect: () => void st().paste({ transform: t.id }) })) },
        { type: 'separator', id: 's1' },
        { id: 'delete', label: `Delete ${plural(n, 'clip')}`, icon: Trash2, danger: true, shortcut: platform === 'darwin' ? ['⌘', '⌫'] : ['Del'], onSelect: () => void st().remove() },
      ];
    }
    const textual = TEXT_KINDS.has(clip.kind);
    const items: MenuItem[] = [
      { id: 'paste', label: 'Paste', icon: CornerDownLeft, shortcut: ['↵'], onSelect: () => void st().paste({ id: clip.id }) },
    ];
    if (textual) {
      items.push(
        { id: 'plain', label: 'Paste as plain text', icon: Type, shortcut: k('shift+enter'), onSelect: () => void st().paste({ id: clip.id, plain: true }) },
        { id: 'pasteAs', type: 'submenu', label: 'Paste as', icon: WandSparkles, items: TRANSFORMS.map((t) => ({ id: t.id, label: t.label, accessKey: t.key, onSelect: () => void st().paste({ id: clip.id, transform: t.id }) })) },
      );
    }
    items.push(
      { type: 'separator', id: 's1' },
      { id: 'copy', label: 'Copy', icon: ClipboardCopy, shortcut: k('mod+c'), onSelect: () => void st().copy(clip.id) },
      { id: 'pin', label: clip.pinned ? 'Unpin' : 'Pin', icon: clip.pinned ? PinOff : Pin, shortcut: k('mod+p'), onSelect: () => void st().pin(clip.id) },
      { id: 'groups', type: 'submenu', label: 'Add to collection', icon: Layers, items: groupItems },
    );
    if (textual) {
      items.push(
        { type: 'separator', id: 's2' },
        { id: 'edit', label: 'Edit…', icon: Pencil, shortcut: k('mod+e'), onSelect: () => st().startEdit() },
        { id: 'snippet', label: 'Save as snippet…', icon: ScrollText, shortcut: k('mod+s'), onSelect: () => { if (!st().previewVisible) st().togglePreview(); usePopup.setState({ editing: 'saveSnippet' }); } },
      );
    }
    if (clip.kind === 'link' && clip.meta.url) {
      const url = clip.meta.url;
      items.push({ id: 'open', label: 'Open link', icon: ExternalLink, onSelect: () => void api.invoke('app:openExternal', { url }) });
    } else if (clip.kind === 'files' && clip.files?.[0]) {
      const path = clip.files[0];
      items.push({ id: 'reveal', label: platform === 'darwin' ? 'Reveal in Finder' : 'Show in Explorer', icon: FolderOpen, onSelect: () => void api.invoke('app:revealPath', { path }) });
    } else if (clip.kind === 'image' && clip.image && imagesPath) {
      const sep = platform === 'win32' ? '\\' : '/';
      const path = `${imagesPath}${sep}${clip.image.file}`;
      items.push({ id: 'reveal', label: platform === 'darwin' ? 'Reveal image in Finder' : 'Show image in Explorer', icon: FolderOpen, onSelect: () => void api.invoke('app:revealPath', { path }) });
    }
    items.push(
      { type: 'separator', id: 's3' },
      { id: 'delete', label: 'Delete', icon: Trash2, danger: true, shortcut: platform === 'darwin' ? ['⌘', '⌫'] : ['Del'], onSelect: () => void st().remove([clip.id]) },
    );
    return items;
  }, [clip, multiIds, groupItems, imagesPath, k, platform]);

  const onClose = useCallback(() => closeMenu(), [closeMenu]);
  if (menu.kind !== 'context' || !clip) return null;
  return <ContextMenu x={menu.x} y={menu.y} items={items} label="Clip actions" onClose={onClose} />;
}
