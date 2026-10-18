import { beforeEach, describe, expect, it, vi } from 'vitest';

const registered = new Map<string, () => void>();
const taken = new Set<string>(); // accelerators "owned by another app"

vi.mock('electron', () => ({
  globalShortcut: {
    register: (accel: string, cb: () => void) => {
      if (taken.has(accel) || registered.has(accel)) return false;
      registered.set(accel, cb);
      return true;
    },
    unregister: (accel: string) => void registered.delete(accel),
    unregisterAll: () => registered.clear(),
  },
}));

const { HotkeyManager } = await import('./hotkeyManager');
type ShortcutId = 'openPopup' | 'pasteLastPlain' | 'toggleCapture';

function make(initial: Partial<Record<ShortcutId, string>> = {}) {
  const store: Record<ShortcutId, string> = { openPopup: 'Control+`', pasteLastPlain: '', toggleCapture: '', ...initial };
  const fired: string[] = [];
  const changes: number[] = [];
  const m = new HotkeyManager({
    platform: 'win32',
    actions: { openPopup: () => fired.push('open'), pasteLastPlain: () => fired.push('plain'), toggleCapture: () => fired.push('toggle') },
    load: () => store,
    save: (id, a) => (store[id] = a),
    onChange: (s) => changes.push(s.length),
  });
  return { m, store, fired, changes };
}

beforeEach(() => {
  registered.clear();
  taken.clear();
});

describe('HotkeyManager', () => {
  it('registers defaults and fires actions', () => {
    const { m, fired } = make();
    const st = m.registerAll();
    expect(st.find((s) => s.id === 'openPopup')).toMatchObject({ accelerator: 'Control+`', registered: true, error: null });
    registered.get('Control+`')!();
    expect(fired).toEqual(['open']);
  });

  it('reports a system conflict on boot', () => {
    taken.add('Control+`');
    const { m } = make();
    expect(m.registerAll()[0]).toMatchObject({ registered: false, error: 'Already in use by another app' });
  });

  it('live re-registers, persists, and validates', () => {
    const { m, store } = make();
    m.registerAll();
    const ok = m.set('openPopup', 'ctrl+shift+space');
    expect(ok).toMatchObject({ ok: true, status: { accelerator: 'Control+Shift+Space', registered: true } });
    expect(store.openPopup).toBe('Control+Shift+Space');
    expect(registered.has('Control+`')).toBe(false);
    expect(m.set('pasteLastPlain', 'V')).toMatchObject({ ok: false, error: 'invalid' });
    expect(m.set('pasteLastPlain', 'Shift+V')).toMatchObject({ ok: false, error: 'invalid' });
    expect(m.set('toggleCapture', 'Control+Shift+Space')).toMatchObject({ ok: false, error: 'conflict-internal' });
    expect(m.set('openPopup', '')).toMatchObject({ ok: true, status: { accelerator: '', registered: false } });
    expect(registered.size).toBe(0);
  });

  it('keeps the old binding when the new one is taken by another app', () => {
    const { m, store } = make();
    m.registerAll();
    taken.add('Control+Shift+K');
    const res = m.set('openPopup', 'Control+Shift+K');
    expect(res).toMatchObject({ ok: false, error: 'conflict-system', status: { accelerator: 'Control+`', registered: true } });
    expect(store.openPopup).toBe('Control+`');
    expect(registered.has('Control+`')).toBe(true);
  });

  it('releases everything while recording and restores afterwards', () => {
    const { m } = make({ toggleCapture: 'Control+Alt+P' });
    m.registerAll();
    expect(registered.size).toBe(2);
    m.setRecording(true);
    expect(registered.size).toBe(0);
    expect(m.set('openPopup', 'Control+Shift+O').ok).toBe(true);
    expect(registered.size).toBe(0); // verified, but not bound until recording ends
    m.setRecording(false);
    expect([...registered.keys()].sort()).toEqual(['Control+Alt+P', 'Control+Shift+O']);
  });
});
