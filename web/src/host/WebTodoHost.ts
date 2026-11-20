import { fileNodeIds } from '../../../src/shared/canvasRefs';
import type { ExtensionMessage, WebviewMessage } from '../../../src/shared/protocol';
import type { Host } from '../../../webview/src/host';
import type { FileResponse } from '../../shared/api';
import type { BoardStorage, Dialogs, Env, FileSaveResult, FileStore, ViewStateStore } from '../ports/types';

export interface WebTodoPorts {
  storage: BoardStorage;
  files: FileStore;
  env: Env;
  dialogs: Dialogs;
  viewState: ViewStateStore;
}

export interface WebTodoCallbacks {
  /** Show a board. `closeThisTab`: this tab was opened from that board's card, so closing it goes back. */
  openBoard(name: string, closeThisTab: boolean): void;
}

/**
 * The web app's side of the full todo editor protocol: answers the messages `TodoSession.handleMessage` answers in
 * the extension, with browser ports instead of VS Code.
 */
export class WebTodoHost implements Host {
  private readonly listeners = new Set<(message: ExtensionMessage) => void>();
  private readonly disposers: (() => void)[] = [];
  private watching = false;
  /** Number of the newest read, so an older answer that arrives late is dropped. */
  private reads = 0;

  /**
   * @param path the todo file, relative to the boards folder
   * @param from the board whose card opened this tab, if any
   */
  constructor(
    private readonly ports: WebTodoPorts,
    private readonly path: string,
    private readonly from: string | undefined,
    private readonly callbacks: WebTodoCallbacks,
  ) {
    this.disposers.push(
      ports.files.watch((changed) => {
        if (this.watching && changed === this.path) this.readFile();
      }),
      ports.storage.watch((event) => {
        if (event.kind === 'list' || event.kind === 'changed' || event.kind === 'removed') void this.postReferences();
      }),
    );
  }

  /** Host → page messages are asynchronous, like `postMessage` in VS Code: no zustand `set` inside a `set`. */
  private send(message: ExtensionMessage): void {
    queueMicrotask(() => {
      for (const listener of this.listeners) listener(message);
    });
  }

  private readFile(): void {
    const n = ++this.reads;
    void this.ports.files
      .read(this.path)
      .catch((): FileResponse => ({ status: 'missing' }))
      .then((r) => {
        if (this.reads !== n) return;
        this.send({ type: 'fileContent', path: this.path, status: r.status, ...(r.text !== undefined ? { text: r.text } : {}) });
      });
  }

  /** The boards that have a card for this file: the one that opened the tab first, then by name. */
  private async boards(): Promise<string[]> {
    const found: string[] = [];
    try {
      for (const info of await this.ports.storage.list()) {
        const loaded = await this.ports.storage.load(info.name);
        // Cards hold paths relative to the boards folder, so the folder is the root.
        if (loaded && fileNodeIds(loaded.text, '/', `/${this.path}`).length > 0) found.push(info.name);
      }
    } catch {
      return [];
    }
    return found.sort((a, b) => Number(b === this.from) - Number(a === this.from) || a.localeCompare(b));
  }

  private async postReferences(): Promise<void> {
    this.send({ type: 'todoReferences', canvases: await this.boards() });
  }

  private async backToCanvas(): Promise<void> {
    const boards = await this.boards();
    if (boards.length === 0) {
      await this.ports.dialogs.alert(`No board shows ${this.path}.`);
      return;
    }
    const target = boards[0];
    this.callbacks.openBoard(target, target === this.from);
  }

  onMessage(listener: (message: ExtensionMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): unknown {
    return this.ports.viewState.get();
  }

  setState(state: unknown): void {
    this.ports.viewState.set(state);
  }

  post(m: WebviewMessage): void {
    const { env } = this.ports;
    switch (m.type) {
      case 'ready':
        this.send({ type: 'initTodo', path: this.path });
        void this.postReferences();
        return;
      case 'watchFiles':
        this.watching = m.paths.includes(this.path);
        if (this.watching) this.readFile();
        return;
      case 'saveFile': {
        if (m.path !== this.path) return;
        void this.ports.files
          .save(this.path, m.text, m.baseText, m.force === true)
          // Always answer: the page sends the next save only after this result.
          .catch((err: unknown): FileSaveResult => ({ ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) }))
          .then((r) => {
            this.send(r.ok ? { type: 'fileSaveResult', path: this.path, ok: true } : { type: 'fileSaveResult', path: this.path, ok: false, conflict: r.conflict, ...(r.error !== undefined ? { error: r.error } : {}) });
            if (r.ok && this.watching) this.readFile();
          });
        return;
      }
      case 'clipboardWrite':
        void env.clipboardWrite(m.text);
        return;
      case 'clipboardRead': {
        const requestId = m.requestId;
        void env.clipboardRead().then(
          (text) => this.send({ type: 'clipboardReadResult', requestId, text }),
          () => this.send({ type: 'clipboardReadResult', requestId, text: '' }),
        );
        return;
      }
      case 'openUrl':
        env.openExternal(m.url);
        return;
      case 'reopenAsText':
        env.openFile(this.path);
        return;
      case 'backToCanvas':
        void this.backToCanvas();
        return;
      default:
        // The rest belongs to the board.
        return;
    }
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.listeners.clear();
  }
}
