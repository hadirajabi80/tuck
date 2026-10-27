<!-- Notes for the next release. Update before tagging; {{VERSION}} is filled in by .github/workflows/release.yml. -->
**Tuck — everything you've copied, one keystroke away.**

A fast, keyboard-first clipboard manager for **Windows and macOS**, inspired by Ditto.

### New in 0.1.8
- **Self-repairing history**: if the history database gets damaged, Tuck now repairs it on start: it keeps the damaged file, rescues every clip it can still read, fills in the rest from its latest backup and tells you what it recovered. Previously Tuck silently failed to start.
- **Automatic backups**: a clean copy of your history is saved once a day and before every import (last 5 kept, in the Tuck data folder under backups).
- If Tuck ever can’t start, it now shows an error instead of disappearing.

### New in 0.1.7
- **Remote Desktop**: copies made inside a Remote Desktop session are now saved (Windows marks them “don’t keep in history”). Passwords a password manager marks as private are still skipped. Setting: Settings › Privacy › Save copies from Remote Desktop.

### New in 0.1.6
- New app icon that matches the tray icon and stays sharp in the taskbar.
- The refresh icon spins while checking for updates.
- Button text is no longer cut off at the bottom.

### New in 0.1.5
- **macOS build** for Apple Silicon and Intel Macs (opens with <kbd>⌘</kbd>+<kbd>⇧</kbd>+<kbd>V</kbd>).
- On macOS, Tuck tells you when a new version is out and links to the download.

### New in 0.1.4
- **Drag and drop**: reorder pinned clips, drag a clip into Pinned to pin it, drag it out to unpin. Alt+↑/↓ moves the selected pin.

### New in 0.1.3
- Submenus (like Add to collection) no longer cover their item when the popup is narrow.

### New in 0.1.2
- Grab strip at the top of the popup for easy dragging, and a button to show/hide the preview pane.
- The popup can be made much smaller; narrow layouts show just the clip title.

### New in 0.1.1
- **Auto-update**: Tuck checks GitHub for new versions, downloads them in the background and asks you to restart (Settings › About › Updates, or the tray menu).
- **Resize** the popup from any edge and **move** it by dragging the search, filter or status bar; your size is remembered.
- New crisp clipboard **tray icon** at every display scale.

### Highlights
- **Opens like Ditto** — press <kbd>Ctrl</kbd>+<kbd>`</kbd> (changeable in Settings › Shortcuts); the popup appears at your cursor, <kbd>Enter</kbd> pastes into the app you were using.
- **Starts with Windows** and lives in the tray (toggle in Settings or the tray menu).
- **Pin** clips so they never expire; organise clips into **collections**; save reusable **snippets**.
- Instant **search** with filters: Text, Images, Links, Files, Colors, Code, Snippets.
- <kbd>Ctrl</kbd>+<kbd>1</kbd>…<kbd>9</kbd> quick paste, <kbd>Shift</kbd>+<kbd>Enter</kbd> paste as plain text, multi-select & merged paste, edit clips, delete with undo.
- **Paste transforms**: UPPERCASE, lowercase, Title Case, trim, JSON pretty/minify, and more (<kbd>Ctrl</kbd>+<kbd>T</kbd>).
- **Privacy**: skips passwords copied from password managers, ignore-list for apps and regex patterns, pause capture.
- **Import from Ditto** — reads `Ditto.db` and `.zdb` backups (clips, pins, groups, images), merging duplicates.
- Light / dark / system theme, Windows 11 acrylic background, export/import as JSON.

### Install

**Windows** — download **Tuck-Setup-{{VERSION}}.exe** and run it (installs for your user, no admin needed). Already on 0.1.1 or newer? Tuck updates itself.
> The installer is not code-signed yet, so SmartScreen may warn — choose **More info › Run anyway**.
> If you also run Ditto, it holds <kbd>Ctrl</kbd>+<kbd>`</kbd> too; Tuck will notify you so you can pick another shortcut.

**macOS** — download **Tuck-{{VERSION}}-arm64.dmg** (Apple Silicon: M1–M4) or **Tuck-{{VERSION}}-x64.dmg** (Intel), open it and drag Tuck to Applications.
> The app is not signed with an Apple Developer ID yet, so macOS blocks the first launch. Run this once in Terminal, then open Tuck:
> `xattr -cr /Applications/Tuck.app`
>
> To let Tuck paste into other apps, allow it in **System Settings › Privacy & Security › Accessibility** when asked.
> macOS builds are new and less tested than Windows — please report anything odd.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

