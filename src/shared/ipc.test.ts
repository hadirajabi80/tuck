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
  it('includes the pin reorder channel', () => {
    expect(INVOKE_CHANNELS).toHaveProperty('clips:reorderPinned', true);
    expect(INVOKE_CHANNELS).toHaveProperty('clips:pin', true);
  });
  it('includes the auto-update channels', () => {
    for (const c of ['updates:getState', 'updates:check', 'updates:download', 'updates:install']) expect(INVOKE_CHANNELS).toHaveProperty(c, true);
    expect(EVENT_CHANNELS).toHaveProperty('updates:changed', true);
  });
  it('defaults to checking and downloading updates automatically', () => {
    expect(defaultSettings('win32').updates).toEqual({ autoCheck: true, autoDownload: true });
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
