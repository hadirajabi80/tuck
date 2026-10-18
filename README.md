# Tuck

**Everything you've copied, one keystroke away.**

Tuck is a keyboard-first clipboard manager for Windows 11 and macOS, built with Electron — Ditto's speed with a modern, quiet UI.

> Status: Phase 0 scaffold. The shared contract, preload bridge, build setup and icons are in place; the main process and UI are being implemented. See [`docs/DESIGN.md`](docs/DESIGN.md) (§0 has the current versions and decisions).

## Features (MVP)

- Captures text (with HTML/RTF alternates), images, file lists, links, colours and code — deduped by content, tagged with the source app.
- Global hotkey (`Ctrl+\`` on Windows, `⌘⇧V` on macOS) opens a popup at the cursor; type to search (substring + fuzzy), `Enter` pastes into the app you were using.
- Pins, collections, snippets, quick paste `Ctrl/⌘+1…9`, paste as plain text, multi-select merge, edit, transforms (case, trim, JSON pretty/minify, …), preview pane.
- Privacy: skips password-manager (concealed) copies, ignore lists for apps and patterns, pause capture.
- Settings for shortcuts, history limits/expiry, appearance (light/dark/system, density, translucency), import/export.
- **Import from Ditto**: bring your Ditto history, pins and groups (`Ditto.db`, or `.zdb`/zip/gzip backups — detected by content, the source file is never modified). Settings › About › *Import from Ditto…*, or the card shown in Settings › General when a Ditto database is found.

## Development

Requires Node ≥ 22.12 (developed on Node 24).

```bash
npm install
npm run dev        # Electron + Vite with HMR (popup and settings windows)
npm run dev:ui     # renderer only, in a browser at http://localhost:5174 (uses the mock API)
npm test           # vitest (shared pure modules)
npm run typecheck  # tsc for main/preload/shared and renderer
npm run build      # production bundles into out/
npm run icons      # regenerate build/ icons from scripts/gen-icons.mjs
```

Packaging (after `npm run build`):

```bash
npm run dist:dir   # unpacked app in dist/
npm run dist:win   # NSIS installer (x64)
npm run dist:mac   # universal DMG — run on macOS
```

macOS: no `.icns` is committed; electron-builder generates it from `build/icon.png` (1024×1024). Paste on macOS needs Accessibility permission (System Settings › Privacy & Security › Accessibility).

## Project layout

```
src/shared/    contract (types.ts, ipc.ts) + pure helpers (accelerator, transforms, detect) with tests
src/preload/   window.api bridge
src/main/      Electron main process
src/renderer/  React UI (one bundle, routes #/popup and #/settings)
build/         icons, entitlements
docs/          design document
```

Storage is SQLite via Node's built-in `node:sqlite` (FTS5 trigram search); the only native dependency is `koffi` for OS APIs.

## License

MIT
