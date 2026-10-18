import { useEffect, useState } from 'react';
import { Card, Field } from '@/components/Field';
import { NumberField } from '@/components/NumberField';
import { Select } from '@/components/Select';
import { TextField } from '@/components/TextField';
import { Toggle } from '@/components/Toggle';
import { readFlag, STORAGE_KEYS } from '@/lib/storage';
import { useSettings } from '@/store/settingsStore';
import { DittoImportCard } from '../DittoImportCard';
import { SectionHeader } from '../SettingsApp';

type SepChoice = 'newline' | 'space' | 'comma' | 'tab' | 'custom';
const SEPARATORS: Record<Exclude<SepChoice, 'custom'>, string> = { newline: '\n', space: ' ', comma: ', ', tab: '\t' };

function sepChoice(sep: string): SepChoice {
  const hit = (Object.keys(SEPARATORS) as Array<keyof typeof SEPARATORS>).find((k) => SEPARATORS[k] === sep);
  return hit ?? 'custom';
}

/** Shows "\n" / "\t" escapes in the custom separator field. */
export function escapeSeparator(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t');
}
export function unescapeSeparator(s: string): string {
  return s.replace(/\\(\\|n|t)/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : '\\'));
}

export function GeneralSection() {
  const settings = useSettings((s) => s.settings)!;
  const appInfo = useSettings((s) => s.appInfo);
  const set = useSettings((s) => s.set);
  const g = settings.general;
  const [choice, setChoice] = useState<SepChoice>(() => sepChoice(g.mergeSeparator));
  const [custom, setCustom] = useState(() => escapeSeparator(g.mergeSeparator));
  const [dittoDismissed] = useState(() => readFlag(STORAGE_KEYS.dittoCardDismissed) === '1');

  useEffect(() => {
    const c = sepChoice(g.mergeSeparator);
    if (c !== 'custom') setChoice(c);
  }, [g.mergeSeparator]);

  const loginSupported = appInfo?.launchAtLoginSupported ?? false;

  return (
    <>
      <SectionHeader title="General" description="How Tuck starts, hides and pastes." />
      {!dittoDismissed && <DittoImportCard variant="general" />}
      <Card title="Startup & window">
        <Field
          label="Launch at login"
          description={loginSupported ? 'Start Tuck quietly in the tray when you sign in.' : 'Available in the installed app — development builds can’t register a login item.'}
          disabled={!loginSupported}
        >
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={g.launchAtLogin} disabled={!loginSupported} onChange={(v) => void set({ general: { launchAtLogin: v } })} />}
        </Field>
        <Field label="Hide popup when it loses focus" description="Click anywhere else to dismiss Tuck.">
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={g.hideOnBlur} onChange={(v) => void set({ general: { hideOnBlur: v } })} />}
        </Field>
        <Field label="Show source app" description="Show which app each clip was copied from.">
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={g.showSourceApp} onChange={(v) => void set({ general: { showSourceApp: v } })} />}
        </Field>
      </Card>
      <Card title="Pasting">
        <Field label="Move pasted clip to top" description="Pasting a clip makes it the most recent one.">
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={g.moveToTopOnPaste} onChange={(v) => void set({ general: { moveToTopOnPaste: v } })} />}
        </Field>
        <Field label="Paste delay" description="Wait before sending the paste keystroke. Raise it if pastes land in the wrong window.">
          {(ids) => <NumberField id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} value={g.pasteDelayMs} min={0} max={1000} step={10} suffix="ms" onChange={(v) => void set({ general: { pasteDelayMs: v } })} />}
        </Field>
        <Field label="Merge separator" description="Placed between clips when you paste a multi-selection.">
          {(ids) => (
            <>
              {choice === 'custom' && (
                <TextField
                  mono
                  width={96}
                  value={custom}
                  aria-label="Custom separator"
                  placeholder="e.g. \n---\n"
                  onChange={(e) => setCustom(e.target.value)}
                  onBlur={() => { const v = unescapeSeparator(custom); if (v && v !== g.mergeSeparator) void set({ general: { mergeSeparator: v } }); }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                />
              )}
              <Select<SepChoice>
                id={ids.id}
                aria-labelledby={ids.labelId}
                aria-describedby={ids.descriptionId}
                value={choice}
                minWidth={128}
                options={[
                  { value: 'newline', label: 'New line' },
                  { value: 'space', label: 'Space' },
                  { value: 'comma', label: 'Comma' },
                  { value: 'tab', label: 'Tab' },
                  { value: 'custom', label: 'Custom…' },
                ]}
                onChange={(v) => {
                  setChoice(v);
                  if (v !== 'custom') void set({ general: { mergeSeparator: SEPARATORS[v] } });
                  else setCustom(escapeSeparator(g.mergeSeparator));
                }}
              />
            </>
          )}
        </Field>
      </Card>
    </>
  );
}
