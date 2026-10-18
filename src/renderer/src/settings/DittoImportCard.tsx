// Import from Ditto (DESIGN.md §I): detect → inspect → options → (raise limit) → import with progress → summary.
import { CircleCheck, DatabaseZap, FolderOpen, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DittoImportError, DittoImportResult, DittoInspectResult } from '@shared/types';
import { api } from '@/lib/api';
import { formatCount, plural } from '@/lib/format';
import { STORAGE_KEYS, writeFlag } from '@/lib/storage';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { ProgressBar } from '@/components/ProgressBar';
import { Spinner } from '@/components/Spinner';
import { Checkbox } from '@/components/TextField';
import { useSettings } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import styles from './DittoImportCard.module.css';

type Phase =
  | { k: 'detecting' }
  | { k: 'idle'; detected: string | null }
  | { k: 'inspecting'; path: string }
  | { k: 'inspected'; info: DittoInspectResult }
  | { k: 'importing'; path: string; done: number; total: number }
  | { k: 'done'; result: DittoImportResult }
  | { k: 'error'; message: string; path: string | null };

const ERRORS: Record<DittoImportError, string> = {
  canceled: 'Canceled.',
  unrecognized: 'This doesn’t look like a Ditto database.',
  'not-ditto': 'This file is a database, but not one Ditto created.',
  'read-failed': 'Couldn’t read the file. Close Ditto and try again.',
  unknown: 'The import failed.',
};

const MAX_ITEMS_CAP = 100_000;

export function DittoImportCard({ variant }: { variant: 'general' | 'about' }) {
  const [phase, setPhase] = useState<Phase>({ k: 'detecting' });
  const [includeImages, setIncludeImages] = useState(true);
  const [includeGroups, setIncludeGroups] = useState(true);
  const [existing, setExisting] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const maxItems = useSettings((s) => s.settings?.history.maxItems ?? 5000);
  const set = useSettings((s) => s.set);
  const detectedRef = useRef<string | null>(null);

  useEffect(() => {
    let alive = true;
    void api.invoke('data:detectDitto').then((r) => {
      if (!alive) return;
      detectedRef.current = r.found ? r.path : null;
      setPhase({ k: 'idle', detected: detectedRef.current });
    }).catch(() => alive && setPhase({ k: 'idle', detected: null }));
    void api.invoke('stats:get').then((s) => alive && setExisting(s.totalClips)).catch(() => {});
    return () => { alive = false; };
  }, []);

  const inspect = useCallback(async (path: string) => {
    setPhase({ k: 'inspecting', path });
    try {
      const info = await api.invoke('data:inspectDitto', { path });
      if (!info.ok) setPhase({ k: 'error', message: ERRORS[info.error ?? 'unknown'], path });
      else setPhase({ k: 'inspected', info });
    } catch (err) {
      setPhase({ k: 'error', message: err instanceof Error ? err.message : ERRORS.unknown, path });
    }
  }, []);

  const choose = useCallback(async () => {
    const prev = phase;
    try {
      const r = await api.invoke('data:pickDittoFile');
      if (r.canceled || !r.path) { setPhase(prev); return; }
      await inspect(r.path);
    } catch {
      toast('Couldn’t open the file picker', 'error');
    }
  }, [phase, inspect]);

  const runImport = useCallback(async (path: string, total: number) => {
    setPhase({ k: 'importing', path, done: 0, total });
    const off = api.on('data:importProgress', (p) => {
      if (p.source !== 'ditto') return;
      setPhase((cur) => (cur.k === 'importing' ? { ...cur, done: p.done, total: p.total || cur.total } : cur));
    });
    try {
      const result = await api.invoke('data:importDitto', { path, includeImages, includeGroups });
      if (result.canceled) { void inspect(path); return; }
      if (!result.ok) { setPhase({ k: 'error', message: result.message || ERRORS[result.error ?? 'unknown'], path }); return; }
      setPhase({ k: 'done', result });
      toast(`Imported ${plural(result.imported, 'clip')} from Ditto`, 'success');
    } catch (err) {
      setPhase({ k: 'error', message: err instanceof Error ? err.message : ERRORS.unknown, path });
    } finally {
      off();
    }
  }, [includeImages, includeGroups, inspect]);

  if (dismissed) return null;
  if (variant === 'general' && (phase.k === 'detecting' || (phase.k === 'idle' && !phase.detected))) return null;

  const dismiss = () => {
    writeFlag(STORAGE_KEYS.dittoCardDismissed, '1');
    setDismissed(true);
  };

  const needed = phase.k === 'inspected' ? phase.info.clips + existing : 0;
  const overLimit = phase.k === 'inspected' && needed > maxItems;
  const raiseTo = Math.min(MAX_ITEMS_CAP, Math.ceil(needed / 1000) * 1000);

  return (
    <section className={styles.card} aria-labelledby="ditto-title" data-variant={variant}>
      <header className={styles.header}>
        <span className={styles.icon}><Icon icon={DatabaseZap} size={18} /></span>
        <div className={styles.headText}>
          <h3 id="ditto-title" className={styles.title}>{variant === 'general' ? 'Bring your Ditto history' : 'Import from Ditto'}</h3>
          <p className={styles.description}>Clips, pins and groups come across. Ditto’s database is only read, never changed.</p>
        </div>
        {variant === 'general' && phase.k !== 'importing' && (
          <button type="button" className={styles.dismiss} aria-label="Dismiss" title="Don’t show again" onClick={dismiss}>
            <Icon icon={X} size={14} />
          </button>
        )}
      </header>

      <div className={styles.body}>
        {phase.k === 'detecting' && (
          <div className={styles.row}><Spinner size={13} /> <span className={styles.muted}>Looking for a Ditto database…</span></div>
        )}

        {phase.k === 'idle' && (
          <>
            {phase.detected ? (
              <div className={styles.found}>
                <span className={styles.foundLabel}>Found</span>
                <code className={styles.path} title={phase.detected}>{phase.detected}</code>
              </div>
            ) : (
              <p className={styles.muted}>No Ditto database was found automatically. Choose a Ditto.db, backup (.bak) or exported .zdb / .zip file.</p>
            )}
            <div className={styles.actions}>
              {phase.detected && <Button variant="primary" onClick={() => void inspect(phase.detected!)}>Inspect</Button>}
              <Button icon={FolderOpen} onClick={() => void choose()}>Choose file…</Button>
            </div>
          </>
        )}

        {phase.k === 'inspecting' && (
          <div className={styles.row}><Spinner size={13} /> <span className={styles.muted}>Reading <code className={styles.inlinePath}>{phase.path}</code>…</span></div>
        )}

        {phase.k === 'inspected' && (
          <>
            <code className={styles.path} title={phase.info.path}>{phase.info.path}</code>
            <dl className={styles.counts}>
              <div><dt>Clips</dt><dd>{formatCount(phase.info.clips)}</dd></div>
              <div><dt>Groups</dt><dd>{formatCount(phase.info.groups)}</dd></div>
              <div><dt>Pinned</dt><dd>{formatCount(phase.info.pinned)}</dd></div>
            </dl>
            <div className={styles.options}>
              <Checkbox checked={includeImages} onChange={setIncludeImages} label="Include images" />
              <Checkbox checked={includeGroups} onChange={setIncludeGroups} label="Import groups as collections" />
            </div>
            {overLimit && (
              <div className={styles.warning} role="status">
                <Icon icon={TriangleAlert} size={14} />
                <span>
                  Tuck keeps up to {formatCount(maxItems)} clips. With this import you’d have {formatCount(needed)}, so the oldest unpinned clips would be trimmed.
                </span>
                {raiseTo > maxItems && (
                  <Button size="sm" onClick={() => void set({ history: { maxItems: raiseTo } }).then((s) => s && toast(`History limit raised to ${formatCount(raiseTo)} clips`, 'success'))}>
                    Raise limit to {formatCount(raiseTo)}
                  </Button>
                )}
              </div>
            )}
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void runImport(phase.info.path, phase.info.clips)}>
                Import {plural(phase.info.clips, 'clip')}
              </Button>
              <Button variant="ghost" onClick={() => void choose()}>Choose another file…</Button>
            </div>
          </>
        )}

        {phase.k === 'importing' && (
          <div className={styles.progress}>
            <ProgressBar value={phase.done} max={phase.total} label="Import progress" indeterminate={phase.total === 0} />
            <div className={styles.progressText}>
              <span>Importing… {formatCount(phase.done)} of {formatCount(phase.total)}</span>
              <span>{phase.total ? Math.round((phase.done / phase.total) * 100) : 0}%</span>
            </div>
          </div>
        )}

        {phase.k === 'done' && (
          <>
            <div className={styles.success}>
              <Icon icon={CircleCheck} size={15} />
              Import complete
            </div>
            <dl className={styles.counts} data-cols="5">
              <div><dt>Imported</dt><dd>{formatCount(phase.result.imported)}</dd></div>
              <div><dt>Merged</dt><dd>{formatCount(phase.result.merged)}</dd></div>
              <div><dt>Skipped</dt><dd>{formatCount(phase.result.skipped)}</dd></div>
              <div><dt>Collections</dt><dd>{formatCount(phase.result.groups)}</dd></div>
              <div><dt>Images</dt><dd>{formatCount(phase.result.images)}</dd></div>
            </dl>
            {phase.result.message && <p className={styles.muted}>{phase.result.message}</p>}
            <div className={styles.actions}>
              {variant === 'general' ? <Button onClick={dismiss}>Done</Button> : <Button onClick={() => setPhase({ k: 'idle', detected: detectedRef.current })}>Import another…</Button>}
            </div>
          </>
        )}

        {phase.k === 'error' && (
          <>
            <div className={styles.error} role="alert">
              <Icon icon={TriangleAlert} size={14} />
              <span>{phase.message}</span>
            </div>
            <div className={styles.actions}>
              {phase.path && <Button onClick={() => void inspect(phase.path!)}>Try again</Button>}
              <Button icon={FolderOpen} onClick={() => void choose()}>Choose file…</Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
