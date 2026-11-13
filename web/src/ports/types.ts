// Ports: each browser feature the web host uses sits behind one of these. A later standalone app swaps one at a time.

import type { BoardInfo } from '../../shared/api';

export interface LoadedBoard {
  text: string;
  etag: string;
}

export type SaveResult = { ok: true; etag: string } | { ok: false; conflict: true } | { ok: false; conflict: false; error: string };

export type StorageEvent = { kind: 'changed'; name: string; etag: string } | { kind: 'removed'; name: string } | { kind: 'list' };

export interface BoardStorage {
  list(): Promise<BoardInfo[]>;
  /** undefined = no such board. */
  load(name: string): Promise<LoadedBoard | undefined>;
  /** Save only if the stored board is still the version `etag` names; else `conflict`. */
  save(name: string, text: string, etag: string): Promise<SaveResult>;
  /** Create only; never overwrite. 'exists' when the name is taken. */
  create(name: string, text: string): Promise<{ name: string; etag: string } | 'exists'>;
  /** Write a copy under the first free `<name>_web….canvas`. */
  saveAs(name: string, text: string): Promise<{ name: string; etag: string }>;
  /** Changes made outside this page. Returns a function that stops listening. */
  watch(listener: (event: StorageEvent) => void): () => void;
}

export interface Env {
  /** '' when the browser refuses. */
  clipboardRead(): Promise<string>;
  clipboardWrite(text: string): Promise<void>;
  /** Opens only http and https URLs, in a new tab. */
  openExternal(url: string): void;
  /** The "Open as text" page for a board, in a new tab. */
  openRaw(name: string): void;
}

export interface Dialogs {
  /** undefined = cancelled. */
  prompt(message: string, initial?: string): string | undefined;
  alert(message: string): void;
  /** Short note that hides by itself. */
  notify(message: string): void;
  /** Required choice after an outside change while there are unsaved changes. */
  askConflict(name: string, copyName: string): Promise<'reload' | 'saveAs'>;
}

export interface Settings {
  gridEnabled(): boolean;
  setGridEnabled(enabled: boolean): void;
  /** Changes made in other tabs. */
  onChange(listener: (enabled: boolean) => void): () => void;
}

/** View state of the open board: synchronous, like the VS Code webview state. */
export interface ViewStateStore {
  get(): unknown;
  set(state: unknown): void;
}
