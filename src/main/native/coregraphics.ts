// macOS: synthesise Cmd+V with CoreGraphics CGEvents via koffi (requires Accessibility trust).
// Untested on real hardware from the Windows dev box; callers fall back to osascript when this returns false.
import { lazyBinding } from './koffi';

const kVK_ANSI_V = 9;
const kCGEventFlagMaskCommand = 0x100000;
const kCGHIDEventTap = 0;

const bind = lazyBinding('coregraphics', (koffi) => {
  if (process.platform !== 'darwin') throw new Error('not macOS');
  const cg = koffi.load('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics');
  const cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation');
  return {
    CGEventCreateKeyboardEvent: cg.func('void *CGEventCreateKeyboardEvent(void *source, uint16_t keycode, bool keyDown)'),
    CGEventSetFlags: cg.func('void CGEventSetFlags(void *event, uint64_t flags)'),
    CGEventPost: cg.func('void CGEventPost(uint32_t tap, void *event)'),
    CFRelease: cf.func('void CFRelease(void *ref)'),
  };
});

export function cgAvailable(): boolean {
  return bind() !== null;
}

export function postCmdV(): boolean {
  const b = bind();
  if (!b) return false;
  try {
    for (const down of [true, false]) {
      const ev = b.CGEventCreateKeyboardEvent(null, kVK_ANSI_V, down);
      if (!ev) return false;
      b.CGEventSetFlags(ev, kCGEventFlagMaskCommand);
      b.CGEventPost(kCGHIDEventTap, ev);
      b.CFRelease(ev);
    }
    return true;
  } catch {
    return false;
  }
}
