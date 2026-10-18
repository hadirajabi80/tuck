import { useEffect, useRef, useState } from 'react';
import type { SettingsSection } from '@shared/types';
import { api } from '@/lib/api';
import { applyAppearance } from '@/lib/theme';
import { DialogHost } from '@/components/Dialog';
import { Toasts } from '@/components/Toasts';
import { useSettings, initSettingsSync } from '@/store/settingsStore';
import { toast } from '@/store/toastStore';
import { NavRail, SECTIONS } from './NavRail';
import { TitleBar } from './TitleBar';
import { AboutSection } from './sections/AboutSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { GeneralSection } from './sections/GeneralSection';
import { HistorySection } from './sections/HistorySection';
import { PrivacySection } from './sections/PrivacySection';
import { ShortcutsSection } from './sections/ShortcutsSection';
import styles from './SettingsApp.module.css';

function sectionFromHash(): SettingsSection {
  const m = /^#\/settings\/(\w+)/.exec(window.location.hash);
  const s = m?.[1] as SettingsSection | undefined;
  return s && SECTIONS.some((x) => x.id === s) ? s : 'general';
}

export function SettingsApp() {
  const [section, setSection] = useState<SettingsSection>(sectionFromHash);
  const settings = useSettings((s) => s.settings);
  const loaded = useSettings((s) => s.loaded);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    initSettingsSync();
    const offNav = api.on('settings:navigate', (e) => setSection(e.section));
    const offNotify = api.on('app:notify', (n) => toast(n.message, n.level, undefined, n.durationMs));
    return () => { offNav(); offNotify(); };
  }, []);

  useEffect(() => applyAppearance(settings, 'settings'), [settings]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
    const label = SECTIONS.find((s) => s.id === section)?.label ?? '';
    document.title = `${label} — Tuck Settings`;
  }, [section]);

  return (
    <div className={styles.app}>
      <TitleBar />
      <div className={styles.main}>
        <NavRail section={section} onSelect={setSection} />
        <div ref={scroller} className={styles.content} role="tabpanel" aria-labelledby={`nav-${section}`} id="settings-panel">
          <div className={styles.column}>
            {!loaded || !settings ? null : (
              <>
                {section === 'general' && <GeneralSection />}
                {section === 'shortcuts' && <ShortcutsSection />}
                {section === 'history' && <HistorySection />}
                {section === 'appearance' && <AppearanceSection />}
                {section === 'privacy' && <PrivacySection />}
                {section === 'about' && <AboutSection />}
              </>
            )}
          </div>
        </div>
      </div>
      <Toasts placement="bottom-right" />
      <DialogHost />
    </div>
  );
}

export function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className={styles.sectionHeader}>
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
}
