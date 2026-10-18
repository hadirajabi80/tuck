// Preload bridge: exposes the typed `window.api` (TuckApi) to both renderer windows.
// Runs sandboxed (contextIsolation + sandbox), so it may only import 'electron' plus bundled relative modules.
import { contextBridge, ipcRenderer } from 'electron';
import { EVENT_CHANNELS, INVOKE_CHANNELS, type TuckApi } from '../shared/ipc';

const windowKind = (process.argv.find((a) => a.startsWith('--window='))?.slice('--window='.length) ?? 'popup') as TuckApi['windowKind'];

const api: TuckApi = {
  platform: process.platform as TuckApi['platform'],
  windowKind,
  invoke: (channel, ...args) => {
    if (!(channel in INVOKE_CHANNELS)) return Promise.reject(new Error(`Unknown IPC channel: ${channel}`));
    return ipcRenderer.invoke(channel, args[0]);
  },
  on: (channel, listener) => {
    if (!(channel in EVENT_CHANNELS)) throw new Error(`Unknown event channel: ${channel}`);
    const handler = (_e: Electron.IpcRendererEvent, payload: unknown) => listener(payload as never);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
};
contextBridge.exposeInMainWorld('api', api);
