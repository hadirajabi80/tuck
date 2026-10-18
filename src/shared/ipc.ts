// Tuck IPC contract: channel names, payloads, main->renderer events, and the preload window.api surface.
// Main implements every InvokeContract channel with ipcMain.handle and emits EventContract channels
// with webContents.send. Renderer only touches window.api.
import type {
  AppInfo, CaptureState, Clip, ClipPage, ClipQuery, ClipSummary, ClipUpdate, ClipsChangedEvent, DeepPartial,
  DittoDetectResult, DittoImportRequest, DittoImportResult, DittoInspectResult,
  ExportRequest, ExportResult, Group, GroupInput, ImportProgressEvent, ImportResult, NotifyEvent, PasteRequest, PasteResult,
  Platform, PopupShownEvent, Settings, SettingsSection, ShortcutId, ShortcutSetResult, ShortcutStatus,
  Snippet, SnippetInput, Stats, UpdateState, WindowKind,
} from './types';

/** renderer -> main (ipcRenderer.invoke). `req: void` means call with no argument. */
export interface InvokeContract {
  // clips
  'clips:list':          { req: ClipQuery;                                 res: ClipPage };
  'clips:get':           { req: { id: string };                            res: Clip | null };
  'clips:update':        { req: ClipUpdate;                                res: Clip };
  'clips:pin':           { req: { id: string; pinned: boolean };           res: ClipSummary };
  'clips:setGroups':     { req: { id: string; groupIds: string[] };        res: ClipSummary };
  'clips:delete':        { req: { ids: string[] };                         res: { deleted: number } };
  'clips:undoDelete':    { req: void;                                      res: { restored: number } };
  'clips:clear':         { req: { includePinned: boolean };                res: { deleted: number } };
  'clips:createText':    { req: { text: string };                          res: Clip };
  /** Copies a clip to the system clipboard without pasting. */
  'clips:copy':          { req: { id: string; plain?: boolean };           res: { ok: boolean } };
  // groups (collections)
  'groups:list':         { req: void;                                      res: Group[] };
  'groups:create':       { req: GroupInput;                                res: Group };
  'groups:update':       { req: { id: string } & Partial<GroupInput>;      res: Group };
  'groups:delete':       { req: { id: string };                            res: { ok: boolean } };
  'groups:reorder':      { req: { ids: string[] };                         res: Group[] };
  // snippets
  'snippets:list':       { req: { query?: string };                        res: Snippet[] };
  'snippets:create':     { req: SnippetInput;                              res: Snippet };
  'snippets:update':     { req: { id: string } & Partial<SnippetInput>;    res: Snippet };
  'snippets:delete':     { req: { id: string };                            res: { ok: boolean } };
  // paste
  'paste:perform':       { req: PasteRequest;                              res: PasteResult };
  // popup window
  'popup:ready':         { req: void;                                      res: void };
  'popup:hide':          { req: { reason: 'escape' | 'paste' | 'action' }; res: void };
  'popup:setLayout':     { req: { previewVisible: boolean };               res: void };
  // settings
  'settings:get':        { req: void;                                      res: Settings };
  'settings:set':        { req: DeepPartial<Settings>;                     res: Settings };
  'settings:reset':      { req: void;                                      res: Settings };
  'settings:openWindow': { req: { section?: SettingsSection };             res: void };
  'settings:closeWindow':{ req: void;                                      res: void };
  // shortcuts
  'shortcuts:status':    { req: void;                                      res: ShortcutStatus[] };
  'shortcuts:set':       { req: { id: ShortcutId; accelerator: string };   res: ShortcutSetResult };
  /** While recording, main unregisters global shortcuts so the recorder can capture them. */
  'shortcuts:setRecording': { req: { recording: boolean };                 res: void };
  // capture
  'capture:getState':    { req: void;                                      res: CaptureState };
  'capture:setPaused':   { req: { paused: boolean };                       res: CaptureState };
  // data
  'data:export':         { req: ExportRequest;                             res: ExportResult };
  'data:import':         { req: void;                                      res: ImportResult };
  'stats:get':           { req: void;                                      res: Stats };
  // data: Ditto import (DESIGN.md section I)
  'data:detectDitto':    { req: void;                                      res: DittoDetectResult };
  /** Dialog filters: Ditto database (*.db;*.zdb;*.zip;*.bak), All files. */
  'data:pickDittoFile':  { req: void;                                      res: { canceled: boolean; path: string | null } };
  'data:inspectDitto':   { req: { path: string };                          res: DittoInspectResult };
  'data:importDitto':    { req: DittoImportRequest;                        res: DittoImportResult };
  // app
  'app:getInfo':         { req: void;                                      res: AppInfo };
  'app:openExternal':    { req: { url: string };                           res: void };
  'app:revealPath':      { req: { path: string };                          res: void };
  /** macOS: prompts the Accessibility dialog; resolves current trust state. */
  'app:requestAccessibility': { req: void;                                 res: { trusted: boolean } };
  'app:quit':            { req: void;                                      res: void };
  'app:relaunch':        { req: void;                                      res: void };
  // auto-update (GitHub Releases via electron-updater; inert in development builds → status 'unsupported')
  'updates:getState':    { req: void;                                      res: UpdateState };
  /** Starts a check (no-op while checking/downloading or once downloaded); resolves with the state right after starting. */
  'updates:check':       { req: void;                                      res: UpdateState };
  /** Downloads an 'available' update (used when updates.autoDownload is off). */
  'updates:download':    { req: void;                                      res: UpdateState };
  /** Quits, installs the downloaded update silently and relaunches. No-op unless status is 'downloaded'. */
  'updates:install':     { req: void;                                      res: void };
}

/** main -> renderer (webContents.send), broadcast to every window. */
export interface EventContract {
  'clips:changed':       ClipsChangedEvent;
  'groups:changed':      { ids: string[] };
  'snippets:changed':    { ids: string[] };
  'settings:changed':    Settings;
  'shortcuts:changed':   ShortcutStatus[];
  'capture:changed':     CaptureState;
  'popup:shown':         PopupShownEvent;
  'popup:hidden':        { reason: 'escape' | 'paste' | 'blur' | 'action' };
  'settings:navigate':   { section: SettingsSection };
  'app:notify':          NotifyEvent;
  'data:importProgress': ImportProgressEvent;
  'updates:changed':     UpdateState;
}

export type InvokeChannel = keyof InvokeContract;
export type EventChannel = keyof EventContract;
export type InvokeReq<C extends InvokeChannel> = InvokeContract[C]['req'];
export type InvokeRes<C extends InvokeChannel> = InvokeContract[C]['res'];
export type EventPayload<E extends EventChannel> = EventContract[E];

/** Runtime whitelists for the preload bridge. Exhaustive by type: a new channel not listed here fails typecheck. */
export const INVOKE_CHANNELS: Record<InvokeChannel, true> = {
  'clips:list': true, 'clips:get': true, 'clips:update': true, 'clips:pin': true, 'clips:setGroups': true,
  'clips:delete': true, 'clips:undoDelete': true, 'clips:clear': true, 'clips:createText': true, 'clips:copy': true,
  'groups:list': true, 'groups:create': true, 'groups:update': true, 'groups:delete': true, 'groups:reorder': true,
  'snippets:list': true, 'snippets:create': true, 'snippets:update': true, 'snippets:delete': true,
  'paste:perform': true,
  'popup:ready': true, 'popup:hide': true, 'popup:setLayout': true,
  'settings:get': true, 'settings:set': true, 'settings:reset': true, 'settings:openWindow': true, 'settings:closeWindow': true,
  'shortcuts:status': true, 'shortcuts:set': true, 'shortcuts:setRecording': true,
  'capture:getState': true, 'capture:setPaused': true,
  'data:export': true, 'data:import': true, 'stats:get': true,
  'data:detectDitto': true, 'data:pickDittoFile': true, 'data:inspectDitto': true, 'data:importDitto': true,
  'app:getInfo': true, 'app:openExternal': true, 'app:revealPath': true, 'app:requestAccessibility': true,
  'app:quit': true, 'app:relaunch': true,
  'updates:getState': true, 'updates:check': true, 'updates:download': true, 'updates:install': true,
};

export const EVENT_CHANNELS: Record<EventChannel, true> = {
  'clips:changed': true, 'groups:changed': true, 'snippets:changed': true, 'settings:changed': true,
  'shortcuts:changed': true, 'capture:changed': true, 'popup:shown': true, 'popup:hidden': true,
  'settings:navigate': true, 'app:notify': true, 'data:importProgress': true, 'updates:changed': true,
};

type ArgTuple<C extends InvokeChannel> = InvokeReq<C> extends void ? [] : [req: InvokeReq<C>];

/** The object exposed by preload as `window.api`. */
export interface TuckApi {
  readonly platform: Platform;
  readonly windowKind: WindowKind;
  invoke<C extends InvokeChannel>(channel: C, ...args: ArgTuple<C>): Promise<InvokeRes<C>>;
  /** Subscribes; returns an unsubscribe function. */
  on<E extends EventChannel>(channel: E, listener: (payload: EventPayload<E>) => void): () => void;
}

/** Image URLs served by the tuck:// protocol. */
export const imageUrl = (id: string, variant: 'full' | 'thumb'): string => `tuck://img/${variant}/${id}`;
