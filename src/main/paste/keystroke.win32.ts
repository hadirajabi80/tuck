// Windows: wait for physical modifier release, then inject Ctrl+V with SendInput.
import { setTimeout as sleep } from 'node:timers/promises';
import { anyModifierDown, sendKeyCombo, VK } from '../native/user32';

export async function waitForModifierRelease(maxMs = 600): Promise<void> {
  const start = Date.now();
  while (anyModifierDown() && Date.now() - start < maxMs) await sleep(10);
}

export async function sendPasteWin(): Promise<boolean> {
  await waitForModifierRelease();
  return sendKeyCombo([VK.CONTROL, VK.V]);
}
