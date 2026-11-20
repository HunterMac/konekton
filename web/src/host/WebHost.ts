import { isHttpUrl, type ExtensionMessage, type WebviewMessage } from '../../../src/shared/protocol';
import type { Host } from '../../../webview/src/host';
import type { FileResponse } from '../../shared/api';
import { todoFileName } from '../../shared/fileRules';
import type { BoardStorage, Dialogs, Env, FileSaveResult, FileStore, LoadedBoard, Settings, ViewStateStore } from '../ports/types';
import { WebDocument, type WebDocumentCallbacks } from './WebDocument';

export interface WebPorts {
  storage: BoardStorage;
  files: FileStore;
  env: Env;
  dialogs: Dialogs;
  settings: Settings;
  viewState: ViewStateStore;
}

/**
 * The web app's side of the board protocol: answers the same messages as `BoardSession.handleMessage`
 * in the extension, with browser ports instead of VS Code.
 */
export class WebHost implements Host {
  readonly doc: WebDocument;
  private readonly listeners = new Set<(message: ExtensionMessage) => void>();
  private version = 0;
  private readonly disposers: (() => void)[] = [];
  /** Files the board shows; their changes are sent as `fileContent`. */
  private watched = new Set<string>();
  /** Per file: number of the newest read, so an older answer that arrives late is dropped. */
  private readonly reads = new Map<string, number>();

  constructor(
    private readonly ports: WebPorts,
    name: string,
    loaded: LoadedBoard,
    callbacks: Omit<WebDocumentCallbacks, 'show'>,
    autoSaveMs?: number,
  ) {
    this.doc = new WebDocument(name, loaded, ports.storage, ports.dialogs, { ...callbacks, show: (text) => this.docChanged(text) }, autoSaveMs);
    this.disposers.push(
      ports.settings.onChange((gridEnabled) => this.send({ type: 'settings', gridEnabled })),
      ports.storage.watch((event) => {
        if (event.kind === 'changed' && event.name === this.doc.name) this.doc.changed(event.name, event.etag);
        else if (event.kind === 'removed' && event.name === this.doc.name) this.doc.removed(event.name);
      }),
      ports.files.watch((path) => {
        if (this.watched.has(path)) this.readFile(path);
      }),
    );
  }

  /** Read a referenced file and send its content, like `ReferencedFiles.read` in the extension. */
  private readFile(path: string): void {
    const n = (this.reads.get(path) ?? 0) + 1;
    this.reads.set(path, n);
    void this.ports.files
      .read(path)
      .catch((): FileResponse => ({ status: 'missing' }))
      .then((r) => {
        if (this.reads.get(path) !== n) return;
        this.send({ type: 'fileContent', path, status: r.status, ...(r.text !== undefined ? { text: r.text } : {}) });
      });
  }

  /** Host → board messages are asynchronous, like `postMessage` in VS Code: no zustand `set` inside a `set`. */
  private send(message: ExtensionMessage): void {
    queueMicrotask(() => {
      for (const listener of this.listeners) listener(message);
    });
  }

  private docChanged(text: string): void {
    this.send({ type: 'docChanged', text, version: ++this.version });
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
    const { env, settings } = this.ports;
    switch (m.type) {
      case 'ready':
        this.send({ type: 'init', text: this.doc.text, version: ++this.version, settings: { gridEnabled: settings.gridEnabled() }, canvasDir: '' });
        return;
      case 'edit':
        this.doc.edit(m.text);
        // Always echo: DocSync drops its pending edits only when they come back.
        this.docChanged(m.text);
        return;
      case 'setGrid':
        settings.setGridEnabled(m.enabled);
        return;
      case 'clipboardWrite':
        void env.clipboardWrite(m.text);
        return;
      case 'clipboardRead': {
        // Called at once: the browser needs the click's user activation.
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
      case 'promptUrl': {
        const requestId = m.requestId;
        void this.promptUrl(m.initial).then((url) => this.send({ type: 'promptUrlResult', requestId, url }));
        return;
      }
      case 'reopenAsText':
        env.openRaw(this.doc.name);
        return;
      case 'pickFile': {
        const requestId = m.requestId;
        void this.pickFile().then((path) => this.send({ type: 'pickFileResult', requestId, ...(path !== undefined ? { path } : {}) }));
        return;
      }
      case 'createTodoFile': {
        const requestId = m.requestId;
        void this.createTodoFile().then((path) => this.send({ type: 'createTodoFileResult', requestId, ...(path !== undefined ? { path } : {}) }));
        return;
      }
      case 'resolveDroppedFiles':
        // A browser drop carries no paths inside the boards folder.
        this.send({ type: 'droppedFilesResult', requestId: m.requestId, paths: [] });
        return;
      case 'saveFile': {
        const path = m.path;
        void this.ports.files
          .save(path, m.text, m.baseText, m.force === true)
          // Always answer: the board sends the next save of this file only after this result.
          .catch((err: unknown): FileSaveResult => ({ ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) }))
          .then((r) => {
            this.send(r.ok ? { type: 'fileSaveResult', path, ok: true } : { type: 'fileSaveResult', path, ok: false, conflict: r.conflict, ...(r.error !== undefined ? { error: r.error } : {}) });
            if (r.ok && this.watched.has(path)) this.readFile(path);
          });
        return;
      }
      case 'watchFiles':
        this.watched = new Set(m.paths);
        for (const path of m.paths) this.readFile(path);
        return;
      case 'openFile':
        env.openFile(m.path);
        return;
      case 'openTodoFullscreen':
        env.openTodo(m.path, this.doc.name);
        return;
      case 'backToCanvas':
        // Only the full todo editor sends this.
        return;
      default: {
        // A new message type fails the typecheck here until the web host handles it.
        const unhandled: never = m;
        return unhandled;
      }
    }
  }

  /** Ask for a path in the boards folder, with the files there to click. Asks again until it is a listed file. */
  private async pickFile(): Promise<string | undefined> {
    const { dialogs } = this.ports;
    let paths: string[];
    try {
      paths = await this.ports.files.list();
    } catch (err) {
      await dialogs.alert(`Cannot list the files: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
    if (paths.length === 0) {
      await dialogs.alert('There are no .md, .txt or .json files in the boards folder.');
      return undefined;
    }
    let value: string | undefined = paths[0];
    let error: string | undefined;
    for (;;) {
      const answer = await dialogs.prompt('File to add (path in the boards folder)', value, { suggestions: paths, error, submitLabel: 'Add file' });
      if (answer === undefined) return undefined;
      const path = answer.trim();
      if (paths.includes(path)) return path;
      error = `No such file in the boards folder: ${path}`;
      value = answer;
    }
  }

  /** Same texts as the extension: ask for a name until `<name>.todo.md` could be created, or the prompt is cancelled. */
  private async createTodoFile(): Promise<string | undefined> {
    const { dialogs } = this.ports;
    let value = '';
    let error: string | undefined;
    for (;;) {
      const answer = await dialogs.prompt('Name of the todo list', value, { error, placeholder: 'e.g. home', submitLabel: 'Create' });
      if (answer === undefined) return undefined;
      let r: Awaited<ReturnType<FileStore['createTodo']>>;
      try {
        r = await this.ports.files.createTodo(answer);
      } catch (err) {
        // Always answer the request: the board waits for it.
        await dialogs.alert(`Cannot create the todo list: ${err instanceof Error ? err.message : String(err)}`);
        return undefined;
      }
      if (r !== 'exists' && 'path' in r) return r.path;
      const name = todoFileName(answer);
      error = r === 'exists' ? `${'name' in name ? name.name : answer} already exists.` : r.error;
      value = answer;
    }
  }

  /** Same texts as `BoardSession.promptUrl`: ask again until the URL is valid or the prompt is cancelled. */
  private async promptUrl(initial?: string): Promise<string | undefined> {
    let value = initial;
    let error: string | undefined;
    for (;;) {
      const answer = await this.ports.dialogs.prompt('URL (http or https)', value, { error, placeholder: 'https://example.com', submitLabel: 'OK' });
      if (answer === undefined) return undefined;
      const url = answer.trim();
      if (isHttpUrl(url)) return url;
      error = 'Only http: and https: URLs are supported.';
      value = answer;
    }
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.listeners.clear();
  }
}
