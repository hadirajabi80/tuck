// The popup keeps focus in the search input. Components register it here so stores/menus can return focus.
let searchInput: HTMLInputElement | null = null;

export function registerSearchInput(el: HTMLInputElement | null): void {
  searchInput = el;
}

export function focusSearch(selectAll = false): void {
  const el = searchInput;
  if (!el) return;
  requestAnimationFrame(() => {
    el.focus({ preventScroll: true });
    if (selectAll) el.select();
  });
}

export function getSearchInput(): HTMLInputElement | null {
  return searchInput;
}
