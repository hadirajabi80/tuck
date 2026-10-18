# Tuck — Design Document

Cross-platform (Windows 11 / macOS) clipboard manager. Ditto's keyboard-first speed, Raycast-grade polish, more features. Greenfield project in `E:\copy` (verified empty; Node 24.15, npm 11.12).

---

## 0. Implementation notes (Phase 0)

Recorded by the lead after scaffolding (2026-10-18). **Where this section disagrees with a later section, this section wins.**

### Exact versions (installed, `package.json` uses `^` ranges)

| Package | Version | Notes |
|---|---|---|
| electron | 44.9.0 | Chromium-based, embedded **Node 24.22.0**, ABI 149 |
| electron-vite | 6.0.0 | Vite 8 / rolldown. `externalizeDepsPlugin()` is deprecated → `build.externalizeDeps` (default **true**) |
| vite | 8.3.4 | |
| @vitejs/plugin-react | 6.1.2 | |
| react / react-dom | 19.3.1 | React **19** (design said 18) — `@types/react` 19.3.0 |
| typescript | 7.0.2 | the native (Go) compiler; `tsc` CLI unchanged. `moduleResolution: "bundler"`, no `baseUrl` |
| vitest | 5.0.5 | config in `vitest.config.mts` (tests: `src/**/*.test.ts(x)`, env node) |
| zustand | 5.0.15 | |
| lucide-react | 1.59.0 | |
| koffi | 3.3.3 | only runtime `dependency` |
| fflate | 0.8.3 | devDependency → bundled into `out/main` |
| electron-builder | 26.15.3 | |
| @types/node | 24.x | pinned to Electron's Node major on purpose |

### Storage engine: `node:sqlite` (NOT better-sqlite3)

Verified inside Electron 44 (`ELECTRON_RUN_AS_NODE=1 electron script.js`, no flags, no warnings): `require('node:sqlite')` loads, SQLite **3.53.4**, `CREATE VIRTUAL TABLE … USING fts5(x, tokenize='trigram')` works and `MATCH '"lipbo"'` substring search returns rows, `new DatabaseSync(path, { readOnly: true })` opens files read-only (writes fail with "attempt to write a readonly database"), WAL works, BLOBs round-trip. So **`better-sqlite3` and `@types/better-sqlite3` are dropped**: no native module, no `install-app-deps`, no rebuilds, no `postinstall`. electron-vite keeps `node:sqlite` external (it is in `builtinModules`); the bundle contains `require("node:sqlite")`.

API for the main engineer (types come from `@types/node`):

```ts
import { DatabaseSync, type StatementSync } from 'node:sqlite';
const db = new DatabaseSync(dbPath);                          // or new DatabaseSync(path, { readOnly: true }) for Ditto import
db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
const stmt = db.prepare('SELECT * FROM clips WHERE id = ?');  // StatementSync
stmt.get(id);  stmt.all(...params);  stmt.run(...params) /* → { changes, lastInsertRowid } */;  stmt.iterate(...)
db.function('name', fn);  db.close();
```

Differences from better-sqlite3 to keep in mind:
- **No `db.transaction(fn)` helper** — write a tiny wrapper: `db.exec('BEGIN')` → work → `db.exec('COMMIT')`, `ROLLBACK` in `catch`. (Ditto import: one `BEGIN…COMMIT` per 200-clip chunk.)
- Rows are **null-prototype objects**; BLOB columns come back as **`Uint8Array`** (wrap with `Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength)` when a Buffer is needed). Bind `Buffer`/`Uint8Array` for BLOBs.
- Named parameters use the prefix in the key by default (`{ $id: 1 }` for `$id`); `stmt.setAllowBareNamedParameters(true)` is on by default in Node 24, so `{ id: 1 }` also works. Positional `?` is simplest.
- Integers > 2^53 need `stmt.setReadBigInts(true)`; our epoch-ms values are fine as numbers.
- No `.pluck()` / `.raw()`; use `stmt.setReturnArrays(true)` if needed.

### koffi 3 (verified in Electron 44)

`require('koffi')` loads under `ELECTRON_RUN_AS_NODE` and `user32.dll` calls work: `GetForegroundWindow`, `GetWindowThreadProcessId(hwnd, _Out_ uint32*)`, `GetClipboardSequenceNumber` all returned live values on this machine. Notes: koffi 3 ships each platform's `.node` in an optional package `@koromix/koffi-<platform>-<arch>` (both are `asarUnpack`ed). Opaque pointers (`koffi.pointer('HWND', koffi.opaque())`) printed as **BigInt**-like values (`657962n`) — compare/store them as-is, don't assume `number`. For the macOS **universal** DMG, both `@koromix/koffi-darwin-x64` and `-arm64` must be present in `node_modules` (`npm install --cpu=x64 --cpu=arm64 --os=darwin` on the mac build host).

### Other deviations from sections C–H

- **Contract**: `src/shared/types.ts` / `ipc.ts` are verbatim from §D plus the §I Ditto additions (types, 4 invoke channels, `data:importProgress` event, whitelists). No other changes.
- **Shared helpers added beyond the §D signatures** (all pure, tested):
  - `accelerator.ts`: `normalize(accel, platform)`; `validate('')` returns `{ ok: true }` ('' = unbound); `Shift`-only combos are rejected (`Shift+V` would hijack typing). `CommandOrControl` accepted on input; `Command` is rejected on Windows.
  - `transforms.ts`: `applyTransform(id, text)` (returns the input unchanged if a transform does not apply, e.g. invalid JSON), `transformText(id, text): {ok,text}|{ok:false,error}`, `isTransformId()`.
  - `detect.ts`: `detectKind(text)` (precedence color > link > code > text), `analyzeText(text) → { kind, meta }` (fills `lineCount/wordCount/charCount` + `url`/`colorHex`/`language`), `detectLink`, `parseColor` (→ `#RRGGBB` / `#RRGGBBAA`), `analyzeCode`/`guessLanguage`/`looksLikeCode`, `LANGUAGE_LABELS`, `textStats`, `makePreview(text, max = 200)`, `imagePreview(w, h)`, `filesPreview(files)`, `subsequenceScore(q, target)` (0 = no match).
- `electron.vite.config.ts` uses no plugins for main/preload (externalizeDeps is the default). Output: `out/main/index.js`, `out/preload/index.js` (CJS, so the sandboxed preload works), `out/renderer/`.
- `npm run dev:ui` is `vite serve src/renderer --config src/renderer/vite.config.ts --port 5174` (strict port).
- **Icons**: generated by `npm run icons` (`scripts/gen-icons.mjs`, zero deps): `build/icon.svg`, `icon.png` (1024), `icon.ico` (16–256), `tray.png` + `tray@2x.png` + `tray.ico` (Windows, accent glyph), `trayTemplate.png` + `@2x` (macOS). No `.icns` — electron-builder derives it from `icon.png` (mac `icon: build/icon.png`). `extraResources` copies the tray/app PNGs to `<resources>/icons`; at runtime use `app.isPackaged ? join(process.resourcesPath, 'icons', f) : join(app.getAppPath(), 'build', f)`.
- `electron-builder.yml`: `asarUnpack` is `koffi/**` + `@koromix/**` (no better-sqlite3), `npmRebuild: false`.
- `src/main/index.ts` is a **placeholder** (two plain windows, logs renderer console/preload errors, `TUCK_SMOKE_EXIT_MS=<ms>` auto-quits) — Engineer 2 replaces it entirely. `src/renderer/src/{main.tsx,App.tsx,lib/mockApi.ts}` are placeholders/stubs for Engineer 3.
- `.gitignore` ignores `*.zdb`/`*.db` — the sample `Ditto.zdb` in the repo root (personal data) stays local; tests must build fixtures in code. It is **gzip** (27 MB) wrapping a **358 MB** SQLite file, so `sqliteOpen.ts` should stream-decompress to the temp file (`stream.pipeline(createReadStream, zlib.createGunzip(), createWriteStream)`) rather than `gunzipSync` (§I), and sniff only the first bytes of the source.

---

## A. Identity

### Name

**Tuck** — "tuck it away, pull it back." One syllable, verb and noun, brandable (`tuck.app`, `gettuck.com`), not a clipboard-app trademark (Ditto, Paste, Maccy, CopyQ, ClipClip, Pastebot, Clipy are all clear). Binary/scheme names: `tuck`, `tuck://`, app id `com.tuck.app`.

Alternates: **Reclip** (literal, searchable, slightly generic) and **Satchel** (warm, "carry everything you've grabbed", longer).

### Tagline

**"Everything you've copied, one keystroke away."**

### Visual identity

**Feel:** quiet, dense, fast. Translucent panel, hairline borders, a single accent colour used sparingly (selection, pins, focus ring). No gradients in the UI; one gradient in the app icon.

**Icon concept:** a rounded square "card" whose top-right corner is folded over (a tucked-in page corner). The fold forms a small triangle in the accent colour against a dark indigo card. Tray/menu-bar icon: the same folded-corner outline as a monochrome template glyph (16/32 px, `trayTemplate.png` on macOS, `.ico` 16/24/32 on Windows).

**Typography** (system stacks, zero font deps):

```css
--font-ui:   "Segoe UI Variable Text", "Segoe UI", -apple-system, "SF Pro Text", system-ui, sans-serif;
--font-mono: "Cascadia Code", ui-monospace, "SF Mono", Menlo, Consolas, monospace;
--text-xs: 11px; --text-sm: 12px; --text-md: 13px; --text-lg: 14px; --text-xl: 16px; --text-2xl: 20px;
--leading-tight: 1.25; --leading-normal: 1.45;
--weight-regular: 400; --weight-medium: 500; --weight-semibold: 600;
```

Base UI size is 13px (settings uses 13/14; popup list rows 13; preview code 12 mono).

**Spacing scale** (4-based): `--sp-0_5: 2px; --sp-1: 4px; --sp-1_5: 6px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 20px; --sp-6: 24px; --sp-8: 32px`.

**Radius:** `--r-sm: 6px` (chips, inputs), `--r-md: 8px` (rows, buttons, cards), `--r-lg: 12px` (popup window, menus), `--r-full: 999px`.

**Motion:** `--ease: cubic-bezier(0.2, 0, 0, 1); --dur-fast: 80ms; --dur-base: 140ms`. Respect `prefers-reduced-motion`.

**Colour tokens** — defined in `src/renderer/src/styles/tokens.css`, switched by `prefers-color-scheme` (main sets `nativeTheme.themeSource` from settings so the media query follows the user's Theme choice with zero IPC).

```css
:root {
  /* Light */
  --accent-9: #5B5BD6;  --accent-10: #5151CD; --accent-11: #4747B8; --accent-a3: rgba(91,91,214,0.10); --accent-a5: rgba(91,91,214,0.22);
  --accent-contrast: #FFFFFF;
  --bg-window: rgba(248, 248, 250, 0.84);   /* translucent over vibrancy/acrylic */
  --bg-window-solid: #F7F7F9;
  --bg-surface: #FFFFFF;  --bg-surface-2: #F1F1F4;  --bg-hover: rgba(0,0,0,0.045); --bg-active: rgba(0,0,0,0.08);
  --bg-selected: var(--accent-a3); --bg-input: rgba(0,0,0,0.04);
  --border: rgba(0,0,0,0.09); --border-strong: rgba(0,0,0,0.16); --border-focus: var(--accent-9);
  --fg-1: #1A1A22; --fg-2: #4A4A57; --fg-3: #7B7B89; --fg-4: #A8A8B4; --fg-on-accent: #FFFFFF;
  --success: #2E9B5B; --warning: #C7891B; --danger: #D64545; --danger-a3: rgba(214,69,69,0.10);
  --kind-text: #6F6F7E; --kind-link: #2F7BE5; --kind-image: #B45CC7; --kind-files: #C98A1B; --kind-color: #2AA07D; --kind-code: #D45A5A;
  --shadow-menu: 0 8px 24px rgba(0,0,0,0.14), 0 0 0 1px rgba(0,0,0,0.06);
}
@media (prefers-color-scheme: dark) {
  :root {
    --accent-9: #6E6ADE; --accent-10: #7B77E8; --accent-11: #B1AFFF; --accent-a3: rgba(110,106,222,0.18); --accent-a5: rgba(110,106,222,0.32);
    --accent-contrast: #FFFFFF;
    --bg-window: rgba(28, 28, 32, 0.78); --bg-window-solid: #1C1C20;
    --bg-surface: #232328; --bg-surface-2: #2B2B31; --bg-hover: rgba(255,255,255,0.055); --bg-active: rgba(255,255,255,0.09);
    --bg-selected: var(--accent-a3); --bg-input: rgba(255,255,255,0.06);
    --border: rgba(255,255,255,0.08); --border-strong: rgba(255,255,255,0.16); --border-focus: var(--accent-9);
    --fg-1: #EDEDF2; --fg-2: #B9B9C4; --fg-3: #85858F; --fg-4: #5C5C66; --fg-on-accent: #FFFFFF;
    --success: #4CC078; --warning: #E0A53C; --danger: #F06A6A; --danger-a3: rgba(240,106,106,0.14);
    --kind-text: #9A9AAB; --kind-link: #5EA0FF; --kind-image: #CF86E0; --kind-files: #E1AA43; --kind-color: #4FC9A2; --kind-code: #F08080;
    --shadow-menu: 0 12px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06);
  }
}
```

Blur/vibrancy: macOS `vibrancy: 'popover'` + `transparent: true`; Windows 11 (build ≥ 22621) `backgroundMaterial: 'acrylic'`; otherwise solid `--bg-window-solid`. The renderer adds `data-vibrancy="on|off"` on `<html>` to pick `--bg-window` vs `--bg-window-solid`.

---

## B. Features

### MVP (ships now)

| Area | Feature |
|---|---|
| Capture | Text, HTML, RTF (as alternates of a text clip), images (PNG), file lists. Polling watcher with native change counter. |
| Capture | Dedupe by content hash: re-copy moves clip to top, bumps `copyCount`, keeps pin/groups. |
| Capture | Source app name (Windows via `koffi` foreground-window exe; macOS via `lsappinfo` once per change, best-effort). |
| Capture | Skip concealed/transient content (password managers), ignore-list of apps, pause capture (tray + popup banner), max image size. |
| Capture | Kind detection: text / link / color / code / image / files, with meta (url, hex, language guess, line/word counts). |
| Popup | Global hotkey (Win `Ctrl+\``, mac `Cmd+Shift+V`), frameless popup at cursor clamped to work area, focused search, keyboard-first, Enter pastes into the previously focused app, Esc hides, blur hides. |
| Popup | Instant search: FTS5 trigram substring search + subsequence fuzzy re-rank; filters All / Pinned / Text / Images / Links / Files / Colors / Code / Snippets; collections dropdown. |
| Popup | Pin/unpin (Pinned section at top, exempt from auto-delete), collections (many-to-many, Ditto groups), quick paste `Ctrl/Cmd+1..9`, paste as plain `Shift+Enter`, multi-select and paste merged, copy-only, edit text, delete with undo, preview pane (text, code, image, colour swatch, link, files), transforms on paste (UPPERCASE, lowercase, Title Case, trim, JSON pretty, JSON minify, strip formatting). |
| Snippets | Saved reusable text with title/keyword, paste from popup, "save clip as snippet". |
| Settings | Window with General / Shortcuts / History / Appearance / Privacy / About; shortcut recorder with live re-register + conflict feedback; theme light/dark/system; launch at login; max items + expire days; import/export JSON; storage stats; clear history. |
| System | Tray / menu-bar icon with menu; single instance; autostart hidden; `tuck://` image protocol. |

### Later (post-MVP, in priority order)

1. Paste stack (sequential paste of multi-selection, one per `Enter`).
2. Snippet keyword expansion (`;sig` anywhere) — needs a key hook.
3. OCR for image clips and search in images.
4. Link previews (title/favicon fetch, opt-in).
5. "Paste and keep open" (`Alt+Enter`), smart collections (rules), tags.
6. Sync (E2E encrypted, file-based via iCloud/OneDrive folder first).
7. Scriptable transforms (user JS), QR code preview for text, perceptual image dedupe.
8. Auto-update (electron-updater), Linux build.

---

## C. Architecture

### Runtime decisions

- **electron-vite 6 + Vite 8 + React 19 + TS 7** (updated in Phase 0, see §0). One renderer bundle serves both windows; hash routes `#/popup` and `#/settings`.
- **Storage: `node:sqlite`** (`DatabaseSync`) — *Phase 0 update, see §0.* Electron 44 embeds Node 24.22 whose built-in `node:sqlite` (SQLite 3.53.4) works unflagged with FTS5 + trigram and read-only opens, so no native module is needed. (Original plan was `better-sqlite3` because Electron 35's Node 22.14 lacked an unflagged `node:sqlite`.) Synchronous API fits a single-writer main process.
- **FFI: `koffi`** (prebuilt binaries in-package, no compile). Used for: Windows `user32` (SendInput, GetForegroundWindow, SetForegroundWindow, AttachThreadInput, GetClipboardSequenceNumber, IsClipboardFormatAvailable, RegisterClipboardFormatW, GetAsyncKeyState, GetWindowThreadProcessId), `kernel32`/`shell32` (process image name, CF_HDROP file list); macOS `libobjc` (NSPasteboard `changeCount`), `CoreGraphics` (CGEvent Cmd+V). `osascript` is the macOS fallback if koffi fails to load.
- **Settings in `userData/settings.json`** (atomic write via temp+rename, deep-merged with defaults) rather than a DB table: readable, needed before the DB opens, trivially exportable. The DB keeps a `meta` table for schema version only.
- **Images as files**: `userData/images/<id>.png` (original) and `userData/images/thumbs/<id>.png` (longest side 240 px). DB stores metadata only. Renderer loads via `tuck://img/thumb/<id>` without IPC byte copies; cleanup is a file delete.
- **Search in main** (SQLite); renderer never holds the whole history. Results paged (100 per page); rows are `ClipSummary` (no html/rtf).

### Folder structure

```
E:\copy
├─ package.json
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ tsconfig.json              # references
├─ tsconfig.node.json         # main + preload + shared
├─ tsconfig.web.json          # renderer + shared
├─ .gitignore  .editorconfig  README.md
├─ build/                     # icon.ico icon.icns icon.png trayTemplate.png trayTemplate@2x.png tray.ico entitlements.mac.plist
├─ docs/DESIGN.md
└─ src/
   ├─ shared/
   │  ├─ types.ts             # domain types + DEFAULT settings
   │  ├─ ipc.ts               # IPC contract + window.api surface
   │  ├─ accelerator.ts       # KeyboardEvent -> Electron accelerator, pretty-print, validate
   │  ├─ transforms.ts        # pure text transforms
   │  └─ detect.ts            # pure kind detection (link/color/code) + preview text + subsequenceScore
   ├─ main/
   │  ├─ index.ts             # bootstrap
   │  ├─ log.ts  paths.ts
   │  ├─ ipc/typed.ts         # handle<C>() / emit<E>() helpers
   │  ├─ ipc/handlers.ts      # registers every InvokeContract channel
   │  ├─ settings/settingsStore.ts
   │  ├─ db/connection.ts  db/migrations.ts  db/clipRepository.ts  db/groupRepository.ts  db/snippetRepository.ts  db/search.ts
   │  ├─ images/imageStore.ts
   │  ├─ clipboard/watcher.ts  reader.ts  changeCounter.ts  concealed.ts  sourceApp.ts  writer.ts
   │  ├─ native/user32.ts  shell32.ts  objc.ts  coregraphics.ts   # koffi bindings, lazy, guarded
   │  ├─ paste/pasteService.ts  focusTracker.ts  keystroke.win32.ts  keystroke.darwin.ts
   │  ├─ hotkeys/hotkeyManager.ts
   │  ├─ windows/popupWindow.ts  settingsWindow.ts  placement.ts
   │  ├─ tray/tray.ts
   │  ├─ autostart.ts
   │  ├─ protocol.ts          # tuck://img/...
   │  ├─ maintenance/retention.ts
   │  └─ data/exportImport.ts
   ├─ preload/
   │  ├─ index.ts
   │  └─ index.d.ts           # declares window.api
   └─ renderer/
      ├─ index.html
      ├─ vite.config.ts       # standalone UI dev (mock api) only
      └─ src/
         ├─ main.tsx  App.tsx  lib/api.ts  lib/mockApi.ts  lib/keys.ts  lib/format.ts
         ├─ styles/tokens.css  styles/global.css
         ├─ store/popupStore.ts  settingsStore.ts  groupsStore.ts  snippetsStore.ts  toastStore.ts
         ├─ components/   (Button, Toggle, Select, NumberField, Field, Chip, Kbd, Menu, ContextMenu, Toast, VirtualList, Spinner, EmptyState, Icon)
         ├─ popup/        PopupApp.tsx  PopupShell.tsx  SearchBar.tsx  FilterBar.tsx  GroupPicker.tsx  CaptureBanner.tsx  ClipList.tsx  ClipRow.tsx  SectionHeader.tsx  PreviewPane.tsx  previews/{Text,Code,Image,Color,Link,Files,Snippet}Preview.tsx  EditClip.tsx  StatusBar.tsx  TransformMenu.tsx  GroupMenu.tsx  ShortcutsOverlay.tsx  usePopupKeys.ts
         └─ settings/     SettingsApp.tsx  TitleBar.tsx  NavRail.tsx  sections/{General,Shortcuts,History,Appearance,Privacy,About}Section.tsx  ShortcutRecorder.tsx  IgnoredAppsEditor.tsx
```

### Main-process modules

**`index.ts` boot order:** `requestSingleInstanceLock` (second instance → show popup) → `protocol.registerSchemesAsPrivileged` → `app.whenReady` → settingsStore.load → db.open + migrate → imageStore.init (orphan sweep) → `nativeTheme.themeSource` → createPopupWindow (hidden, preloaded) → tray → hotkeyManager.registerAll → watcher.start → retention.schedule → autostart.sync. macOS: `app.dock.hide()` (plus `LSUIElement`). `--hidden` arg accepted and ignored (always tray-only).

**`clipboard/changeCounter.ts`** — `current(): number`. Windows: `GetClipboardSequenceNumber()`. macOS: `[[NSPasteboard generalPasteboard] changeCount]` through koffi `objc_msgSend` (`objc_getClass`, `sel_registerName`). Fallback (koffi load failure): FNV hash of `availableFormats().join() + readText()` (image-only changes via `readImage().getSize()`).

**`clipboard/watcher.ts`** — `setInterval(poll, settings.history.pollIntervalMs)` (default 200). On counter change: debounce 60 ms (apps write multiple formats sequentially), then: skip if `expectOwnChange` flag set by the writer (auto-reset after 1500 ms); skip if paused; `concealed.isConcealed()` → skip; `sourceApp.current()` → skip if in `privacy.ignoredApps`; `reader.read()` → `NewClipInput | null`; `privacy.ignorePatterns` regex check on text; `clipRepository.upsert()` (dedupe by hash) → `emit('clips:changed')` → `retention.enforce()`. Errors logged, loop never stops.

**`clipboard/concealed.ts`** —
- macOS: `clipboard.availableFormats()` includes any of `org.nspasteboard.ConcealedType`, `org.nspasteboard.TransientType`, `org.nspasteboard.AutoGeneratedType`, `com.agilebits.onepassword`, `com.typeit4me.clipping` → concealed.
- Windows: Electron's `availableFormats()` only lists standard MIME names, so custom formats are checked natively: `IsClipboardFormatAvailable(RegisterClipboardFormatW(name))` for `ExcludeClipboardContentFromMonitorProcessing` and `Clipboard Viewer Ignore` → concealed. `CanIncludeInClipboardHistory`: if available, `clipboard.readBuffer('CanIncludeInClipboardHistory')` DWORD `0` → concealed. Fallback without koffi: `clipboard.readBuffer(name).length > 0`.

**`clipboard/reader.ts`** — `read(): NewClipInput | null`:
1. `formats = clipboard.availableFormats()`.
2. Files first: Windows → `shell32.ts` reads `CF_HDROP` via `OpenClipboard/GetClipboardData(15)/DragQueryFileW` (fallback `readBuffer('FileNameW')`, first file only); macOS → `readBuffer('NSFilenamesPboardType')` plist XML, extract `<string>` entries (fallback `clipboard.read('public.file-url')`). If ≥1 path → `kind: 'files'`.
3. `text = clipboard.readText()`. If `text.trim()` non-empty → text-family clip: `html = clipboard.readHTML()`, `rtf = clipboard.readRTF()` (each dropped if > 512 KB), `kind = detect.detectKind(text)`.
4. Else if formats include an image type (`image/png`, `image/jpeg`, `public.png`, `public.tiff`) and `history.captureImages` → `clipboard.readImage()`; skip if empty or PNG > `maxImageBytes`; `imageStore.save(id, png)` → `kind: 'image'`.
5. Else `null`.
Hash: `sha1(kind + '\0' + (image ? png : files ? files.join('\n') : text))`.

**`clipboard/sourceApp.ts`** — Windows: `GetForegroundWindow` → `GetWindowThreadProcessId` → `OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION)` → `QueryFullProcessImageNameW` → basename (`Code.exe`). macOS: `execFile('lsappinfo', ['info','-only','name', frontAsn])` with 150 ms timeout, cached 500 ms. Returns `null` on failure.

**`db/*`** — `connection.ts` opens `userData/tuck.db` with WAL; `migrations.ts` holds the SQL below keyed by version in `meta`; repositories expose typed methods; `search.ts` implements `list(query: ClipQuery)`.

**`images/imageStore.ts`** — `save(id, png): ClipImageMeta` (original + thumb via `nativeImage.resize`), `delete(id)`, `sweepOrphans(knownIds)`, `pathFor(id, variant)`.

**`protocol.ts`** — `protocol.handle('tuck', …)`: `tuck://img/full/<id>` and `tuck://img/thumb/<id>`; `id` validated against `/^[0-9a-f-]{36}$/`; `image/png`, `Cache-Control: max-age=31536000`.

**`settings/settingsStore.ts`** — `get()`, `set(patch)` (deep merge, range validation, atomic write, `emit('settings:changed')`, then side effects: theme, hotkeys, autostart, watcher interval, popup material), `reset()`.

**`hotkeys/hotkeyManager.ts`** — `registerAll()`, `set(id, accelerator): ShortcutSetResult` (validate → `invalid`; internal duplicate → `conflict-internal`; unregister old → `globalShortcut.register(new)`; on `false` re-register old → `conflict-system`), `status()`, `setRecording(bool)` (temporarily unregisters all so the recorder can capture the current combo). Emits `shortcuts:changed`.

**`windows/popupWindow.ts`** — created once, hidden:
```ts
new BrowserWindow({
  width: 760, height: 460, show: false, frame: false, resizable: false, movable: false,
  minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
  hasShadow: true, roundedCorners: true,
  transparent: isMac, vibrancy: isMac ? 'popover' : undefined, visualEffectState: 'active',
  backgroundMaterial: isWin11 && settings.appearance.vibrancy ? 'acrylic' : 'none',
  backgroundColor: isMac ? '#00000000' : undefined,
  webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false,
    additionalArguments: ['--window=popup'], spellcheck: false }
})
```
`show(trigger)`: `focusTracker.capture()` → `placement.compute(size)` → `setBounds` → `show()` + `focus()` → Windows: after 50 ms if `!isFocused()` call `user32.forceForeground(hwnd)` → `emit('popup:shown')`. `hide(reason)`: `hide()`; on macOS also `app.hide()` for `'paste'|'escape'` (returns activation to the previous app). `blur` → hide when `general.hideOnBlur`. `setLayout({previewVisible})` → width 760 or 480, re-clamped. macOS: `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })`, `setAlwaysOnTop(true, 'floating')`.

**`windows/placement.ts`** — `cursor = screen.getCursorScreenPoint()`, `display = screen.getDisplayNearestPoint(cursor)`, top-left at `cursor + (12, 12)`, clamped into `display.workArea` with 8 px margin; `'center'` centres in the display; `'remember'` reuses last bounds if still on a current display.

**`paste/focusTracker.ts`** — Windows: `capture()` stores `GetForegroundWindow()`; `restore()`: `SetForegroundWindow(hwnd)`; if false → `AttachThreadInput(GetCurrentThreadId(), GetWindowThreadProcessId(hwnd), true)` → `SetForegroundWindow` → detach. macOS: `restore()` = `app.hide()`.

**`paste/pasteService.ts`** — `perform(req: PasteRequest): PasteResult`:
1. Resolve content (clip / merged clips joined with `separator` / snippet body / raw text). Apply `transform` to text (drops html/rtf). `plain` drops html/rtf.
2. macOS: if `!systemPreferences.isTrustedAccessibilityClient(false)` → call with `true` once per session → return `{ ok: false, error: 'accessibility' }`, content still placed on the clipboard.
3. `watcher.expectOwnChange()`; `writer.write(content)` (`clipboard.write({ text, html, rtf })`, `clipboard.writeImage(nativeImage.createFromPath)`, files: Windows `writeBuffer('FileNameW')` first file + text fallback, macOS `writeBuffer('NSFilenamesPboardType', plist)`).
4. `popupWindow.hide('paste')` → `focusTracker.restore()` → wait `general.pasteDelayMs` (60) → Windows: wait until `GetAsyncKeyState` reports Ctrl/Shift/Alt/Win released (10 ms polls, max 600 ms) → `keystroke.send()`.
5. `clipRepository.markPasted(ids)` (`last_pasted_at`; `updated_at` if `moveToTopOnPaste`) → `emit('clips:changed', {reason:'pasted'})`.

**`paste/keystroke.win32.ts`** — koffi `SendInput` with 4 `INPUT` records (Ctrl down, V down, V up, Ctrl up; `KEYEVENTF_KEYUP = 2`):
```ts
const KEYBDINPUT = koffi.struct('KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
const MOUSEINPUT = koffi.struct('MOUSEINPUT', { dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
const HARDWAREINPUT = koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
const INPUT = koffi.struct('INPUT', { type: 'uint32', u: koffi.union('INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }) });
const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');
// SendInput(4, inputs, koffi.sizeof(INPUT))  // 40 bytes on x64; type=1 (INPUT_KEYBOARD), wVk 0x11 (Ctrl), 0x56 (V)
```
**`paste/keystroke.darwin.ts`** — koffi on `CoreGraphics.framework`: `CGEventCreateKeyboardEvent(NULL, 9 /*kVK_ANSI_V*/, true)`, `CGEventSetFlags(ev, 0x100000 /*Command*/)`, `CGEventPost(0 /*kCGHIDEventTap*/, ev)`, same with `keyDown=false`, `CFRelease`. Fallback: `execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'])`.

**`tray/tray.ts`** — menu: Open Tuck (shows accelerator), Pause capture (checkbox), separator, 5 recent clips (click = copy), separator, Launch at login (checkbox), Settings…, separator, Quit. Left click: Windows toggles popup; macOS opens menu. Tooltip "Tuck — capture paused" + dot overlay icon when paused.

**`autostart.ts`** — `app.setLoginItemSettings({ openAtLogin, openAsHidden: true, args: ['--hidden'] })`; no-op with warning when `!app.isPackaged`.

**`maintenance/retention.ts`** — delete non-pinned clips beyond `maxItems` (by `updated_at`) and older than `expireDays` (0 = never) plus their image files; runs after inserts and hourly. Deleted clips are kept 60 s in an in-memory undo ring (max 20) for `clips:undoDelete`.

**`data/exportImport.ts`** — JSON `{ format: 'tuck-export', version: 1, exportedAt, clips, groups, snippets }`; images inline base64 PNG when `includeImages`. Import merges by hash, matches groups by name, skips snippets with identical `(title, body)`.

### DB schema (`src/main/db/migrations.ts`, version 1)

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS clips (
  id             TEXT PRIMARY KEY,                 -- uuid v4; implicit rowid kept for FTS
  kind           TEXT NOT NULL CHECK (kind IN ('text','link','color','code','image','files')),
  text           TEXT,                             -- plain text; file paths joined by '\n'; NULL for image
  html           TEXT,
  rtf            TEXT,
  files_json     TEXT,                             -- JSON string[]
  image_json     TEXT,                             -- JSON ClipImageMeta
  preview        TEXT NOT NULL,                    -- single line, <= 200 chars
  hash           TEXT NOT NULL,
  byte_size      INTEGER NOT NULL DEFAULT 0,
  source_app     TEXT,
  pinned         INTEGER NOT NULL DEFAULT 0,
  pinned_at      INTEGER,
  copy_count     INTEGER NOT NULL DEFAULT 1,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,                 -- list order
  last_pasted_at INTEGER,
  meta_json      TEXT NOT NULL DEFAULT '{}'
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_clips_hash         ON clips(hash);
CREATE INDEX        IF NOT EXISTS idx_clips_updated      ON clips(updated_at DESC);
CREATE INDEX        IF NOT EXISTS idx_clips_kind_updated ON clips(kind, updated_at DESC);
CREATE INDEX        IF NOT EXISTS idx_clips_pinned       ON clips(pinned, pinned_at DESC);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, icon TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clip_groups (
  clip_id  TEXT NOT NULL REFERENCES clips(id)  ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (clip_id, group_id)
);
CREATE INDEX IF NOT EXISTS idx_clip_groups_group ON clip_groups(group_id);

CREATE TABLE IF NOT EXISTS snippets (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, keyword TEXT,
  group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0, usage_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
  text, content='clips', content_rowid='rowid', tokenize='trigram'
);
CREATE TRIGGER IF NOT EXISTS clips_ai AFTER INSERT ON clips BEGIN
  INSERT INTO clips_fts(rowid, text) VALUES (new.rowid, coalesce(new.text, ''));
END;
CREATE TRIGGER IF NOT EXISTS clips_ad AFTER DELETE ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, text) VALUES ('delete', old.rowid, coalesce(old.text, ''));
END;
CREATE TRIGGER IF NOT EXISTS clips_au AFTER UPDATE OF text ON clips BEGIN
  INSERT INTO clips_fts(clips_fts, rowid, text) VALUES ('delete', old.rowid, coalesce(old.text, ''));
  INSERT INTO clips_fts(rowid, text) VALUES (new.rowid, coalesce(new.text, ''));
END;

INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '1');
```

**Search (`db/search.ts`)** — `q = query.trim()`:
- Filter clause: `pinned` → `pinned=1`; `text` → `kind IN ('text','link','color','code')`; `images/links/files/colors/code` → single kind; `all` → none. `excludePinned` adds `pinned=0`; `groupId` adds `EXISTS (SELECT 1 FROM clip_groups …)`.
- `q === ''` → order `pinned_at DESC` (pinned filter) else `updated_at DESC`, `LIMIT/OFFSET`.
- `q.length >= 3` → `JOIN clips_fts f ON f.rowid = c.rowid WHERE clips_fts MATCH '"' || replace(q,'"','""') || '"'`, order `updated_at DESC`.
- `q.length < 3` → `text LIKE '%'||q||'%' ESCAPE '\'`.
- Fuzzy re-rank: if exact pass returned < `limit` and `q` has no spaces, run `subsequenceScore` over the 2000 most recent previews in the filter and append non-duplicate matches by score.

---

## D. Shared contract

### `src/shared/types.ts`

```ts
// Tuck shared domain types. Imported by main, preload and renderer. No electron/node imports.

export type Platform = 'win32' | 'darwin';
export type WindowKind = 'popup' | 'settings';

export type ClipKind = 'text' | 'link' | 'color' | 'code' | 'image' | 'files';

/** Popup filter chips. 'snippets' is served by snippets:list, not clips:list. */
export type FilterId = 'all' | 'pinned' | 'text' | 'images' | 'links' | 'files' | 'colors' | 'code' | 'snippets';
export type ClipFilterId = Exclude<FilterId, 'snippets'>;

export interface ClipImageMeta {
  width: number;
  height: number;
  bytes: number;          // stored PNG bytes
  file: string;           // relative to userData/images; load via tuck://img/full/<id>
  thumb: string;          // relative to userData/images/thumbs; load via tuck://img/thumb/<id>
  thumbWidth: number;
  thumbHeight: number;
}

export interface ClipMeta {
  url?: string;           // normalised URL for 'link'
  colorHex?: string;      // #RRGGBB[AA] for 'color'
  language?: string;      // guess for 'code' ('json','ts','py',…), '' unknown
  lineCount?: number;
  wordCount?: number;
  charCount?: number;
  fileCount?: number;
}

/** Lightweight row used by lists. Never carries html/rtf. */
export interface ClipSummary {
  id: string;
  kind: ClipKind;
  preview: string;        // single line, <= 200 chars. Image: "Image 1280×720". Files: first path.
  hasHtml: boolean;
  hasRtf: boolean;
  image: ClipImageMeta | null;
  files: string[] | null;
  byteSize: number;
  sourceApp: string | null;
  pinned: boolean;
  pinnedAt: number | null;
  copyCount: number;
  createdAt: number;      // epoch ms, first copy
  updatedAt: number;      // epoch ms, last copy/edit/paste — list sort key
  lastPastedAt: number | null;
  groupIds: string[];
  meta: ClipMeta;
}

/** Full clip, returned by clips:get. */
export interface Clip extends ClipSummary {
  text: string | null;    // text-family kinds; file paths joined by '\n'; null for images
  html: string | null;
  rtf: string | null;
  hash: string;
}

export interface ClipQuery {
  filter: ClipFilterId;
  groupId?: string | null;
  query: string;
  offset: number;
  limit: number;          // 1..500
  excludePinned?: boolean;
}

export interface ClipPage {
  items: ClipSummary[];
  total: number;          // matches ignoring offset/limit
  offset: number;
}

export interface ClipUpdate {
  id: string;
  text: string;           // html/rtf cleared; kind/meta/preview/hash re-derived
}

export const GROUP_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'violet', 'pink'] as const;
export type GroupColor = (typeof GROUP_COLORS)[number];

export interface Group {
  id: string;
  name: string;
  color: GroupColor | null;
  icon: string | null;    // lucide icon name
  sortOrder: number;
  createdAt: number;
  clipCount: number;
}

export interface GroupInput {
  name: string;
  color?: GroupColor | null;
  icon?: string | null;
}

export interface Snippet {
  id: string;
  title: string;
  body: string;
  keyword: string | null;
  groupId: string | null;
  sortOrder: number;
  usageCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface SnippetInput {
  title: string;
  body: string;
  keyword?: string | null;
  groupId?: string | null;
}

export type TransformId =
  | 'upper' | 'lower' | 'title' | 'trim' | 'collapseWhitespace' | 'removeLineBreaks'
  | 'jsonPretty' | 'jsonMinify' | 'stripFormatting';

export const TRANSFORMS: ReadonlyArray<{ id: TransformId; label: string; key: string }> = [
  { id: 'upper', label: 'UPPERCASE', key: 'U' },
  { id: 'lower', label: 'lowercase', key: 'L' },
  { id: 'title', label: 'Title Case', key: 'T' },
  { id: 'trim', label: 'Trim whitespace', key: 'W' },
  { id: 'collapseWhitespace', label: 'Collapse whitespace', key: 'C' },
  { id: 'removeLineBreaks', label: 'Remove line breaks', key: 'B' },
  { id: 'jsonPretty', label: 'JSON pretty', key: 'J' },
  { id: 'jsonMinify', label: 'JSON minify', key: 'M' },
  { id: 'stripFormatting', label: 'Plain text only', key: 'P' },
];

export type PasteRequest =
  | { type: 'clip'; clipId: string; plain?: boolean; transform?: TransformId | null }
  | { type: 'clips'; clipIds: string[]; separator?: string; plain?: boolean; transform?: TransformId | null }
  | { type: 'snippet'; snippetId: string }
  | { type: 'text'; text: string; html?: string | null };

export interface PasteResult {
  ok: boolean;
  /** 'accessibility': macOS permission missing — content was still placed on the clipboard. */
  error?: 'accessibility' | 'not-found' | 'clipboard' | 'keystroke' | 'unknown';
  message?: string;
}

export type ShortcutId = 'openPopup' | 'pasteLastPlain' | 'toggleCapture';

export interface ShortcutStatus {
  id: ShortcutId;
  accelerator: string;    // Electron accelerator, '' = unbound
  registered: boolean;
  error: string | null;
}

export interface ShortcutSetResult {
  ok: boolean;
  status: ShortcutStatus;
  error?: 'invalid' | 'conflict-internal' | 'conflict-system' | 'unknown';
  message?: string;
}

export interface CaptureState {
  paused: boolean;
  pausedAt: number | null;
}

export type ThemeMode = 'system' | 'light' | 'dark';
export type Density = 'comfortable' | 'compact';
export type PopupPosition = 'cursor' | 'center' | 'remember';
export type SettingsSection = 'general' | 'shortcuts' | 'history' | 'appearance' | 'privacy' | 'about';

export interface Settings {
  general: {
    launchAtLogin: boolean;
    hideOnBlur: boolean;
    moveToTopOnPaste: boolean;
    pasteDelayMs: number;        // 0..1000
    mergeSeparator: string;
    showSourceApp: boolean;
  };
  shortcuts: Record<ShortcutId, string>;
  history: {
    maxItems: number;            // 50..100000
    expireDays: number;          // 0 = never, 0..3650
    dedupe: boolean;
    captureImages: boolean;
    captureFiles: boolean;
    maxImageBytes: number;
    pollIntervalMs: number;      // 100..2000
  };
  appearance: {
    theme: ThemeMode;
    density: Density;
    vibrancy: boolean;
    previewVisible: boolean;
    popupPosition: PopupPosition;
    showQuickPasteBadges: 'always' | 'modifier' | 'never';
  };
  privacy: {
    skipConcealed: boolean;
    ignoredApps: string[];       // Win: exe basename (case-insensitive); mac: app name
    ignorePatterns: string[];    // regex sources; matching text clips are not captured
  };
}

export type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export function defaultSettings(platform: Platform): Settings {
  const mac = platform === 'darwin';
  return {
    general: { launchAtLogin: true, hideOnBlur: true, moveToTopOnPaste: true, pasteDelayMs: 60, mergeSeparator: '\n', showSourceApp: true },
    shortcuts: { openPopup: mac ? 'Command+Shift+V' : 'Control+`', pasteLastPlain: '', toggleCapture: '' },
    history: { maxItems: 5000, expireDays: 90, dedupe: true, captureImages: true, captureFiles: true, maxImageBytes: 25 * 1024 * 1024, pollIntervalMs: 200 },
    appearance: { theme: 'system', density: 'comfortable', vibrancy: true, previewVisible: true, popupPosition: 'cursor', showQuickPasteBadges: 'modifier' },
    privacy: { skipConcealed: true, ignoredApps: [], ignorePatterns: [] },
  };
}

export interface Stats {
  totalClips: number;
  pinnedClips: number;
  imageClips: number;
  dbBytes: number;
  imagesBytes: number;
  oldestAt: number | null;
}

export interface AppInfo {
  name: string;
  version: string;
  platform: Platform;
  arch: string;
  electron: string;
  chrome: string;
  node: string;
  isPackaged: boolean;
  userDataPath: string;
  dbPath: string;
  imagesPath: string;
  accessibilityTrusted: boolean | null;   // null on Windows
  launchAtLoginSupported: boolean;
}

export interface ExportRequest { includeImages: boolean }
export interface ExportResult { ok: boolean; canceled: boolean; path?: string; clips?: number; error?: string }
export interface ImportResult { ok: boolean; canceled: boolean; imported: number; skipped: number; groups: number; snippets: number; error?: string }

export interface ClipsChangedEvent {
  reason: 'added' | 'updated' | 'deleted' | 'cleared' | 'imported' | 'restored' | 'pasted';
  ids: string[];
}

export interface PopupShownEvent {
  trigger: 'hotkey' | 'tray' | 'second-instance' | 'api';
  filter?: FilterId;
}

export interface NotifyEvent {
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  durationMs?: number;   // default 3000
}

export const LIMITS = {
  previewChars: 200,
  listPageSize: 100,
  maxHtmlBytes: 512 * 1024,
  maxRtfBytes: 512 * 1024,
  maxTextBytes: 4 * 1024 * 1024,
  thumbMaxSide: 240,
  undoRingSize: 20,
  undoWindowMs: 60_000,
} as const;
```

### `src/shared/ipc.ts`

```ts
// Tuck IPC contract: channel names, payloads, main->renderer events, and the preload window.api surface.
// Main implements every InvokeContract channel with ipcMain.handle and emits EventContract channels
// with webContents.send. Renderer only touches window.api.
import type {
  AppInfo, CaptureState, Clip, ClipPage, ClipQuery, ClipSummary, ClipUpdate, ClipsChangedEvent, DeepPartial,
  ExportRequest, ExportResult, Group, GroupInput, ImportResult, NotifyEvent, PasteRequest, PasteResult,
  Platform, PopupShownEvent, Settings, SettingsSection, ShortcutId, ShortcutSetResult, ShortcutStatus,
  Snippet, SnippetInput, Stats, WindowKind,
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
  // app
  'app:getInfo':         { req: void;                                      res: AppInfo };
  'app:openExternal':    { req: { url: string };                           res: void };
  'app:revealPath':      { req: { path: string };                          res: void };
  /** macOS: prompts the Accessibility dialog; resolves current trust state. */
  'app:requestAccessibility': { req: void;                                 res: { trusted: boolean } };
  'app:quit':            { req: void;                                      res: void };
  'app:relaunch':        { req: void;                                      res: void };
}

/** main -> renderer (webContents.send), broadcast to every window. */
export interface EventContract {
  'clips:changed':     ClipsChangedEvent;
  'groups:changed':    { ids: string[] };
  'snippets:changed':  { ids: string[] };
  'settings:changed':  Settings;
  'shortcuts:changed': ShortcutStatus[];
  'capture:changed':   CaptureState;
  'popup:shown':       PopupShownEvent;
  'popup:hidden':      { reason: 'escape' | 'paste' | 'blur' | 'action' };
  'settings:navigate': { section: SettingsSection };
  'app:notify':        NotifyEvent;
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
  'app:getInfo': true, 'app:openExternal': true, 'app:revealPath': true, 'app:requestAccessibility': true,
  'app:quit': true, 'app:relaunch': true,
};

export const EVENT_CHANNELS: Record<EventChannel, true> = {
  'clips:changed': true, 'groups:changed': true, 'snippets:changed': true, 'settings:changed': true,
  'shortcuts:changed': true, 'capture:changed': true, 'popup:shown': true, 'popup:hidden': true,
  'settings:navigate': true, 'app:notify': true,
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
```

### Preload (`src/preload/index.ts`)

```ts
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
```

`src/preload/index.d.ts`:
```ts
import type { TuckApi } from '../shared/ipc';
declare global { interface Window { api: TuckApi } }
export {};
```

Main-side typed helpers (`src/main/ipc/typed.ts`):
```ts
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
```

### `src/shared/accelerator.ts` (signatures)

```ts
export function fromKeyboardEvent(e: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; metaKey: boolean }, platform: Platform): string | null; // null for modifier-only
export function validate(accel: string, platform: Platform): { ok: true } | { ok: false; reason: string };  // >=1 modifier unless F1..F24
export function pretty(accel: string, platform: Platform): string;        // "Ctrl+Shift+V" / "⌘⇧V"
export function prettyParts(accel: string, platform: Platform): string[]; // ["⌘","⇧","V"] for <Kbd>
```
Accelerator names: `Control`, `Shift`, `Alt`, `Command` (mac) / `Super` (win); keys `A–Z`, `0–9`, `F1–F24`, `Space`, `Tab`, `Backspace`, `Delete`, `Insert`, `Return`, arrows, `Home/End/PageUp/PageDown`, `Escape`; punctuation from `KeyboardEvent.code` (`Backquote` → `` ` ``, `Minus` → `-`, `Equal` → `=`, `BracketLeft/Right` → `[`/`]`, `Backslash` → `\`, `Semicolon` → `;`, `Quote` → `'`, `Comma` → `,`, `Period` → `.`, `Slash` → `/`).

---

## E. Renderer UI spec

### Windows and routing

Same bundle; `App.tsx` reads `window.location.hash` (`#/popup` default, `#/settings`); main loads `index.html#/popup` and `index.html#/settings`. `window.api.windowKind` must agree; the route wins if they differ.

**Stack:** React 19 (Phase 0, §0), **zustand 5** (no providers, selectors keep rows cheap), **CSS Modules + CSS variables** (Vite built-in, zero deps; Tailwind rejected to keep bundle/config minimal), `lucide-react` icons. Data fetching via `window.api` wrapped in `lib/api.ts` (`export const api = window.api ?? mockApi`).

### Popup layout

- **760 × 460** with preview; **480 × 460** list-only. Window radius 12, 1 px `--border` ring, OS shadow.
- Vertical stack: SearchBar 48 → FilterBar 36 → optional CaptureBanner 28 → body (flex) → StatusBar 26.
- Body: ClipList (flex 1, min 440) | 1 px divider | PreviewPane (fixed 300).
- Rows: 44 px comfortable / 36 compact. Anatomy: `[quick-badge 18][kind glyph or 28×28 thumb or 14 px colour dot][preview text, ellipsis][meta: source app · relative time][pin icon]`.
- Sticky section headers (24 px, `--fg-3`, uppercase 11 px): **Pinned** (All filter only), **Today**, **Yesterday**, **This week**, **Earlier**.
- Selected row: `--bg-selected` + 3 px accent bar at left; multi-selected rows show a filled check circle.

### Component tree

```
PopupApp
└─ PopupShell (data-density, data-vibrancy, onKeyDown=usePopupKeys)
   ├─ SearchBar       Search icon · <input autoFocus> · clear (×) · hint "⌘," (settings)
   ├─ FilterBar       Chip×9 (All Pinned Text Images Links Files Colors Code Snippets) · spacer · GroupPicker ("Collections ▾")
   ├─ CaptureBanner   "Capture paused — Resume" | macOS: "Accessibility permission needed to paste — Grant"
   ├─ SplitPane
   │  ├─ ClipList (VirtualList, ~60-line in-house windowing, fixed row height) → SectionHeader · ClipRow[] (or SnippetRow[] under Snippets)
   │  └─ PreviewPane → PreviewHeader (kind, size, dims, source, copied/pasted times, group chips)
   │                   · TextPreview | CodePreview | ImagePreview | ColorPreview | LinkPreview | FilesPreview | SnippetPreview
   │                   · EditClip (textarea; Save ⌘↵ / Cancel Esc) when editing
   ├─ StatusBar       "1,284 clips · ↑↓ navigate · ↵ paste · ⇧↵ plain · ? shortcuts"
   ├─ ContextMenu     (right click on a row)
   ├─ TransformMenu   (Ctrl/Cmd+T)
   ├─ GroupMenu       (Ctrl/Cmd+G; checkbox list + "New collection…")
   ├─ ShortcutsOverlay (?)
   └─ Toasts          (aria-live="polite")
```

### Popup keyboard map (focus always stays in the search input; the list is driven via `aria-activedescendant`)

| Keys | Action |
|---|---|
| `↑` / `↓` | Move selection (`PageUp/PageDown` move 10) |
| `Home` / `End` | First/last row when query is empty; otherwise caret movement |
| `Enter` | Paste selection (merged if multi-select) and hide |
| `Shift+Enter` | Paste as plain text |
| `Ctrl/Cmd+Enter` | Paste with last-used transform |
| `Ctrl/Cmd+1..9` | Quick paste nth visible row (badges appear while modifier is held) |
| `Esc` | Hide popup (selection and query reset on next show; filter kept) |
| `Tab` / `Shift+Tab` | Next/previous filter chip |
| `Ctrl/Cmd+Space` | Toggle multi-select on current row; `Shift+↑/↓` extends; `Ctrl/Cmd+A` selects all visible |
| `Ctrl/Cmd+P` | Pin / unpin |
| `Ctrl/Cmd+E` | Edit text (preview pane becomes editor; `Ctrl/Cmd+Enter` save, `Esc` cancel) |
| `Ctrl/Cmd+C` | Copy to clipboard without pasting, hide |
| `Delete` (Win) / `Cmd+Backspace` (mac) | Delete selection; toast "Deleted · Undo" |
| `Ctrl/Cmd+Z` | Undo last delete (within 60 s) |
| `Ctrl/Cmd+T` | Transform menu, then `U/L/T/W/C/B/J/M/P` or arrows+Enter |
| `Ctrl/Cmd+G` | Collections menu for current row |
| `Ctrl/Cmd+S` | Save current clip as snippet (inline title field in preview) |
| `Ctrl/Cmd+N` | New snippet (switches to Snippets filter, opens editor) |
| `Ctrl/Cmd+.` | Toggle preview pane (persists `appearance.previewVisible`) |
| `Ctrl/Cmd+,` | Open settings |
| `Ctrl/Cmd+Shift+C` | Clear search |
| `?` (query empty) / `Ctrl/Cmd+/` | Shortcuts overlay |
| `Alt+click` row | Open link / reveal file / open image |

Mouse: click selects, double-click pastes, right-click context menu (Paste, Paste plain, Paste as ▸, Copy, Pin, Add to collection ▸, Edit, Save as snippet, Open link/Reveal, Delete). Hover reveals pin button and time.

### State (`store/popupStore.ts`)

```ts
interface PopupState {
  query: string; filter: FilterId; groupId: string | null;
  items: ClipSummary[]; pinned: ClipSummary[]; total: number; loading: boolean; requestId: number;
  snippets: Snippet[];
  selectedId: string | null; multi: Set<string>; anchorId: string | null;
  previewVisible: boolean; editing: boolean; menu: 'none' | 'context' | 'transform' | 'group' | 'help';
  lastTransform: TransformId | null; modifierHeld: boolean;
  setQuery; setFilter; setGroup; moveSelection(delta); select(id, mode: 'single' | 'toggle' | 'range');
  refresh(); loadMore(); paste(opts); pin(); remove(); undo(); edit(text); togglePreview();
}
```
`refresh()` runs on `popup:shown`, query/filter/group changes (debounced 40 ms) and `clips:changed` (debounced 50 ms). Each request carries `requestId`; stale responses are dropped. In the All filter it issues `clips:list({filter:'pinned', limit: 50})` and `clips:list({filter:'all', excludePinned: true, limit: 100})` in parallel. Selection is restored by id, else first row. `loadMore()` appends the next page when the virtual list nears its end.

### Empty states

- No clips at all: folded-corner illustration, "Nothing tucked away yet", "Copy anything — it shows up here. Press `Ctrl+\`` any time."
- No search results: "No matches for "foo"", secondary "Search all" when a filter is active.
- Pinned empty: "Pin clips you reuse with `Ctrl+P`. Pinned clips never expire."
- Collection empty: "Add clips with `Ctrl+G`."
- Snippets empty: "Create a snippet with `Ctrl+N`."
- Images disabled: "Image capture is off — enable in Settings › History."

### Micro-interactions

- Popup show: 90 ms scale 0.98→1 + fade; hide is instant.
- Row hover 60 ms background; selection moves without animation; pin icon pops 1→1.2→1 (120 ms); delete slides row left 120 ms; toast slides up from StatusBar.
- Quick-paste badges fade in while `Ctrl/Cmd` is held (`showQuickPasteBadges: 'modifier'`).
- Thumbnails lazy-load with 100 ms fade; colour rows show the swatch in the glyph slot; link rows show hostname as meta.
- Search spinner only if a query takes > 120 ms. Preview pane cross-fades 80 ms.

### Accessibility

- Search `input`: `role="combobox"`, `aria-controls="clip-list"`, `aria-activedescendant`; list `role="listbox"`, rows `role="option"` + `aria-selected`; sections `role="group"` + `aria-label`.
- Filter bar `role="tablist"`; chips `role="tab"`. Menus `role="menu"` with arrow navigation and typeahead; `Esc` returns focus to the input.
- Toasts `aria-live="polite"`; errors `assertive`. 2 px accent focus ring (`:focus-visible`), contrast ≥ 4.5:1 for `--fg-2`, `prefers-reduced-motion` disables transitions, `prefers-contrast: more` swaps `--border` for `--border-strong`.

### Settings window

920 × 640 (min 760 × 520), resizable, `titleBarStyle: 'hidden'` + `titleBarOverlay` (Windows) / `hiddenInset` (macOS); `TitleBar` is a drag region. Left `NavRail` 200 px (General, Shortcuts, History, Appearance, Privacy, About), content column max 640 px, cards with `Field` rows (label + description + control). Every change saves immediately via `settings:set`; the store reflects `settings:changed`.

- **General:** Launch at login (disabled with note in dev), Hide popup on blur, Move pasted clip to top, Paste delay (ms), Merge separator (New line / Space / Comma / Custom), Show source app.
- **Shortcuts:** `ShortcutRecorder` per shortcut (Open Tuck, Paste last as plain, Toggle capture). Recorder: button shows `<Kbd>` parts; click → "Press keys… (Esc cancel, Backspace clear)" and `shortcuts:setRecording(true)`; keydown builds the accelerator and calls `shortcuts:set`; states: green "Registered"; red "Already in use by another app" (display reverts); amber "Needs a modifier". `setRecording(false)` on blur/complete. Footer notes known conflicts (VS Code terminal uses `Ctrl+\``; macOS "Paste and Match Style" uses `Cmd+Shift+V`) and a "Test" hint.
- **History:** Max items, Expire after N days (0 = never), Dedupe, Capture images + Max image size (MB), Capture files, Poll interval (advanced), Storage card (`stats:get`) with "Clear history…" (confirm dialog, "Keep pinned" checkbox).
- **Appearance:** Theme (segmented System/Light/Dark), Density, Translucent background, Show preview by default, Popup position, Quick-paste badges.
- **Privacy:** Skip concealed content, Ignored apps editor (list + add, suggestions from recent `sourceApp` values), Ignore patterns (regex list, live validity), Pause capture toggle.
- **About:** icon, name, version, Electron/Chrome versions, Export… (include images checkbox), Import…, Open data folder, Reset settings, licences, macOS Accessibility status with "Open System Settings".

---

## F. Work breakdown (3 engineers, non-overlapping ownership)

### Phase 0 — Lead (Engineer 1), day 1, blocks the others

Owns: `package.json`, `electron.vite.config.ts`, `electron-builder.yml`, `tsconfig*.json`, `.gitignore`, `README.md`, `build/*`, `docs/*`, **`src/shared/*`** (types, ipc, accelerator, transforms, detect + `*.test.ts`), **`src/preload/*`**, `src/renderer/index.html`, `src/renderer/vite.config.ts`, `src/renderer/src/styles/tokens.css`, `src/renderer/src/lib/api.ts`, `src/main/ipc/typed.ts`.

Deliverable: `npm run dev` opens an empty popup and settings window that log `window.api.platform`; `npm run typecheck` and `npm test` pass; commit tagged `scaffold`. Afterwards the lead reviews PRs and owns CI, icons, packaging, integration.

### Engineer 2 — Main process (after Phase 0)

Owns everything under `src/main/` except `ipc/typed.ts`. Sequence:
1. `paths.ts`, `log.ts`, `settings/settingsStore.ts`, `db/connection.ts`, `db/migrations.ts`.
2. `db/clipRepository.ts`, `db/search.ts`, `db/groupRepository.ts`, `db/snippetRepository.ts`, `images/imageStore.ts`, `protocol.ts`, `ipc/handlers.ts` — renderer can go live against real data here.
3. `native/*`, `clipboard/*` (watcher online), `maintenance/retention.ts`.
4. `windows/*`, `hotkeys/*`, `tray/*`, `autostart.ts`, `paste/*`.
5. `data/exportImport.ts`, polish, error paths.

### Engineer 3 — Renderer (after Phase 0)

Owns everything under `src/renderer/src/` except `styles/tokens.css` and `lib/api.ts`. Builds against `lib/mockApi.ts` (owned by Engineer 3; used when `window.api` is undefined, i.e. `npm run dev:ui` in a browser) with seeded fake clips of every kind. Sequence:
1. `global.css`, primitives in `components/`, `VirtualList`.
2. Popup: shell, search, filters, list, keyboard map (`usePopupKeys.ts`), preview pane, paste flow.
3. Menus, multi-select, edit, snippets, collections, toasts, empty states.
4. Settings window, all sections, `ShortcutRecorder`.
5. Accessibility pass, density/vibrancy, reduced motion.

### Integration and verification (lead drives)

1. Swap mock for real: `npm run dev`; copy text/image/files from Notepad/Explorer (Finder/Preview on mac); verify rows, dedupe, source app, thumbnails via `tuck://`.
2. Hotkey opens popup at cursor on each monitor, clamped at edges and at 125 %/150 % DPI; `Enter` pastes into Notepad, VS Code, Chrome address bar, Word; `Shift+Enter` plain into Word; image into Paint; file list into Explorer.
3. Shortcut recorder: change to `Ctrl+Shift+Space`, verify live; set an invalid combo (no modifier) → amber; a combo held by another app → red, old binding kept.
4. Concealed: copy from KeePass/1Password/Bitwarden → not captured. Ignored apps: add `notepad.exe` → not captured.
5. Retention: `maxItems=60`, copy 70 items → oldest 10 non-pinned gone, pinned remain; `expireDays` via faked `updated_at`.
6. Pause/resume from tray; launch-at-login toggles `HKCU\...\Run` / macOS Login Items; export → import into a wiped `userData`.
7. macOS: Accessibility denied path shows banner, content still on clipboard; after granting, paste works; popup over fullscreen app.
8. `npm run dist:win` installs via NSIS; koffi loads from `app.asar.unpacked` and `node:sqlite` opens the DB; `npm run dist:mac` DMG runs (unsigned → right-click Open).

---

## G. Risks and platform caveats

- **No clipboard change event in Electron** → polling. Mitigated with native change counters (free on both platforms); pure fallback reads text every 300 ms. Bursty writers (Office) bump the counter several times → 60 ms debounce.
- **Native modules:** only `koffi` (N-API prebuilts per platform via `@koromix/koffi-*` optional packages, no compile); it lives in `dependencies` and `asarUnpack`. SQLite is `node:sqlite` built into Electron's Node (Phase 0, §0) — when bumping Electron, re-run the §0 FTS5-trigram smoke test (`node:sqlite` is newer than the rest of Node's stable API surface, so verify on every Electron major).
- **Windows foreground rules:** `SetForegroundWindow` may be refused unless our process received the last input; the hotkey press counts, and `AttachThreadInput` is the documented workaround. `forceForeground` runs 50 ms after show if the popup is not focused.
- **Modifier still held** when sending `Ctrl+V` (quick paste `Ctrl+1`): wait for physical release via `GetAsyncKeyState` (max 600 ms).
- **macOS Accessibility:** CGEvent posting and osascript both require trust in System Settings › Privacy & Security › Accessibility. The dev build is `Electron.app`, so trust it separately. Never block capture on it.
- **Default hotkey collisions:** macOS `Cmd+Shift+V` = "Paste and Match Style" in some apps; Windows `Ctrl+\`` = VS Code terminal toggle. Documented in Shortcuts settings with one-click alternatives (`Cmd+Shift+Space`, `Ctrl+Cmd+V`, `Ctrl+Shift+Space`).
- **`globalShortcut.register` on macOS** can return `true` for system-intercepted combos; settings shows a "Test" hint.
- **Windows custom clipboard formats** are invisible to `clipboard.availableFormats()`; the koffi path is required for reliable concealed-content detection.
- **File lists:** Electron has no cross-platform file-list API; Windows `CF_HDROP` via koffi (read) and `FileNameW` (write, first file only — multi-file clips paste as text paths). macOS plist formats are stable but undocumented.
- **Acrylic on Windows** needs 22H2+; otherwise solid. Transparent + acrylic combinations are buggy, so the Windows popup is non-transparent and relies on DWM rounded corners.
- **Large images:** `readImage()` decodes on every change containing an image; capped by `maxImageBytes`; repeated 50 MB screenshots cause brief main-thread stalls (move to a worker later).
- **Privacy:** history is plaintext on disk in `userData`; encryption-at-rest is a later feature. Concealed detection depends on password managers tagging their copies (1Password, Bitwarden, KeePassXC, Windows Hello do).
- **Signing/notarization:** unsigned Windows builds trigger SmartScreen (plan EV / Azure Trusted Signing). macOS needs Developer ID + notarization (`electron-builder` `notarize: true`, env `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`), hardened runtime with `entitlements.mac.plist`. `LSUIElement` keeps Tuck out of the Dock; the macOS login item persists only when the app lives in `/Applications`.

---

## H. package.json

*Phase 0 update:* the authoritative files are now in the repo — `package.json`, `electron-builder.yml`, `electron.vite.config.ts`, `tsconfig*.json`, `vitest.config.mts`. Versions and deviations are listed in §0. Current `package.json`:

```json
{
  "name": "tuck",
  "productName": "Tuck",
  "version": "0.1.0",
  "description": "Everything you've copied, one keystroke away.",
  "main": "./out/main/index.js",
  "author": "Tuck",
  "license": "MIT",
  "private": true,
  "engines": {
    "node": ">=22.12"
  },
  "scripts": {
    "dev": "electron-vite dev",
    "dev:ui": "vite serve src/renderer --config src/renderer/vite.config.ts --port 5174",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "icons": "node scripts/gen-icons.mjs",
    "dist:dir": "npm run build && electron-builder --dir",
    "dist:win": "npm run build && electron-builder --win nsis",
    "dist:mac": "npm run build && electron-builder --mac dmg"
  },
  "dependencies": {
    "koffi": "^3.3.3"
  },
  "devDependencies": {
    "@types/node": "^24.19.2",
    "@types/react": "^19.3.0",
    "@types/react-dom": "^19.3.0",
    "@vitejs/plugin-react": "^6.1.2",
    "electron": "^44.9.0",
    "electron-builder": "^26.15.3",
    "electron-vite": "^6.0.0",
    "fflate": "^0.8.3",
    "lucide-react": "^1.59.0",
    "react": "^19.3.1",
    "react-dom": "^19.3.1",
    "typescript": "^7.0.2",
    "vite": "^8.3.4",
    "vitest": "^5.0.5",
    "zustand": "^5.0.15"
  }
}
```

React, zustand, lucide and fflate are devDependencies on purpose: electron-vite bundles them and electron-builder only packs `dependencies` into the asar, so the installer stays lean. The only runtime dependency is `koffi` (prebuilt N-API binary, no rebuild); SQLite is Node's built-in `node:sqlite`, so there is no `postinstall`/`install-app-deps` step.

### Critical Files for Implementation

- E:\copy\src\shared\ipc.ts — the contract both engineers code against
- E:\copy\src\shared\types.ts — domain model and settings defaults
- E:\copy\src\main\clipboard\watcher.ts — capture loop, dedupe, concealed/ignore logic
- E:\copy\src\main\paste\pasteService.ts — hide → restore focus → keystroke flow (with `paste/focusTracker.ts`, `native/user32.ts`)
- E:\copy\src\renderer\src\popup\usePopupKeys.ts — the keyboard-first behaviour that makes the popup feel like Ditto
---

## I. Import from Ditto (MVP addition)

Users switching from Ditto can bring their whole history, pins and groups. Entry points: Settings › About › **Import from Ditto…**, plus a one-time card in Settings › General when a Ditto database is auto-detected (`%APPDATA%\Ditto\Ditto.db`, also checks the Ditto install dir for portable `Ditto.db`). Works on macOS too (file picked manually — the parser is pure JS, no Windows APIs).

### Accepted files (format detected by magic bytes, never by extension)

| Magic | Handling |
|---|---|
| `SQLite format 3\0` | Open directly, read-only (`.db`, `.zdb`, `.bak`, anything). |
| `PK\x03\x04` (zip) | Unzip in memory with `fflate` (devDependency, bundled into main); take the first entry whose bytes start with the SQLite magic; write to a temp file in `os.tmpdir()`; open it read-only. |
| `\x1f\x8b` (gzip) | `zlib.gunzipSync` → must start with SQLite magic → temp file. |
| other | `{ ok:false, error:'unrecognized' }` — "This doesn't look like a Ditto database." |

The source file is never written. Temp files are deleted in `finally`. If `Main` or `Data` tables are missing → `error: 'not-ditto'`.

### Ditto schema (relevant columns)

```
Main(lID INTEGER PK, lDate INTEGER /*unix seconds*/, mText TEXT /*description*/, lDontAutoDelete INTEGER,
     bIsGroup INTEGER, lParentID INTEGER /*group lID, -1/0 = none*/, QuickPasteText TEXT,
     lastPasteDate INTEGER, stickyClipOrder REAL, clipOrder REAL)
Data(lID INTEGER PK, lParentID INTEGER /*Main.lID*/, strClipBoardFormat TEXT, ooData BLOB)
```
Columns can be missing in old Ditto versions → read `PRAGMA table_info(Main)` and select only columns that exist (missing → NULL).

### Mapping

- `bIsGroup = 1` rows → Tuck `groups` (name = `mText`, matched by name case-insensitively with existing groups, nested Ditto groups flattened). Clip `lParentID` → membership in that group.
- Pinned = `lDontAutoDelete > 0` OR (`stickyClipOrder` not NULL and > -2147483647, i.e. Ditto "sticky" clip).
- `createdAt = updatedAt = lDate * 1000` (fallback now); `lastPastedAt = lastPasteDate*1000` if > 0; `sourceApp = 'Ditto import'` is NOT set — leave null; `meta.importedFrom = 'ditto'` is not needed.
- Formats per clip (from `Data`), priority:
  - `CF_UNICODETEXT` → UTF-16LE, strip trailing `\0`. Else `CF_TEXT` / `CF_OEMTEXT` → latin1, strip `\0`.
  - `HTML Format` → UTF-8 CF_HTML; parse `StartFragment:`/`EndFragment:` byte offsets (fallback `<!--StartFragment-->` markers, fallback whole body) → `html`.
  - `Rich Text Format` → latin1 string → `rtf`.
  - `CF_HDROP` → `DROPFILES` struct: `pFiles` (uint32 @0), `fWide` (uint32 @16); list of NUL-terminated paths (UTF-16LE if fWide else latin1) ending in a double NUL → `files` kind.
  - `PNG` → bytes as-is. Else `CF_DIB` / `CF_DIBV5` → decode `BITMAPINFOHEADER` (biSize, width, height (negative = top-down), bitCount 24/32, compression BI_RGB(0) / BI_BITFIELDS(3); masks after header for BITFIELDS when biSize==40; palette for ≤8 bpp → skip clip), rows padded to 4 bytes, bottom-up → BGRA buffer → `nativeImage.createFromBitmap(buf,{width,height})` → `toPNG()` → `imageStore.save`. 32-bpp with all-zero alpha → force alpha 255.
  - Precedence for kind: files > text (with html/rtf alternates) > image. Nothing decodable → skipped.
- Text clips run through the normal `detect.detectKind`, preview and hash pipeline → **dedupe against existing Tuck history by hash** (existing clip keeps its row; pin is OR-ed; groups added).
- Respect `LIMITS` (truncate html/rtf over limit; skip text over `maxTextBytes`; images over `maxImageBytes`).
- Import is chunked: 200 clips per `db.transaction`, `await setImmediate` between chunks; emits `data:importProgress` after each chunk; on finish emits `clips:changed {reason:'imported'}` and `groups:changed`. Retention is NOT applied to imported clips during import (run once after; imported pins exempt as usual) — but warn in result if `imported > history.maxItems` that older clips will be trimmed; the UI offers to raise max items before importing (shows count from `data:inspectDitto`).

### Contract additions (included in `src/shared/types.ts` / `ipc.ts`)

```ts
// types.ts
export interface DittoDetectResult { found: boolean; path: string | null }
export interface DittoInspectResult { ok: boolean; path: string; clips: number; groups: number; pinned: number; error?: DittoImportError }
export type DittoImportError = 'canceled' | 'unrecognized' | 'not-ditto' | 'read-failed' | 'unknown';
export interface DittoImportRequest { path?: string | null /* null/undefined → open file dialog */; includeImages: boolean; includeGroups: boolean }
export interface DittoImportResult { ok: boolean; canceled: boolean; imported: number; merged: number; skipped: number; groups: number; images: number; error?: DittoImportError; message?: string }
export interface ImportProgressEvent { source: 'ditto' | 'tuck'; done: number; total: number }

// ipc.ts InvokeContract
'data:detectDitto':  { req: void; res: DittoDetectResult };
'data:pickDittoFile':{ req: void; res: { canceled: boolean; path: string | null } };   // dialog filters: Ditto database (*.db;*.zdb;*.zip;*.bak), All files
'data:inspectDitto': { req: { path: string }; res: DittoInspectResult };
'data:importDitto':  { req: DittoImportRequest; res: DittoImportResult };
// ipc.ts EventContract
'data:importProgress': ImportProgressEvent;
```

### Files
- Main: `src/main/data/dittoImport.ts` (detect/inspect/import), `src/main/data/dittoFormats.ts` (pure decoders: utf16, CF_HTML, DROPFILES, DIB→BGRA — unit-tested with fixtures built in tests), `src/main/data/sqliteOpen.ts` (magic sniff + unzip/gunzip to temp).
- Renderer: `src/renderer/src/settings/DittoImportCard.tsx` (detect → inspect → options [include images, include collections] → progress bar → result summary), used in General (when detected & not dismissed — `localStorage` flag) and About.
