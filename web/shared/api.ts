// The contract between the dev-server plugin (web/server) and the page (web/src): paths, JSON shapes, events.

export const API_PREFIX = '/__konekton/';

export const API = {
  /** GET: list of boards. */
  boards: '/__konekton/boards',
  /** GET: read one board. PUT with `If-Match`: save. PUT with `If-None-Match: *`: create. `?name=<board>`. */
  board: '/__konekton/board',
  /** PUT: write a copy under the first free `<name>_web….canvas`. `?name=<board>`. */
  saveAs: '/__konekton/save-as',
} as const;

/** Largest board file and request body the server accepts. */
export const MAX_BOARD_BYTES = 5 * 1024 * 1024;

export interface BoardInfo {
  name: string;
  size: number;
  /** Milliseconds since the epoch. */
  mtime: number;
}

export interface BoardListResponse {
  boards: BoardInfo[];
}

export interface BoardResponse {
  text: string;
  etag: string;
}

/** Body of every PUT. */
export interface SaveRequest {
  text: string;
}

export interface SaveResponse {
  etag: string;
}

export interface CreatedResponse {
  name: string;
  etag: string;
}

/** 412: the file on disk is not the version the save was based on. No `etag` when the file is missing. */
export interface ConflictResponse {
  error: string;
  etag?: string;
}

export interface ErrorResponse {
  error: string;
}

/** WebSocket events from the plugin to the page (`server.ws.send` / `import.meta.hot.on`). */
export const EVENTS = {
  changed: 'konekton:changed',
  removed: 'konekton:removed',
  list: 'konekton:list',
} as const;

export interface ChangedEvent {
  name: string;
  etag: string;
}

export interface RemovedEvent {
  name: string;
}

declare module 'vite/types/customEvent.d.ts' {
  interface CustomEventMap {
    'konekton:changed': ChangedEvent;
    'konekton:removed': RemovedEvent;
    'konekton:list': Record<string, never>;
  }
}
