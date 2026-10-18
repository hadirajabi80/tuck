// The popup keyboard map (DESIGN.md §E). Focus stays in the search input; this handler runs on the shell
// (keydown bubbles from the input). Menus, editors and dialogs stop propagation of their own keys.
import { useCallback, useEffect, type KeyboardEvent } from 'react';
import type { Platform } from '@shared/types';
import { api } from '@/lib/api';
import { getSearchInput } from '@/lib/focus';
import { isDeleteCombo, isMod, isModKey, matchCombo, quickPasteIndex } from '@/lib/keys';
import { usePopup } from '@/store/popupStore';

export interface PopupKeyHandlers {
  onKeyDown: (e: KeyboardEvent) => void;
  onKeyUp: (e: KeyboardEvent) => void;
}

/** Pure dispatcher (exported for tests): returns true when the event was handled. */
export function handlePopupKey(e: KeyboardEvent | globalThis.KeyboardEvent, platform: Platform): boolean {
  const st = usePopup.getState();
  const mod = isMod(e, platform);
  const input = getSearchInput();
  const query = st.query;
  const combo = (c: string) => matchCombo(e, c, platform);

  if (isModKey(e, platform)) {
    st.setModifierHeld(true);
    return false;
  }

  // Overlays first
  if (st.menu.kind === 'help') {
    if (e.key === 'Escape' || e.key === '?' || combo('mod+/')) { st.closeMenu(); return true; }
    return false;
  }
  if (st.menu.kind !== 'none') return false; // menus own the keyboard while open
  if (st.editing) {
    if (e.key === 'Escape') { st.cancelEdit(); return true; }
    return false;
  }

  // Quick paste Ctrl/Cmd+1..9
  const qi = quickPasteIndex(e, platform);
  if (qi >= 0) { void st.quickPaste(qi); return true; }

  switch (e.key) {
    case 'ArrowDown':
    case 'ArrowUp': {
      if (e.altKey || mod) return false;
      st.moveSelection(e.key === 'ArrowDown' ? 1 : -1, e.shiftKey);
      return true;
    }
    case 'PageDown':
    case 'PageUp':
      st.moveSelection(e.key === 'PageDown' ? 10 : -10, e.shiftKey);
      return true;
    case 'Home':
    case 'End':
      if (query) return false; // caret movement
      st.selectEdge(e.key === 'Home' ? 'first' : 'last');
      return true;
    case 'Enter': {
      if (e.altKey) return false;
      if (mod) {
        if (st.lastTransform) void st.paste({ transform: st.lastTransform });
        else st.openMenu({ kind: 'transform' });
        return true;
      }
      void st.paste({ plain: e.shiftKey });
      return true;
    }
    case 'Escape': {
      if (st.multi.size) { st.clearMulti(); return true; }
      void api.invoke('popup:hide', { reason: 'escape' });
      return true;
    }
    case 'Tab':
      if (mod || e.altKey) return false;
      st.cycleFilter(e.shiftKey ? -1 : 1);
      return true;
    default:
      break;
  }

  const caretAtEnd = !input || (input.selectionStart === input.value.length && input.selectionEnd === input.value.length);
  if (isDeleteCombo(e, platform, caretAtEnd || query === '')) { void st.remove(); return true; }

  if (combo('mod+space')) { st.toggleMulti(); return true; }
  if (combo('mod+a')) {
    // First press selects the query text; with the query fully selected (or empty) it selects all rows.
    const allSelected = !input || input.value === '' || (input.selectionStart === 0 && input.selectionEnd === input.value.length);
    if (!allSelected) return false;
    st.selectAll();
    return true;
  }
  if (combo('mod+p')) { void st.pin(); return true; }
  if (combo('mod+e')) { st.startEdit(); return true; }
  if (combo('mod+c')) {
    if (input && input.selectionStart !== input.selectionEnd) return false; // copying query text
    void st.copy();
    return true;
  }
  if (combo('mod+z')) {
    if (query) return false; // undo typing
    void st.undo();
    return true;
  }
  if (combo('mod+t')) { if (st.selectedId && st.filter !== 'snippets') st.openMenu({ kind: 'transform' }); return true; }
  if (combo('mod+g')) { if (st.selectedId && st.filter !== 'snippets') st.openMenu({ kind: 'group' }); return true; }
  if (combo('mod+s')) {
    if (st.selectedId && st.filter !== 'snippets') {
      if (!st.previewVisible) st.togglePreview();
      usePopup.setState({ editing: 'saveSnippet' });
    }
    return true;
  }
  if (combo('mod+n')) { st.newSnippet(); return true; }
  if (combo('mod+.')) { st.togglePreview(); return true; }
  if (combo('mod+,')) { void api.invoke('settings:openWindow', {}); return true; }
  if (combo('mod+shift+c')) { st.setQuery(''); return true; }
  if (combo('mod+/') || ((e.key === '?' || (e.code === 'Slash' && e.shiftKey)) && query === '' && !mod && !e.altKey)) { st.openMenu({ kind: 'help' }); return true; }
  return false;
}

export function usePopupKeys(platform: Platform): PopupKeyHandlers {
  const onKeyDown = useCallback((e: KeyboardEvent) => {
    if (handlePopupKey(e, platform)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [platform]);

  const onKeyUp = useCallback((e: KeyboardEvent) => {
    if (isModKey(e, platform) || !isMod(e, platform)) usePopup.getState().setModifierHeld(false);
  }, [platform]);

  // Modifier release / window blur outside React's tree.
  useEffect(() => {
    const up = (e: globalThis.KeyboardEvent) => { if (isModKey(e, platform)) usePopup.getState().setModifierHeld(false); };
    const blur = () => usePopup.getState().setModifierHeld(false);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [platform]);

  return { onKeyDown, onKeyUp };
}
