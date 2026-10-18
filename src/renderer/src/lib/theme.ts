// Applies appearance settings as data attributes on <html>.
// In Electron, main sets nativeTheme.themeSource so prefers-color-scheme already follows the Theme setting;
// data-theme makes the same choice work in the browser mock (global.css overrides the media query).
import type { Platform, Settings, WindowKind } from '@shared/types';

export function applyDocumentAttributes(opts: { platform: Platform; windowKind: WindowKind; mock: boolean }): void {
  const root = document.documentElement;
  root.dataset.platform = opts.platform;
  root.dataset.window = opts.windowKind;
  if (opts.mock) root.dataset.mock = 'true';
}

export function applyAppearance(settings: Settings | null, windowKind: WindowKind): void {
  const root = document.documentElement;
  const theme = settings?.appearance.theme ?? 'system';
  if (theme === 'system') delete root.dataset.theme;
  else root.dataset.theme = theme;
  // Only the popup sits on vibrancy/acrylic; the settings window is solid.
  root.dataset.vibrancy = windowKind === 'popup' && (settings?.appearance.vibrancy ?? true) ? 'on' : 'off';
  root.dataset.density = settings?.appearance.density ?? 'comfortable';
}
