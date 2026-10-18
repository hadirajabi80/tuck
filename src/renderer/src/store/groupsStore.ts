// Collections (Ditto groups).
import { create } from 'zustand';
import type { Group, GroupColor } from '@shared/types';
import { GROUP_COLORS } from '@shared/types';
import { api } from '@/lib/api';
import { toast } from './toastStore';

interface GroupsState {
  groups: Group[];
  load: () => Promise<void>;
  create: (name: string) => Promise<Group | null>;
  remove: (id: string) => Promise<void>;
}

export const useGroups = create<GroupsState>((set, get) => ({
  groups: [],
  load: async () => {
    try {
      set({ groups: await api.invoke('groups:list') });
    } catch (err) {
      console.error('[tuck] groups:list failed', err);
    }
  },
  create: async (name) => {
    try {
      const used = new Set(get().groups.map((g) => g.color));
      const color: GroupColor = GROUP_COLORS.find((c) => c !== 'gray' && !used.has(c)) ?? 'gray';
      const g = await api.invoke('groups:create', { name, color });
      set((s) => ({ groups: [...s.groups, g] }));
      return g;
    } catch {
      toast('Could not create the collection', 'error');
      return null;
    }
  },
  remove: async (id) => {
    await api.invoke('groups:delete', { id });
    set((s) => ({ groups: s.groups.filter((g) => g.id !== id) }));
  },
}));

export function groupColorVar(color: GroupColor | null | undefined): string {
  return `var(--group-${color ?? 'gray'})`;
}

let subscribed = false;
export function initGroupsSync(): void {
  if (subscribed) return;
  subscribed = true;
  let t: ReturnType<typeof setTimeout> | null = null;
  const reload = () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => void useGroups.getState().load(), 60);
  };
  api.on('groups:changed', reload);
  api.on('clips:changed', reload); // clip counts
  void useGroups.getState().load();
}
