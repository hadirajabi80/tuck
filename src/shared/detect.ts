// Pure content detection for text-family clips: link / colour / code / text, meta, previews,
// and the subsequence fuzzy scorer used by search re-ranking. No electron/node imports.
import { LIMITS, type ClipKind, type ClipMeta } from './types';

export type TextKind = Extract<ClipKind, 'text' | 'link' | 'color' | 'code'>;

// ---------------------------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------------------------

const MAX_LINK_CHARS = 2048;
const SCHEME_URL = /^(?:https?|ftp|file):\/\/\S+$/i;
const MAILTO = /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const WWW_URL = /^www\.[^\s./]+\.[^\s]+$/i;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Returns the normalised URL when the whole (trimmed) text is a single link, else null. */
export function detectLink(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > MAX_LINK_CHARS || /\s/.test(t)) return null;
  let candidate: string;
  if (SCHEME_URL.test(t) || MAILTO.test(t)) candidate = t;
  else if (WWW_URL.test(t)) candidate = `https://${t}`;
  else return null;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'ftp:') {
    const host = url.hostname;
    const hostOk = host === 'localhost' || IPV4.test(host) || host.startsWith('[') || /^[^.]+(\.[^.]+)+$/.test(host);
    if (!hostOk) return null;
  }
  return url.href;
}

// ---------------------------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------------------------

const HEX_COLOR = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_COLOR = /^(rgba?|hsla?)\(\s*([^()]*?)\s*\)$/i;

const hex2 = (n: number): string => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0').toUpperCase();

function toHex(r: number, g: number, b: number, a = 1): string {
  const base = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
  const alpha = Math.round(Math.min(1, Math.max(0, a)) * 255);
  return alpha === 255 ? base : base + hex2(alpha);
}

function parseNumber(token: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(token)) return null;
  return Number(token);
}

/** "50%" → 0.5 (as fraction) or a plain number → value. Returns null if malformed. */
function parseComponent(token: string): { value: number; percent: boolean } | null {
  if (token.endsWith('%')) {
    const n = parseNumber(token.slice(0, -1));
    return n === null ? null : { value: n / 100, percent: true };
  }
  const n = parseNumber(token);
  return n === null ? null : { value: n, percent: false };
}

function parseAlpha(token: string | undefined): number | null {
  if (token === undefined) return 1;
  const c = parseComponent(token);
  if (!c) return null;
  if (c.value < 0 || c.value > 1) return null;
  return c.value;
}

function parseHue(token: string): number | null {
  const m = /^([+-]?(?:\d+\.?\d*|\.\d+))(deg|turn|rad)?$/i.exec(token);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'deg').toLowerCase();
  const deg = unit === 'turn' ? n * 360 : unit === 'rad' ? (n * 180) / Math.PI : n;
  return ((deg % 360) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number): number => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): number => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * Parses a CSS colour literal (#RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb()/rgba(), hsl()/hsla(), comma or space syntax).
 * Returns upper-case #RRGGBB, or #RRGGBBAA when alpha < 1. Named colours are intentionally not recognised.
 */
export function parseColor(text: string): string | null {
  const t = text.trim().replace(/;$/, '').trim();
  if (!t || t.length > 64) return null;
  const hex = HEX_COLOR.exec(t);
  if (hex) {
    let h = hex[1]!.toUpperCase();
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 8 && h.endsWith('FF')) h = h.slice(0, 6);
    return `#${h}`;
  }
  const fn = FUNC_COLOR.exec(t);
  if (!fn) return null;
  const name = fn[1]!.toLowerCase();
  let body = fn[2]!;
  let alphaToken: string | undefined;
  const slash = body.split('/');
  if (slash.length > 2) return null;
  if (slash.length === 2) { body = slash[0]!.trim(); alphaToken = slash[1]!.trim(); }
  let parts = body.includes(',') ? body.split(',').map((p) => p.trim()) : body.split(/\s+/).filter(Boolean);
  if (parts.length === 4 && alphaToken === undefined) { alphaToken = parts[3]; parts = parts.slice(0, 3); }
  if (parts.length !== 3) return null;
  const alpha = parseAlpha(alphaToken);
  if (alpha === null) return null;

  if (name.startsWith('rgb')) {
    const comps = parts.map(parseComponent);
    if (comps.some((c) => c === null)) return null;
    const rgb = (comps as { value: number; percent: boolean }[]).map((c) => (c.percent ? c.value * 255 : c.value));
    if (rgb.some((v) => v < 0 || v > 255)) return null;
    return toHex(rgb[0]!, rgb[1]!, rgb[2]!, alpha);
  }
  const hue = parseHue(parts[0]!);
  const s = parts[1]!.endsWith('%') ? parseComponent(parts[1]!) : null;
  const l = parts[2]!.endsWith('%') ? parseComponent(parts[2]!) : null;
  if (hue === null || !s || !l || s.value < 0 || s.value > 1 || l.value < 0 || l.value > 1) return null;
  const [r, g, b] = hslToRgb(hue, s.value, l.value);
  return toHex(r, g, b, alpha);
}

// ---------------------------------------------------------------------------------------------
// Code
// ---------------------------------------------------------------------------------------------

export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  json: 'JSON', ts: 'TypeScript', js: 'JavaScript', py: 'Python', html: 'HTML', xml: 'XML', css: 'CSS',
  sql: 'SQL', sh: 'Shell', ps1: 'PowerShell', c: 'C', cpp: 'C++', cs: 'C#', java: 'Java', go: 'Go',
  rust: 'Rust', php: 'PHP', yaml: 'YAML', '': 'Code',
};

interface Rule { lang: string; re: RegExp; w: number }

// Weights: 3 = decisive on its own, 2 = strong, 1 = supporting. A language needs a total >= CODE_THRESHOLD.
const RULES: Rule[] = [
  // JavaScript (TypeScript inherits these, see scoreLanguages)
  { lang: 'js', re: /\b(?:const|let|var)\s+[\w$]+\s*=/, w: 2 },
  { lang: 'js', re: /\bfunction\s*[\w$]*\s*\([^)]*\)\s*\{/, w: 3 },
  { lang: 'js', re: /\([^)]*\)\s*=>|[\w$]+\s*=>\s*[{(\w]/, w: 2 },
  { lang: 'js', re: /\bconsole\.(?:log|error|warn|info)\(/, w: 3 },
  { lang: 'js', re: /^\s*(?:import\s+[^;]*\s+from\s+['"]|export\s+(?:default|const|function|class)\b)/m, w: 3 },
  { lang: 'js', re: /\brequire\(\s*['"][^'"]+['"]\s*\)/, w: 3 },
  { lang: 'js', re: /===|!==/, w: 1 },
  { lang: 'js', re: /\b(?:document|window)\.\w+/, w: 1 },
  // TypeScript-only
  { lang: 'ts', re: /^\s*(?:export\s+)?(?:interface|type)\s+\w+(?:<[^>]*>)?\s*(?:=|\{|extends)/m, w: 3 },
  { lang: 'ts', re: /[\w)]\s*:\s*(?:string|number|boolean|void|unknown|any|never)(?:\[\])?\s*[,;)=|{]/, w: 2 },
  { lang: 'ts', re: /\bimport\s+type\b|\bas\s+const\b|\breadonly\s+\w+\s*:/, w: 2 },
  // Python
  { lang: 'py', re: /^\s*def\s+\w+\s*\([^)]*\)\s*(?:->\s*[\w[\], .]+)?:\s*$/m, w: 3 },
  { lang: 'py', re: /^\s*class\s+\w+(?:\([^)]*\))?:\s*$/m, w: 3 },
  { lang: 'py', re: /^\s*(?:from\s+[\w.]+\s+import\s+[\w*, ]+|import\s+[\w.]+(?:\s+as\s+\w+)?)\s*$/m, w: 2 },
  { lang: 'py', re: /^\s*(?:if|elif|for|while|with|try|except)\b[^\n{};]*:\s*$/m, w: 2 },
  { lang: 'py', re: /\bself\.\w+/, w: 1 },
  { lang: 'py', re: /\bprint\(|\b(?:None|True|False)\b/, w: 1 },
  // HTML / XML
  { lang: 'html', re: /^\s*<!doctype\s+html|<html[\s>]|<\/(?:div|span|p|a|body|head|ul|li|table|script|style)>/i, w: 3 },
  { lang: 'xml', re: /^\s*<\?xml\s/i, w: 3 },
  // CSS
  { lang: 'css', re: /^\s*[.#]?[\w-][\w\s.#:>+~*[\]="'-]*\{\s*$/m, w: 1 },
  { lang: 'css', re: /^\s*[\w-]+\s*:\s*[^;{}\n]+;\s*$/m, w: 1 },
  { lang: 'css', re: /[.#]?[\w-]+\s*\{\s*[\w-]+\s*:\s*[^;{}]+;/, w: 3 },
  { lang: 'css', re: /@(?:media|import|keyframes|font-face|supports)\b/, w: 2 },
  // SQL
  { lang: 'sql', re: /^\s*(?:SELECT\s+[\s\S]+?\s+FROM\s+\w+|INSERT\s+INTO\s+\w+|UPDATE\s+\w+\s+SET\s+|DELETE\s+FROM\s+\w+|CREATE\s+(?:TABLE|INDEX|VIEW|TRIGGER)\b|ALTER\s+TABLE\s+\w+|DROP\s+(?:TABLE|INDEX)\b)/im, w: 3 },
  { lang: 'sql', re: /\b(?:WHERE|JOIN|GROUP BY|ORDER BY|VALUES|LIMIT)\b/, w: 1 },
  // Shell
  { lang: 'sh', re: /^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|z)?sh\b/, w: 3 },
  { lang: 'sh', re: /^\s*(?:sudo\s+)?(?:apt(?:-get)?|brew|npm|npx|yarn|pnpm|git|docker|kubectl|curl|wget|chmod|chown|mkdir|rm|cp|mv|ls|cat|grep|ssh|scp|pip3?|cargo|go|make|tar)\s+(?:-{1,2}[\w-]+|[\w./:@-]+)/m, w: 2 },
  { lang: 'sh', re: /\s(?:&&|\|\|)\s|\|\s*(?:grep|awk|sed|xargs|sort|head|tail|wc)\b/, w: 2 },
  { lang: 'sh', re: /^\s*export\s+[A-Z_][A-Z0-9_]*=/m, w: 3 },
  { lang: 'sh', re: /\$\{?[A-Z_][A-Z0-9_]*\}?/, w: 1 },
  // PowerShell
  { lang: 'ps1', re: /\b(?:Get|Set|New|Remove|Write|Invoke|Start|Stop|Import|Test)-[A-Z]\w+/, w: 3 },
  { lang: 'ps1', re: /^\s*\$[\w:]+\s*=/m, w: 1 },
  // C / C++
  { lang: 'c', re: /^\s*#include\s*[<"][\w./]+[>"]/m, w: 3 },
  { lang: 'c', re: /\bint\s+main\s*\(/, w: 2 },
  { lang: 'c', re: /\bprintf\s*\(/, w: 1 },
  { lang: 'cpp', re: /\bstd::\w+|\btemplate\s*<|#include\s*<(?:iostream|vector|string|memory)>/, w: 3 },
  // C#
  { lang: 'cs', re: /^\s*using\s+System(?:\.[\w.]+)?;/m, w: 3 },
  { lang: 'cs', re: /\bnamespace\s+[\w.]+\s*[{;]/, w: 2 },
  { lang: 'cs', re: /\bConsole\.Write(?:Line)?\(|\bvar\s+\w+\s*=\s*new\s+\w+/, w: 2 },
  { lang: 'cs', re: /\b(?:public|private|internal|protected)\s+(?:static\s+|async\s+|override\s+)*(?:class|void|string|int|bool|Task)\b/, w: 1 },
  // Java
  { lang: 'java', re: /\bpublic\s+static\s+void\s+main\s*\(\s*String/, w: 3 },
  { lang: 'java', re: /\bSystem\.out\.print(?:ln)?\(|^\s*import\s+java\./m, w: 3 },
  { lang: 'java', re: /^\s*package\s+[\w.]+;\s*$/m, w: 2 },
  { lang: 'java', re: /\b(?:public|private|protected)\s+(?:static\s+|final\s+)*(?:class|void|String|int|boolean)\b/, w: 1 },
  // Go
  { lang: 'go', re: /^\s*package\s+\w+\s*$/m, w: 2 },
  { lang: 'go', re: /\bfunc\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s*)?\w+\s*\([^)]*\)/, w: 3 },
  { lang: 'go', re: /\b\w+\s*:=\s*/, w: 1 },
  { lang: 'go', re: /\bfmt\.\w+\(/, w: 2 },
  // Rust
  { lang: 'rust', re: /\bfn\s+\w+\s*(?:<[^>]*>)?\s*\([^)]*\)\s*(?:->\s*[\w<>&' ]+)?\s*\{/, w: 3 },
  { lang: 'rust', re: /\blet\s+mut\s+\w+|\bimpl(?:<[^>]*>)?\s+\w+|\bpub\s+(?:fn|struct|enum)\b/, w: 3 },
  { lang: 'rust', re: /\b(?:println|vec|format)!\(/, w: 2 },
  // PHP
  { lang: 'php', re: /^\s*<\?php\b/, w: 3 },
  { lang: 'php', re: /\$\w+\s*->\s*\w+\(|\becho\s+\$\w+/, w: 2 },
];

export const CODE_THRESHOLD = 3;

function isJsonLike(t: string): boolean {
  const first = t[0];
  const last = t[t.length - 1];
  if (!((first === '{' && last === '}') || (first === '[' && last === ']'))) return false;
  if (t.length < 2) return false;
  try {
    const v: unknown = JSON.parse(t);
    if (Array.isArray(v)) return v.length > 0 && (v.length > 1 || typeof v[0] === 'object');
    return typeof v === 'object' && v !== null;
  } catch {
    return false;
  }
}

function isYaml(lines: string[]): boolean {
  const content = lines.filter((l) => l.trim() !== '' && !/^\s*#/.test(l));
  if (content.length < 3) return false;
  const keyLines = content.filter((l) => /^\s*(?:-\s+)?[\w.-]+:(?:\s|$)/.test(l));
  const listLines = content.filter((l) => /^\s*-\s+\S/.test(l));
  const nested = content.some((l) => /^\s{2,}\S/.test(l));
  const prose = content.some((l) => /[.!?]\s+[A-Z]/.test(l));
  return !prose && nested && keyLines.length >= 2 && (keyLines.length + listLines.length) / content.length >= 0.8;
}

/** Fraction of non-blank lines that end like code (`;`, `{`, `}`, `)`, `,`) or are indented. */
function structuralScore(lines: string[]): number {
  const content = lines.filter((l) => l.trim() !== '');
  if (content.length === 0) return 0;
  const codey = content.filter((l) => /[;{}]\s*$|^\s*[})\]]/.test(l) || /^(?: {2,}|\t)\S/.test(l)).length;
  return codey / content.length;
}

/** Scores each language. Exposed for tests/debugging; most callers want guessLanguage/looksLikeCode. */
export function scoreLanguages(text: string): Record<string, number> {
  const scores: Record<string, number> = {};
  for (const r of RULES) if (r.re.test(text)) scores[r.lang] = (scores[r.lang] ?? 0) + r.w;
  if (scores.ts) scores.ts += scores.js ?? 0;
  if (scores.cpp) scores.cpp += scores.c ?? 0;
  return scores;
}

const CODE_SCAN_CHARS = 20_000;

/**
 * Guesses the language of a code-like text. Returns `{ language, code }` where `code` says whether the text
 * should be treated as code at all; language '' means "code, language unknown".
 */
export function analyzeCode(text: string): { code: boolean; language: string } {
  const t = text.trim();
  if (t.length < 4) return { code: false, language: '' };
  const sample = t.length > CODE_SCAN_CHARS ? t.slice(0, CODE_SCAN_CHARS) : t;
  if (isJsonLike(t)) return { code: true, language: 'json' };
  const lines = sample.split(/\r\n|\r|\n/);
  if (/^#!.*\bpython/.test(sample)) return { code: true, language: 'py' };
  if (/^#!.*\bnode\b/.test(sample)) return { code: true, language: 'js' };

  const scores = scoreLanguages(sample);
  const structural = structuralScore(lines);
  let best = '';
  let bestScore = 0;
  for (const [lang, s] of Object.entries(scores)) {
    if (s > bestScore) { best = lang; bestScore = s; }
  }
  if (best && structural >= 0.3) bestScore += 1;
  if (bestScore >= CODE_THRESHOLD) return { code: true, language: best };
  if (isYaml(lines)) return { code: true, language: 'yaml' };
  // Unknown language but clearly structured like code (several lines ending in ; { } or indented blocks with symbols).
  const symbols = (sample.match(/[{}();=<>[\]]/g) ?? []).length / sample.length;
  if (lines.length >= 3 && structural >= 0.6 && symbols >= 0.04) return { code: true, language: best };
  return { code: false, language: '' };
}

/** Language id for code ('json','ts','py',…) or '' if unknown / not code. */
export function guessLanguage(text: string): string {
  return analyzeCode(text).language;
}

export function looksLikeCode(text: string): boolean {
  return analyzeCode(text).code;
}

// ---------------------------------------------------------------------------------------------
// Kind + meta
// ---------------------------------------------------------------------------------------------

/** Kind for a text-family clip. Precedence: color > link > code > text. */
export function detectKind(text: string): TextKind {
  if (parseColor(text)) return 'color';
  if (detectLink(text)) return 'link';
  if (looksLikeCode(text)) return 'code';
  return 'text';
}

export interface TextStats { lineCount: number; wordCount: number; charCount: number }

/** Line / word / code-point counts. A single trailing line break does not count as an extra line. */
export function textStats(text: string): TextStats {
  let charCount = 0;
  let lineCount = text.length > 0 ? 1 : 0;
  let wordCount = 0;
  let inWord = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    // Count code points: skip the low half of a surrogate pair.
    if (!(c >= 0xdc00 && c <= 0xdfff && i > 0 && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff)) charCount++;
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) lineCount++;
    const ws = c === 32 || (c >= 9 && c <= 13) || c === 0xa0 || c === 0x2028 || c === 0x2029 || c === 0x3000 || (c >= 0x2000 && c <= 0x200a);
    if (ws) inWord = false;
    else if (!inWord) { inWord = true; wordCount++; }
  }
  if (lineCount > 1 && /(?:\r\n|\r|\n)$/.test(text)) lineCount--;
  return { lineCount, wordCount, charCount };
}

/** Kind + ClipMeta for a text-family clip (text, link, color, code). */
export function analyzeText(text: string): { kind: TextKind; meta: ClipMeta } {
  const stats = textStats(text);
  const meta: ClipMeta = { ...stats };
  const color = parseColor(text);
  if (color) return { kind: 'color', meta: { ...meta, colorHex: color } };
  const url = detectLink(text);
  if (url) return { kind: 'link', meta: { ...meta, url } };
  const code = analyzeCode(text);
  if (code.code) return { kind: 'code', meta: { ...meta, language: code.language } };
  return { kind: 'text', meta };
}

// ---------------------------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------------------------

/**
 * Single-line preview: whitespace runs (incl. line breaks) collapse to one space, trimmed,
 * at most `max` code points (truncated with '…'). Scans lazily, so huge texts are cheap.
 */
export function makePreview(text: string, max: number = LIMITS.previewChars): string {
  const out: string[] = [];
  let pendingSpace = false;
  let truncated = false;
  for (const ch of text) {
    if (/\s/.test(ch)) { pendingSpace = out.length > 0; continue; }
    if (pendingSpace) { out.push(' '); pendingSpace = false; }
    out.push(ch);
    if (out.length > max) { truncated = true; break; }
  }
  if (!truncated) return out.join('');
  const kept = out.slice(0, Math.max(0, max - 1));
  while (kept.length && kept[kept.length - 1] === ' ') kept.pop();
  return `${kept.join('')}…`;
}

export function imagePreview(width: number, height: number): string {
  return `Image ${width}×${height}`;
}

/** Preview for a file-list clip: the first path ('' for an empty list). */
export function filesPreview(files: readonly string[]): string {
  return makePreview(files[0] ?? '');
}

// ---------------------------------------------------------------------------------------------
// Fuzzy subsequence scoring
// ---------------------------------------------------------------------------------------------

const isWordChar = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);

/**
 * Scores `query` as a case-insensitive subsequence of `target`. Returns 0 when it does not match
 * (or the query is empty); otherwise a positive score — higher is better. Rewards consecutive runs,
 * matches at word starts / camelCase humps and early matches; penalises gaps.
 */
export function subsequenceScore(query: string, target: string): number {
  const q = query.toLowerCase();
  if (!q || !target) return 0;
  const t = target.toLowerCase();
  if (q.length > t.length) return 0;
  // Quick reject: is it a subsequence at all?
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) if (t[i] === q[qi]) qi++;
  if (qi < q.length) return 0;
  // Case info for camelCase humps; lower-casing can change length for a few code points, then skip humps.
  const src = t.length === target.length ? target : t;

  // Try a greedy walk from each of the first few occurrences of q[0]; keep the best.
  let best = 0;
  let starts = 0;
  for (let s = t.indexOf(q[0]!); s !== -1 && starts < 12; s = t.indexOf(q[0]!, s + 1), starts++) {
    let score = 0;
    let streak = 0;
    let prev = -1;
    let j = 0;
    for (let i = s; i < t.length && j < q.length; i++) {
      if (t[i] !== q[j]) continue;
      let charScore = 1;
      const before = i > 0 ? src[i - 1]! : '';
      const cur = src[i]!;
      const boundary = i === 0 || !isWordChar(before) || (before === before.toLowerCase() && cur !== cur.toLowerCase());
      if (boundary) charScore += 2;
      if (prev === i - 1) { streak++; charScore += Math.min(streak, 4) * 1.5; } else { streak = 0; if (prev >= 0) charScore -= Math.min(i - prev - 1, 10) * 0.15; }
      score += charScore;
      prev = i;
      j++;
    }
    if (j < q.length) continue;
    score -= Math.min(s, 30) * 0.05;          // prefer early matches
    score -= Math.min(t.length, 500) * 0.002; // prefer shorter targets slightly
    if (score > best) best = score;
  }
  return best > 0 ? best : 0.001;
}
