// STUB — replaced by the renderer engineer with a seeded in-memory mock (fake clips of every kind).
// Used only when window.api is undefined, i.e. `npm run dev:ui` in a plain browser.
import type { TuckApi } from '@shared/ipc';

const platform: TuckApi['platform'] = /Mac/i.test(globalThis.navigator?.platform ?? '') ? 'darwin' : 'win32';
const windowKind: TuckApi['windowKind'] = globalThis.location?.hash.startsWith('#/settings') ? 'settings' : 'popup';

export const mockApi: TuckApi = {
  platform,
  windowKind,
  invoke: (channel, ..._args) => Promise.reject(new Error(`mockApi: "${channel}" not implemented`)),
  on: () => () => {},
};
