import * as vscode from 'vscode';
import { fileNodeIds } from '../shared/canvasRefs';
import { isHttpUrl, type ExtensionMessage, type WebviewMessage } from '../shared/protocol';
import { basename } from '../shared/paths';
import type { BoardEditorProvider } from './boardEditorProvider';
import { ReferencedFiles } from './referencedFiles';
import { getWebviewHtml } from './webviewHtml';

export const TODO_VIEW_TYPE = 'konekton.todo';

/** The canvas card a todo file was opened from. */
export interface TodoOrigin {
  canvas: vscode.Uri;
  nodeId: string;
}

/** Canvases are searched in the workspace; a huge workspace must not stall the editor. */
const MAX_CANVASES = 500;

/** A canvas that shows the todo file, and the cards that do. */
interface CanvasRef {
  uri: vscode.Uri;
  label: string;
  nodeIds: string[];
}

/** One open full todo editor: a todo document, its webview, and everything that must be cleaned up with it. */
export class TodoSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly referenced: ReferencedFiles;
  private readonly name: string;
  private readonly postEmitter = new vscode.EventEmitter<ExtensionMessage>();
  private origin: TodoOrigin | undefined;

  /** Fires for every message sent to the webview. */
  readonly onDidPostMessage = this.postEmitter.event;

  constructor(
    readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly boards: BoardEditorProvider,
    origin: TodoOrigin | undefined,
    private readonly onDispose: (s: TodoSession) => void,
  ) {
    this.origin = origin;
    this.name = basename(document.uri.path);
    this.referenced = new ReferencedFiles(vscode.Uri.joinPath(document.uri, '..'), (m) => this.post(m));

    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')] };
    webview.html = getWebviewHtml(webview, extensionUri, 'todo');

    this.disposables.push(
      this.postEmitter,
      this.referenced,
      webview.onDidReceiveMessage((m: WebviewMessage) => void this.handleMessage(m)),
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) {
          this.referenced.readAll();
          void this.postReferences();
        }
      }),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private post(message: ExtensionMessage): void {
    this.postEmitter.fire(message);
    void this.panel.webview.postMessage(message);
  }

  /** The card the editor was opened from changed (the file was opened again from another card). */
  setOrigin(origin: TodoOrigin): void {
    this.origin = origin;
    void this.postReferences();
  }

  /** Handle one webview message. Public so tests can drive a session without a real webview. */
  async handleMessage(m: WebviewMessage): Promise<void> {
    switch (m.type) {
      case 'ready':
        this.post({ type: 'initTodo', path: this.name });
        void this.postReferences();
        return;
      case 'watchFiles':
        // Only the todo file of this editor.
        this.referenced.setPaths(m.paths.filter((p) => p === this.name));
        return;
      case 'saveFile': {
        if (m.path !== this.name) return;
        const result = await this.referenced.save(m.path, m.text, m.baseText, m.force === true);
        this.post({ type: 'fileSaveResult', path: m.path, ...result });
        return;
      }
      case 'clipboardWrite':
        await vscode.env.clipboard.writeText(m.text);
        return;
      case 'clipboardRead':
        this.post({ type: 'clipboardReadResult', requestId: m.requestId, text: await vscode.env.clipboard.readText() });
        return;
      case 'openUrl':
        if (isHttpUrl(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url, true));
        return;
      case 'reopenAsText':
        await vscode.commands.executeCommand('vscode.openWith', this.document.uri, 'default');
        return;
      case 'backToCanvas':
        await this.backToCanvas();
        return;
      default:
        // The rest belongs to the canvas editor.
        return;
    }
  }

  /** The canvases that show this file. Opened-from first, then by name. */
  private async canvases(): Promise<CanvasRef[]> {
    const target = this.document.uri;
    const files = await vscode.workspace.findFiles('**/*.canvas', '**/node_modules/**', MAX_CANVASES);
    const found: CanvasRef[] = [];
    for (const uri of files) {
      if (uri.scheme !== target.scheme) continue;
      const text = await readText(uri);
      // A cheap test before the parse: the card holds the file name.
      if (text === undefined || !text.includes(this.name)) continue;
      const nodeIds = fileNodeIds(text, vscode.Uri.joinPath(uri, '..').path, target.path);
      if (nodeIds.length > 0) found.push({ uri, label: vscode.workspace.asRelativePath(uri), nodeIds });
    }
    const first = this.origin?.canvas.toString();
    return found.sort((a, b) => Number(b.uri.toString() === first) - Number(a.uri.toString() === first) || a.label.localeCompare(b.label));
  }

  private async postReferences(): Promise<void> {
    const refs = await this.canvases();
    this.post({ type: 'todoReferences', canvases: refs.map((r) => r.label) });
  }

  /** Show the canvas with the card selected. With several canvases and no opened-from one, ask which. */
  private async backToCanvas(): Promise<void> {
    const refs = await this.canvases();
    if (refs.length === 0) {
      void vscode.window.showInformationMessage(`No canvas shows ${this.name}.`);
      return;
    }
    let ref = refs[0];
    const fromOrigin = this.origin !== undefined && ref.uri.toString() === this.origin.canvas.toString();
    if (!fromOrigin && refs.length > 1) {
      const picked = await vscode.window.showQuickPick(
        refs.map((r) => ({ label: r.label, ref: r })),
        { placeHolder: `${this.name} is on several canvases. Go back to:` },
      );
      if (!picked) return;
      ref = picked.ref;
    }
    const nodeId = fromOrigin && this.origin !== undefined && ref.nodeIds.includes(this.origin.nodeId) ? this.origin.nodeId : ref.nodeIds[0];
    await this.boards.openBoard(ref.uri, nodeId);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.onDispose(this);
  }
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open && !open.isClosed) return open.getText();
  try {
    return new TextDecoder('utf-8').decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/** The full todo editor: a `*.todo.md` file as a tab of its own (TODO-STANDALONE.md). */
export class TodoEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly active = new Set<TodoSession>();
  /** The card each todo file was last opened from, by file URI. */
  private readonly origins = new Map<string, TodoOrigin>();

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly boards: BoardEditorProvider,
  ) {}

  sessions(): TodoSession[] {
    return [...this.active];
  }

  /** Open `uri` in the full todo editor, in the active editor group. `origin`: the canvas card it comes from. */
  async open(uri: vscode.Uri, origin?: TodoOrigin): Promise<void> {
    const key = uri.toString();
    if (origin) {
      this.origins.set(key, origin);
      for (const s of this.active) if (s.document.uri.toString() === key) s.setOrigin(origin);
    }
    await vscode.commands.executeCommand('vscode.openWith', uri, TODO_VIEW_TYPE, { viewColumn: vscode.ViewColumn.Active });
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const session = new TodoSession(document, panel, this.extensionUri, this.boards, this.origins.get(document.uri.toString()), (s) => this.active.delete(s));
    this.active.add(session);
  }
}
