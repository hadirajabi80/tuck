// Auto-update state shared by the About card and the popup status bar: initial updates:getState,
// then every updates:changed broadcast from main.
import { useEffect, useState } from 'react';
import type { UpdateState } from '@shared/types';
import { api } from './api';

export function useUpdateState(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null);
  useEffect(() => {
    let alive = true;
    const off = api.on('updates:changed', (next) => setState(next));
    api
      .invoke('updates:getState')
      .then((initial) => {
        // A broadcast that arrived while the request was in flight is newer — keep it.
        if (alive) setState((prev) => prev ?? initial);
      })
      .catch(() => {});
    return () => {
      alive = false;
      off();
    };
  }, []);
  return state;
}
