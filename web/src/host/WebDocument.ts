import { webCopyName } from '../../shared/boardNames';
import type { BoardStorage, Dialogs, LoadedBoard, SaveResult } from '../ports/types';
import { UndoStack } from './UndoStack';

export const AUTO_SAVE_MS = 300;

export interface WebDocumentCallbacks {
  /** Show this text on the board (undo, redo, reload). */
  show(text: string): void;
  /** End open text edits. Their text arrives as one more `edit` before the promise resolves. */
  closeTextFields(): Promise<void>;
  /** The board now lives under a new name (after Save-as). */
  renamed(name: string, previous: string): void;
  /** The board file is gone: leave the board. */
  gone(name: string): void;
}

/** Something that happened outside: a change or delete on the server, or a refused save. */
type OutsideEvent = { kind: 'changed'; name: string; etag: string } | { kind: 'removed'; name: string } | { kind: 'refused'; name: string; basedOn: string };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * One open board in the web app: its text, undo history, auto save and conflict state.
 * No DOM code, so it can be tested with fake storage and dialogs.
 */
export class WebDocument {
  name: string;
  /** Version of the stored board that `savedText` is. */
  etag: string;
  /** What the board shows. */
  text: string;
  /** What the server has. */
  savedText: string;
  readonly undoStack: UndoStack;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private inFlight = false;
  private again = false;
  /** The Reload / Save-as question is shown. */
  private locked = false;
  private busy = false;
  private queued: OutsideEvent | undefined;
  private current: Promise<void> = Promise.resolve();

  constructor(
    name: string,
    loaded: LoadedBoard,
    private readonly storage: BoardStorage,
    private readonly dialogs: Dialogs,
    private readonly callbacks: WebDocumentCallbacks,
    private readonly delay = AUTO_SAVE_MS,
  ) {
    this.name = name;
    this.etag = loaded.etag;
    this.text = loaded.text;
    this.savedText = loaded.text;
    this.undoStack = new UndoStack(loaded.text);
  }

  get dirty(): boolean {
    return this.text !== this.savedText || this.inFlight;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  isLocked(): boolean {
    return this.locked;
  }

  /** Resolves when the current outside-event handling (question included) has finished. For tests. */
  settled(): Promise<void> {
    return this.current;
  }

  /** A board action: one undo step. While the question is shown it is part of "my version" but starts no save. */
  edit(text: string): void {
    this.text = text;
    this.undoStack.push(text);
    this.schedule();
  }

  undo(): void {
    if (this.locked) return;
    this.move(this.undoStack.undo());
  }

  redo(): void {
    if (this.locked) return;
    this.move(this.undoStack.redo());
  }

  private move(text: string | undefined): void {
    if (text === undefined) return;
    this.text = text;
    this.callbacks.show(text);
    this.schedule();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(): void {
    this.clearTimer();
    if (this.locked) return;
    this.timer = setTimeout(() => void this.flush(), this.delay);
  }

  /** Ctrl/Cmd+S: save at once. Nothing to save: nothing happens. */
  saveNow(): Promise<void> {
    return this.flush();
  }

  private async flush(): Promise<void> {
    this.clearTimer();
    if (this.locked || this.text === this.savedText) return;
    if (this.inFlight) {
      this.again = true;
      return;
    }
    const name = this.name;
    const basedOn = this.etag;
    const sent = this.text;
    this.inFlight = true;
    let result: SaveResult;
    try {
      result = await this.storage.save(name, sent, basedOn);
    } catch (err) {
      result = { ok: false, conflict: false, error: message(err) };
    }
    this.inFlight = false;
    const again = this.again;
    this.again = false;
    if (name !== this.name) return;
    if (result.ok) {
      this.savedText = sent;
      this.etag = result.etag;
      if (again || this.text !== this.savedText) await this.flush();
    } else if (result.conflict) {
      this.enqueue({ kind: 'refused', name, basedOn });
    } else {
      this.dialogs.notify(`Not saved: ${result.error}`);
    }
  }

  /** The stored board changed outside this page. */
  changed(name: string, etag: string): void {
    this.enqueue({ kind: 'changed', name, etag });
  }

  /** The stored board was deleted outside this page. */
  removed(name: string): void {
    this.enqueue({ kind: 'removed', name });
  }

  /** One outside event at a time; while one runs, only the latest new one is kept. */
  private enqueue(event: OutsideEvent): void {
    if (this.locked) return;
    if (this.busy) {
      this.queued = event;
      return;
    }
    this.busy = true;
    this.current = (async () => {
      try {
        let next: OutsideEvent | undefined = event;
        while (next) {
          this.queued = undefined;
          try {
            await this.handle(next);
          } catch (err) {
            this.dialogs.notify(`Not reloaded: ${message(err)}`);
          }
          next = this.queued;
        }
      } finally {
        this.busy = false;
      }
    })();
  }

  /** True when the event no longer concerns this document's current state. */
  private stale(event: OutsideEvent): boolean {
    if (event.name !== this.name || this.locked) return true;
    if (event.kind === 'changed') return event.etag === this.etag;
    if (event.kind === 'refused') return event.basedOn !== this.etag;
    return false;
  }

  private async handle(event: OutsideEvent): Promise<void> {
    if (this.stale(event)) return;
    if (event.kind === 'refused') {
      await this.conflict();
      return;
    }
    // Typed text counts as unsaved: commit it before deciding.
    await this.callbacks.closeTextFields();
    if (this.stale(event)) return;
    if (this.dirty) {
      await this.conflict();
      return;
    }
    if (event.kind === 'removed') {
      this.callbacks.gone(this.name);
      return;
    }
    if (await this.reload()) this.dialogs.notify('Reloaded: the file changed on server');
  }

  /** Ask Reload or Save-as. The board is read-only and auto save is paused until the answer. */
  private async conflict(): Promise<void> {
    await this.callbacks.closeTextFields();
    this.locked = true;
    this.clearTimer();
    for (;;) {
      const answer = await this.dialogs.askConflict(this.name, webCopyName(this.name, 1));
      try {
        if (answer === 'reload') {
          if (!(await this.reload())) return; // Gone: the page leaves the board.
        } else {
          await this.saveAsCopy();
        }
        break;
      } catch (err) {
        this.dialogs.notify(`${answer === 'reload' ? 'Not reloaded' : 'Not saved'}: ${message(err)}`);
      }
    }
    this.locked = false;
    if (this.text !== this.savedText) this.schedule();
  }

  /** Load the stored board and show it. History starts fresh. False when the board is gone. */
  private async reload(): Promise<boolean> {
    const loaded = await this.storage.load(this.name);
    if (!loaded) {
      this.callbacks.gone(this.name);
      return false;
    }
    this.clearTimer();
    this.text = loaded.text;
    this.savedText = loaded.text;
    this.etag = loaded.etag;
    this.undoStack.reset(loaded.text);
    this.callbacks.show(loaded.text);
    return true;
  }

  /** Save "my version" as a new board and continue there. The undo history is kept. */
  private async saveAsCopy(): Promise<void> {
    const sent = this.text;
    const copy = await this.storage.saveAs(this.name, sent);
    const previous = this.name;
    this.name = copy.name;
    this.etag = copy.etag;
    this.savedText = sent;
    this.callbacks.renamed(copy.name, previous);
    this.dialogs.notify(`Saved as ${copy.name}`);
  }
}
