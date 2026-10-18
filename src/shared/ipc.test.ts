import { describe, expect, it } from 'vitest';
import { EVENT_CHANNELS, INVOKE_CHANNELS, imageUrl } from './ipc';
import { defaultSettings } from './types';

describe('ipc contract', () => {
  it('channel names follow "area:action"', () => {
    for (const c of [...Object.keys(INVOKE_CHANNELS), ...Object.keys(EVENT_CHANNELS)]) {
      expect(c).toMatch(/^[a-z]+:[a-zA-Z]+$/);
    }
  });
  it('includes the Ditto import channels', () => {
    for (const c of ['data:detectDitto', 'data:pickDittoFile', 'data:inspectDitto', 'data:importDitto']) expect(INVOKE_CHANNELS).toHaveProperty(c, true);
    expect(EVENT_CHANNELS).toHaveProperty('data:importProgress', true);
  });
  it('builds tuck:// image urls', () => {
    expect(imageUrl('abc', 'thumb')).toBe('tuck://img/thumb/abc');
    expect(imageUrl('abc', 'full')).toBe('tuck://img/full/abc');
  });
  it('platform default hotkeys', () => {
    expect(defaultSettings('win32').shortcuts.openPopup).toBe('Control+`');
    expect(defaultSettings('darwin').shortcuts.openPopup).toBe('Command+Shift+V');
  });
});
