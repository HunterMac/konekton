import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { listTokens, readTokens, type TokenInfo } from '../../../../src/shared/todoFormat';
import { shortDate } from '../../layout/dates';

/** A task title needs at least this many characters (tokens such as `#tag` or `!fri` do not count). */
export const MIN_TITLE_LENGTH = 3;

/** True when the typed text, without its tokens, is long enough to be a title. */
export function isValidTitle(typed: string): boolean {
  return readTokens(typed).title.trim().length >= MIN_TITLE_LENGTH;
}

/** What to do after the title is saved. */
export type TitleNext = 'none' | 'newBelow' | 'indent' | 'outdent';

interface Props {
  /** The task text with its tokens. The input shows only the title; the tokens show as chips beside it. */
  initial: string;
  /** Tags and people used in the file, most used first, without `#` / `@`. */
  tags: string[];
  people: string[];
  /** `value`: the typed title (it may hold new tokens). `kept`: the old tokens not removed, as written. */
  onCommit(value: string, next: TitleNext, kept: string[]): void;
}

function chipLabel(t: TokenInfo): string {
  if (t.kind === 'due') return `${shortDate(t.value.slice(0, 10))}${t.value.length > 10 ? ` ${t.value.slice(11)}` : ''}`;
  return t.kind === 'estimate' ? t.value : t.raw;
}

const PARTIAL_RE = /(^|\s)([#@])([\p{L}\p{N}_./-]*)$/u;

/**
 * The title as plain text. Old tokens show as chips with ×; new ones can be typed (`#tag @person !fri ~30m`).
 * Suggests tags after `#` and people after `@`; Tab accepts the first.
 */
export function TitleEditor({ initial, tags, people, onCommit }: Props) {
  const start = useMemo(() => readTokens(initial).title, [initial]);
  const [value, setValue] = useState(start);
  const [caret, setCaret] = useState(start.length);
  const [kept, setKept] = useState<TokenInfo[]>(() => listTokens(initial));
  const keptRef = useRef(kept);
  keptRef.current = kept;
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const latest = useRef(value);
  latest.current = value;
  /** Caret to set once the accepted suggestion is rendered, before the next key arrives. */
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (pendingCaret.current !== null) {
      ref.current?.setSelectionRange(pendingCaret.current, pendingCaret.current);
      pendingCaret.current = null;
    }
  }, [value]);

  const finish = (next: TitleNext) => {
    if (done.current) return;
    done.current = true;
    onCommit(latest.current, next, keptRef.current.map((t) => t.raw));
  };

  useEffect(() => {
    const el = ref.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // A tab switch destroys the webview: save first.
    const onHide = () => {
      if (document.hidden) finish('none');
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
    // Runs once per editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const partial = PARTIAL_RE.exec(value.slice(0, caret));
  // Strings, not the match array (a new one each render), so the memo holds.
  const sigil = partial?.[2];
  const typedWord = partial?.[3];
  const suggestions = useMemo(() => {
    if (sigil === undefined || typedWord === undefined) return [];
    const pool = sigil === '#' ? tags : people;
    const typed = typedWord.toLowerCase();
    return pool.filter((s) => s.toLowerCase().startsWith(typed) && s.toLowerCase() !== typed).slice(0, 6);
  }, [sigil, typedWord, tags, people]);

  const accept = (word: string) => {
    if (!partial) return;
    const start = caret - partial[3].length;
    const next = `${value.slice(0, start)}${word} ${value.slice(caret).replace(/^\s+/, '')}`;
    const at = start + word.length + 1;
    pendingCaret.current = at;
    setValue(next);
    setCaret(at);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish('newBelow');
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish('none');
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (suggestions.length > 0 && !e.shiftKey) accept(suggestions[0]);
      else finish(e.shiftKey ? 'outdent' : 'indent');
    }
  };

  return (
    <div className="eb-todo-title-edit">
      <input
        ref={ref}
        className={`eb-todo-title-input${value.trim() !== '' && !isValidTitle(value) ? ' invalid' : ''}`}
        title={`At least ${MIN_TITLE_LENGTH} characters, or the old title stays`}
        value={value}
        spellCheck={false}
        placeholder="Task  #tag @person !fri ~30m"
        onChange={(e) => {
          setValue(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
        }}
        onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        onKeyDown={onKeyDown}
        onBlur={() => finish('none')}
      />
      {kept.length > 0 && (
        <div className="eb-todo-kept">
          {kept.map((t, i) => (
            <span key={`${t.raw}${i}`} className={`eb-todo-chip ${t.kind === 'tag' ? 'tag' : t.kind === 'person' ? 'person' : t.kind === 'due' ? 'due' : 'est'}`}>
              {chipLabel(t)}
              <button
                type="button"
                className="eb-todo-x"
                title="Remove"
                onMouseDown={(e) => {
                  // Keep the focus in the title, so removing a chip does not end the edit.
                  e.preventDefault();
                  setKept(kept.filter((_k, j) => j !== i));
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {suggestions.length > 0 && partial && (
        <div className="eb-todo-suggest">
          {suggestions.map((s, i) => (
            <button
              key={s}
              type="button"
              className={`eb-todo-chip ${partial[2] === '#' ? 'tag' : 'person'}${i === 0 ? ' first' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault();
                accept(s);
              }}
            >
              {partial[2]}
              {s}
            </button>
          ))}
          <span className="eb-todo-hint">Tab</span>
        </div>
      )}
    </div>
  );
}
