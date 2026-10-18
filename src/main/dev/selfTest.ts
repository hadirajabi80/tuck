// TUCK_DEV_SELFTEST=1 — exercises the IPC surface end-to-end from inside the popup renderer
// (window.api → preload → ipcMain handlers) and logs a compact report. QA/dev only; it creates test data.
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BrowserWindow } from 'electron';
import { exportToFile, importFromFile } from '../data/exportImport';
import { logger } from '../log';

const log = logger('selftest');

const SCRIPT = String.raw`(async () => {
  const api = window.api;
  const out = {};
  const step = async (name, fn) => {
    try { out[name] = await fn(); } catch (e) { out[name] = 'ERROR: ' + (e && e.message || e); }
  };
  await step('info', async () => { const i = await api.invoke('app:getInfo'); return { platform: i.platform, electron: i.electron, isPackaged: i.isPackaged, launchAtLoginSupported: i.launchAtLoginSupported }; });
  await step('settings.launchAtLogin', async () => (await api.invoke('settings:get')).general.launchAtLogin);
  await step('shortcuts', async () => (await api.invoke('shortcuts:status')).map(s => s.id + '=' + (s.accelerator || '-') + ':' + (s.registered ? 'ok' : (s.error || 'unbound'))));
  await step('setShortcutInvalid', async () => (await api.invoke('shortcuts:set', { id: 'pasteLastPlain', accelerator: 'V' })).error);
  await step('setShortcutInternalConflict', async () => { const st = await api.invoke('shortcuts:status'); const open = st.find(s => s.id === 'openPopup').accelerator; return open ? (await api.invoke('shortcuts:set', { id: 'toggleCapture', accelerator: open })).error : 'n/a'; });
  await step('capture', async () => api.invoke('capture:getState'));
  await step('pauseResume', async () => { const a = await api.invoke('capture:setPaused', { paused: true }); const b = await api.invoke('capture:setPaused', { paused: false }); return a.paused + '/' + b.paused; });
  await step('settingsSet', async () => (await api.invoke('settings:set', { history: { maxItems: 4000 }, appearance: { theme: 'dark' } })).history.maxItems);
  await step('settingsWindow', async () => { await api.invoke('settings:openWindow', { section: 'about' }); await new Promise(r => setTimeout(r, 1200)); await api.invoke('settings:closeWindow'); return 'ok'; });
  await step('settingsReset', async () => (await api.invoke('settings:reset')).appearance.theme);
  await step('createText', async () => (await api.invoke('clips:createText', { text: 'selftest hello world' })).kind);
  await step('listAll', async () => { const p = await api.invoke('clips:list', { filter: 'all', query: '', offset: 0, limit: 100 }); return { total: p.total, kinds: p.items.map(i => i.kind) }; });
  await step('search', async () => (await api.invoke('clips:list', { filter: 'all', query: 'selftest', offset: 0, limit: 10 })).total);
  const page = await api.invoke('clips:list', { filter: 'all', query: '', offset: 0, limit: 100 });
  const text = page.items.find(i => i.preview.startsWith('selftest'));
  const img = page.items.find(i => i.kind === 'image');
  const files = page.items.find(i => i.kind === 'files');
  await step('pin', async () => (await api.invoke('clips:pin', { id: text.id, pinned: true })).pinned);
  await step('pinnedList', async () => (await api.invoke('clips:list', { filter: 'pinned', query: '', offset: 0, limit: 10 })).total);
  await step('group', async () => { const g = await api.invoke('groups:create', { name: 'Selftest', color: 'violet' }); const s = await api.invoke('clips:setGroups', { id: text.id, groupIds: [g.id] }); const gl = await api.invoke('groups:list'); return { member: s.groupIds[0] === g.id, count: gl.find(x => x.id === g.id).clipCount }; });
  await step('edit', async () => (await api.invoke('clips:update', { id: text.id, text: '#336699' })).kind);
  await step('get', async () => { const c = await api.invoke('clips:get', { id: text.id }); return { kind: c.kind, hex: c.meta.colorHex, hash: !!c.hash }; });
  await step('snippets', async () => { const s = await api.invoke('snippets:create', { title: 'Sig', body: 'Best regards' }); const l = await api.invoke('snippets:list', { query: 'regards' }); await api.invoke('snippets:update', { id: s.id, keyword: ';sig' }); return l.length; });
  await step('deleteUndo', async () => { const d = await api.invoke('clips:delete', { ids: [text.id] }); const u = await api.invoke('clips:undoDelete'); return d.deleted + '/' + u.restored; });
  await step('thumb', async () => { if (!img) return 'no image clip'; const r = await fetch('tuck://img/thumb/' + img.id); const b = await r.blob(); return r.status + ' ' + b.type + ' ' + b.size; });
  await step('thumbImgTag', async () => { if (!img) return 'no image clip'; return await new Promise(res => { const el = new Image(); el.onload = () => res(el.naturalWidth + 'x' + el.naturalHeight); el.onerror = () => res('img error'); el.src = 'tuck://img/thumb/' + img.id; }); });
  await step('badProtocol', async () => (await fetch('tuck://img/thumb/../../etc')).status);
  await step('stats', async () => api.invoke('stats:get'));
  await step('detectDitto', async () => (await api.invoke('data:detectDitto')).found);
  await step('copyFiles', async () => files ? (await api.invoke('clips:copy', { id: files.id })).ok : 'no files clip');
  return out;
})()`;

export async function runSelfTest(win: BrowserWindow): Promise<void> {
  try {
    const res = await win.webContents.executeJavaScript(SCRIPT, true);
    log.info('report', JSON.stringify(res));
    // Main-side: Tuck JSON export → import round trip (everything should merge as duplicates).
    const file = join(tmpdir(), `tuck-selftest-${process.pid}.json`);
    const exp = await exportToFile({ includeImages: true }, file);
    const imp = await importFromFile(file);
    rmSync(file, { force: true });
    log.info('export/import', JSON.stringify({ exported: exp.clips, ok: exp.ok && imp.ok, imported: imp.imported, skipped: imp.skipped, groups: imp.groups, snippets: imp.snippets }));
  } catch (err) {
    log.error('selftest failed', err);
  }
}
