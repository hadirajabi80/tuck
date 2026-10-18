import { api, isMock } from '@/lib/api';
import { formatCount, plural } from '@/lib/format';
import { comboParts } from '@/lib/keys';
import { Kbd } from '@/components/Kbd';
import { usePopup } from '@/store/popupStore';
import styles from './StatusBar.module.css';

export function StatusBar() {
  const filter = usePopup((s) => s.filter);
  const total = usePopup((s) => s.total);
  const pinnedTotal = usePopup((s) => s.pinnedTotal);
  const multi = usePopup((s) => s.multi.size);
  const query = usePopup((s) => s.query);
  const snippets = usePopup((s) => s.snippets.length);
  const previewVisible = usePopup((s) => s.previewVisible);
  const loaded = usePopup((s) => s.loaded);
  const platform = api.platform;

  const count = filter === 'snippets' ? plural(snippets, 'snippet') : `${formatCount(total + pinnedTotal)} ${query ? (total + pinnedTotal === 1 ? 'match' : 'matches') : total + pinnedTotal === 1 ? 'clip' : 'clips'}`;
  const hint = (parts: string[], label: string) => (
    <span className={styles.hint}>
      <Kbd parts={parts} bare />
      <span>{label}</span>
    </span>
  );

  return (
    <footer className={styles.bar}>
      <span className={styles.count} aria-live="polite">
        {multi > 0 ? <strong>{formatCount(multi)} selected</strong> : loaded ? count : ' '}
      </span>
      <span className={styles.hints}>
        {multi > 0 ? (
          <>
            {hint(['↵'], 'paste merged')}
            {hint(comboParts('mod+space', platform), 'toggle')}
            {hint(['Esc'], 'clear')}
          </>
        ) : (
          <>
            {hint(['↑↓'], 'navigate')}
            {hint(['↵'], 'paste')}
            {filter !== 'snippets' && hint(comboParts('shift+enter', platform), 'plain')}
            {previewVisible && filter !== 'snippets' && hint(comboParts('mod+t', platform), 'transform')}
            {hint(['?'], 'shortcuts')}
          </>
        )}
      </span>
      {isMock && <span className={styles.mock} title="Running against the in-memory mock API">mock</span>}
    </footer>
  );
}
