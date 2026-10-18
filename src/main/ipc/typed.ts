// Typed wrappers over ipcMain.handle / webContents.send, bound to the shared IPC contract.
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { EventChannel, EventPayload, InvokeChannel, InvokeReq, InvokeRes } from '../../shared/ipc';

export function handle<C extends InvokeChannel>(
  channel: C,
  fn: (req: InvokeReq<C>, event: IpcMainInvokeEvent) => InvokeRes<C> | Promise<InvokeRes<C>>,
): void {
  ipcMain.handle(channel, (event, req) => fn(req, event));
}

export function emit<E extends EventChannel>(channel: E, payload: EventPayload<E>): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}
