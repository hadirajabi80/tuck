// Popup placement: at the cursor (+12,+12) clamped into the display work area (8 px margin), centred,
// or the remembered position if it is still on a connected display.
import { screen, type Rectangle } from 'electron';
import type { PopupPosition } from '../../shared/types';

const MARGIN = 8;
const OFFSET = 12;

export function clampInto(b: Rectangle, area: Rectangle, margin = MARGIN): Rectangle {
  const width = Math.min(b.width, area.width - margin * 2);
  const height = Math.min(b.height, area.height - margin * 2);
  const x = Math.min(Math.max(b.x, area.x + margin), area.x + area.width - margin - width);
  const y = Math.min(Math.max(b.y, area.y + margin), area.y + area.height - margin - height);
  return { x: Math.round(x), y: Math.round(y), width, height };
}

/** Cursor placement; flips above/left of the cursor when there is no room below/right. */
export function atPoint(pt: { x: number; y: number }, size: { width: number; height: number }, area: Rectangle): Rectangle {
  let x = pt.x + OFFSET;
  let y = pt.y + OFFSET;
  if (x + size.width > area.x + area.width - MARGIN && pt.x - OFFSET - size.width >= area.x + MARGIN) x = pt.x - OFFSET - size.width;
  if (y + size.height > area.y + area.height - MARGIN && pt.y - OFFSET - size.height >= area.y + MARGIN) y = pt.y - OFFSET - size.height;
  return clampInto({ x, y, ...size }, area);
}

export function centered(size: { width: number; height: number }, area: Rectangle): Rectangle {
  return clampInto(
    { x: area.x + Math.round((area.width - size.width) / 2), y: area.y + Math.round((area.height - size.height) / 3), ...size },
    area,
  );
}

export function computePopupBounds(
  size: { width: number; height: number },
  mode: PopupPosition,
  remembered: Rectangle | null,
): Rectangle {
  const cursor = screen.getCursorScreenPoint();
  if (mode === 'remember' && remembered) {
    const onScreen = screen.getAllDisplays().find((d) => {
      const a = d.workArea;
      return remembered.x >= a.x && remembered.y >= a.y && remembered.x < a.x + a.width && remembered.y < a.y + a.height;
    });
    if (onScreen) return clampInto({ x: remembered.x, y: remembered.y, ...size }, onScreen.workArea);
  }
  const display = screen.getDisplayNearestPoint(cursor);
  if (mode === 'center') return centered(size, display.workArea);
  return atPoint(cursor, size, display.workArea);
}
