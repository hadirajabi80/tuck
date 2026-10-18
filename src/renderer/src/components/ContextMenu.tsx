// Context menu = Menu anchored at the pointer. Kept as its own primitive so callers read naturally.
import { Menu, type MenuItem, type MenuCloseReason } from './Menu';

export interface ContextMenuProps {
  x: number;
  y: number;
  items: MenuItem[];
  label?: string;
  onClose: (reason: MenuCloseReason) => void;
}

export function ContextMenu({ x, y, items, label = 'Actions', onClose }: ContextMenuProps) {
  return <Menu items={items} anchor={{ x: x + 2, y: y + 2 }} label={label} onClose={onClose} minWidth={220} />;
}
