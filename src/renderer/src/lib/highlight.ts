// Very small, safe syntax highlighter for the code preview. Produces tokens (rendered as React spans,
// never innerHTML). Good enough for a glance; not a parser.

export type TokenType = 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'key' | 'punct';
export interface Token { t: TokenType; v: string }

const KEYWORDS: Record<string, string[]> = {
  js: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue',
    'new', 'class', 'extends', 'import', 'from', 'export', 'default', 'async', 'await', 'try', 'catch', 'finally', 'throw',
    'typeof', 'instanceof', 'in', 'of', 'this', 'null', 'undefined', 'true', 'false', 'yield', 'delete', 'void', 'super', 'static', 'get', 'set'],
  ts: ['interface', 'type', 'enum', 'implements', 'readonly', 'public', 'private', 'protected', 'as', 'keyof', 'namespace',
    'declare', 'abstract', 'string', 'number', 'boolean', 'unknown', 'never', 'any', 'satisfies'],
  py: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'import', 'from', 'as',
    'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'pass', 'break', 'continue', 'None', 'True', 'False', 'self', 'async', 'await'],
  sql: ['select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit',
    'offset', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'index', 'view', 'alter', 'drop', 'and',
    'or', 'not', 'null', 'is', 'as', 'distinct', 'count', 'sum', 'avg', 'min', 'max', 'case', 'when', 'then', 'else', 'end',
    'primary', 'key', 'references', 'default', 'desc', 'asc', 'union', 'all', 'exists', 'in', 'like', 'between', 'with', 'integer', 'text'],
  sh: ['if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'export', 'local', 'return', 'echo', 'sudo', 'cd'],
  css: ['important', 'media', 'import', 'keyframes', 'from', 'to', 'supports'],
  go: ['func', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'var', 'const', 'type', 'struct', 'interface', 'map',
    'chan', 'go', 'defer', 'nil', 'true', 'false', 'switch', 'case', 'default'],
  rust: ['fn', 'let', 'mut', 'pub', 'struct', 'enum', 'impl', 'trait', 'use', 'mod', 'match', 'if', 'else', 'for', 'while', 'loop',
    'return', 'self', 'Self', 'true', 'false', 'as', 'where', 'async', 'await', 'move', 'ref', 'crate'],
  c: ['int', 'char', 'void', 'return', 'if', 'else', 'for', 'while', 'struct', 'typedef', 'const', 'static', 'include', 'define',
    'unsigned', 'long', 'double', 'float', 'sizeof', 'class', 'public', 'private', 'protected', 'namespace', 'using', 'new',
    'template', 'bool', 'true', 'false', 'string', 'var', 'null', 'final', 'package', 'import', 'extends', 'implements'],
  ps1: ['function', 'param', 'if', 'else', 'elseif', 'foreach', 'for', 'while', 'return', 'in', 'true', 'false', 'null'],
};

function keywordSet(lang: string): Set<string> {
  const base =
    lang === 'ts' ? [...KEYWORDS.js!, ...KEYWORDS.ts!]
    : lang === 'js' || lang === 'json' ? KEYWORDS.js!
    : lang === 'cpp' || lang === 'cs' || lang === 'java' || lang === 'php' ? KEYWORDS.c!
    : (KEYWORDS[lang] ?? KEYWORDS.js!);
  return new Set(base);
}

const HASH_COMMENT = new Set(['py', 'sh', 'ps1', 'yaml']);
const DASH_COMMENT = new Set(['sql']);

/** Tokenizes one block of code. Language ids follow shared/detect (json, ts, js, py, sql, sh, css, …). */
export function tokenize(code: string, lang: string): Token[] {
  const out: Token[] = [];
  const kw = keywordSet(lang);
  const caseInsensitive = lang === 'sql';
  const hash = HASH_COMMENT.has(lang);
  const dash = DASH_COMMENT.has(lang);
  const json = lang === 'json';
  let i = 0;
  let plain = '';
  const flush = () => { if (plain) { out.push({ t: 'plain', v: plain }); plain = ''; } };
  const push = (t: TokenType, v: string) => { flush(); out.push({ t, v }); };
  const n = code.length;

  while (i < n) {
    const ch = code[i]!;
    const next = code[i + 1];
    // comments
    if (!json && ch === '/' && next === '/' && !hash) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      push('comment', code.slice(i, stop)); i = stop; continue;
    }
    if (!json && ch === '/' && next === '*') {
      const end = code.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      push('comment', code.slice(i, stop)); i = stop; continue;
    }
    if ((hash && ch === '#') || (dash && ch === '-' && next === '-')) {
      const end = code.indexOf('\n', i);
      const stop = end === -1 ? n : end;
      push('comment', code.slice(i, stop)); i = stop; continue;
    }
    // strings
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n && code[j] !== ch) {
        if (code[j] === '\\') j++;
        else if (code[j] === '\n' && ch !== '`') break;
        j++;
      }
      const stop = Math.min(n, j + 1);
      const str = code.slice(i, stop);
      // JSON keys / object keys: string followed by optional spaces and ':'
      let k = stop;
      while (k < n && (code[k] === ' ' || code[k] === '\t')) k++;
      push(code[k] === ':' && (json || lang === 'js' || lang === 'ts' || lang === 'yaml') ? 'key' : 'string', str);
      i = stop; continue;
    }
    // numbers
    if (/[0-9]/.test(ch) && !/[\w$]/.test(code[i - 1] ?? '')) {
      const m = /^(?:0x[0-9a-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(code.slice(i, i + 40));
      if (m) { push('number', m[0]); i += m[0].length; continue; }
    }
    // words
    if (/[A-Za-z_$@]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[\w$-]/.test(code[j]!) && !(code[j] === '-' && lang !== 'css' && lang !== 'ps1')) j++;
      const word = code.slice(i, j);
      const bare = word.replace(/^@/, '');
      if (kw.has(caseInsensitive ? bare.toLowerCase() : bare)) push('keyword', word);
      else if (lang === 'css' && code[j] === ':' && /^[a-z-]+$/.test(word)) push('key', word);
      else plain += word;
      i = j; continue;
    }
    if (/[{}()[\];,.:=<>+*/!&|?-]/.test(ch)) { push('punct', ch); i++; continue; }
    plain += ch;
    i++;
  }
  flush();
  return out;
}

/** Splits tokens into lines (tokens spanning lines are split), for line-numbered rendering. */
export function tokenLines(tokens: Token[]): Token[][] {
  const lines: Token[][] = [[]];
  for (const tok of tokens) {
    const parts = tok.v.split('\n');
    parts.forEach((p, idx) => {
      if (idx > 0) lines.push([]);
      if (p) lines[lines.length - 1]!.push({ t: tok.t, v: p });
    });
  }
  return lines;
}
