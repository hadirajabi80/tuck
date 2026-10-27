// Windows bindings (user32 + kernel32) via koffi. HWND/HANDLE are declared as intptr_t so values come back
// as plain numbers (koffi 3 returns opaque pointers as BigInt — see DESIGN §0); compare/store them as-is.
import { lazyBinding } from './koffi';

export type Hwnd = number | bigint;

export const VK = { SHIFT: 0x10, CONTROL: 0x11, MENU: 0x12, LWIN: 0x5b, RWIN: 0x5c, V: 0x56, INSERT: 0x2d } as const;
const INPUT_KEYBOARD = 1;
const KEYEVENTF_KEYUP = 0x0002;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
export const CF_HDROP = 15;

const bind = lazyBinding('win32', (koffi) => {
  if (process.platform !== 'win32') throw new Error('not windows');
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const KEYBDINPUT = koffi.struct('TUCK_KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
  const MOUSEINPUT = koffi.struct('TUCK_MOUSEINPUT', { dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr' });
  const HARDWAREINPUT = koffi.struct('TUCK_HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
  const INPUT = koffi.struct('TUCK_INPUT', {
    type: 'uint32',
    u: koffi.union('TUCK_INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }),
  });
  const inputSize = koffi.sizeof(INPUT); // 40 on x64, 28 on ia32

  return {
    inputSize,
    INPUT,
    GetForegroundWindow: user32.func('intptr_t __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(intptr_t hwnd)'),
    BringWindowToTop: user32.func('int __stdcall BringWindowToTop(intptr_t hwnd)'),
    IsWindow: user32.func('int __stdcall IsWindow(intptr_t hwnd)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, void *buf, int max)'),
    IsIconic: user32.func('int __stdcall IsIconic(intptr_t hwnd)'),
    ShowWindow: user32.func('int __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
    AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, int attach)'),
    GetClipboardSequenceNumber: user32.func('uint32_t __stdcall GetClipboardSequenceNumber()'),
    GetClipboardOwner: user32.func('intptr_t __stdcall GetClipboardOwner()'),
    IsClipboardFormatAvailable: user32.func('int __stdcall IsClipboardFormatAvailable(uint32_t format)'),
    RegisterClipboardFormatW: user32.func('uint32_t __stdcall RegisterClipboardFormatW(const char16_t *name)'),
    OpenClipboard: user32.func('int __stdcall OpenClipboard(intptr_t hwnd)'),
    CloseClipboard: user32.func('int __stdcall CloseClipboard()'),
    GetClipboardData: user32.func('intptr_t __stdcall GetClipboardData(uint32_t format)'),
    EmptyClipboard: user32.func('int __stdcall EmptyClipboard()'),
    SetClipboardData: user32.func('intptr_t __stdcall SetClipboardData(uint32_t format, intptr_t mem)'),
    GetAsyncKeyState: user32.func('int16_t __stdcall GetAsyncKeyState(int vk)'),
    SendInput: user32.func('uint32_t __stdcall SendInput(uint32_t count, TUCK_INPUT *inputs, int size)'),
    GetCurrentThreadId: kernel32.func('uint32_t __stdcall GetCurrentThreadId()'),
    OpenProcess: kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, int inherit, uint32_t pid)'),
    CloseHandle: kernel32.func('int __stdcall CloseHandle(intptr_t handle)'),
    QueryFullProcessImageNameW: kernel32.func(
      'int __stdcall QueryFullProcessImageNameW(intptr_t process, uint32_t flags, void *buffer, _Inout_ uint32_t *size)',
    ),
    GlobalLock: kernel32.func('intptr_t __stdcall GlobalLock(intptr_t mem)'),
    GlobalUnlock: kernel32.func('int __stdcall GlobalUnlock(intptr_t mem)'),
    GlobalSize: kernel32.func('uintptr_t __stdcall GlobalSize(intptr_t mem)'),
    GlobalAlloc: kernel32.func('intptr_t __stdcall GlobalAlloc(uint32_t flags, uintptr_t bytes)'),
    GlobalFree: kernel32.func('intptr_t __stdcall GlobalFree(intptr_t mem)'),
    // Electron runs V8 with the memory cage, so koffi.view() (external ArrayBuffers) aborts the process.
    // Copy through RtlMoveMemory into/out of JS-owned Buffers instead.
    copyFrom: kernel32.func('RtlMoveMemory', 'void', ['void *', 'intptr_t', 'uintptr_t']),
    copyTo: kernel32.func('RtlMoveMemory', 'void', ['intptr_t', 'void *', 'uintptr_t']),
  };
});

export function win32Available(): boolean {
  return bind() !== null;
}

const isNull = (h: Hwnd | null | undefined): boolean => h === null || h === undefined || h === 0 || h === 0n;

export function getForegroundWindow(): Hwnd | null {
  const b = bind();
  if (!b) return null;
  const h = b.GetForegroundWindow() as Hwnd;
  return isNull(h) ? null : h;
}

/** Window that last put data on the clipboard (null when none / unknown). */
export function getClipboardOwner(): Hwnd | null {
  const b = bind();
  if (!b) return null;
  const h = b.GetClipboardOwner() as Hwnd;
  return isNull(h) ? null : h;
}

export function windowProcessId(hwnd: Hwnd): { threadId: number; pid: number } | null {
  const b = bind();
  if (!b) return null;
  const pid = [0];
  const threadId = b.GetWindowThreadProcessId(hwnd, pid) as number;
  return threadId ? { threadId, pid: pid[0]! } : null;
}

/** Full image path of the process owning `hwnd` (null on failure / elevated targets). */
export function processImagePath(pid: number): string | null {
  const b = bind();
  if (!b || !pid) return null;
  const h = b.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid) as number;
  if (!h) return null;
  try {
    const buf = Buffer.alloc(1040);
    const size = [520];
    if (!b.QueryFullProcessImageNameW(h, 0, buf, size)) return null;
    return buf.toString('utf16le', 0, size[0]! * 2);
  } finally {
    b.CloseHandle(h);
  }
}

/** Window class name (e.g. Shell_TrayWnd for the taskbar). */
export function windowClassName(hwnd: Hwnd): string | null {
  const b = bind();
  if (!b) return null;
  const buf = Buffer.alloc(512);
  const n = b.GetClassNameW(hwnd, buf, 256) as number;
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : null;
}

export function clipboardSequenceNumber(): number | null {
  const b = bind();
  return b ? (b.GetClipboardSequenceNumber() as number) : null;
}

const formatIds = new Map<string, number>();

export function registeredFormat(name: string): number | null {
  const b = bind();
  if (!b) return null;
  let id = formatIds.get(name);
  if (id === undefined) {
    id = b.RegisterClipboardFormatW(name) as number;
    formatIds.set(name, id);
  }
  return id || null;
}

export function isFormatAvailable(format: number): boolean | null {
  const b = bind();
  return b ? !!b.IsClipboardFormatAvailable(format) : null;
}

/** Raw bytes of a clipboard format (OpenClipboard → GetClipboardData → GlobalLock). Null if absent or busy. */
export function readClipboardFormat(format: number, maxBytes = 64 * 1024 * 1024): Buffer | null {
  const b = bind();
  if (!b) return null;
  if (!b.IsClipboardFormatAvailable(format)) return null;
  let opened = false;
  for (let i = 0; i < 5 && !opened; i++) opened = !!b.OpenClipboard(0);
  if (!opened) return null;
  try {
    const h = b.GetClipboardData(format) as number;
    if (!h) return null;
    const size = Number(b.GlobalSize(h));
    if (!size || size > maxBytes) return null;
    const p = b.GlobalLock(h);
    if (!p) return null;
    try {
      const out = Buffer.alloc(size);
      b.copyFrom(out, p, size);
      return out;
    } finally {
      b.GlobalUnlock(h);
    }
  } finally {
    b.CloseClipboard();
  }
}

/**
 * Replaces the clipboard with raw format payloads (e.g. CF_HDROP + CF_UNICODETEXT). `owner` must be a window
 * of ours: with a NULL owner EmptyClipboard leaves no owner and SetClipboardData fails.
 */
export function writeClipboardFormats(owner: Hwnd, entries: Array<{ format: number; data: Buffer }>): boolean {
  const b = bind();
  if (!b) return false;
  let opened = false;
  for (let i = 0; i < 5 && !opened; i++) opened = !!b.OpenClipboard(owner);
  if (!opened) return false;
  try {
    if (!b.EmptyClipboard()) return false;
    for (const { format, data } of entries) {
      const h = b.GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, data.length) as number;
      if (!h) return false;
      const p = b.GlobalLock(h);
      if (!p) {
        b.GlobalFree(h);
        return false;
      }
      b.copyTo(p, data, data.length);
      b.GlobalUnlock(h);
      if (!b.SetClipboardData(format, h)) {
        b.GlobalFree(h);
        return false;
      }
    }
    return true;
  } finally {
    b.CloseClipboard();
  }
}

export const CF_UNICODETEXT = 13;

export function isKeyDown(vk: number): boolean {
  const b = bind();
  if (!b) return false;
  return ((b.GetAsyncKeyState(vk) as number) & 0x8000) !== 0;
}

export function anyModifierDown(): boolean {
  return [VK.CONTROL, VK.SHIFT, VK.MENU, VK.LWIN, VK.RWIN].some(isKeyDown);
}

/** Sends key-down for each vk in order, then key-up in reverse order. Returns true if all events were injected. */
export function sendKeyCombo(vks: number[]): boolean {
  const b = bind();
  if (!b) return false;
  const ev = (vk: number, up: boolean) => ({
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: vk, wScan: 0, dwFlags: up ? KEYEVENTF_KEYUP : 0, time: 0, dwExtraInfo: 0 } },
  });
  const inputs = [...vks.map((vk) => ev(vk, false)), ...[...vks].reverse().map((vk) => ev(vk, true))];
  const sent = b.SendInput(inputs.length, inputs, b.inputSize) as number;
  return sent === inputs.length;
}

/** Brings `hwnd` to the foreground; uses AttachThreadInput when a plain SetForegroundWindow is refused. */
export function forceForeground(hwnd: Hwnd): boolean {
  const b = bind();
  if (!b || isNull(hwnd) || !b.IsWindow(hwnd)) return false;
  if (b.IsIconic(hwnd)) b.ShowWindow(hwnd, 9 /* SW_RESTORE */);
  if (b.SetForegroundWindow(hwnd)) return true;
  const self = b.GetCurrentThreadId() as number;
  const fg = b.GetForegroundWindow() as Hwnd;
  const fgThread = isNull(fg) ? 0 : ((b.GetWindowThreadProcessId(fg, [0]) as number) || 0);
  const target = (b.GetWindowThreadProcessId(hwnd, [0]) as number) || 0;
  const attached: number[] = [];
  for (const t of new Set([fgThread, target])) {
    if (t && t !== self && b.AttachThreadInput(self, t, 1)) attached.push(t);
  }
  try {
    b.BringWindowToTop(hwnd);
    return !!b.SetForegroundWindow(hwnd);
  } finally {
    for (const t of attached) b.AttachThreadInput(self, t, 0);
  }
}

/** HWND from BrowserWindow.getNativeWindowHandle(). */
export function hwndFromHandle(buf: Buffer): Hwnd {
  return buf.length >= 8 ? Number(buf.readBigUInt64LE(0)) : buf.readUInt32LE(0);
}
