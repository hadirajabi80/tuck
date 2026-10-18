// PLACEHOLDER — the renderer engineer replaces this with PopupApp / SettingsApp routing.
import { useEffect, useState } from 'react';
import type { WindowKind } from '@shared/types';
import { api, isMock } from './lib/api';

function routeFromHash(): WindowKind {
  return window.location.hash.startsWith('#/settings') ? 'settings' : 'popup';
}

export function App() {
  const [route, setRoute] = useState<WindowKind>(routeFromHash);

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHash);
    console.log(`[tuck] route=${routeFromHash()} platform=${api.platform} windowKind=${api.windowKind} mock=${isMock}`);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  return (
    <main
      style={{
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-md)',
        color: 'var(--fg-1)',
        background: 'var(--bg-app)',
        minHeight: '100vh',
        margin: 0,
        padding: 'var(--sp-6)',
        boxSizing: 'border-box',
      }}
    >
      <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--weight-semibold)', margin: 0 }}>Tuck — {route}</h1>
      <p style={{ color: 'var(--fg-2)' }}>
        platform: <code>{api.platform}</code> · windowKind: <code>{api.windowKind}</code>
        {isMock ? ' · mock api' : ''}
      </p>
    </main>
  );
}
