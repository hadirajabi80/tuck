// Kind-specific preview bodies for the PreviewPane.
import { ExternalLink, File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, FolderOpen, Globe } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ClipSummary, Snippet } from '@shared/types';
import { api } from '@/lib/api';
import { basename, dirname, extname, hostname } from '@/lib/format';
import { tokenize, tokenLines } from '@/lib/highlight';
import { clipImageSrc } from '@/lib/images';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import styles from './previews.module.css';

const MAX_PREVIEW_CHARS = 20_000;
const MAX_CODE_LINES = 400;

export function TextPreview({ text }: { text: string }) {
  const shown = text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS)}…` : text;
  return <div className={styles.text}>{shown}</div>;
}

export function CodePreview({ text, language }: { text: string; language: string }) {
  const lines = useMemo(() => {
    const src = text.length > MAX_PREVIEW_CHARS ? text.slice(0, MAX_PREVIEW_CHARS) : text;
    return tokenLines(tokenize(src, language)).slice(0, MAX_CODE_LINES);
  }, [text, language]);
  const gutter = String(lines.length).length;
  return (
    <div className={styles.code} style={{ ['--gutter' as string]: `${gutter + 1}ch` }}>
      {lines.map((line, i) => (
        <div key={i} className={styles.codeLine}>
          <span className={styles.lineNo} aria-hidden>{i + 1}</span>
          <span className={styles.lineText}>
            {line.length === 0 ? ' ' : line.map((t, j) => (t.t === 'plain' ? t.v : <span key={j} className={styles[`tok_${t.t}`]}>{t.v}</span>))}
          </span>
        </div>
      ))}
    </div>
  );
}

export function ImagePreview({ clip }: { clip: ClipSummary }) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <div className={styles.imageWrap}>
      {!failed ? (
        <img
          className={styles.image}
          src={clipImageSrc(clip.id, 'full')}
          alt={clip.preview}
          draggable={false}
          data-loaded={loaded ? 'true' : undefined}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : (
        <div className={styles.imageMissing}>Image file missing</div>
      )}
    </div>
  );
}

function hexToRgb(hex: string): [number, number, number, number] {
  const h = hex.replace('#', '');
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
}

function luminance(r: number, g: number, b: number): number {
  const c = [r, g, b].map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

export function contrastRatio(hex: string, against: '#FFFFFF' | '#000000'): number {
  const [r, g, b] = hexToRgb(hex);
  const l1 = luminance(r, g, b);
  const l2 = against === '#FFFFFF' ? 1 : 0;
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

export function ColorPreview({ hex, original }: { hex: string; original: string }) {
  const [r, g, b, a] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  const white = contrastRatio(hex, '#FFFFFF');
  const black = contrastRatio(hex, '#000000');
  const fg = white >= black ? '#FFFFFF' : '#000000';
  const rows: Array<[string, string]> = [
    ['HEX', hex.toUpperCase()],
    ['RGB', a < 1 ? `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` : `rgb(${r}, ${g}, ${b})`],
    ['HSL', `hsl(${h}, ${s}%, ${l}%)`],
  ];
  return (
    <div className={styles.color}>
      <div className={styles.swatch} style={{ background: hex, color: fg }}>
        <span className={styles.swatchLabel}>{original.trim()}</span>
      </div>
      <dl className={styles.colorValues}>
        {rows.map(([k, v]) => (
          <div key={k} className={styles.colorRow}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
        <div className={styles.colorRow}>
          <dt>Contrast</dt>
          <dd>
            <span className={styles.contrastChip} style={{ background: hex, color: '#FFFFFF' }}>Aa {white.toFixed(1)}</span>
            <span className={styles.contrastChip} style={{ background: hex, color: '#000000' }}>Aa {black.toFixed(1)}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function LinkPreview({ url }: { url: string }) {
  let path = '';
  try {
    const u = new URL(url);
    path = decodeURIComponent(u.pathname + u.search + u.hash);
  } catch {
    path = url;
  }
  const host = hostname(url);
  return (
    <div className={styles.link}>
      <div className={styles.linkCard}>
        <span className={styles.linkIcon}><Icon icon={Globe} size={18} /></span>
        <div className={styles.linkText}>
          <div className={styles.linkHost}>{host || url}</div>
          {path && path !== '/' && <div className={styles.linkPath}>{path}</div>}
        </div>
      </div>
      <div className={styles.linkUrl}>{url}</div>
      <Button size="sm" icon={ExternalLink} onClick={() => void api.invoke('app:openExternal', { url })}>
        Open in browser
      </Button>
    </div>
  );
}

const FILE_ICONS: Array<[RegExp, typeof File]> = [
  [/^(png|jpe?g|gif|webp|bmp|svg|heic|ico|tiff?)$/, FileImage],
  [/^(mp3|m4a|flac|wav|ogg|aac)$/, FileAudio],
  [/^(mp4|mov|mkv|avi|webm)$/, FileVideo],
  [/^(zip|7z|rar|gz|tar|exe|msi|dmg)$/, FileArchive],
  [/^(xlsx?|csv|numbers)$/, FileSpreadsheet],
  [/^(ts|tsx|js|jsx|json|py|rs|go|c|cpp|cs|java|html|css|sh|ps1|md)$/, FileCode],
  [/^(txt|docx?|pdf|rtf|pages|odt)$/, FileText],
];

function fileIcon(path: string): typeof File {
  const ext = extname(path);
  if (!ext) return Folder;
  return FILE_ICONS.find(([re]) => re.test(ext))?.[1] ?? File;
}

export function FilesPreview({ files }: { files: string[] }) {
  return (
    <ul className={styles.files}>
      {files.map((f) => (
        <li key={f} className={styles.file}>
          <Icon icon={fileIcon(f)} size={16} className={styles.fileIcon} />
          <span className={styles.fileText}>
            <span className={styles.fileName}>{basename(f)}</span>
            <span className={styles.fileDir}>{dirname(f)}</span>
          </span>
          <button type="button" tabIndex={-1} className={styles.reveal} title="Reveal" aria-label={`Reveal ${basename(f)}`} onClick={() => void api.invoke('app:revealPath', { path: f })}>
            <Icon icon={FolderOpen} size={13} />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SnippetPreview({ snippet }: { snippet: Snippet }) {
  return (
    <div className={styles.snippet}>
      <div className={styles.snippetTitle}>{snippet.title}</div>
      <TextPreview text={snippet.body} />
    </div>
  );
}
