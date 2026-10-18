import type { TuckApi } from '../shared/ipc';
declare global { interface Window { api: TuckApi } }
export {};
