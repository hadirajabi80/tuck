// About › Updates: current version, live update state (check / download progress / ready / error),
// "Check for updates" + "Restart now", and the updates.autoCheck / autoDownload toggles.
import { CircleAlert, CircleArrowUp, CircleCheck, Download, Info, RefreshCw, RotateCw } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { UpdateState } from '@shared/types';
import { api } from '@/lib/api';
import { formatBytes, fullDateTime } from '@/lib/format';
import { useUpdateState } from '@/lib/useUpdates';
import { Button } from '@/components/Button';
import { Card, Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { ProgressBar } from '@/components/ProgressBar';
import { Spinner } from '@/components/Spinner';
import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import styles from './UpdatesCard.module.css';

type Tone = 'neutral' | 'ok' | 'accent' | 'bad';

function lastChecked(ts: number | null, now: number): string | null {
  if (!ts) return null;
  const s = fullDateTime(ts, now);
  return `Last checked ${/^(Just|Today|Yesterday)\b/.test(s) ? s[0]!.toLowerCase() + s.slice(1) : s}`;
}

function describe(u: UpdateState): { tone: Tone; icon: ReactNode; title: string; detail?: string } {
  switch (u.status) {
    case 'checking':
      return { tone: 'neutral', icon: <Spinner size={14} />, title: 'Checking for updates…' };
    case 'available':
      return { tone: 'accent', icon: <Icon icon={CircleArrowUp} size={16} />, title: `Version ${u.version} is available` };
    case 'downloading': {
      const pct = Math.floor(u.percent);
      const speed = u.bytesPerSecond > 0 ? ` · ${formatBytes(u.bytesPerSecond)}/s` : '';
      return {
        tone: 'accent',
        icon: <Icon icon={Download} size={16} />,
        title: `Downloading ${pct}%${speed}`,
        detail: u.total > 0 ? `Version ${u.version} · ${formatBytes(u.transferred)} of ${formatBytes(u.total)}` : `Version ${u.version}`,
      };
    }
    case 'downloaded':
      return { tone: 'accent', icon: <Icon icon={CircleArrowUp} size={16} />, title: `Version ${u.version} is ready`, detail: 'Restart Tuck to finish updating. It also installs the next time Tuck quits.' };
    case 'not-available':
      return { tone: 'ok', icon: <Icon icon={CircleCheck} size={16} />, title: 'You’re up to date' };
    case 'error':
      return { tone: 'bad', icon: <Icon icon={CircleAlert} size={16} />, title: 'Couldn’t check for updates', detail: u.message };
    case 'unsupported':
      return { tone: 'neutral', icon: <Icon icon={Info} size={16} />, title: 'Automatic updates are off in this build', detail: u.message };
    default:
      return { tone: 'neutral', icon: <Icon icon={RefreshCw} size={15} />, title: 'Updates come from GitHub Releases' };
  }
}

export function UpdatesCard() {
  const u = useUpdateState();
  const settings = useSettings((s) => s.settings);
  const set = useSettings((s) => s.set);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setNow(Date.now()), [u?.lastCheckedAt]);

  const run = async (fn: () => Promise<unknown>, failure: string) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast(failure, 'error');
    } finally {
      setBusy(false);
    }
  };

  const unsupported = u?.status === 'unsupported';
  const d = u ? describe(u) : null;
  const meta = [u?.currentVersion ? `Current version ${u.currentVersion}` : null, u ? lastChecked(u.lastCheckedAt, now) : null].filter(Boolean).join(' · ');

  let action: ReactNode = null;
  if (u?.status === 'downloaded') {
    action = (
      <Button variant="primary" icon={RotateCw} loading={busy} onClick={() => void run(() => api.invoke('updates:install'), 'Couldn’t start the update')}>
        Restart now
      </Button>
    );
  } else if (u?.status === 'available') {
    action = (
      <Button variant="primary" icon={Download} loading={busy} onClick={() => void run(() => api.invoke('updates:download'), 'Couldn’t start the download')}>
        Download
      </Button>
    );
  } else if (u?.status !== 'downloading') {
    action = (
      <Button
        icon={RefreshCw}
        loading={busy || u?.status === 'checking'}
        disabled={!u || unsupported}
        onClick={() => void run(() => api.invoke('updates:check'), 'Couldn’t check for updates')}
      >
        {u?.status === 'error' ? 'Retry' : 'Check for updates'}
      </Button>
    );
  }

  const notes = u && (u.status === 'available' || u.status === 'downloaded') ? u.releaseNotes : null;
  const updates = settings?.updates;

  return (
    <Card title="Updates">
      <div className={styles.status} data-tone={d?.tone ?? 'neutral'}>
        <span className={styles.icon} aria-hidden="true">{d?.icon ?? <Spinner size={14} />}</span>
        <div className={styles.text} aria-live="polite">
          <div className={styles.title}>{d?.title ?? 'Loading…'}</div>
          {d?.detail && <div className={styles.detail}>{d.detail}</div>}
          {meta && <div className={styles.meta}>{meta}</div>}
          {u?.status === 'downloading' && (
            <div className={styles.progress}>
              <ProgressBar value={u.percent} max={100} label="Update download" indeterminate={u.percent <= 0 && u.transferred <= 0} />
            </div>
          )}
          {notes && (
            <details className={styles.notes}>
              <summary>What’s new</summary>
              <div className={styles.notesBody}>{notes}</div>
            </details>
          )}
        </div>
        {action && <div className={styles.action}>{action}</div>}
      </div>
      <Field label="Check automatically" description="Look for a new version shortly after launch and every 6 hours." disabled={unsupported || !updates}>
        {(ids) => (
          <Toggle
            id={ids.id}
            aria-labelledby={ids.labelId}
            aria-describedby={ids.descriptionId}
            checked={updates?.autoCheck ?? true}
            disabled={unsupported || !updates}
            onChange={(v) => void set({ updates: { autoCheck: v } })}
          />
        )}
      </Field>
      <Field label="Download automatically" description="Fetch updates in the background, then install when you restart." disabled={unsupported || !updates}>
        {(ids) => (
          <Toggle
            id={ids.id}
            aria-labelledby={ids.labelId}
            aria-describedby={ids.descriptionId}
            checked={updates?.autoDownload ?? true}
            disabled={unsupported || !updates}
            onChange={(v) => void set({ updates: { autoDownload: v } })}
          />
        )}
      </Field>
    </Card>
  );
}
