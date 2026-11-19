// Messages between the extension host and the webview (see IDEA.md 4.4).

export type FileStatus = 'ok' | 'missing' | 'binary' | 'tooLarge';

export interface BoardSettings {
  gridEnabled: boolean;
}

/** Webview → extension. */
export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'edit'; text: string }
  | { type: 'watchFiles'; paths: string[] }
  | { type: 'saveFile'; path: string; text: string; baseText: string; force?: boolean }
  | { type: 'pickFile'; requestId: number }
  | { type: 'promptUrl'; requestId: number; initial?: string }
  /** Ask for a name and create `<name>.todo.md` next to the board. */
  | { type: 'createTodoFile'; requestId: number }
  | { type: 'openFile'; path: string }
  | { type: 'openUrl'; url: string }
  | { type: 'setGrid'; enabled: boolean }
  | { type: 'reopenAsText' }
  /** Open a todo file reference as a full editor tab. `nodeId` is the card, so "Back to canvas" can find it again. */
  | { type: 'openTodoFullscreen'; path: string; nodeId: string }
  /** The full todo editor: go back to the canvas that shows this file. */
  | { type: 'backToCanvas' }
  | { type: 'resolveDroppedFiles'; requestId: number; uris: string[] }
  | { type: 'clipboardWrite'; text: string }
  | { type: 'clipboardRead'; requestId: number };

/** Extension → webview. */
export type ExtensionMessage =
  /** `focusNode`: a card to select and center, when the board opens from "Back to canvas". */
  | { type: 'init'; text: string; version: number; settings: BoardSettings; canvasDir: string; focusNode?: string }
  /** Select and center a card of the open board. */
  | { type: 'focusNode'; id: string }
  /** The full todo editor starts: `path` is the todo file (its name, next to the document). */
  | { type: 'initTodo'; path: string }
  /** Canvases that show this todo file, as short names. Empty: no "Back to canvas" button. */
  | { type: 'todoReferences'; canvases: string[] }
  | { type: 'docChanged'; text: string; version: number }
  | ({ type: 'settings' } & BoardSettings)
  | { type: 'fileContent'; path: string; status: FileStatus; text?: string }
  | { type: 'fileSaveResult'; path: string; ok: boolean; conflict?: boolean; error?: string }
  | { type: 'pickFileResult'; requestId: number; path?: string }
  | { type: 'promptUrlResult'; requestId: number; url?: string }
  /** `path` is relative to the board folder; unset when cancelled or failed. */
  | { type: 'createTodoFileResult'; requestId: number; path?: string }
  | { type: 'droppedFilesResult'; requestId: number; paths: string[] }
  | { type: 'clipboardReadResult'; requestId: number; text: string };

export const MAX_PREVIEW_BYTES = 1024 * 1024;

/** True for URLs the board may open or store: only `http:` and `https:`. */
export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
