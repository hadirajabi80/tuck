// paste:perform — resolve content → transform/plain → write clipboard → hide popup → restore focus →
// delay → wait for modifier release → Ctrl/Cmd+V → markPasted.
import { setTimeout as sleep } from 'node:timers/promises';
import { systemPreferences } from 'electron';
import { applyTransform, isTransformId } from '../../shared/transforms';
import type { Clip, PasteRequest, PasteResult, TransformId } from '../../shared/types';
import { writeContent, type ClipContent } from '../clipboard/writer';
import { contentFor } from '../clips/clipService';
import { r } from '../context';
import { emit } from '../ipc/typed';
import { logger } from '../log';
import { settings } from '../settings/settingsStore';
import { hidePopup, isPopupVisible } from '../windows/popupWindow';
import { restoreFocus } from './focusTracker';
import { sendPasteMac } from './keystroke.darwin';
import { sendPasteWin } from './keystroke.win32';

const log = logger('paste');
let accessibilityPrompted = false;

const TEXT_KINDS = new Set(['text', 'link', 'color', 'code', 'files']);

function transformed(content: ClipContent, transform: TransformId | null | undefined): ClipContent {
  if (!transform || !isTransformId(transform) || content.imagePath) return content;
  const text = content.text ?? (content.files ? content.files.join('\n') : '');
  return { text: applyTransform(transform, text) };
}

function resolve(req: PasteRequest): { content: ClipContent; clipIds: string[]; snippetId?: string } | null {
  const sep = settings().get().general.mergeSeparator;
  switch (req.type) {
    case 'clip': {
      const clip = r().clips.get(req.clipId);
      if (!clip) return null;
      const plain = !!req.plain || req.transform === 'stripFormatting';
      return { content: transformed(contentFor(clip, plain), req.transform), clipIds: [clip.id] };
    }
    case 'clips': {
      const clips = (Array.isArray(req.clipIds) ? req.clipIds : []).map((id) => r().clips.get(id)).filter((c): c is Clip => !!c);
      if (!clips.length) return null;
      if (clips.length === 1) {
        const plain = !!req.plain || req.transform === 'stripFormatting';
        return { content: transformed(contentFor(clips[0]!, plain), req.transform), clipIds: [clips[0]!.id] };
      }
      const textual = clips.filter((c) => TEXT_KINDS.has(c.kind));
      if (!textual.length) return { content: contentFor(clips[0]!), clipIds: [clips[0]!.id] };
      const joined = textual.map((c) => c.text ?? '').join(typeof req.separator === 'string' ? req.separator : sep);
      return { content: transformed({ text: joined }, req.transform), clipIds: textual.map((c) => c.id) };
    }
    case 'snippet': {
      const s = r().snippets.get(req.snippetId);
      if (!s) return null;
      return { content: { text: s.body }, clipIds: [], snippetId: s.id };
    }
    case 'text':
      if (typeof req.text !== 'string') return null;
      return { content: { text: req.text, html: req.html ?? null }, clipIds: [] };
    default:
      return null;
  }
}

export async function performPaste(req: PasteRequest): Promise<PasteResult> {
  try {
    const resolved = resolve(req);
    if (!resolved) return { ok: false, error: 'not-found', message: 'Nothing to paste' };
    const fromPopup = isPopupVisible();

    if (!(await writeContent(resolved.content))) return { ok: false, error: 'clipboard', message: 'Could not write to the clipboard' };
    if (resolved.snippetId) {
      r().snippets.markUsed(resolved.snippetId);
      emit('snippets:changed', { ids: [resolved.snippetId] });
    }

    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
      if (!accessibilityPrompted) {
        accessibilityPrompted = true;
        systemPreferences.isTrustedAccessibilityClient(true);
      }
      return { ok: false, error: 'accessibility', message: 'Allow Tuck in System Settings › Privacy & Security › Accessibility' };
    }

    if (fromPopup) {
      hidePopup('paste');
      if (process.platform === 'win32') restoreFocus();
    }
    await sleep(settings().get().general.pasteDelayMs);
    const sent = process.platform === 'darwin' ? await sendPasteMac() : process.platform === 'win32' ? await sendPasteWin() : false;

    if (resolved.clipIds.length) {
      r().clips.markPasted(resolved.clipIds, settings().get().general.moveToTopOnPaste);
      emit('clips:changed', { reason: 'pasted', ids: resolved.clipIds });
    }
    if (!sent) {
      log.warn('paste keystroke failed (content is on the clipboard)');
      return { ok: false, error: 'keystroke', message: 'Copied — press Ctrl/Cmd+V to paste' };
    }
    return { ok: true };
  } catch (err) {
    log.error('paste failed', err);
    return { ok: false, error: 'unknown', message: (err as Error).message };
  }
}

/** "Paste last as plain" global shortcut. */
export async function pasteLastPlain(): Promise<void> {
  const clip = r().clips.latestText();
  if (!clip) return;
  const res = await performPaste({ type: 'clip', clipId: clip.id, plain: true });
  if (!res.ok) log.warn('pasteLastPlain:', res.error, res.message ?? '');
}

export function accessibilityTrusted(): boolean | null {
  if (process.platform !== 'darwin') return null;
  return systemPreferences.isTrustedAccessibilityClient(false);
}
