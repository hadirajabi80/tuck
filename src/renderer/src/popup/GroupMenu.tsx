import { useCallback, useMemo } from 'react';
import { Menu, type MenuItem } from '@/components/Menu';
import { findClip, usePopup } from '@/store/popupStore';
import { useGroupItems } from './RowContextMenu';
import { selectedRowAnchor } from './TransformMenu';

/** Ctrl/Cmd+G: toggle collections for the selected clip (stays open), plus "New collection…". */
export function GroupMenu() {
  const clip = usePopup((s) => findClip(s, s.selectedId));
  const closeMenu = usePopup((s) => s.closeMenu);
  const groupItems = useGroupItems(clip);
  const anchor = useMemo(selectedRowAnchor, []);
  const items = useMemo<MenuItem[]>(() => [{ type: 'label', id: 'lbl', label: 'Collections' }, ...groupItems], [groupItems]);
  const onClose = useCallback(() => closeMenu(), [closeMenu]);
  if (!clip) return null;
  return <Menu items={items} anchor={anchor} label="Add to collection" onClose={onClose} minWidth={220} />;
}
