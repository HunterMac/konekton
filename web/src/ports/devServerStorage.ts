import { API, EVENTS, type BoardListResponse, type BoardResponse, type CreatedResponse, type SaveResponse } from '../../shared/api';
import type { BoardStorage, SaveResult, StorageEvent } from './types';

const boardUrl = (path: string, name: string) => `${path}?name=${encodeURIComponent(name)}`;

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string') return body.error;
  } catch {
    // Not JSON.
  }
  return `HTTP ${res.status}`;
}

function put(url: string, text: string, headers: Record<string, string>): Promise<Response> {
  return fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ text }) });
}

/** Boards as files in the dev server's boards folder (web/server/boardsPlugin.ts). */
export function createDevServerStorage(): BoardStorage {
  return {
    async list() {
      const res = await fetch(API.boards, { cache: 'no-store' });
      if (!res.ok) throw new Error(await errorText(res));
      return ((await res.json()) as BoardListResponse).boards;
    },

    async load(name) {
      const res = await fetch(boardUrl(API.board, name), { cache: 'no-store' });
      if (res.status === 404) return undefined;
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as BoardResponse;
    },

    async save(name, text, etag): Promise<SaveResult> {
      try {
        const res = await put(boardUrl(API.board, name), text, { 'If-Match': etag });
        if (res.status === 412) return { ok: false, conflict: true };
        if (!res.ok) return { ok: false, conflict: false, error: await errorText(res) };
        return { ok: true, etag: ((await res.json()) as SaveResponse).etag };
      } catch (err) {
        return { ok: false, conflict: false, error: err instanceof Error ? err.message : String(err) };
      }
    },

    async create(name, text) {
      const res = await put(boardUrl(API.board, name), text, { 'If-None-Match': '*' });
      if (res.status === 409) return 'exists';
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as CreatedResponse;
    },

    async saveAs(name, text) {
      const res = await put(boardUrl(API.saveAs, name), text, {});
      if (!res.ok) throw new Error(await errorText(res));
      return (await res.json()) as CreatedResponse;
    },

    watch(listener: (event: StorageEvent) => void) {
      const hot = import.meta.hot;
      if (!hot) return () => {};
      const onChanged = (p: { name: string; etag: string }) => listener({ kind: 'changed', name: p.name, etag: p.etag });
      const onRemoved = (p: { name: string }) => listener({ kind: 'removed', name: p.name });
      const onList = () => listener({ kind: 'list' });
      hot.on(EVENTS.changed, onChanged);
      hot.on(EVENTS.removed, onRemoved);
      hot.on(EVENTS.list, onList);
      return () => {
        hot.off(EVENTS.changed, onChanged);
        hot.off(EVENTS.removed, onRemoved);
        hot.off(EVENTS.list, onList);
      };
    },
  };
}
