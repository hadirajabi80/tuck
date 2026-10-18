import { Check } from 'lucide-react';
import { useCallback, useMemo } from 'react';
import { TRANSFORMS } from '@shared/types';
import { Menu, type MenuAnchor, type MenuItem } from '@/components/Menu';
import { usePopup } from '@/store/popupStore';

/** Anchor menus opened from the keyboard at the selected row (fallback: top-centre of the list). */
export function selectedRowAnchor(): MenuAnchor {
  const id = usePopup.getState().selectedId;
  const el = id ? document.getElementById(`clip-row-${id}`) : null;
  const r = el?.getBoundingClientRect();
  if (r && r.height > 0) return { rect: { left: r.left + 52, top: r.top, right: r.right, bottom: r.bottom - 4, width: r.width, height: r.height } };
  return { x: 80, y: 96 };
}

export function TransformMenu() {
  const closeMenu = usePopup((s) => s.closeMenu);
  const last = usePopup((s) => s.lastTransform);
  const multi = usePopup((s) => s.multi.size);
  const anchor = useMemo(selectedRowAnchor, []);
  const items = useMemo<MenuItem[]>(() => [
    { type: 'label', id: 'lbl', label: multi > 1 ? `Paste ${multi} merged as` : 'Paste as' },
    ...TRANSFORMS.map<MenuItem>((t) => ({
      id: t.id,
      label: t.label,
      accessKey: t.key,
      icon: t.id === last ? Check : undefined,
      onSelect: () => void usePopup.getState().paste({ transform: t.id }),
    })),
  ], [last, multi]);
  const onClose = useCallback(() => closeMenu(), [closeMenu]);
  const initial = last ? TRANSFORMS.findIndex((t) => t.id === last) + 1 : 1;
  return <Menu items={items} anchor={anchor} label="Paste as" onClose={onClose} minWidth={220} initialActive={initial} />;
}
