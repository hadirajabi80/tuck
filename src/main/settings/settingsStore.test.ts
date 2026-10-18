import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { defaultSettings } from '../../shared/types';
import { deepMerge, sanitize, SettingsStore } from './settingsStore';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'tuck-settings-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('settings', () => {
  it('defaults launchAtLogin to true and uses platform hotkeys', () => {
    expect(defaultSettings('win32').general.launchAtLogin).toBe(true);
    expect(defaultSettings('win32').shortcuts.openPopup).toBe('Control+`');
    expect(defaultSettings('darwin').shortcuts.openPopup).toBe('Command+Shift+V');
  });

  it('deep-merges partial patches', () => {
    const d = defaultSettings('win32');
    const m = deepMerge(d, { history: { maxItems: 100 } });
    expect(m.history.maxItems).toBe(100);
    expect(m.history.expireDays).toBe(d.history.expireDays);
  });

  it('clamps, validates enums and normalises accelerators', () => {
    const d = defaultSettings('win32');
    const s = sanitize(
      {
        general: { pasteDelayMs: 99999, hideOnBlur: 'yes' },
        history: { maxItems: 3, pollIntervalMs: 5 },
        appearance: { theme: 'neon', density: 'compact' },
        shortcuts: { openPopup: 'ctrl+shift+space', pasteLastPlain: '%%%' },
        privacy: { ignoredApps: [' Code.exe ', 'code.exe', 7, ''] },
      },
      d,
      'win32',
    );
    expect(s.general.pasteDelayMs).toBe(1000);
    expect(s.general.hideOnBlur).toBe(true);
    expect(s.history.maxItems).toBe(50);
    expect(s.history.pollIntervalMs).toBe(100);
    expect(s.appearance.theme).toBe('system');
    expect(s.appearance.density).toBe('compact');
    expect(s.shortcuts.openPopup).toBe('Control+Shift+Space');
    expect(s.shortcuts.pasteLastPlain).toBe('');
    expect(s.privacy.ignoredApps).toEqual(['Code.exe']);
  });

  it('persists atomically, notifies listeners and recovers from a corrupt file', () => {
    const dir = tmp();
    const file = join(dir, 'settings.json');
    const store = new SettingsStore(file, 'win32');
    store.load();
    const seen: number[] = [];
    store.onChange((next, prev) => seen.push(next.history.maxItems - prev.history.maxItems));
    store.set({ history: { maxItems: 6000 } });
    store.set({ history: { maxItems: 6000 } }); // no-op → no event
    expect(seen).toEqual([1000]);
    expect(JSON.parse(readFileSync(file, 'utf8')).history.maxItems).toBe(6000);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);

    writeFileSync(file, '{ not json');
    const again = new SettingsStore(file, 'win32');
    expect(again.load().history.maxItems).toBe(5000);
    expect(readdirSync(dir).some((f) => f.includes('.corrupt-'))).toBe(true);
    expect(again.reset().general.launchAtLogin).toBe(true);
  });
});
