import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BoardError, BoardFiles, etagOf, seedBoards } from '../../web/server/boardFiles';

const failRename = vi.hoisted(() => ({ on: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...real,
    rename: async (from: string, to: string) => {
      if (failRename.on) throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
      return real.rename(from, to);
    },
  };
});

let dir: string;
let files: BoardFiles;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'konekton-boards-'));
  files = new BoardFiles(dir);
});

afterEach(async () => {
  failRename.on = false;
  await rm(dir, { recursive: true, force: true });
});

async function status(promise: Promise<unknown>): Promise<number | undefined> {
  try {
    await promise;
    return undefined;
  } catch (err) {
    if (err instanceof BoardError) return err.status;
    throw err;
  }
}

const tmpFiles = async () => (await readdir(dir)).filter((n) => n.endsWith('.tmp'));

describe('BoardFiles', () => {
  it('reads with a strong SHA-256 etag', async () => {
    await writeFile(path.join(dir, 'a.canvas'), 'hello');
    const r = await files.read('a.canvas');
    expect(r.text).toBe('hello');
    expect(r.etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect(r.etag).toBe(etagOf('hello'));
  });

  it('answers 404 for a missing board and 400 for a bad name', async () => {
    expect(await status(files.read('none.canvas'))).toBe(404);
    expect(await status(files.read('../package.json'))).toBe(400);
    expect(await status(files.read('.x.canvas'))).toBe(400);
    expect(await status(files.read('a/b.canvas'))).toBe(400);
  });

  it('writeIfMatch writes with the right etag', async () => {
    await writeFile(path.join(dir, 'a.canvas'), 'one');
    const etag = await files.writeIfMatch('a.canvas', 'two', etagOf('one'));
    expect(etag).toBe(etagOf('two'));
    expect(await readFile(path.join(dir, 'a.canvas'), 'utf8')).toBe('two');
    expect(await tmpFiles()).toEqual([]);
  });

  it('writeIfMatch refuses a wrong etag and leaves the file', async () => {
    await writeFile(path.join(dir, 'a.canvas'), 'one');
    let err: unknown;
    try {
      await files.writeIfMatch('a.canvas', 'two', etagOf('other'));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(BoardError);
    expect((err as BoardError).status).toBe(412);
    expect((err as BoardError).etag).toBe(etagOf('one'));
    expect(await readFile(path.join(dir, 'a.canvas'), 'utf8')).toBe('one');
    expect(await tmpFiles()).toEqual([]);
  });

  it('writeIfMatch refuses a missing file', async () => {
    expect(await status(files.writeIfMatch('a.canvas', 'two', etagOf('one')))).toBe(412);
    expect(await readdir(dir)).toEqual([]);
  });

  it('leaves no temp file after a failed write', async () => {
    await writeFile(path.join(dir, 'a.canvas'), 'one');
    failRename.on = true;
    await expect(files.writeIfMatch('a.canvas', 'two', etagOf('one'))).rejects.toThrow('disk full');
    expect(await readFile(path.join(dir, 'a.canvas'), 'utf8')).toBe('one');
    expect(await tmpFiles()).toEqual([]);
  });

  it('runs two writes to one name in order', async () => {
    await writeFile(path.join(dir, 'a.canvas'), 'one');
    const first = files.writeIfMatch('a.canvas', 'two', etagOf('one'));
    const second = files.writeIfMatch('a.canvas', 'three', etagOf('two'));
    expect(await first).toBe(etagOf('two'));
    expect(await second).toBe(etagOf('three'));
    expect(await readFile(path.join(dir, 'a.canvas'), 'utf8')).toBe('three');
  });

  it('createNew never overwrites', async () => {
    await writeFile(path.join(dir, 'a.canvas'), 'one');
    expect(await status(files.createNew('a.canvas', 'two'))).toBe(409);
    expect(await readFile(path.join(dir, 'a.canvas'), 'utf8')).toBe('one');
    const created = await files.createNew('b.canvas', 'new');
    expect(created).toEqual({ name: 'b.canvas', etag: etagOf('new') });
    expect(await readFile(path.join(dir, 'b.canvas'), 'utf8')).toBe('new');
    expect(await tmpFiles()).toEqual([]);
  });

  it('saveAs picks the first free web copy name', async () => {
    await writeFile(path.join(dir, 'x.canvas'), 'disk');
    expect((await files.saveAs('x.canvas', 'mine')).name).toBe('x_web.canvas');
    expect((await files.saveAs('x.canvas', 'mine 2')).name).toBe('x_web-2.canvas');
    expect(await readFile(path.join(dir, 'x_web-2.canvas'), 'utf8')).toBe('mine 2');
    expect(await readFile(path.join(dir, 'x.canvas'), 'utf8')).toBe('disk');
  });

  it('refuses a symlink that points outside the folder', async () => {
    const outside = await mkdtemp(path.join(tmpdir(), 'konekton-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.canvas'), 'secret');
      await symlink(path.join(outside, 'secret.canvas'), path.join(dir, 'link.canvas'));
      expect(await status(files.read('link.canvas'))).toBe(403);
      expect(await status(files.writeIfMatch('link.canvas', 'x', etagOf('secret')))).toBe(403);
      expect(await readFile(path.join(outside, 'secret.canvas'), 'utf8')).toBe('secret');
      expect((await files.list()).map((b) => b.name)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('lists only top-level boards, sorted', async () => {
    await writeFile(path.join(dir, 'b.canvas'), '');
    await writeFile(path.join(dir, 'a.canvas'), '{}');
    await writeFile(path.join(dir, 'a.canvas.123.tmp'), '');
    await writeFile(path.join(dir, 'notes.txt'), '');
    await mkdir(path.join(dir, 'sub.canvas'));
    const list = await files.list();
    expect(list.map((b) => b.name)).toEqual(['a.canvas', 'b.canvas']);
    expect(list[0].size).toBe(2);
  });

  it('knows its own writes', async () => {
    await writeFile(path.join(dir, 'a.canvas'), 'one');
    const etag = await files.writeIfMatch('a.canvas', 'two', etagOf('one'));
    expect(files.isOwnWrite('a.canvas', etag)).toBe(true);
    await writeFile(path.join(dir, 'a.canvas'), 'outside');
    expect(files.isOwnWrite('a.canvas', etagOf('outside'))).toBe(false);
  });
});

describe('seedBoards', () => {
  it('copies top-level .canvas files only when the folder is missing', async () => {
    const fixtures = path.join(dir, 'fixtures');
    await mkdir(path.join(fixtures, 'docs'), { recursive: true });
    await writeFile(path.join(fixtures, 'a.canvas'), 'a');
    await writeFile(path.join(fixtures, 'docs', 'b.canvas'), 'b');
    await writeFile(path.join(fixtures, 'readme.md'), '');
    const boards = path.join(dir, 'boards');

    expect(await seedBoards(boards, fixtures)).toBe(true);
    expect(await readdir(boards)).toEqual(['a.canvas']);

    await rm(path.join(boards, 'a.canvas'));
    expect(await seedBoards(boards, fixtures)).toBe(false);
    expect(await readdir(boards)).toEqual([]);
  });
});
