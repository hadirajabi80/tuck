// Thin lucide-react wrapper: consistent size/stroke, decorative by default.
import type { LucideIcon } from 'lucide-react';
import {
  BookOpen, Braces, Briefcase, Code2, FileText, Files, Folder, Hash, Image as ImageIcon, Link2, Palette, Star, Tag, Type,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import type { ClipKind } from '@shared/types';

export interface IconProps {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible label; when omitted the icon is aria-hidden. */
  label?: string;
}

export function Icon({ icon: Glyph, size = 16, strokeWidth = 1.75, className, style, label }: IconProps) {
  return (
    <Glyph
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      style={style}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      focusable={false}
    />
  );
}

export const KIND_ICONS: Record<ClipKind, LucideIcon> = {
  text: Type,
  link: Link2,
  color: Palette,
  code: Code2,
  image: ImageIcon,
  files: Files,
};

export const KIND_LABELS: Record<ClipKind, string> = {
  text: 'Text',
  link: 'Link',
  color: 'Color',
  code: 'Code',
  image: 'Image',
  files: 'Files',
};

/** Icons for collections (Group.icon holds a lucide name). */
const GROUP_ICONS: Record<string, LucideIcon> = {
  briefcase: Briefcase, palette: Palette, 'book-open': BookOpen, star: Star, tag: Tag, folder: Folder, hash: Hash,
  braces: Braces, 'file-text': FileText,
};

export function groupIcon(name: string | null | undefined): LucideIcon {
  return (name && GROUP_ICONS[name]) || Hash;
}
