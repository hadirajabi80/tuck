// Hash routing: #/popup (default) and #/settings. The route wins over window.api.windowKind if they differ.
import { lazy, Suspense, useEffect, useState } from 'react';
import type { WindowKind } from '@shared/types';
import { api, isMock } from './lib/api';
import { applyDocumentAttributes } from './lib/theme';
import { PopupApp } from './popup/PopupApp';

const SettingsApp = lazy(() => import('./settings/SettingsApp').then((m) => ({ default: m.SettingsApp })));

function routeFromHash(): WindowKind {
  return window.location.hash.startsWith('#/settings') ? 'settings' : 'popup';
}

export function App() {
  const [route, setRoute] = useState<WindowKind>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    applyDocumentAttributes({ platform: api.platform, windowKind: route, mock: isMock });
    document.title = route === 'settings' ? 'Tuck Settings' : 'Tuck';
    if (route !== api.windowKind && !isMock) console.warn(`[tuck] route "${route}" differs from windowKind "${api.windowKind}"`);
  }, [route]);

  if (route === 'settings') {
    return (
      <Suspense fallback={null}>
        <SettingsApp />
      </Suspense>
    );
  }
  return <PopupApp />;
}
