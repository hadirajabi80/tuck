// The only way renderer code talks to main. In Electron, preload exposes window.api;
// in a plain browser (`npm run dev:ui`) we fall back to the in-memory mock.
import type { TuckApi } from '@shared/ipc';
import { mockApi } from './mockApi';

export const api: TuckApi = window.api ?? mockApi;
export const isMock: boolean = api === mockApi;
