import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { API, API_PREFIX, EVENTS, MAX_BOARD_BYTES, type SaveRequest } from '../shared/api.ts';
import { isBoardName } from '../shared/boardNames.ts';
import { BoardError, BoardFiles, seedBoards } from './boardFiles.ts';
import { checkRequest } from './requestGuard.ts';

export interface BoardsPluginOptions {
  /** Folder with the `.canvas` files. Created and filled from `fixturesDir` when missing. */
  boardsDir: string;
  fixturesDir: string;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
/** An editor's delete-then-write save can show up as `unlink` before `add`. Wait this long before believing a delete. */
const UNLINK_GRACE_MS = 200;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(JSON.stringify(body));
}

/** Read a JSON `{ text }` body. Stops reading at the size limit. */
function readSaveBody(req: IncomingMessage): Promise<SaveRequest> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const fail = (err: BoardError) => {
      if (done) return;
      done = true;
      req.off('data', onData);
      reject(err);
    };
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BOARD_BYTES) {
        fail(new BoardError(413, 'Body too large'));
        return;
      }
      chunks.push(chunk);
    };
    req.on('data', onData);
    req.on('error', () => fail(new BoardError(400, 'Request failed')));
    req.on('end', () => {
      if (done) return;
      done = true;
      try {
        const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const text = typeof body === 'object' && body !== null ? (body as { text?: unknown }).text : undefined;
        if (typeof text !== 'string') throw new Error('no text');
        resolve({ text });
      } catch {
        reject(new BoardError(400, 'Body must be JSON with a "text" string'));
      }
    });
  });
}

async function route(files: BoardFiles, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const name = url.searchParams.get('name') ?? '';
  const method = (req.method ?? 'GET').toUpperCase();

  if (method === 'GET' && url.pathname === API.boards) {
    sendJson(res, 200, { boards: await files.list() });
    return;
  }
  if (method === 'GET' && url.pathname === API.board) {
    sendJson(res, 200, await files.read(name));
    return;
  }
  if (method === 'PUT' && url.pathname === API.board) {
    if (!isBoardName(name)) throw new BoardError(400, `Not a board name: ${name}`);
    const ifMatch = req.headers['if-match'];
    const ifNoneMatch = req.headers['if-none-match'];
    if (ifNoneMatch === '*') {
      const { text } = await readSaveBody(req);
      sendJson(res, 201, await files.createNew(name, text));
      return;
    }
    if (typeof ifMatch !== 'string' || ifMatch.trim() === '') throw new BoardError(428, 'If-Match is required');
    const { text } = await readSaveBody(req);
    sendJson(res, 200, { etag: await files.writeIfMatch(name, text, ifMatch.trim()) });
    return;
  }
  if (method === 'PUT' && url.pathname === API.saveAs) {
    if (!isBoardName(name)) throw new BoardError(400, `Not a board name: ${name}`);
    const { text } = await readSaveBody(req);
    sendJson(res, 201, await files.saveAs(name, text));
    return;
  }
  throw new BoardError(404, 'Not found');
}

function watchBoards(server: ViteDevServer, files: BoardFiles, boardsDir: string): void {
  const nameOf = (file: string): string | undefined => {
    const full = path.resolve(file);
    if (path.dirname(full) !== boardsDir) return undefined;
    const name = path.basename(full);
    return isBoardName(name) ? name : undefined;
  };

  const sendChanged = async (name: string) => {
    let etag: string;
    try {
      etag = (await files.read(name)).etag;
    } catch {
      return;
    }
    if (files.isOwnWrite(name, etag)) return;
    server.ws.send(EVENTS.changed, { name, etag });
  };

  server.watcher.add(boardsDir);
  server.watcher.on('change', (file) => {
    const name = nameOf(file);
    if (name) void sendChanged(name);
  });
  server.watcher.on('add', (file) => {
    const name = nameOf(file);
    if (!name) return;
    void sendChanged(name);
    server.ws.send(EVENTS.list, {});
  });
  server.watcher.on('unlink', (file) => {
    const name = nameOf(file);
    if (!name) return;
    setTimeout(() => {
      stat(path.join(boardsDir, name)).then(
        () => void sendChanged(name),
        () => server.ws.send(EVENTS.removed, { name }),
      );
      server.ws.send(EVENTS.list, {});
    }, UNLINK_GRACE_MS);
  });
}

/** Dev-server endpoints for the board files, and file watching. Dev only. */
export function boardsPlugin(options: BoardsPluginOptions): Plugin {
  const boardsDir = path.resolve(options.boardsDir);
  return {
    name: 'konekton-boards',
    apply: 'serve',

    configResolved(config) {
      const host = config.server.host;
      if (host !== undefined && (typeof host !== 'string' || !LOCAL_HOSTS.has(host))) {
        throw new Error('Konekton web: the dev server must stay on localhost. Do not use --host.');
      }
    },

    async configureServer(server) {
      await seedBoards(boardsDir, options.fixturesDir);
      const files = new BoardFiles(boardsDir);

      // Added here, not in a returned function: it runs before Vite's own middlewares and its HTML fallback.
      server.middlewares.use((req, res, next) => {
        if (!(req.url ?? '').startsWith(API_PREFIX)) {
          next();
          return;
        }
        const blocked = checkRequest({ method: req.method, url: req.url, headers: req.headers });
        if (blocked) {
          sendJson(res, blocked.status, { error: blocked.error });
          return;
        }
        route(files, req, res).catch((err: unknown) => {
          if (err instanceof BoardError) {
            if (err.status === 413) {
              // The rest of the body is not read: close the connection after the answer.
              res.setHeader('Connection', 'close');
              res.on('finish', () => req.destroy());
            }
            sendJson(res, err.status, err.etag ? { error: err.message, etag: err.etag } : { error: err.message });
            return;
          }
          server.config.logger.error(`Konekton web: ${err instanceof Error ? err.message : String(err)}`);
          sendJson(res, 500, { error: err instanceof Error ? err.message : 'Server error' });
        });
      });

      watchBoards(server, files, boardsDir);
      server.config.logger.info(`  Konekton boards: ${boardsDir}`);
    },
  };
}
