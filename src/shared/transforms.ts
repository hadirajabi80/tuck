// Pure text transforms applied on paste (DESIGN.md section B / TransformMenu).
// No electron/node imports. Every transform drops html/rtf alternates — the caller handles that.
import { TRANSFORMS, type TransformId } from './types';

export type TransformOutcome = { ok: true; text: string } | { ok: false; error: string };

const TRANSFORM_IDS = new Set<string>(TRANSFORMS.map((t) => t.id));

export function isTransformId(value: unknown): value is TransformId {
  return typeof value === 'string' && TRANSFORM_IDS.has(value);
}

/** Characters after which a letter starts a new word for Title Case. Apostrophes are excluded ("don't"). */
const TITLE_BOUNDARY = /(^|[\s\-‐–—/([{"“«_.])(\p{L})/gu;

function titleCase(text: string): string {
  return text.toLocaleLowerCase().replace(TITLE_BOUNDARY, (_m, pre: string, ch: string) => pre + ch.toLocaleUpperCase());
}

/** A line break plus any horizontal whitespace around it. */
const LINE_BREAK = /[^\S\r\n]*(?:\r\n|\r|\n|\u{2028}|\u{2029})[^\S\r\n]*/gu;
const ZERO_WIDTH = /[\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu;
const EXOTIC_SPACES = /[\u{A0}\u{2007}\u{202F}]/gu;

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const src = text.replace(/^\u{FEFF}/u, '').trim();
  if (!src) return { ok: false, error: 'Empty text is not JSON' };
  try {
    return { ok: true, value: JSON.parse(src) };
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Applies a transform, reporting failures (currently only the JSON transforms can fail). */
export function transformText(id: TransformId, text: string): TransformOutcome {
  switch (id) {
    case 'upper': return { ok: true, text: text.toLocaleUpperCase() };
    case 'lower': return { ok: true, text: text.toLocaleLowerCase() };
    case 'title': return { ok: true, text: titleCase(text) };
    case 'trim': return { ok: true, text: text.trim() };
    case 'collapseWhitespace': return { ok: true, text: text.replace(/\s+/g, ' ').trim() };
    case 'removeLineBreaks': return { ok: true, text: text.trim().replace(LINE_BREAK, ' ') };
    case 'jsonPretty': {
      const p = parseJson(text);
      return p.ok ? { ok: true, text: JSON.stringify(p.value, null, 2) } : p;
    }
    case 'jsonMinify': {
      const p = parseJson(text);
      return p.ok ? { ok: true, text: JSON.stringify(p.value) } : p;
    }
    case 'stripFormatting':
      // Text-level cleanup only (html/rtf are dropped by the caller): remove zero-width chars, normalise exotic spaces.
      return { ok: true, text: text.replace(ZERO_WIDTH, '').replace(EXOTIC_SPACES, ' ') };
    default: {
      const never: never = id;
      return { ok: false, error: `Unknown transform: ${String(never)}` };
    }
  }
}

/** Applies a transform; returns the input unchanged when the transform does not apply (e.g. invalid JSON). */
export function applyTransform(id: TransformId, text: string): string {
  const r = transformText(id, text);
  return r.ok ? r.text : text;
}
