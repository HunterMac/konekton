import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Dialogs } from './types';

const NOTICE_MS = 4000;

interface Conflict {
  name: string;
  copyName: string;
  resolve(answer: 'reload' | 'saveAs'): void;
}

interface DialogState {
  notice: { id: number; text: string } | null;
  conflict: Conflict | null;
}

/** Browser prompts, plus a notice and the conflict question rendered by `<DialogHost>`. */
export class BrowserDialogs implements Dialogs {
  private state: DialogState = { notice: null, conflict: null };
  private readonly listeners = new Set<() => void>();
  private noticeId = 0;

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
    const id = ++this.noticeId;
    this.update({ notice: { id, text } });
    window.setTimeout(() => {
      if (this.state.notice?.id === id) this.update({ notice: null });
    }, NOTICE_MS);
  }

  askConflict(name: string, copyName: string): Promise<'reload' | 'saveAs'> {
    return new Promise((resolve) => this.update({ conflict: { name, copyName, resolve } }));
  }

  answer(choice: 'reload' | 'saveAs'): void {
    const conflict = this.state.conflict;
    if (!conflict) return;
    this.update({ conflict: null });
    conflict.resolve(choice);
  }
}

/** Keys and clipboard events inside the dialog must not reach the board's window/document listeners. */
const ISOLATED_EVENTS = ['keydown', 'keyup', 'copy', 'cut', 'paste'] as const;

function ConflictDialog({ dialogs, conflict }: { dialogs: BrowserDialogs; conflict: Conflict }) {
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
    <dialog ref={ref} className="kw-dialog" aria-labelledby="kw-conflict-title">
      <p id="kw-conflict-title">
        <strong>{conflict.name}</strong> changed on the server while you had unsaved changes.
      </p>
      <div className="kw-dialog-buttons">
        <button type="button" onClick={() => dialogs.answer('reload')}>
          Reload from server
        </button>
        <button type="button" className="kw-primary" onClick={() => dialogs.answer('saveAs')}>
          Save my version as {conflict.copyName}
        </button>
      </div>
    </dialog>
  );
}

/** Renders the notice and the conflict question of `dialogs`. */
export function DialogHost({ dialogs }: { dialogs: BrowserDialogs }) {
  const state = useSyncExternalStore(dialogs.subscribe, dialogs.snapshot);
  return (
    <>
      <div className="kw-notice-area" role="status">
        {state.notice && (
          <div key={state.notice.id} className="kw-notice">
            {state.notice.text}
          </div>
        )}
      </div>
      {state.conflict && <ConflictDialog key={state.conflict.name} dialogs={dialogs} conflict={state.conflict} />}
    </>
  );
}
