import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileResponse } from '../shared/api.ts';
import { isRefPath, MAX_REF_FILE_BYTES, todoFileName } from '../shared/fileRules.ts';
import { atomicWrite, BoardError, code, createExclusive } from './boardFiles.ts';

/** Folders the file picker does not look into. */
const SKIP_DIRS = new Set(['node_modules']);
const MAX_DEPTH = 6;
const MAX_LIST = 2000;

const normalizeEol = (s: string): string => s.replace(/\r\n/g, '\n');

/**
 * The text files the boards reference (`.md`, `.txt`, `.json`), anywhere inside the boards folder: the web
 * version of the extension's `ReferencedFiles`. Every path is checked; nothing outside the folder is read or written.
 */
export class RefFiles {
  private realDir: string | undefined;
  /** Writes to one path run one after another. */
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(readonly dir: string) {}

  /** Full path. Refuses bad paths, symlinks out of the folder and anything but a regular file. */
  private async resolve(rel: string): Promise<{ full: string; exists: boolean }> {
    if (!isRefPath(rel)) throw new BoardError(400, `Not a file path the board can use: ${rel}`);
    const full = path.join(this.dir, ...rel.split('/'));
    this.realDir ??= await realpath(this.dir);
    let real: string;
    try {
      real = await realpath(full);
    } catch (err) {
      if (code(err) !== 'ENOENT') throw err;
      // The parent folder must still be inside the boards folder.
      let parent: string;
      try {
        parent = await realpath(path.dirname(full));
      } catch {
        return { full, exists: false };
      }
      if (parent !== this.realDir && !parent.startsWith(this.realDir + path.sep)) throw new BoardError(403, `Outside the boards folder: ${rel}`);
      return { full, exists: false };
    }
    if (!real.startsWith(this.realDir + path.sep) || !(await stat(real)).isFile()) throw new BoardError(403, `Not a file in the boards folder: ${rel}`);
    return { full, exists: true };
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    });
    return next;
  }

  async read(rel: string): Promise<FileResponse> {
    const { full, exists } = await this.resolve(rel);
    if (!exists) return { status: 'missing' };
    if ((await stat(full)).size > MAX_REF_FILE_BYTES) return { status: 'tooLarge' };
    const bytes = await readFile(full);
    if (bytes.subarray(0, 8000).includes(0)) return { status: 'binary' };
    return { status: 'ok', text: bytes.toString('utf8') };
  }

  /** Save `text` when the file still has `baseText` (line endings ignored) or `force`. Keeps CRLF files CRLF. */
  save(rel: string, text: string, baseText: string, force: boolean): Promise<void> {
    return this.enqueue(rel, async () => {
      if (Buffer.byteLength(text, 'utf8') > MAX_REF_FILE_BYTES) throw new BoardError(413, 'File too large');
      const { full, exists } = await this.resolve(rel);
      if (!exists) throw new BoardError(force ? 404 : 412, 'The file does not exist');
      const disk = (await readFile(full)).toString('utf8');
      if (!force && normalizeEol(disk) !== normalizeEol(baseText)) throw new BoardError(412, 'The file changed on disk');
      const next = disk.includes('\r\n') ? normalizeEol(text).replace(/\n/g, '\r\n') : normalizeEol(text);
      if (next !== disk) await atomicWrite(full, next);
    });
  }

  /** Create `<name>.todo.md` at the top of the boards folder with one empty task. Never overwrites: 409. */
  createTodo(typed: string): Promise<string> {
    const r = todoFileName(typed);
    if ('error' in r) return Promise.reject(new BoardError(400, r.error));
    return this.enqueue(r.name, async () => {
      const { full, exists } = await this.resolve(r.name);
      if (exists) throw new BoardError(409, `${r.name} already exists`);
      await createExclusive(full, '- [ ] \n', () => new BoardError(409, `${r.name} already exists`));
      return r.name;
    });
  }

  /** Paths of the text files in the folder and its subfolders (not hidden ones, not `node_modules`), sorted. */
  async list(): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: string, prefix: string, depth: number) => {
      if (depth > MAX_DEPTH || out.length >= MAX_LIST) return;
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') || out.length >= MAX_LIST) continue;
        const rel = prefix === '' ? e.name : `${prefix}/${e.name}`;
        if (e.isDirectory() && !SKIP_DIRS.has(e.name)) await walk(path.join(dir, e.name), rel, depth + 1);
        else if (e.isFile() && isRefPath(rel)) out.push(rel);
      }
    };
    await walk(this.dir, '', 0);
    return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  /** The board path of a watched file, or undefined when it is not one the boards may use. */
  pathOf(file: string): string | undefined {
    const rel = path.relative(this.dir, path.resolve(file));
    if (rel.startsWith('..') || path.isAbsolute(rel)) return undefined;
    const posix = rel.split(path.sep).join('/');
    return isRefPath(posix) ? posix : undefined;
  }
}
