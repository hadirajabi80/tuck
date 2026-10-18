import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { Stats } from '@shared/types';
import { api } from '@/lib/api';
import { formatBytes, formatCount, plural, shortDate } from '@/lib/format';
import { Button } from '@/components/Button';
import { confirm } from '@/components/Dialog';
import { Card, Field } from '@/components/Field';
import { NumberField } from '@/components/NumberField';
import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { SectionHeader } from '../SettingsApp';
import styles from './sections.module.css';

const MB = 1024 * 1024;

export function HistorySection() {
  const h = useSettings((s) => s.settings!.history);
  const set = useSettings((s) => s.set);
  return (
    <>
      <SectionHeader title="History" description="What Tuck keeps and for how long. Pinned clips are never removed automatically." />
      <Card title="Retention">
        <Field label="Maximum clips" description="Oldest unpinned clips are removed beyond this number.">
          {(ids) => <NumberField id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} value={h.maxItems} min={50} max={100000} step={50} width={128} onChange={(v) => void set({ history: { maxItems: v } })} />}
        </Field>
        <Field label="Delete clips after" description={h.expireDays === 0 ? 'Never — clips stay until the maximum is reached.' : `Unpinned clips older than ${plural(h.expireDays, 'day')} are removed.`}>
          {(ids) => <NumberField id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} value={h.expireDays} min={0} max={3650} suffix="days" width={128} onChange={(v) => void set({ history: { expireDays: v } })} />}
        </Field>
        <Field label="Merge duplicates" description="Copying the same thing again moves it to the top instead of adding a new clip.">
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={h.dedupe} onChange={(v) => void set({ history: { dedupe: v } })} />}
        </Field>
      </Card>
      <Card title="Capture">
        <Field label="Capture images" description="Screenshots and copied images are saved as PNG files.">
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={h.captureImages} onChange={(v) => void set({ history: { captureImages: v } })} />}
        </Field>
        <Field label="Maximum image size" description="Larger images are skipped." disabled={!h.captureImages}>
          {(ids) => <NumberField id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} value={Math.round(h.maxImageBytes / MB)} min={1} max={200} suffix="MB" disabled={!h.captureImages} onChange={(v) => void set({ history: { maxImageBytes: v * MB } })} />}
        </Field>
        <Field label="Capture files" description="Files copied in Explorer or Finder are saved as file lists.">
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={h.captureFiles} onChange={(v) => void set({ history: { captureFiles: v } })} />}
        </Field>
        <Field label="Clipboard check interval" description="Advanced. Lower is snappier, higher uses less CPU.">
          {(ids) => <NumberField id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} value={h.pollIntervalMs} min={100} max={2000} step={50} suffix="ms" onChange={(v) => void set({ history: { pollIntervalMs: v } })} />}
        </Field>
      </Card>
      <StorageCard />
    </>
  );
}

export function StorageCard() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [clearing, setClearing] = useState(false);
  const load = useCallback(async () => {
    try { setStats(await api.invoke('stats:get')); } catch { /* ignore */ }
  }, []);
  useEffect(() => {
    void load();
    let t: ReturnType<typeof setTimeout> | null = null;
    const off = api.on('clips:changed', () => { if (t) clearTimeout(t); t = setTimeout(() => void load(), 200); });
    return () => { off(); if (t) clearTimeout(t); };
  }, [load]);

  const clear = async () => {
    const r = await confirm({
      title: 'Clear clipboard history?',
      message: 'This permanently deletes your clips and their images. It can’t be undone.',
      confirmLabel: 'Clear history',
      danger: true,
      checkbox: { label: 'Keep pinned clips', defaultChecked: true },
    });
    if (!r.confirmed) return;
    setClearing(true);
    try {
      const { deleted } = await api.invoke('clips:clear', { includePinned: !r.checked });
      toast(`Deleted ${plural(deleted, 'clip')}`, 'success');
      void load();
    } catch {
      toast('Couldn’t clear history', 'error');
    } finally {
      setClearing(false);
    }
  };

  const cells: Array<[string, string]> = stats
    ? [
        [formatCount(stats.totalClips), 'Clips'],
        [formatCount(stats.pinnedClips), 'Pinned'],
        [formatCount(stats.imageClips), 'Images'],
        [formatBytes(stats.dbBytes), 'Database'],
        [formatBytes(stats.imagesBytes), 'Image files'],
        [stats.oldestAt ? shortDate(stats.oldestAt) : '—', 'Oldest clip'],
      ]
    : [['—', 'Clips'], ['—', 'Pinned'], ['—', 'Images'], ['—', 'Database'], ['—', 'Image files'], ['—', 'Oldest clip']];

  return (
    <Card title="Storage">
      <div className={styles.stats}>
        {cells.map(([v, l]) => (
          <div key={l} className={styles.stat}>
            <div className={styles.statValue}>{v}</div>
            <div className={styles.statLabel}>{l}</div>
          </div>
        ))}
      </div>
      <div className={styles.storageActions}>
        <span className={styles.muted}>History is stored on this device only.</span>
        <Button variant="danger" icon={Trash2} loading={clearing} onClick={() => void clear()}>
          Clear history…
        </Button>
      </div>
    </Card>
  );
}
