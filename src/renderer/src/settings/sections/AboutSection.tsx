import { Download, FolderOpen, LogOut, RotateCcw, ShieldCheck, Upload } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/api';
import { plural } from '@/lib/format';
import { Button } from '@/components/Button';
import { confirm } from '@/components/Dialog';
import { TuckMark } from '@/components/EmptyState';
import { Card, CardBody, Field } from '@/components/Field';
import { Checkbox } from '@/components/TextField';
import { useSettings } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { DittoImportCard } from '../DittoImportCard';
import { UpdatesCard } from '../UpdatesCard';
import { SectionHeader } from '../SettingsApp';
import styles from './sections.module.css';

export function AboutSection() {
  const info = useSettings((s) => s.appInfo);
  const reset = useSettings((s) => s.reset);
  const refreshAppInfo = useSettings((s) => s.refreshAppInfo);
  const [includeImages, setIncludeImages] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const mac = (info?.platform ?? api.platform) === 'darwin';

  const doExport = async () => {
    setExporting(true);
    try {
      const r = await api.invoke('data:export', { includeImages });
      if (r.canceled) return;
      if (r.ok) toast(`Exported ${plural(r.clips ?? 0, 'clip')}`, 'success', r.path ? { label: 'Show', onClick: () => void api.invoke('app:revealPath', { path: r.path! }) } : undefined);
      else toast(r.error || 'Export failed', 'error');
    } catch {
      toast('Export failed', 'error');
    } finally {
      setExporting(false);
    }
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const r = await api.invoke('data:import');
      if (r.canceled) return;
      if (r.ok) {
        const parts = [plural(r.imported, 'clip') + ' imported'];
        if (r.skipped) parts.push(`${r.skipped} already here`);
        if (r.groups) parts.push(plural(r.groups, 'collection'));
        if (r.snippets) parts.push(plural(r.snippets, 'snippet'));
        toast(parts.join(' · '), 'success');
      } else toast(r.error || 'Import failed', 'error');
    } catch {
      toast('Import failed', 'error');
    } finally {
      setImporting(false);
    }
  };

  const doReset = async () => {
    const r = await confirm({
      title: 'Reset all settings?',
      message: 'Shortcuts, appearance and privacy settings go back to their defaults. Your clipboard history is not touched.',
      confirmLabel: 'Reset settings',
      danger: true,
    });
    if (!r.confirmed) return;
    try {
      await reset();
      toast('Settings reset to defaults', 'success');
    } catch {
      toast('Couldn’t reset settings', 'error');
    }
  };

  const grantAccessibility = async () => {
    const { trusted } = await api.invoke('app:requestAccessibility');
    void refreshAppInfo();
    toast(trusted ? 'Accessibility permission granted' : 'Allow Tuck in System Settings › Privacy & Security › Accessibility', trusted ? 'success' : 'info');
  };

  return (
    <>
      <SectionHeader title="About" />
      <div className={styles.hero}>
        <TuckMark size={56} />
        <div>
          <div className={styles.heroName}>{info?.name ?? 'Tuck'} <span className={styles.muted}>{info?.version}</span></div>
          <div className={styles.heroTag}>Everything you’ve copied, one keystroke away.</div>
          {info && (
            <div className={styles.heroMeta}>
              Electron {info.electron} · Chrome {info.chrome} · Node {info.node} · {info.platform === 'darwin' ? 'macOS' : 'Windows'} {info.arch}{info.isPackaged ? '' : ' · development build'}
            </div>
          )}
        </div>
      </div>

      <UpdatesCard />

      {mac && (
        <Card title="Permissions">
          <Field
            label="Accessibility"
            description="Needed to paste into other apps. Without it, Tuck copies the clip and you press ⌘V yourself."
            status={
              info?.accessibilityTrusted ? <span className={`${styles.statusDot} ${styles.ok}`}>Granted</span> : <span className={`${styles.statusDot} ${styles.bad}`}>Not granted</span>
            }
          >
            <Button icon={ShieldCheck} onClick={() => void grantAccessibility()} disabled={!!info?.accessibilityTrusted}>
              Open System Settings
            </Button>
          </Field>
        </Card>
      )}

      <Card title="Your data">
        <Field label="Export history" description="Save clips, collections and snippets as a Tuck JSON file.">
          <Checkbox checked={includeImages} onChange={setIncludeImages} label="Include images" />
          <Button icon={Download} loading={exporting} onClick={() => void doExport()}>Export…</Button>
        </Field>
        <Field label="Import Tuck export" description="Merge a Tuck JSON export. Duplicates are skipped.">
          <Button icon={Upload} loading={importing} onClick={() => void doImport()}>Import…</Button>
        </Field>
        <Field label="Data folder" description={info ? <span className={styles.path} title={info.userDataPath}>{info.userDataPath}</span> : undefined}>
          <Button icon={FolderOpen} disabled={!info} onClick={() => info && void api.invoke('app:revealPath', { path: info.userDataPath })}>
            Open
          </Button>
        </Field>
      </Card>

      <div style={{ marginTop: 'var(--sp-6)' }}>
        <DittoImportCard variant="about" />
      </div>

      <Card title="Reset">
        <Field label="Reset settings" description="Restore every setting to its default. History is kept.">
          <Button variant="danger" icon={RotateCcw} onClick={() => void doReset()}>Reset…</Button>
        </Field>
      </Card>

      <Card title="Licences">
        <CardBody>
          <p className={styles.licence} style={{ padding: 0 }}>
            Tuck is released under the MIT licence. It is built with Electron, React, zustand and Lucide icons (ISC), and uses
            SQLite through Node’s built-in <code>node:sqlite</code>, koffi (MIT), fflate (MIT) and electron-updater (MIT).
          </p>
        </CardBody>
      </Card>

      <div className={styles.footerRow}>
        <span>© Tuck contributors</span>
        <Button variant="ghost" size="sm" icon={LogOut} onClick={() => void api.invoke('app:quit')}>Quit Tuck</Button>
      </div>
    </>
  );
}
