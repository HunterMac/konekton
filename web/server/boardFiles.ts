import { createHash, randomBytes } from 'node:crypto';
import { copyFile, link, lstat, mkdir, open, readdir, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { MAX_BOARD_BYTES, type BoardInfo, type CreatedResponse } from '../shared/api.ts';
import { isBoardName, webCopyName } from '../shared/boardNames.ts';

/** An error with the HTTP status the endpoint answers with. */
export class BoardError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** For 412: the etag of the file on disk, when there is one. */
    readonly etag?: string,
  ) {
    super(message);
  }
}

const MAX_COPIES = 999;

/** Strong ETag: SHA-256 of the UTF-8 bytes. */
export function etagOf(content: string | Buffer): string {
  return `"${createHash('sha256').update(content).digest('hex')}"`;
}

function code(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : undefined;
}

/**
 * Create `boardsDir` and fill it with the top-level `*.canvas` files of `fixturesDir`.
 * Does nothing when the folder exists. Returns true when it seeded.
 */
export async function seedBoards(boardsDir: string, fixturesDir: string): Promise<boolean> {
  try {
    await stat(boardsDir);
    return false;
  } catch (err) {
    if (code(err) !== 'ENOENT') throw err;
  }
  await mkdir(boardsDir, { recursive: true });
  for (const entry of await readdir(fixturesDir, { withFileTypes: true })) {
    if (entry.isFile() && isBoardName(entry.name)) await copyFile(path.join(fixturesDir, entry.name), path.join(boardsDir, entry.name));
  }
  return true;
}

/** The `.canvas` files directly inside one folder. Every name is checked; nothing outside the folder is read or written. */
export class BoardFiles {
  /** Etag of the last text this server wrote, per name. The watcher skips these. */
  private readonly lastWritten = new Map<string, string>();
  /** Writes to one name run one after another. */
  private readonly queues = new Map<string, Promise<unknown>>();
  private realDir: string | undefined;

  constructor(readonly dir: string) {}

  /** Full path of a board. Refuses bad names, symlinks out of the folder and anything but a regular file. */
  private async resolve(name: string): Promise<{ full: string; exists: boolean }> {
    if (!isBoardName(name)) throw new BoardError(400, `Not a board name: ${name}`);
    const full = path.join(this.dir, name);
    let real: string;
    try {
      real = await realpath(full);
    } catch (err) {
      if (code(err) !== 'ENOENT') throw err;
      // A dangling symlink has no realpath; it is not a board either.
      try {
        await lstat(full);
      } catch {
        return { full, exists: false };
      }
      throw new BoardError(403, `Not a board file: ${name}`);
    }
    this.realDir ??= await realpath(this.dir);
    if (path.dirname(real) !== this.realDir || !(await stat(real)).isFile()) throw new BoardError(403, `Not a board file: ${name}`);
    return { full, exists: true };
  }

  private enqueue<T>(name: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(name) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(name, settled);
    void settled.then(() => {
      if (this.queues.get(name) === settled) this.queues.delete(name);
    });
    return next;
  }

  /** Write a temp file in the same folder, flush it, then rename it over the target. */
  private async atomicWrite(full: string, text: string): Promise<void> {
    const tmp = `${full}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      const handle = await open(tmp, 'wx');
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmp, full);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }

  private checkSize(text: string): void {
    if (Buffer.byteLength(text, 'utf8') > MAX_BOARD_BYTES) throw new BoardError(413, 'Board too large');
  }

  /** Boards in the folder, sorted by name. Subfolders, symlinks and temp files are left out. */
  async list(): Promise<BoardInfo[]> {
    const boards: BoardInfo[] = [];
    for (const entry of await readdir(this.dir, { withFileTypes: true })) {
      if (!entry.isFile() || !isBoardName(entry.name)) continue;
      try {
        const s = await stat(path.join(this.dir, entry.name));
        boards.push({ name: entry.name, size: s.size, mtime: s.mtimeMs });
      } catch {
        // Deleted between readdir and stat.
      }
    }
    return boards.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async read(name: string): Promise<{ text: string; etag: string }> {
    const { full, exists } = await this.resolve(name);
    if (!exists) throw new BoardError(404, `No such board: ${name}`);
    if ((await stat(full)).size > MAX_BOARD_BYTES) throw new BoardError(413, 'Board too large');
    const bytes = await readFile(full);
    return { text: bytes.toString('utf8'), etag: etagOf(bytes) };
  }

  /** Save `text` only if the disk file is still the version `etag` names. */
  writeIfMatch(name: string, text: string, etag: string): Promise<string> {
    return this.enqueue(name, async () => {
      this.checkSize(text);
      const { full, exists } = await this.resolve(name);
      if (!exists) throw new BoardError(412, 'The board does not exist');
      const diskEtag = etagOf(await readFile(full));
      if (diskEtag !== etag) throw new BoardError(412, 'The board changed on the server', diskEtag);
      const next = etagOf(text);
      // Before the rename, so the watcher event of this write is already known as our own.
      this.lastWritten.set(name, next);
      await this.atomicWrite(full, text);
      return next;
    });
  }

  /** Create a board. Never overwrites: 409 when the name is taken. */
  createNew(name: string, text: string): Promise<CreatedResponse> {
    return this.enqueue(name, async () => {
      this.checkSize(text);
      const { full, exists } = await this.resolve(name);
      if (exists) throw new BoardError(409, `A board named ${name} already exists`);
      const etag = etagOf(text);
      this.lastWritten.set(name, etag);
      await this.createExclusive(full, name, text);
      return { name, etag };
    });
  }

  /**
   * Write the full file under a name that must not exist. A hard link from a finished temp file fails if the name
   * exists, so the board never appears half written. File systems without hard links reserve the name with `wx` first.
   */
  private async createExclusive(full: string, name: string, text: string): Promise<void> {
    const tmp = `${full}.${randomBytes(6).toString('hex')}.tmp`;
    const handle = await open(tmp, 'wx');
    try {
      try {
        await handle.writeFile(text, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await link(tmp, full);
    } catch (err) {
      if (code(err) === 'EEXIST') throw new BoardError(409, `A board named ${name} already exists`);
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EXDEV'].includes(code(err) ?? '')) throw err;
      await this.reserveThenWrite(full, name, text);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }

  private async reserveThenWrite(full: string, name: string, text: string): Promise<void> {
    try {
      await (await open(full, 'wx')).close();
    } catch (err) {
      if (code(err) === 'EEXIST') throw new BoardError(409, `A board named ${name} already exists`);
      throw err;
    }
    try {
      await this.atomicWrite(full, text);
    } catch (err) {
      await unlink(full).catch(() => {});
      throw err;
    }
  }

  /** Write a copy under the first free `<name>_web.canvas`, `<name>_web-2.canvas`, … */
  async saveAs(name: string, text: string): Promise<CreatedResponse> {
    if (!isBoardName(name)) throw new BoardError(400, `Not a board name: ${name}`);
    for (let n = 1; n <= MAX_COPIES; n++) {
      const candidate = webCopyName(name, n);
      if (!isBoardName(candidate)) throw new BoardError(400, `Name too long for a copy: ${name}`);
      try {
        return await this.createNew(candidate, text);
      } catch (err) {
        if (err instanceof BoardError && err.status === 409) continue;
        throw err;
      }
    }
    throw new BoardError(500, `No free copy name for ${name}`);
  }

  /** True when `etag` is what this server last wrote to `name`. */
  isOwnWrite(name: string, etag: string): boolean {
    return this.lastWritten.get(name) === etag;
  }
}
