import { Layers, MousePointerClick, ScrollText } from 'lucide-react';
import { LANGUAGE_LABELS } from '@shared/detect';
import type { Clip, ClipSummary } from '@shared/types';
import { api } from '@/lib/api';
import { appLabel, formatBytes, formatCount, fullDateTime, plural } from '@/lib/format';
import { comboParts } from '@/lib/keys';
import { EmptyState } from '@/components/EmptyState';
import { Tag } from '@/components/Chip';
import { Icon, KIND_ICONS, KIND_LABELS } from '@/components/Icon';
import { Kbd } from '@/components/Kbd';
import { groupColorVar, useGroups } from '@/store/groupsStore';
import { findClip, findSnippet, targetIds, usePopup } from '@/store/popupStore';
import { useSettings } from '@/store/settingsStore';
import { EditClip, SaveSnippetForm, SnippetEditor } from './EditClip';
import { CodePreview, ColorPreview, FilesPreview, ImagePreview, LinkPreview, SnippetPreview, TextPreview } from './previews/previews';
import styles from './PreviewPane.module.css';

export function PreviewPane() {
  const filter = usePopup((s) => s.filter);
  const selectedId = usePopup((s) => s.selectedId);
  const editing = usePopup((s) => s.editing);
  const multiCount = usePopup((s) => s.multi.size);
  const clip = usePopup((s) => findClip(s, s.selectedId));
  const snippet = usePopup((s) => (s.filter === 'snippets' ? findSnippet(s, s.selectedId) : undefined));
  const detail = usePopup((s) => (s.detail && s.detail.id === s.selectedId ? s.detail : null));

  let content: React.ReactNode;
  if (editing === 'newSnippet') content = <SnippetEditor snippet={null} />;
  else if (filter === 'snippets') {
    if (!snippet) content = <EmptyState compact icon={ScrollText} title="No snippet selected" />;
    else if (editing === 'snippet') content = <SnippetEditor snippet={snippet} />;
    else content = <SnippetView key={snippet.id} />;
  } else if (multiCount > 1) content = <MultiPreview />;
  else if (!clip) content = <EmptyState compact icon={MousePointerClick} title="Nothing selected" description="Pick a clip to preview it here." />;
  else if (editing === 'clip') content = detail ? <EditClip clip={detail} /> : null;
  else content = <ClipView key={clip.id} clip={clip} detail={detail} saving={editing === 'saveSnippet'} />;

  return (
    <aside className={styles.pane} aria-label="Preview" data-selected={selectedId ?? undefined}>
      {content}
    </aside>
  );
}

function kindTitle(c: ClipSummary): string {
  if (c.kind === 'code') return LANGUAGE_LABELS[c.meta.language ?? ''] ?? 'Code';
  if (c.kind === 'files') return c.files && c.files.length > 1 ? `${c.files.length} Files` : 'File';
  return KIND_LABELS[c.kind];
}

function sizeSummary(c: ClipSummary): string {
  if (c.kind === 'image' && c.image) return `${c.image.width}×${c.image.height} · ${formatBytes(c.image.bytes)}`;
  if (c.kind === 'files') return c.files ? plural(c.files.length, 'item') : '';
  const parts: string[] = [];
  if (c.meta.lineCount && c.meta.lineCount > 1) parts.push(plural(c.meta.lineCount, 'line'));
  if (c.meta.charCount !== undefined) parts.push(plural(c.meta.charCount, 'char'));
  return parts.join(' · ');
}

function ClipView({ clip, detail, saving }: { clip: ClipSummary; detail: Clip | null; saving: boolean }) {
  const text = detail?.text ?? null;
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <span className={styles.kind} data-kind={clip.kind}>
          {clip.kind === 'color' && clip.meta.colorHex ? (
            <span className={styles.kindSwatch} style={{ background: clip.meta.colorHex }} />
          ) : (
            <Icon icon={KIND_ICONS[clip.kind]} size={13} />
          )}
          {kindTitle(clip)}
        </span>
        <span className={styles.size}>{sizeSummary(clip)}</span>
      </header>
      {saving && <SaveSnippetForm defaultTitle={clip.preview.slice(0, 48)} />}
      <div className={styles.body}>
        <ClipBody clip={clip} text={text} />
      </div>
      <ClipMeta clip={clip} />
    </div>
  );
}

function ClipBody({ clip, text }: { clip: ClipSummary; text: string | null }) {
  switch (clip.kind) {
    case 'image':
      return <ImagePreview clip={clip} />;
    case 'files':
      return <FilesPreview files={clip.files ?? []} />;
    case 'color':
      return <ColorPreview hex={clip.meta.colorHex ?? '#000000'} original={text ?? clip.preview} />;
    case 'link':
      return <LinkPreview url={clip.meta.url ?? clip.preview} />;
    case 'code':
      return text === null ? <Placeholder /> : <CodePreview text={text} language={clip.meta.language ?? ''} />;
    default:
      return text === null ? <Placeholder /> : <TextPreview text={text} />;
  }
}

function Placeholder() {
  return <div className={styles.placeholder} aria-hidden />;
}

function ClipMeta({ clip }: { clip: ClipSummary }) {
  const groups = useGroups((s) => s.groups);
  const showSource = useSettings((s) => s.settings?.general.showSourceApp ?? true);
  const clipGroups = groups.filter((g) => clip.groupIds.includes(g.id));
  const rows: Array<[string, React.ReactNode]> = [];
  if (showSource && clip.sourceApp) rows.push(['Source', appLabel(clip.sourceApp)]);
  rows.push(['Copied', `${fullDateTime(clip.updatedAt)}${clip.copyCount > 1 ? ` · ${formatCount(clip.copyCount)}×` : ''}`]);
  if (clip.lastPastedAt) rows.push(['Pasted', fullDateTime(clip.lastPastedAt)]);
  if (clip.createdAt < clip.updatedAt - 60_000) rows.push(['First copied', fullDateTime(clip.createdAt)]);
  if (clip.hasHtml || clip.hasRtf) rows.push(['Formats', ['Plain', clip.hasHtml && 'HTML', clip.hasRtf && 'RTF'].filter(Boolean).join(' · ')]);
  return (
    <footer className={styles.meta}>
      <dl className={styles.metaList}>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.metaRow}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {clipGroups.length > 0 && (
        <div className={styles.groups} aria-label="Collections">
          {clipGroups.map((g) => (
            <Tag key={g.id} dot={groupColorVar(g.color)}>{g.name}</Tag>
          ))}
        </div>
      )}
    </footer>
  );
}

function SnippetView() {
  const snippet = usePopup((s) => findSnippet(s, s.selectedId))!;
  const groups = useGroups((s) => s.groups);
  const group = groups.find((g) => g.id === snippet.groupId);
  const platform = api.platform;
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <span className={styles.kind} data-kind="snippet">
          <Icon icon={ScrollText} size={13} />
          Snippet
        </span>
        {snippet.keyword && <Tag tone="accent">{snippet.keyword}</Tag>}
      </header>
      <div className={styles.body}>
        <SnippetPreview snippet={snippet} />
      </div>
      <footer className={styles.meta}>
        <dl className={styles.metaList}>
          <div className={styles.metaRow}><dt>Used</dt><dd>{snippet.usageCount === 1 ? 'Once' : `${formatCount(snippet.usageCount)} times`}</dd></div>
          <div className={styles.metaRow}><dt>Updated</dt><dd>{fullDateTime(snippet.updatedAt)}</dd></div>
          <div className={styles.metaRow}><dt>Edit</dt><dd><Kbd parts={comboParts('mod+e', platform)} /></dd></div>
        </dl>
        {group && <div className={styles.groups}><Tag dot={groupColorVar(group.color)}>{group.name}</Tag></div>}
      </footer>
    </div>
  );
}

function MultiPreview() {
  const state = usePopup();
  const ids = targetIds(state);
  const clips = ids.map((id) => findClip(state, id)).filter((c): c is ClipSummary => !!c);
  const separator = useSettings((s) => s.settings?.general.mergeSeparator ?? '\n');
  const platform = api.platform;
  const sepLabel = separator === '\n' ? 'new line' : separator === ' ' ? 'space' : separator === ', ' || separator === ',' ? 'comma' : `“${separator}”`;
  return (
    <div className={styles.view}>
      <header className={styles.header}>
        <span className={styles.kind} data-kind="multi">
          <Icon icon={Layers} size={13} />
          {plural(clips.length, 'clip')} selected
        </span>
      </header>
      <div className={styles.body}>
        <ol className={styles.multiList}>
          {clips.map((c, i) => (
            <li key={c.id} className={styles.multiItem}>
              <span className={styles.multiIndex}>{i + 1}</span>
              <Icon icon={KIND_ICONS[c.kind]} size={13} className={styles.multiIcon} />
              <span className={styles.multiText}>{c.preview}</span>
            </li>
          ))}
        </ol>
      </div>
      <footer className={styles.meta}>
        <dl className={styles.metaList}>
          <div className={styles.metaRow}><dt>Paste merged</dt><dd><Kbd parts={['↵']} /></dd></div>
          <div className={styles.metaRow}><dt>As plain text</dt><dd><Kbd parts={comboParts('shift+enter', platform)} /></dd></div>
          <div className={styles.metaRow}><dt>Separator</dt><dd>{sepLabel}</dd></div>
        </dl>
      </footer>
    </div>
  );
}
