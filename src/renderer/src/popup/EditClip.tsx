// Inline editors in the preview pane: edit clip text, save clip as snippet, create/edit snippet.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Clip, Snippet } from '@shared/types';
import { api } from '@/lib/api';
import { comboParts, isMod } from '@/lib/keys';
import { Button } from '@/components/Button';
import { Kbd } from '@/components/Kbd';
import { usePopup } from '@/store/popupStore';
import styles from './EditClip.module.css';

/** Ctrl/Cmd+Enter saves, Esc cancels; every other key stays inside the editor. */
function editorKeys(e: KeyboardEvent, save: () => void, cancel: () => void): void {
  e.stopPropagation();
  if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  else if (e.key === 'Enter' && isMod(e, api.platform)) { e.preventDefault(); save(); }
}

function EditorFooter({ onCancel, onSave, saveLabel = 'Save', disabled }: { onCancel: () => void; onSave: () => void; saveLabel?: string; disabled?: boolean }) {
  const platform = api.platform;
  return (
    <div className={styles.footer}>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Cancel <Kbd parts={['Esc']} />
      </Button>
      <Button size="sm" variant="primary" onClick={onSave} disabled={disabled}>
        {saveLabel} <Kbd parts={comboParts('mod+enter', platform)} className={styles.kbdOnAccent} />
      </Button>
    </div>
  );
}

export function EditClip({ clip }: { clip: Clip }) {
  const [text, setText] = useState(clip.text ?? '');
  const ref = useRef<HTMLTextAreaElement>(null);
  const saveEdit = usePopup((s) => s.saveEdit);
  const cancelEdit = usePopup((s) => s.cancelEdit);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const save = () => void saveEdit(text);
  return (
    <div className={styles.editor}>
      <div className={styles.title}>
        Editing clip
        {(clip.hasHtml || clip.hasRtf) && <span className={styles.note}>Formatting will be removed</span>}
      </div>
      <textarea
        ref={ref}
        className={styles.textarea}
        data-mono={clip.kind === 'code' ? 'true' : undefined}
        value={text}
        spellCheck={false}
        aria-label="Clip text"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => editorKeys(e, save, cancelEdit)}
      />
      <EditorFooter onCancel={cancelEdit} onSave={save} disabled={!text.trim()} />
    </div>
  );
}

export function SaveSnippetForm({ defaultTitle }: { defaultTitle: string }) {
  const [title, setTitle] = useState(defaultTitle);
  const [keyword, setKeyword] = useState('');
  const saveAsSnippet = usePopup((s) => s.saveAsSnippet);
  const cancelEdit = usePopup((s) => s.cancelEdit);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  const save = () => void saveAsSnippet(title, keyword.trim() || null);
  const onKey = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
    else if (e.key === 'Enter') { e.preventDefault(); save(); }
  };
  return (
    <div className={styles.saveForm} role="group" aria-label="Save as snippet">
      <div className={styles.saveRow}>
        <input ref={ref} className={styles.input} placeholder="Snippet title" value={title} aria-label="Snippet title" onChange={(e) => setTitle(e.target.value)} onKeyDown={onKey} />
        <input className={`${styles.input} ${styles.keyword}`} placeholder=";keyword" value={keyword} aria-label="Keyword (optional)" onChange={(e) => setKeyword(e.target.value)} onKeyDown={onKey} />
      </div>
      <div className={styles.saveHint}>
        <span>Save as snippet</span>
        <span><Kbd parts={['↵']} /> save · <Kbd parts={['Esc']} /> cancel</span>
      </div>
    </div>
  );
}

export function SnippetEditor({ snippet }: { snippet: Snippet | null }) {
  const [title, setTitle] = useState(snippet?.title ?? '');
  const [keyword, setKeyword] = useState(snippet?.keyword ?? '');
  const [body, setBody] = useState(snippet?.body ?? '');
  const saveSnippet = usePopup((s) => s.saveSnippet);
  const cancelEdit = usePopup((s) => s.cancelEdit);
  const titleRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (snippet) bodyRef.current?.focus();
    else titleRef.current?.focus();
  }, [snippet]);
  const valid = title.trim() !== '' && body !== '';
  const save = () => {
    if (!valid) return;
    void saveSnippet(snippet?.id ?? null, { title: title.trim(), body, keyword: keyword.trim() || null, groupId: snippet?.groupId ?? null });
  };
  const keys = (e: KeyboardEvent) => editorKeys(e, save, cancelEdit);
  return (
    <div className={styles.editor}>
      <div className={styles.title}>{snippet ? 'Edit snippet' : 'New snippet'}</div>
      <div className={styles.fields}>
        <input ref={titleRef} className={styles.input} placeholder="Title" value={title} aria-label="Title" onChange={(e) => setTitle(e.target.value)} onKeyDown={keys} />
        <input className={`${styles.input} ${styles.keyword}`} placeholder=";keyword" value={keyword} aria-label="Keyword (optional)" onChange={(e) => setKeyword(e.target.value)} onKeyDown={keys} />
      </div>
      <textarea
        ref={bodyRef}
        className={styles.textarea}
        placeholder="Snippet text…"
        value={body}
        spellCheck={false}
        aria-label="Snippet text"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={keys}
      />
      <EditorFooter onCancel={cancelEdit} onSave={save} saveLabel={snippet ? 'Save' : 'Create'} disabled={!valid} />
    </div>
  );
}
