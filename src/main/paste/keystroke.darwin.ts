// macOS: Cmd+V via CoreGraphics CGEvent (koffi), osascript System Events fallback. Both need Accessibility trust.
import { execFile } from 'node:child_process';
import { postCmdV } from '../native/coregraphics';

function osascriptPaste(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'], { timeout: 3000 }, (err) =>
      resolve(!err),
    );
  });
}

export async function sendPasteMac(): Promise<boolean> {
  if (postCmdV()) return true;
  return osascriptPaste();
}
