// Global shortcut recorder (DESIGN.md §E Shortcuts). Click → record; main unregisters global shortcuts while
// recording so the current combo can be captured; the result shows Registered / conflict / invalid states.
import { CircleAlert, CircleCheck, RotateCcw, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { fromKeyboardEvent, prettyParts, validate } from '@shared/accelerator';
import { defaultSettings, type ShortcutId } from '@shared/types';
import { api } from '@/lib/api';
import { Icon } from '@/components/Icon';
import { Kbd } from '@/components/Kbd';
import { useSettings } from '@/store/settingsStore';
import styles from './ShortcutRecorder.module.css';

type Feedback =
  | { tone: 'success'; text: string }
  | { tone: 'danger'; text: string }
  | { tone: 'warning'; text: string }
  | null;

function heldModifiers(e: KeyboardEvent, mac: boolean): string[] {
  const parts: string[] = [];
  if (mac) {
    if (e.ctrlKey) parts.push('⌃');
    if (e.altKey) parts.push('⌥');
    if (e.shiftKey) parts.push('⇧');
    if (e.metaKey) parts.push('⌘');
  } else {
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Win');
  }
  return parts;
}

export function ShortcutRecorder({ id, labelledBy, describedBy }: { id: ShortcutId; labelledBy?: string; describedBy?: string }) {
  const platform = api.platform;
  const mac = platform === 'darwin';
  const status = useSettings((s) => s.shortcuts.find((x) => x.id === id));
  const accelerator = useSettings((s) => s.settings?.shortcuts[id] ?? '');
  const [recording, setRecording] = useState(false);
  const [held, setHeld] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const recordingRef = useRef(false);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const current = status?.accelerator ?? accelerator;
  const defaultAccel = defaultSettings(platform).shortcuts[id];

  const show = (f: Feedback, ms = 4000) => {
    setFeedback(f);
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    if (f && f.tone === 'success') feedbackTimer.current = setTimeout(() => setFeedback(null), ms);
  };

  const setRec = (on: boolean) => {
    if (recordingRef.current === on) return;
    recordingRef.current = on;
    setRecording(on);
    setHeld([]);
    void api.invoke('shortcuts:setRecording', { recording: on }).catch(() => {});
  };

  useEffect(() => () => {
    if (recordingRef.current) void api.invoke('shortcuts:setRecording', { recording: false }).catch(() => {});
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
  }, []);

  const apply = async (accel: string) => {
    setBusy(true);
    try {
      const r = await api.invoke('shortcuts:set', { id, accelerator: accel });
      if (r.ok) {
        show(accel ? { tone: 'success', text: 'Registered' } : { tone: 'success', text: 'Shortcut cleared' });
      } else if (r.error === 'invalid') {
        show({ tone: 'warning', text: r.message || 'Needs a modifier' });
      } else if (r.error === 'conflict-internal') {
        show({ tone: 'danger', text: r.message || 'Already used by another Tuck shortcut' });
      } else if (r.error === 'conflict-system') {
        show({ tone: 'danger', text: 'Already in use by another app' });
      } else {
        show({ tone: 'danger', text: r.message || 'Couldn’t register this shortcut' });
      }
    } catch {
      show({ tone: 'danger', text: 'Couldn’t register this shortcut' });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!recording) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setFeedback(null); setRec(true); }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const noMods = !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
    if (e.key === 'Escape' && noMods) { setRec(false); return; }
    if ((e.key === 'Backspace' || e.key === 'Delete') && noMods) {
      setRec(false);
      void apply('');
      return;
    }
    const accel = fromKeyboardEvent(e, platform);
    if (!accel) { setHeld(heldModifiers(e, mac)); return; }
    const v = validate(accel, platform);
    setRec(false);
    if (!v.ok) {
      show({ tone: 'warning', text: /^(Needs a modifier|Shift alone)/.test(v.reason) ? 'Needs a modifier' : v.reason });
      return;
    }
    void apply(accel);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (recording) setHeld(heldModifiers(e, mac));
  };

  const parts = prettyParts(current, platform);
  const notRegistered = !!current && status && !status.registered && !recording;

  return (
    <div className={styles.wrap}>
      <div className={styles.controls}>
        <button
          ref={btn}
          type="button"
          className={styles.recorder}
          data-recording={recording ? 'true' : undefined}
          data-tone={feedback?.tone}
          aria-labelledby={labelledBy}
          aria-describedby={describedBy}
          aria-live="polite"
          disabled={busy}
          onClick={() => { setFeedback(null); setRec(!recording); }}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => setRec(false)}
        >
          {recording ? (
            held.length ? (
              <span className={styles.held}><Kbd parts={[...held, '…']} /></span>
            ) : (
              <span className={styles.prompt}>Press keys…</span>
            )
          ) : parts.length ? (
            <Kbd parts={parts} />
          ) : (
            <span className={styles.unset}>Not set</span>
          )}
        </button>
        <button
          type="button"
          className={styles.reset}
          title="Reset to default"
          aria-label="Reset to default"
          style={current !== defaultAccel && !recording ? undefined : { visibility: 'hidden' }}
          onClick={() => void apply(defaultAccel)}
        >
          <Icon icon={RotateCcw} size={13} />
        </button>
      </div>
      <div className={styles.status} aria-live="polite">
        {recording ? (
          <span className={styles.hint}>Esc cancel · Backspace clear</span>
        ) : feedback ? (
          <span className={styles.feedback} data-tone={feedback.tone}>
            <Icon icon={feedback.tone === 'success' ? CircleCheck : feedback.tone === 'warning' ? TriangleAlert : CircleAlert} size={12} strokeWidth={2.2} />
            {feedback.text}
          </span>
        ) : notRegistered ? (
          <span className={styles.feedback} data-tone="danger">
            <Icon icon={CircleAlert} size={12} strokeWidth={2.2} />
            {status?.error || 'Not registered'}
          </span>
        ) : null}
      </div>
    </div>
  );
}
