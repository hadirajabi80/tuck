import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import styles from './EmptyState.module.css';

/** The Tuck folded-corner card, drawn with tokens so it follows the theme. */
export function FoldedCard({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" fill="none" aria-hidden focusable="false" className={styles.art}>
      <rect x="14" y="20" width="40" height="44" rx="8" fill="var(--bg-surface-2)" stroke="var(--border-strong)" />
      <path
        d="M24 10h22l12 12v34a8 8 0 0 1-8 8H24a8 8 0 0 1-8-8V18a8 8 0 0 1 8-8Z"
        fill="var(--bg-surface)"
        stroke="var(--border-strong)"
      />
      <path d="M46 10v8a4 4 0 0 0 4 4h8L46 10Z" fill="var(--accent-a5)" stroke="var(--accent-9)" strokeLinejoin="round" />
      <rect x="24" y="30" width="22" height="3" rx="1.5" fill="var(--fg-4)" opacity="0.55" />
      <rect x="24" y="37" width="26" height="3" rx="1.5" fill="var(--fg-4)" opacity="0.4" />
      <rect x="24" y="44" width="16" height="3" rx="1.5" fill="var(--fg-4)" opacity="0.3" />
    </svg>
  );
}

/** App mark used in About and the title bar. */
export function TuckMark({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden focusable="false">
      <defs>
        <linearGradient id="tuck-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4B4BC4" />
          <stop offset="1" stopColor="#23236A" />
        </linearGradient>
      </defs>
      {/* Same clipboard-on-tile mark as the app icon (scripts/gen-icons.mjs). */}
      <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#tuck-mark-g)" />
      <rect x="18.5" y="17.5" width="27" height="34" rx="4.5" fill="#FFFFFF" />
      <rect x="23" y="29" width="18" height="3" rx="1.5" fill="#5B5BD6" />
      <rect x="23" y="36.5" width="14" height="3" rx="1.5" fill="#5B5BD6" />
      <rect x="23" y="44" width="16" height="3" rx="1.5" fill="#5B5BD6" />
      <rect x="25" y="12.5" width="14" height="8.5" rx="2.6" fill="#A9A6FF" stroke="#2E2C80" strokeWidth="1.8" />
    </svg>
  );
}

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  /** Show the folded-corner illustration (no clips at all). */
  illustration?: boolean;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title, description, icon, illustration, action, compact }: EmptyStateProps) {
  return (
    <div className={styles.empty} data-compact={compact ? 'true' : undefined} role="status">
      {illustration ? (
        <FoldedCard />
      ) : icon ? (
        <span className={styles.iconWrap}>
          <Icon icon={icon} size={20} />
        </span>
      ) : null}
      <div className={styles.title}>{title}</div>
      {description && <div className={styles.description}>{description}</div>}
      {action && <div className={styles.action}>{action}</div>}
    </div>
  );
}
