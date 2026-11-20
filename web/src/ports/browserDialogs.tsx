import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import type { Dialogs, PromptOptions } from './types';

const NOTICE_MS = 4000;

type QuestionBody =
  | { kind: 'conflict'; name: string; copyName: string; resolve(answer: 'reload' | 'saveAs'): void }
  | { kind: 'removed'; path: string; resolve(answer: 'write' | 'delete'): void }
  | { kind: 'prompt'; message: string; initial: string; options: PromptOptions; resolve(answer: string | undefined): void }
  | { kind: 'alert'; message: string; resolve(): void };

type Question = { id: number } & QuestionBody;

interface DialogState {
  notice: { id: number; text: string } | null;
  /** Open questions; the first one is shown. */
  questions: Question[];
}

/** The prompt and alert dialogs, a notice and the questions (conflict, removed on Drive) rendered by `<DialogHost>`. */
export class BrowserDialogs implements Dialogs {
  private state: DialogState = { notice: null, questions: [] };
  private readonly listeners = new Set<() => void>();
  private noticeId = 0;
  private questionId = 0;

  /** Where outside changes come from, in the texts: 'the server' (dev server) or 'Drive'. */
  constructor(readonly remote: 'the server' | 'Drive' = 'the server') {}

  private update(patch: Partial<DialogState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly snapshot = (): DialogState => this.state;

  private ask(question: QuestionBody): void {
    this.update({ questions: [...this.state.questions, { ...question, id: ++this.questionId } as Question] });
  }

  prompt(message: string, initial?: string, options: PromptOptions = {}): Promise<string | undefined> {
    return new Promise((resolve) => this.ask({ kind: 'prompt', message, initial: initial ?? '', options, resolve }));
  }

  alert(message: string): Promise<void> {
    return new Promise((resolve) => this.ask({ kind: 'alert', message, resolve }));
  }

  notify(text: string): void {
    // `WebDocument` words it for the dev server.
    if (this.remote === 'Drive') text = text.replace('changed on server', 'changed on Drive');
    const id = ++this.noticeId;
    this.update({ notice: { id, text } });
    window.setTimeout(() => {
      if (this.state.notice?.id === id) this.update({ notice: null });
    }, NOTICE_MS);
  }

  askConflict(name: string, copyName: string): Promise<'reload' | 'saveAs'> {
    return new Promise((resolve) => this.ask({ kind: 'conflict', name, copyName, resolve }));
  }

  askRemoved(path: string): Promise<'write' | 'delete'> {
    return new Promise((resolve) => this.ask({ kind: 'removed', path, resolve }));
  }

  /** The answer to the conflict or removed question that is shown. */
  answer(choice: 'reload' | 'saveAs' | 'write' | 'delete'): void {
    const [first, ...rest] = this.state.questions;
    if (!first || (first.kind !== 'conflict' && first.kind !== 'removed')) return;
    this.update({ questions: rest });
    (first.resolve as (answer: typeof choice) => void)(choice);
  }

  /** The answer to the prompt that is shown; undefined = cancelled. */
  answerPrompt(value: string | undefined): void {
    const [first, ...rest] = this.state.questions;
    if (first?.kind !== 'prompt') return;
    this.update({ questions: rest });
    first.resolve(value);
  }

  /** The alert that is shown was closed. */
  dismissAlert(): void {
    const [first, ...rest] = this.state.questions;
    if (first?.kind !== 'alert') return;
    this.update({ questions: rest });
    first.resolve();
  }
}

/** Keys and clipboard events inside the dialog must not reach the board's window/document listeners. */
const ISOLATED_EVENTS = ['keydown', 'keyup', 'copy', 'cut', 'paste'] as const;

/**
 * A modal dialog. Without `onCancel` a choice is required (Esc does nothing); with it Esc cancels.
 * Keys are isolated from the board, so use `onSubmit`/`onClick`, not React key handlers, inside.
 */
function QuestionDialog({ title, children, onCancel, onSubmit, className }: { title: ReactNode; children: ReactNode; onCancel?: () => void; onSubmit?: (e: FormEvent) => void; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const cancel = useRef(onCancel);
  cancel.current = onCancel;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    // Esc: cancels when the dialog allows it; the dialog itself is closed by its host.
    const onCancelEvent = (e: Event) => {
      e.preventDefault();
      cancel.current?.();
    };
    for (const type of ISOLATED_EVENTS) el.addEventListener(type, stop);
    el.addEventListener('cancel', onCancelEvent);
    // Modal: the rest of the page is inert (no pointer, no focus).
    if (!el.open) el.showModal();
    return () => {
      for (const type of ISOLATED_EVENTS) el.removeEventListener(type, stop);
      el.removeEventListener('cancel', onCancelEvent);
      if (el.open) el.close();
    };
  }, []);

  return (
    <dialog ref={ref} className={`kw-dialog${className ? ` ${className}` : ''}`} aria-labelledby="kw-question-title">
      <form method="dialog" onSubmit={onSubmit}>
        <p id="kw-question-title">{title}</p>
        {children}
      </form>
    </dialog>
  );
}

/** One text field, optional clickable suggestions, an inline error. Enter = OK, Esc = Cancel. */
function PromptDialog({ dialogs, question }: { dialogs: BrowserDialogs; question: Extract<Question, { kind: 'prompt' }> }) {
  const { message, initial, options } = question;
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  // Typing narrows the list; a value that is one of the suggestions (the prefilled one) shows them all.
  const typed = value.trim().toLowerCase();
  const all = options.suggestions ?? [];
  const suggestions = all.some((s) => s.toLowerCase() === typed) ? all : all.filter((s) => s.toLowerCase().includes(typed));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    dialogs.answerPrompt(value);
  };

  return (
    <QuestionDialog title={message} onCancel={() => dialogs.answerPrompt(undefined)} onSubmit={submit} className="kw-dialog-prompt">
      <input
        ref={input}
        className="kw-dialog-input"
        type="text"
        value={value}
        placeholder={options.placeholder}
        aria-labelledby="kw-question-title"
        aria-invalid={options.error !== undefined}
        aria-describedby={options.error !== undefined ? 'kw-prompt-error' : undefined}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
      />
      {options.error !== undefined && (
        <p id="kw-prompt-error" className="kw-dialog-error" role="alert">
          {options.error}
        </p>
      )}
      {options.suggestions && options.suggestions.length > 0 && (
        <ul className="kw-dialog-suggestions" aria-label="Files">
          {suggestions.map((s) => (
            <li key={s}>
              <button
                type="button"
                className={s === value.trim() ? 'active' : ''}
                onClick={() => {
                  setValue(s);
                  input.current?.focus();
                }}
                onDoubleClick={() => dialogs.answerPrompt(s)}
              >
                {s}
              </button>
            </li>
          ))}
          {suggestions.length === 0 && <li className="kw-dialog-none">No match</li>}
        </ul>
      )}
      <div className="kw-dialog-buttons">
        <button type="button" onClick={() => dialogs.answerPrompt(undefined)}>
          Cancel
        </button>
        <button type="submit" className="kw-primary">
          {options.submitLabel ?? 'OK'}
        </button>
      </div>
    </QuestionDialog>
  );
}

/** Renders the notice and the first open question of `dialogs`. */
export function DialogHost({ dialogs }: { dialogs: BrowserDialogs }) {
  const state = useSyncExternalStore(dialogs.subscribe, dialogs.snapshot);
  const question = state.questions[0];
  return (
    <>
      <div className="kw-notice-area" role="status">
        {state.notice && (
          <div key={state.notice.id} className="kw-notice">
            {state.notice.text}
          </div>
        )}
      </div>
      {question?.kind === 'conflict' && (
        <QuestionDialog
          key={question.id}
          title={
            <>
              <strong>{question.name}</strong> changed on {dialogs.remote} while you had unsynced changes.
            </>
          }
        >
          <div className="kw-dialog-buttons">
            <button type="button" onClick={() => dialogs.answer('reload')}>
              Reload from {dialogs.remote}
            </button>
            <button type="button" className="kw-primary" onClick={() => dialogs.answer('saveAs')}>
              Save my version as {question.copyName}
            </button>
          </div>
        </QuestionDialog>
      )}
      {question?.kind === 'removed' && (
        <QuestionDialog
          key={question.id}
          title={
            <>
              <strong>{question.path}</strong> was removed on Drive. Write it again now?
            </>
          }
        >
          <div className="kw-dialog-buttons">
            <button type="button" onClick={() => dialogs.answer('delete')}>
              Delete my copy
            </button>
            <button type="button" className="kw-primary" onClick={() => dialogs.answer('write')}>
              Write it again
            </button>
          </div>
        </QuestionDialog>
      )}
      {question?.kind === 'prompt' && <PromptDialog key={question.id} dialogs={dialogs} question={question} />}
      {question?.kind === 'alert' && (
        <QuestionDialog key={question.id} title={question.message} onCancel={() => dialogs.dismissAlert()} onSubmit={(e) => e.preventDefault()}>
          <div className="kw-dialog-buttons">
            <button type="button" className="kw-primary" autoFocus onClick={() => dialogs.dismissAlert()}>
              OK
            </button>
          </div>
        </QuestionDialog>
      )}
    </>
  );
}
