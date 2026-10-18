import { Monitor, Moon, Rows3, Rows4, Sun } from 'lucide-react';
import type { Density, PopupPosition, Settings, ThemeMode } from '@shared/types';
import { api } from '@/lib/api';
import { Card, Field } from '@/components/Field';
import { SegmentedControl } from '@/components/SegmentedControl';
import { Select } from '@/components/Select';
import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/store/settingsStore';
import { SectionHeader } from '../SettingsApp';

type Badges = Settings['appearance']['showQuickPasteBadges'];

export function AppearanceSection() {
  const a = useSettings((s) => s.settings!.appearance);
  const set = useSettings((s) => s.set);
  const mac = api.platform === 'darwin';
  return (
    <>
      <SectionHeader title="Appearance" description="Make the popup look and feel the way you like." />
      <Card>
        <Field label="Theme">
          {(ids) => (
            <SegmentedControl<ThemeMode>
              aria-labelledby={ids.labelId}
              value={a.theme}
              options={[
                { value: 'system', label: 'System', icon: Monitor },
                { value: 'light', label: 'Light', icon: Sun },
                { value: 'dark', label: 'Dark', icon: Moon },
              ]}
              onChange={(v) => void set({ appearance: { theme: v } })}
            />
          )}
        </Field>
        <Field label="Density" description="Row height in the clip list.">
          {(ids) => (
            <SegmentedControl<Density>
              aria-labelledby={ids.labelId}
              value={a.density}
              options={[
                { value: 'comfortable', label: 'Comfortable', icon: Rows3 },
                { value: 'compact', label: 'Compact', icon: Rows4 },
              ]}
              onChange={(v) => void set({ appearance: { density: v } })}
            />
          )}
        </Field>
        <Field label="Translucent background" description={mac ? 'Use macOS vibrancy behind the popup.' : 'Use Windows 11 acrylic behind the popup (22H2 or later).'}>
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={a.vibrancy} onChange={(v) => void set({ appearance: { vibrancy: v } })} />}
        </Field>
      </Card>
      <Card title="Popup">
        <Field label="Show preview by default" description={`Toggle it any time with ${mac ? '⌘.' : 'Ctrl+.'}`}>
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={a.previewVisible} onChange={(v) => void set({ appearance: { previewVisible: v } })} />}
        </Field>
        <Field label="Popup position">
          {(ids) => (
            <Select<PopupPosition>
              id={ids.id}
              aria-labelledby={ids.labelId}
              value={a.popupPosition}
              minWidth={180}
              options={[
                { value: 'cursor', label: 'Next to the cursor' },
                { value: 'center', label: 'Center of the screen' },
                { value: 'remember', label: 'Where I last left it' },
              ]}
              onChange={(v) => void set({ appearance: { popupPosition: v } })}
            />
          )}
        </Field>
        <Field label="Quick-paste numbers" description={`Numbers 1–9 next to rows for ${mac ? '⌘' : 'Ctrl+'}1…9.`}>
          {(ids) => (
            <Select<Badges>
              id={ids.id}
              aria-labelledby={ids.labelId}
              aria-describedby={ids.descriptionId}
              value={a.showQuickPasteBadges}
              minWidth={180}
              options={[
                { value: 'modifier', label: mac ? 'While holding ⌘' : 'While holding Ctrl' },
                { value: 'always', label: 'Always' },
                { value: 'never', label: 'Never' },
              ]}
              onChange={(v) => void set({ appearance: { showQuickPasteBadges: v } })}
            />
          )}
        </Field>
      </Card>
    </>
  );
}
