import { Card, CardBody, Field } from '@/components/Field';
import { Toggle } from '@/components/Toggle';
import { useSettings } from '@/store/settingsStore';
import { IgnoredAppsEditor, IgnorePatternsEditor } from '../IgnoredAppsEditor';
import { SectionHeader } from '../SettingsApp';

export function PrivacySection() {
  const p = useSettings((s) => s.settings!.privacy);
  const paused = useSettings((s) => s.capture.paused);
  const setPaused = useSettings((s) => s.setPaused);
  const set = useSettings((s) => s.set);
  return (
    <>
      <SectionHeader title="Privacy" description="Control what Tuck is allowed to remember. History never leaves this device." />
      <Card>
        <Field label="Pause capture" description={paused ? 'Tuck is not saving anything you copy right now.' : 'Stop saving new copies until you resume.'}>
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={paused} onChange={(v) => void setPaused(v)} />}
        </Field>
        <Field label="Skip concealed content" description="Password managers mark copied secrets as concealed — Tuck never saves them.">
          {(ids) => <Toggle id={ids.id} aria-labelledby={ids.labelId} aria-describedby={ids.descriptionId} checked={p.skipConcealed} onChange={(v) => void set({ privacy: { skipConcealed: v } })} />}
        </Field>
      </Card>
      <Card title="Ignored apps" description="Anything copied while these apps are in front is not saved.">
        <CardBody>
          <IgnoredAppsEditor />
        </CardBody>
      </Card>
      <Card title="Ignore patterns" description="Text matching any of these regular expressions is not saved.">
        <CardBody>
          <IgnorePatternsEditor />
        </CardBody>
      </Card>
    </>
  );
}
