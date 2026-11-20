// Fake ports for the web host tests: in-memory storage, recorded dialogs, plain settings and view state.

import type { BoardInfo, FileResponse } from '../../../web/shared/api';
import { todoFileName } from '../../../src/shared/todoFormat';
import { webCopyName } from '../../../web/shared/boardNames';
import type { BoardStorage, Dialogs, Env, PromptOptions, FileSaveResult, FileStore, LoadedBoard, SaveResult, Settings, StorageEvent, ViewStateStore } from '../../../web/src/ports/types';

/** In-memory referenced files. `change` is an outside edit that the watchers see. */
export class FakeFiles implements FileStore {
  readonly disk = new Map<string, string>();
  readonly saves: { path: string; text: string; baseText: string; force: boolean }[] = [];
  private listeners = new Set<(path: string) => void>();

  /** An outside change: writes the file and tells the watchers. */
  change(path: string, text: string | undefined): void {
    if (text === undefined) this.disk.delete(path);
    else this.disk.set(path, text);
    for (const l of this.listeners) l(path);
  }

  async list(): Promise<string[]> {
    return [...this.disk.keys()].sort();
  }

  async read(path: string): Promise<FileResponse> {
    const text = this.disk.get(path);
    return text === undefined ? { status: 'missing' } : { status: 'ok', text };
  }

  async save(path: string, text: string, baseText: string, force: boolean): Promise<FileSaveResult> {
    this.saves.push({ path, text, baseText, force });
    const current = this.disk.get(path);
    if (current === undefined) return { ok: false, conflict: false, error: 'The file does not exist' };
    if (!force && current !== baseText) return { ok: false, conflict: true };
    this.change(path, text);
    return { ok: true };
  }

  async createTodo(name: string): Promise<{ path: string } | 'exists' | { error: string }> {
    const r = todoFileName(name);
    if ('error' in r) return r;
    if (this.disk.has(r.name)) return 'exists';
    this.change(r.name, '- [ ] \n');
    return { path: r.name };
  }

  watch(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class FakeStorage implements BoardStorage {
  readonly disk = new Map<string, LoadedBoard>();
  readonly saves: { name: string; text: string; etag: string }[] = [];
  readonly loads: string[] = [];
  /** Replace the save answer, e.g. to simulate a server error or a slow save. */
  saveImpl: ((name: string, text: string, etag: string) => Promise<SaveResult>) | undefined;
  private n = 0;
  private listeners = new Set<(event: StorageEvent) => void>();

  /** Write a file as an outside program would. Returns the new etag. */
  put(name: string, text: string): string {
    const etag = `"e${++this.n}"`;
    this.disk.set(name, { text, etag });
    return etag;
  }

  emit(event: StorageEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  async list(): Promise<BoardInfo[]> {
    return [...this.disk.keys()].sort().map((name) => ({ name, size: this.disk.get(name)!.text.length, mtime: 0 }));
  }

  async load(name: string): Promise<LoadedBoard | undefined> {
    this.loads.push(name);
    const board = this.disk.get(name);
    return board && { ...board };
  }

  save(name: string, text: string, etag: string): Promise<SaveResult> {
    this.saves.push({ name, text, etag });
    if (this.saveImpl) return this.saveImpl(name, text, etag);
    return Promise.resolve(this.saveNow(name, text, etag));
  }

  /** The default save: If-Match on the in-memory disk. */
  saveNow(name: string, text: string, etag: string): SaveResult {
    const current = this.disk.get(name);
    if (!current || current.etag !== etag) return { ok: false, conflict: true };
    return { ok: true, etag: this.put(name, text) };
  }

  async create(name: string, text: string): Promise<{ name: string; etag: string } | 'exists'> {
    if (this.disk.has(name)) return 'exists';
    return { name, etag: this.put(name, text) };
  }

  async saveAs(name: string, text: string): Promise<{ name: string; etag: string }> {
    for (let n = 1; ; n++) {
      const candidate = webCopyName(name, n);
      if (!this.disk.has(candidate)) return { name: candidate, etag: this.put(candidate, text) };
    }
  }

  watch(listener: (event: StorageEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class FakeDialogs implements Dialogs {
  readonly notices: string[] = [];
  readonly alerts: string[] = [];
  readonly prompts: { message: string; initial?: string; options?: PromptOptions }[] = [];
  readonly conflicts: { name: string; copyName: string }[] = [];
  /** Answers for `prompt`, in order. `undefined` = cancel. */
  promptAnswers: (string | undefined)[] = [];
  private pending: ((answer: 'reload' | 'saveAs') => void) | undefined;

  async prompt(message: string, initial?: string, options?: PromptOptions): Promise<string | undefined> {
    this.prompts.push({ message, initial, options });
    return this.promptAnswers.shift();
  }

  async alert(message: string): Promise<void> {
    this.alerts.push(message);
  }

  notify(message: string): void {
    this.notices.push(message);
  }

  askConflict(name: string, copyName: string): Promise<'reload' | 'saveAs'> {
    this.conflicts.push({ name, copyName });
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  readonly removals: string[] = [];
  private pendingRemoved: ((answer: 'write' | 'delete') => void) | undefined;

  askRemoved(path: string): Promise<'write' | 'delete'> {
    this.removals.push(path);
    return new Promise((resolve) => {
      this.pendingRemoved = resolve;
    });
  }

  answerRemoved(choice: 'write' | 'delete'): void {
    const resolve = this.pendingRemoved;
    this.pendingRemoved = undefined;
    resolve?.(choice);
  }

  get asking(): boolean {
    return this.pending !== undefined;
  }

  answer(choice: 'reload' | 'saveAs'): void {
    const resolve = this.pending;
    this.pending = undefined;
    resolve?.(choice);
  }
}

export class FakeEnv implements Env {
  readonly opened: string[] = [];
  readonly raw: string[] = [];
  readonly files: string[] = [];
  readonly written: string[] = [];
  clipboard: string | Error = '';

  async clipboardRead(): Promise<string> {
    if (this.clipboard instanceof Error) return '';
    return this.clipboard;
  }

  async clipboardWrite(text: string): Promise<void> {
    this.written.push(text);
  }

  openExternal(url: string): void {
    // Same check as the browser env.
    if (/^https?:\/\//i.test(url)) this.opened.push(url);
  }

  openRaw(name: string): void {
    this.raw.push(name);
  }

  openFile(path: string): void {
    this.files.push(path);
  }

  readonly todos: { path: string; from: string }[] = [];

  openTodo(path: string, from: string): void {
    this.todos.push({ path, from });
  }
}

export class FakeSettings implements Settings {
  grid = false;
  private listeners = new Set<(enabled: boolean) => void>();

  gridEnabled(): boolean {
    return this.grid;
  }

  setGridEnabled(enabled: boolean): void {
    this.grid = enabled;
  }

  /** A change made in another tab. */
  changeElsewhere(enabled: boolean): void {
    this.grid = enabled;
    for (const listener of this.listeners) listener(enabled);
  }

  onChange(listener: (enabled: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class FakeViewState implements ViewStateStore {
  state: unknown;

  get(): unknown {
    return this.state;
  }

  set(state: unknown): void {
    this.state = state;
  }
}

/** Let pending promise chains run. */
export async function tick(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}
