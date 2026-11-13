import { isHttpUrl, type ExtensionMessage, type WebviewMessage } from '../../../src/shared/protocol';
import type { Host } from '../../../webview/src/host';
import type { BoardStorage, Dialogs, Env, LoadedBoard, Settings, ViewStateStore } from '../ports/types';
import { WebDocument, type WebDocumentCallbacks } from './WebDocument';

export interface WebPorts {
  storage: BoardStorage;
  env: Env;
  dialogs: Dialogs;
  settings: Settings;
  viewState: ViewStateStore;
}

export const NO_FILE_REFERENCES = 'File references are not available in the web version.';

/**
 * The web app's side of the board protocol: answers the same messages as `BoardSession.handleMessage`
 * in the extension, with browser ports instead of VS Code.
 */
export class WebHost implements Host {
  readonly doc: WebDocument;
  private readonly listeners = new Set<(message: ExtensionMessage) => void>();
  private version = 0;
  private readonly disposers: (() => void)[] = [];

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
    );
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
      case 'promptUrl':
        this.send({ type: 'promptUrlResult', requestId: m.requestId, url: this.promptUrl(m.initial) });
        return;
      case 'reopenAsText':
        env.openRaw(this.doc.name);
        return;
      case 'pickFile':
        this.send({ type: 'pickFileResult', requestId: m.requestId });
        return;
      case 'resolveDroppedFiles':
        this.send({ type: 'droppedFilesResult', requestId: m.requestId, paths: [] });
        return;
      case 'saveFile':
        this.send({ type: 'fileSaveResult', path: m.path, ok: false, error: NO_FILE_REFERENCES });
        return;
      case 'watchFiles':
      case 'openFile':
        return;
      default: {
        // A new message type fails the typecheck here until the web host handles it.
        const unhandled: never = m;
        return unhandled;
      }
    }
  }

  /** Same texts as `BoardSession.promptUrl`: ask again until the URL is valid or the prompt is cancelled. */
  private promptUrl(initial?: string): string | undefined {
    let value = initial;
    for (;;) {
      const answer = this.ports.dialogs.prompt('URL (http or https)', value);
      if (answer === undefined) return undefined;
      const url = answer.trim();
      if (isHttpUrl(url)) return url;
      this.ports.dialogs.alert('Only http: and https: URLs are supported.');
      value = answer;
    }
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
    this.disposers.length = 0;
    this.listeners.clear();
  }
}
