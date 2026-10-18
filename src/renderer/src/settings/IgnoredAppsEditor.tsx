// Ignored apps (list + add, suggestions from recent source apps) and ignore patterns (regex, live validity).
import { Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { appLabel } from '@/lib/format';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icon';
import { TextField } from '@/components/TextField';
import { useSettings } from '@/store/settingsStore';
import styles from './sections/sections.module.css';

function sameApp(a: string, b: string): boolean {
  return api.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export function IgnoredAppsEditor() {
  const apps = useSettings((s) => s.settings!.privacy.ignoredApps);
  const set = useSettings((s) => s.set);
  const [draft, setDraft] = useState('');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void api.invoke('clips:list', { filter: 'all', query: '', offset: 0, limit: 300 }).then((page) => {
      if (!alive) return;
      const seen: string[] = [];
      for (const c of page.items) if (c.sourceApp && !seen.some((s) => sameApp(s, c.sourceApp!))) seen.push(c.sourceApp);
      setRecent(seen);
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const suggestions = useMemo(() => recent.filter((r) => !apps.some((a) => sameApp(a, r))).slice(0, 6), [recent, apps]);

  const add = (name: string) => {
    const v = name.trim();
    if (!v || apps.some((a) => sameApp(a, v))) { setDraft(''); return; }
    void set({ privacy: { ignoredApps: [...apps, v] } });
    setDraft('');
  };
  const remove = (name: string) => void set({ privacy: { ignoredApps: apps.filter((a) => a !== name) } });

  return (
    <div className={styles.stackGap}>
      {apps.length ? (
        <div className={styles.chips} role="list" aria-label="Ignored apps">
          {apps.map((a) => (
            <span key={a} className={styles.appChip} role="listitem">
              {a}
              <button type="button" aria-label={`Stop ignoring ${a}`} onClick={() => remove(a)}>
                <Icon icon={X} size={12} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <div className={styles.empty}>No ignored apps.</div>
      )}
      <div className={styles.addRow}>
        <TextField
          value={draft}
          placeholder={api.platform === 'win32' ? 'App executable, e.g. KeePass.exe' : 'App name, e.g. 1Password'}
          aria-label="App to ignore"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(draft); } }}
        />
        <Button icon={Plus} onClick={() => add(draft)} disabled={!draft.trim()}>Add</Button>
      </div>
      {suggestions.length > 0 && (
        <div className={styles.suggestions}>
          <span>Recent:</span>
          {suggestions.map((s) => (
            <button key={s} type="button" className={styles.suggestion} title={s} onClick={() => add(s)}>
              + {appLabel(s)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Returns an error message for an invalid regex source, or null. */
export function regexError(source: string): string | null {
  if (!source.trim()) return null;
  try {
    new RegExp(source);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message.replace(/^Invalid regular expression: /, '') : 'Invalid pattern';
  }
}

const EXAMPLES: ReadonlyArray<{ label: string; source: string }> = [
  { label: 'Card numbers', source: '^\\d{4}[ -]?\\d{4}[ -]?\\d{4}[ -]?\\d{4}$' },
  { label: 'One-time codes', source: '^\\d{6}$' },
  { label: 'API keys', source: '^(sk|pk|ghp|xox[bp])[-_][A-Za-z0-9_-]{16,}$' },
];

export function IgnorePatternsEditor() {
  const patterns = useSettings((s) => s.settings!.privacy.ignorePatterns);
  const set = useSettings((s) => s.set);
  const [drafts, setDrafts] = useState<string[]>(patterns);
  const [adding, setAdding] = useState('');

  useEffect(() => setDrafts(patterns), [patterns]);

  const commit = (next: string[]) => {
    const clean = next.map((p) => p.trim()).filter((p) => p && !regexError(p));
    if (clean.join('\u0000') !== patterns.join('\u0000')) void set({ privacy: { ignorePatterns: clean } });
  };

  const addErr = regexError(adding);
  const add = (src: string) => {
    const v = src.trim();
    if (!v || regexError(v) || patterns.includes(v)) return;
    void set({ privacy: { ignorePatterns: [...patterns, v] } });
    setAdding('');
  };

  return (
    <div className={styles.stackGap}>
      {drafts.map((p, i) => {
        const err = regexError(p);
        return (
          <div key={i}>
            <div className={styles.patternRow}>
              <TextField
                mono
                value={p}
                invalid={!!err}
                aria-label={`Pattern ${i + 1}`}
                onChange={(e) => setDrafts(drafts.map((d, j) => (j === i ? e.target.value : d)))}
                onBlur={() => commit(drafts)}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              />
              <Button iconOnly icon={X} variant="ghost" aria-label={`Remove pattern ${i + 1}`} onClick={() => commit(drafts.filter((_, j) => j !== i))} />
            </div>
            {err && <div className={styles.patternError}>{err} — not saved</div>}
          </div>
        );
      })}
      <div>
        <div className={styles.addRow}>
          <TextField
            mono
            value={adding}
            invalid={!!addErr}
            placeholder="Regular expression, e.g. ^\d{6}$"
            aria-label="New ignore pattern"
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(adding); } }}
          />
          <Button icon={Plus} onClick={() => add(adding)} disabled={!adding.trim() || !!addErr}>Add</Button>
        </div>
        {addErr ? <div className={styles.patternError}>{addErr}</div> : adding.trim() ? <div className={styles.patternOk}>Valid pattern</div> : null}
      </div>
      <div className={styles.suggestions}>
        <span>Examples:</span>
        {EXAMPLES.filter((x) => !patterns.includes(x.source)).map((x) => (
          <button key={x.label} type="button" className={styles.suggestion} title={x.source} onClick={() => add(x.source)}>
            + {x.label}
          </button>
        ))}
      </div>
    </div>
  );
}
