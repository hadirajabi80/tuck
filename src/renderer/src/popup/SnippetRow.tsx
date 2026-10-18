import { ScrollText } from 'lucide-react';
import { memo } from 'react';
import type { Snippet } from '@shared/types';
import { makePreview } from '@shared/detect';
import { Icon } from '@/components/Icon';
import type { RowCommonProps } from './ClipRow';
import rowStyles from './ClipRow.module.css';
import styles from './SnippetRow.module.css';

export const SnippetRow = memo(function SnippetRow(p: RowCommonProps & { snippet: Snippet }) {
  const s = p.snippet;
  return (
    <div
      id={`clip-row-${s.id}`}
      role="option"
      aria-selected={p.selected}
      aria-posinset={p.posInSet}
      aria-setsize={p.setSize}
      className={rowStyles.row}
      style={p.style}
      data-selected={p.selected ? 'true' : undefined}
      data-removing={p.removing ? 'true' : undefined}
      onClick={(e) => p.onClick(s.id, e)}
      onDoubleClick={() => p.onDoubleClick(s.id)}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className={`${rowStyles.inner} ${styles.inner}`}>
        <span className={rowStyles.lead}>
          {p.quickIndex >= 0 && <span className={rowStyles.badge} data-visible={p.showBadge ? 'true' : undefined} aria-hidden>{p.quickIndex + 1}</span>}
        </span>
        <span className={`${rowStyles.glyph} ${styles.glyph}`}>
          <Icon icon={ScrollText} size={15} />
        </span>
        <span className={styles.text}>
          <span className={styles.title}>{s.title}</span>
          <span className={styles.body}>{makePreview(s.body, 120)}</span>
        </span>
        {s.keyword ? <span className={styles.keyword}>{s.keyword}</span> : <span />}
      </div>
    </div>
  );
});
