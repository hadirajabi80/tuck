// macOS: NSPasteboard changeCount through the Objective-C runtime (libobjc objc_msgSend) via koffi.
// Untested on real hardware from the Windows dev box — every call is guarded and falls back to null.
import { lazyBinding } from './koffi';

const bind = lazyBinding('objc', (koffi) => {
  if (process.platform !== 'darwin') throw new Error('not macOS');
  const objc = koffi.load('/usr/lib/libobjc.A.dylib');
  // AppKit is already loaded in Electron's process; loading it again is harmless and makes NSPasteboard resolvable.
  koffi.load('/System/Library/Frameworks/AppKit.framework/AppKit');
  const objc_getClass = objc.func('void *objc_getClass(const char *name)');
  const sel_registerName = objc.func('void *sel_registerName(const char *name)');
  const msgSendPtr = objc.func('objc_msgSend', 'void *', ['void *', 'void *']);
  const msgSendLong = objc.func('objc_msgSend', 'long', ['void *', 'void *']);
  const NSPasteboard = objc_getClass('NSPasteboard');
  if (!NSPasteboard) throw new Error('NSPasteboard class not found');
  const selGeneral = sel_registerName('generalPasteboard');
  const selChangeCount = sel_registerName('changeCount');
  return {
    changeCount(): number | null {
      const pb = msgSendPtr(NSPasteboard, selGeneral);
      if (!pb) return null;
      return Number(msgSendLong(pb, selChangeCount));
    },
  };
});

export function pasteboardChangeCount(): number | null {
  const b = bind();
  if (!b) return null;
  try {
    return b.changeCount();
  } catch {
    return null;
  }
}
