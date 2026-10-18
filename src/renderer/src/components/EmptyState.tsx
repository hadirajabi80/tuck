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
      <path d="M16 4h28l16 16v28a12 12 0 0 1-12 12H16A12 12 0 0 1 4 48V16A12 12 0 0 1 16 4Z" fill="url(#tuck-mark-g)" />
      <path d="M44 4v10a6 6 0 0 0 6 6h10L44 4Z" fill="#9C98FF" />
      <rect x="16" y="28" width="22" height="4" rx="2" fill="#FFFFFF" opacity="0.9" />
      <rect x="16" y="37" width="30" height="4" rx="2" fill="#FFFFFF" opacity="0.55" />
      <rect x="16" y="46" width="14" height="4" rx="2" fill="#FFFFFF" opacity="0.35" />
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
