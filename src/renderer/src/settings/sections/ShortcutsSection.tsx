import { Info } from 'lucide-react';
import { pretty } from '@shared/accelerator';
import type { ShortcutId } from '@shared/types';
import { api } from '@/lib/api';
import { Button } from '@/components/Button';
import { Card, Field } from '@/components/Field';
import { Icon } from '@/components/Icon';
import { Kbd } from '@/components/Kbd';
import { prettyParts } from '@shared/accelerator';
import { useSettings } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { SectionHeader } from '../SettingsApp';
import { ShortcutRecorder } from '../ShortcutRecorder';
import styles from './sections.module.css';

const ROWS: ReadonlyArray<{ id: ShortcutId; label: string; description: string }> = [
  { id: 'openPopup', label: 'Open Tuck', description: 'Show the clipboard popup from anywhere.' },
  { id: 'pasteLastPlain', label: 'Paste last clip as plain text', description: 'Paste the most recent clip without formatting, no popup.' },
  { id: 'toggleCapture', label: 'Pause / resume capture', description: 'Temporarily stop saving what you copy.' },
];

export function ShortcutsSection() {
  const platform = api.platform;
  const mac = platform === 'darwin';
  const openPopup = useSettings((s) => s.settings?.shortcuts.openPopup ?? '');
  const alternatives = mac ? ['Command+Shift+Space', 'Control+Command+V'] : ['Control+Shift+Space', 'Control+Alt+V'];

  const useAlternative = async (accel: string) => {
    const r = await api.invoke('shortcuts:set', { id: 'openPopup', accelerator: accel });
    if (r.ok) toast(`Open Tuck is now ${pretty(accel, platform)}`, 'success');
    else toast(r.error === 'conflict-system' ? `${pretty(accel, platform)} is already in use by another app` : r.message || 'Couldn’t register that shortcut', 'error');
  };

  return (
    <>
      <SectionHeader title="Shortcuts" description="Global shortcuts work in every app. Click a shortcut, then press the new keys." />
      <Card>
        {ROWS.map((row) => (
          <Field key={row.id} label={row.label} description={row.description}>
            {(ids) => <ShortcutRecorder id={row.id} labelledBy={ids.labelId} describedBy={ids.descriptionId} />}
          </Field>
        ))}
      </Card>
      <Card title="Known conflicts">
        <div className={styles.note}>
          <Icon icon={Info} size={14} className={styles.noteIcon} />
          <div>
            {mac ? (
              <p>
                <Kbd parts={prettyParts('Command+Shift+V', platform)} /> is “Paste and Match Style” in some apps (Pages, Mail, Slack). If Tuck takes it over, pick an alternative:
              </p>
            ) : (
              <p>
                VS Code uses <Kbd parts={prettyParts('Control+`', platform)} /> to toggle its terminal. If you work in VS Code, pick an alternative:
              </p>
            )}
            <div className={styles.noteActions}>
              {alternatives.map((a) => (
                <Button key={a} size="sm" onClick={() => void useAlternative(a)} disabled={openPopup === a}>
                  Use {pretty(a, platform)}
                </Button>
              ))}
            </div>
            <p className={styles.noteHint}>
              Test: press the shortcut in another app — Tuck should open.{mac ? ' macOS may report a shortcut as registered even when the system intercepts it.' : ''}
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}
