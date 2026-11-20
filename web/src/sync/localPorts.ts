import type { BoardInfo, FileResponse } from '../../shared/api';
import { MAX_BOARD_BYTES } from '../../shared/api';
import { webCopyName } from '../../shared/boardNames';
import { isRefPath, MAX_REF_FILE_BYTES, todoFileName } from '../../shared/fileRules';
import type { BoardStorage, FileSaveResult, FileStore, SaveResult, StorageEvent } from '../ports/types';
import type { LocalStore } from './localStore';

const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;
const normalizeEol = (s: string): string => s.replace(/\r\n/g, '\n');

/** Boards of the local copy: the same contract as the dev server's `BoardStorage`. */
export function createLocalStorage(store: LocalStore): BoardStorage {
  return {
    async list() {
      const out: BoardInfo[] = (await store.list('board')).map((e) => ({ name: e.path, size: byteLength(e.text), mtime: e.changedAt }));
      return out;
    },

    async load(name) {
      const entry = await store.get(name);
      return entry && entry.kind === 'board' ? { text: entry.text, etag: entry.etag } : undefined;
    },

    async save(name, text, etag): Promise<SaveResult> {
      if (byteLength(text) > MAX_BOARD_BYTES) return { ok: false, conflict: false, error: 'File too large' };
      try {
        const r = await store.saveIfMatch(name, text, etag);
        return r.ok ? { ok: true, etag: r.etag } : { ok: false, conflict: true };
      } catch (err) {
        return { ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async create(name, text) {
      if (byteLength(text) > MAX_BOARD_BYTES) throw new Error('File too large');
      const r = await store.createNew(name, 'board', text);
      return r === 'exists' ? 'exists' : { name, etag: r.etag };
    },

    async saveAs(name, text) {
      if (byteLength(text) > MAX_BOARD_BYTES) throw new Error('File too large');
      for (let n = 1; n < 1000; n++) {
        const copy = webCopyName(name, n);
        const r = await store.createNew(copy, 'board', text);
        if (r !== 'exists') return { name: copy, etag: r.etag };
      }
      throw new Error('Too many copies');
    },

    watch(listener: (event: StorageEvent) => void) {
      return store.onEvent((event) => {
        if (event.byThisPage) return;
        if (event.kind === 'list') listener({ kind: 'list' });
        else if (event.kind === 'removed') listener({ kind: 'removed', name: event.path });
        else if (event.entryKind === 'board') listener({ kind: 'changed', name: event.path, etag: event.etag });
      });
    },
  };
}

/** Referenced text files of the local copy: the same contract as the dev server's `FileStore`. */
export function createLocalFiles(store: LocalStore): FileStore {
  return {
    async list() {
      return (await store.list('file')).map((e) => e.path).filter(isRefPath);
    },

    async read(path): Promise<FileResponse> {
      const entry = await store.get(path);
      if (!entry || entry.kind !== 'file') return { status: 'missing' };
      if (byteLength(entry.text) > MAX_REF_FILE_BYTES) return { status: 'tooLarge' };
      return { status: 'ok', text: entry.text };
    },

    async save(path, text, baseText, force): Promise<FileSaveResult> {
      if (!isRefPath(path)) return { ok: false, conflict: false, error: `Not a file path the board can use: ${path}` };
      if (byteLength(text) > MAX_REF_FILE_BYTES) return { ok: false, conflict: false, error: 'File too large' };
      try {
        return await store.change<FileSaveResult>(path, (cur) => {
          if (!cur || cur.kind !== 'file') return force ? { result: { ok: false, conflict: false, error: 'The file does not exist' } } : { result: { ok: false, conflict: true } };
          if (!force && normalizeEol(cur.text) !== normalizeEol(baseText)) return { result: { ok: false, conflict: true } };
          // Keep CRLF files CRLF, like the dev server.
          const next = cur.text.includes('\r\n') ? normalizeEol(text).replace(/\n/g, '\r\n') : normalizeEol(text);
          if (next === cur.text) return { result: { ok: true } };
          return { result: { ok: true }, write: { kind: 'file', text: next } };
        });
      } catch (err) {
        return { ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async createTodo(name) {
      const r = todoFileName(name);
      if ('error' in r) return r;
      const created = await store.createNew(r.name, 'file', '- [ ] \n');
      return created === 'exists' ? 'exists' : { path: r.name };
    },

    watch(listener) {
      return store.onEvent((event) => {
        if (event.kind === 'changed' || event.kind === 'removed') listener(event.path);
      });
    },
  };
}

