import * as vscode from 'vscode';
import { isHttpUrl, type ExtensionMessage, type WebviewMessage } from '../shared/protocol';
import { relativePath } from '../shared/paths';
import { isTodoPath, todoFileName } from '../shared/todoFormat';
import { ReferencedFiles } from './referencedFiles';
import type { TodoOrigin, TodoSession } from './todoEditorProvider';
import { getWebviewHtml } from './webviewHtml';

const GRID_SETTING = 'grid.enabled';

export const BOARD_VIEW_TYPE = 'konekton.board';

/** Opens a todo file in the full todo editor. Set by `activate()`. */
export type TodoOpener = (uri: vscode.Uri, origin: TodoOrigin) => Promise<void>;

/** Exposed by `activate()` for the integration tests. */
export interface KonektonApi {
  getSessions(): BoardSession[];
  getTodoSessions(): TodoSession[];
}

/** One open board view: a document, its webview, and everything that must be cleaned up with it. */
export class BoardSession implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly referenced: ReferencedFiles;
  private readonly canvasDir: vscode.Uri;
  private readonly postEmitter = new vscode.EventEmitter<ExtensionMessage>();
  /** True while the webview runs: it said `ready` and has not been hidden since (a hidden webview is destroyed). */
  private live = false;

  /** Fires for every message sent to the webview. */
  readonly onDidPostMessage = this.postEmitter.event;

  constructor(
    readonly document: vscode.TextDocument,
    private readonly panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    private readonly onDispose: (s: BoardSession) => void,
    private readonly openTodo?: TodoOpener,
    /** A card to select and center when the webview starts. */
    private pendingFocus?: string,
  ) {
    this.canvasDir = vscode.Uri.joinPath(document.uri, '..');
    this.referenced = new ReferencedFiles(this.canvasDir, (m) => this.post(m));

    const webview = panel.webview;
    webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist', 'webview')] };
    webview.html = getWebviewHtml(webview, extensionUri);

    this.disposables.push(
      this.postEmitter,
      this.referenced,
      webview.onDidReceiveMessage((m: WebviewMessage) => void this.handleMessage(m)),
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== document.uri.toString() || e.contentChanges.length === 0) return;
        this.post({ type: 'docChanged', text: document.getText(), version: document.version });
      }),
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(`konekton.${GRID_SETTING}`)) this.post({ type: 'settings', gridEnabled: this.gridEnabled() });
      }),
      panel.onDidChangeViewState((e) => {
        if (e.webviewPanel.visible) this.referenced.readAll();
        else this.live = false;
      }),
      panel.onDidDispose(() => this.dispose()),
    );
  }

  private gridEnabled(): boolean {
    return vscode.workspace.getConfiguration('konekton').get<boolean>(GRID_SETTING, false);
  }

  private post(message: ExtensionMessage): void {
    this.postEmitter.fire(message);
    void this.panel.webview.postMessage(message);
  }

  /** Handle one webview message. Public so tests can drive a session without a real webview. */
  async handleMessage(m: WebviewMessage): Promise<void> {
    switch (m.type) {
      case 'ready': {
        this.live = true;
        const focusNode = this.pendingFocus;
        this.pendingFocus = undefined;
        this.post({
          type: 'init',
          text: this.document.getText(),
          version: this.document.version,
          settings: { gridEnabled: this.gridEnabled() },
          canvasDir: this.canvasDir.path,
          ...(focusNode !== undefined ? { focusNode } : {}),
        });
        return;
      }
      case 'edit':
        await this.applyEdit(m.text);
        return;
      case 'watchFiles':
        this.referenced.setPaths(m.paths);
        return;
      case 'saveFile': {
        const result = await this.referenced.save(m.path, m.text, m.baseText, m.force === true);
        this.post({ type: 'fileSaveResult', path: m.path, ...result });
        return;
      }
      case 'pickFile':
        this.post({ type: 'pickFileResult', requestId: m.requestId, path: await this.pickFile() });
        return;
      case 'promptUrl':
        this.post({ type: 'promptUrlResult', requestId: m.requestId, url: await this.promptUrl(m.initial) });
        return;
      case 'createTodoFile':
        this.post({ type: 'createTodoFileResult', requestId: m.requestId, path: await this.createTodoFile() });
        return;
      case 'resolveDroppedFiles':
        this.post({ type: 'droppedFilesResult', requestId: m.requestId, paths: await this.referenced.resolveDropped(m.uris) });
        return;
      case 'clipboardWrite':
        await vscode.env.clipboard.writeText(m.text);
        return;
      case 'clipboardRead':
        this.post({ type: 'clipboardReadResult', requestId: m.requestId, text: await vscode.env.clipboard.readText() });
        return;
      case 'openFile':
        await this.openFile(m.path);
        return;
      case 'openUrl':
        if (isHttpUrl(m.url)) await vscode.env.openExternal(vscode.Uri.parse(m.url, true));
        return;
      case 'setGrid':
        await vscode.workspace.getConfiguration('konekton').update(GRID_SETTING, m.enabled, vscode.ConfigurationTarget.Global);
        return;
      case 'reopenAsText':
        await vscode.commands.executeCommand('vscode.openWith', this.document.uri, 'default');
        return;
      case 'openTodoFullscreen':
        if (isTodoPath(m.path)) await this.openTodo?.(this.referenced.uriFor(m.path), { canvas: this.document.uri, nodeId: m.nodeId });
        return;
    }
  }

  /** Select and center a card. A webview that is not running gets it with its next `init`. */
  focusNode(id: string): void {
    if (this.live && this.panel.visible) {
      this.post({ type: 'focusNode', id });
    } else {
      this.pendingFocus = id;
    }
  }

  /** Replace the whole document: one webview action is one undo step. */
  private async applyEdit(text: string): Promise<void> {
    if (text === this.document.getText()) return;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(this.document.uri, new vscode.Range(0, 0, this.document.lineCount, 0), text);
    await vscode.workspace.applyEdit(edit);
  }

  private async pickFile(): Promise<string | undefined> {
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(this.canvasDir, '**/*'), undefined, 10000);
    const items = files
      .filter((f) => f.toString() !== this.document.uri.toString())
      .map((f) => relativePath(this.canvasDir.path, f.path))
      .sort((a, b) => a.localeCompare(b))
      .map((label) => ({ label }));
    const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Select a file to add to the board', matchOnDescription: true });
    return picked?.label;
  }

  private async promptUrl(initial?: string): Promise<string | undefined> {
    const value = await vscode.window.showInputBox({
      prompt: 'URL (http or https)',
      value: initial,
      validateInput: (v) => (isHttpUrl(v.trim()) ? undefined : 'Only http: and https: URLs are supported.'),
    });
    return value?.trim();
  }

  /** Ask for a name and create `<name>.todo.md` with one empty task next to the board. Returns its path. */
  private async createTodoFile(): Promise<string | undefined> {
    const exists = async (name: string) => {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(this.canvasDir, name));
        return true;
      } catch {
        return false;
      }
    };
    const value = await vscode.window.showInputBox({
      prompt: 'Name of the todo list',
      placeHolder: 'home',
      validateInput: async (v) => {
        const r = todoFileName(v);
        if ('error' in r) return r.error;
        if (await exists(r.name)) return `${r.name} already exists.`;
        return undefined;
      },
    });
    if (value === undefined) return undefined;
    const r = todoFileName(value);
    if ('error' in r || (await exists(r.name))) return undefined;
    const name = r.name;
    try {
      await vscode.workspace.fs.writeFile(vscode.Uri.joinPath(this.canvasDir, name), new TextEncoder().encode('- [ ] \n'));
    } catch (err) {
      void vscode.window.showErrorMessage(`Could not create ${name}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
    return name;
  }

  private async openFile(path: string): Promise<void> {
    const uri = this.referenced.uriFor(path);
    try {
      await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.Beside });
    } catch {
      await vscode.commands.executeCommand('vscode.open', uri, { viewColumn: vscode.ViewColumn.Beside });
    }
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.onDispose(this);
  }
}

export class BoardEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly active = new Set<BoardSession>();
  /** Cards to center in boards that are not open yet, by board URI. */
  private readonly focus = new Map<string, string>();
  private openTodo: TodoOpener | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {}

  sessions(): BoardSession[] {
    return [...this.active];
  }

  /** Where "open fullscreen" on a todo card sends the file. */
  setTodoOpener(opener: TodoOpener): void {
    this.openTodo = opener;
  }

  /** Show a board with one card selected and centered, in the active editor group. */
  async openBoard(uri: vscode.Uri, nodeId: string): Promise<void> {
    const key = uri.toString();
    const open = [...this.active].filter((s) => s.document.uri.toString() === key);
    if (open.length === 0) this.focus.set(key, nodeId);
    for (const s of open) s.focusNode(nodeId);
    await vscode.commands.executeCommand('vscode.openWith', uri, BOARD_VIEW_TYPE, { viewColumn: vscode.ViewColumn.Active });
  }

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const key = document.uri.toString();
    const focus = this.focus.get(key);
    this.focus.delete(key);
    const session = new BoardSession(document, panel, this.extensionUri, (s) => this.active.delete(s), this.openTodo, focus);
    this.active.add(session);
  }
}
