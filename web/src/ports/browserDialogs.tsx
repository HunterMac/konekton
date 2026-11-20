import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import type { Dialogs } from './types';

const NOTICE_MS = 4000;

type Question =
  | { kind: 'conflict'; name: string; copyName: string; resolve(answer: 'reload' | 'saveAs'): void }
  | { kind: 'removed'; path: string; resolve(answer: 'write' | 'delete'): void };

interface DialogState {
  notice: { id: number; text: string } | null;
  /** Open questions; the first one is shown. */
  questions: Question[];
}

/** Browser prompts, plus a notice and the questions (conflict, removed on Drive) rendered by `<DialogHost>`. */
export class BrowserDialogs implements Dialogs {
  private state: DialogState = { notice: null, questions: [] };
  private readonly listeners = new Set<() => void>();
  private noticeId = 0;

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

  prompt(message: string, initial?: string): string | undefined {
    return window.prompt(message, initial ?? '') ?? undefined;
  }

  alert(message: string): void {
    window.alert(message);
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
    return new Promise((resolve) => this.update({ questions: [...this.state.questions, { kind: 'conflict', name, copyName, resolve }] }));
  }

  askRemoved(path: string): Promise<'write' | 'delete'> {
    return new Promise((resolve) => this.update({ questions: [...this.state.questions, { kind: 'removed', path, resolve }] }));
  }

  /** The answer to the question that is shown. */
  answer(choice: 'reload' | 'saveAs' | 'write' | 'delete'): void {
    const [first, ...rest] = this.state.questions;
    if (!first) return;
    this.update({ questions: rest });
    (first.resolve as (answer: typeof choice) => void)(choice);
  }
}

/** Keys and clipboard events inside the dialog must not reach the board's window/document listeners. */
const ISOLATED_EVENTS = ['keydown', 'keyup', 'copy', 'cut', 'paste'] as const;

/** A modal question with a required choice. */
function QuestionDialog({ title, children }: { title: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    // Esc: a choice is required.
    const onCancel = (e: Event) => e.preventDefault();
    for (const type of ISOLATED_EVENTS) el.addEventListener(type, stop);
    el.addEventListener('cancel', onCancel);
    // Modal: the rest of the page is inert (no pointer, no focus).
    if (!el.open) el.showModal();
    return () => {
      for (const type of ISOLATED_EVENTS) el.removeEventListener(type, stop);
      el.removeEventListener('cancel', onCancel);
      if (el.open) el.close();
    };
  }, []);

  return (
    <dialog ref={ref} className="kw-dialog" aria-labelledby="kw-question-title">
      <p id="kw-question-title">{title}</p>
      <div className="kw-dialog-buttons">{children}</div>
    </dialog>
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
          key={`c:${question.name}`}
          title={
            <>
              <strong>{question.name}</strong> changed on {dialogs.remote} while you had unsynced changes.
            </>
          }
        >
          <button type="button" onClick={() => dialogs.answer('reload')}>
            Reload from {dialogs.remote}
          </button>
          <button type="button" className="kw-primary" onClick={() => dialogs.answer('saveAs')}>
            Save my version as {question.copyName}
          </button>
        </QuestionDialog>
      )}
      {question?.kind === 'removed' && (
        <QuestionDialog
          key={`r:${question.path}`}
          title={
            <>
              <strong>{question.path}</strong> was removed on Drive. Write it again now?
            </>
          }
        >
          <button type="button" onClick={() => dialogs.answer('delete')}>
            Delete my copy
          </button>
          <button type="button" className="kw-primary" onClick={() => dialogs.answer('write')}>
            Write it again
          </button>
        </QuestionDialog>
      )}
    </>
  );
}
