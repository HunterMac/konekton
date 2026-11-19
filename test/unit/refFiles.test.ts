import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BoardError } from '../../web/server/boardFiles';
import { RefFiles } from '../../web/server/refFiles';
import { isRefPath, MAX_REF_FILE_BYTES, REF_FILE_EXTENSIONS, todoFileName as webTodoFileName } from '../../web/shared/fileRules';
import { TEXT_FILE_EXTENSIONS } from '../../src/shared/canvasFormat';
import { MAX_PREVIEW_BYTES } from '../../src/shared/protocol';
import { todoFileName } from '../../src/shared/todoFormat';

let root: string;
let dir: string;
let refs: RefFiles;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'konekton-refs-'));
  dir = path.join(root, 'boards');
  await mkdir(dir);
  refs = new RefFiles(dir);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
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

describe('web file rules', () => {
  it('stay equal to the rules in src/shared', () => {
    expect([...REF_FILE_EXTENSIONS]).toEqual([...TEXT_FILE_EXTENSIONS]);
    expect(MAX_REF_FILE_BYTES).toBe(MAX_PREVIEW_BYTES);
    for (const input of ['home', ' home.todo.md ', 'Home.TODO.md', '', '  ', '../x', 'a/b', '.hidden', 'a:b', 'x'.repeat(121), 'Plan 2026', 'tab\there']) {
      expect(webTodoFileName(input), input).toEqual(todoFileName(input));
    }
  });
});

describe('isRefPath', () => {
  it('allows relative text file paths inside the folder only', () => {
    expect(isRefPath('a.md')).toBe(true);
    expect(isRefPath('notes/home.todo.md')).toBe(true);
    expect(isRefPath('data.json')).toBe(true);
    for (const bad of ['', '../a.md', 'a/../b.md', '/etc/a.md', 'a\\b.md', '.hidden.md', 'x/.git/a.md', 'a//b.md', 'board.canvas', 'a.exe', 'a\u0000.md']) {
      expect(isRefPath(bad), bad).toBe(false);
    }
  });
});

describe('RefFiles', () => {
  it('reads files and reports missing, binary and bad paths', async () => {
    await mkdir(path.join(dir, 'notes'));
    await writeFile(path.join(dir, 'notes', 'a.md'), 'hello');
    await writeFile(path.join(dir, 'bin.txt'), Buffer.from([1, 0, 2]));
    expect(await refs.read('notes/a.md')).toEqual({ status: 'ok', text: 'hello' });
    expect(await refs.read('none.md')).toEqual({ status: 'missing' });
    expect(await refs.read('bin.txt')).toEqual({ status: 'binary' });
    expect(await status(refs.read('../x.md'))).toBe(400);
  });

  it('refuses symlinks that lead out of the folder', async () => {
    await writeFile(path.join(root, 'secret.md'), 'secret');
    await symlink(path.join(root, 'secret.md'), path.join(dir, 'link.md'));
    await mkdir(path.join(root, 'outside'));
    await symlink(path.join(root, 'outside'), path.join(dir, 'out'));
    expect(await status(refs.read('link.md'))).toBe(403);
    expect(await status(refs.read('out/new.md'))).toBe(403);
    expect(await status(refs.save('link.md', 'x', 'secret', true))).toBe(403);
    expect(await readFile(path.join(root, 'secret.md'), 'utf8')).toBe('secret');
  });

  it('saves only over the base text, unless forced, and keeps CRLF', async () => {
    const file = path.join(dir, 'a.md');
    await writeFile(file, 'one\r\ntwo\r\n');
    await refs.save('a.md', 'one\nTWO\n', 'one\ntwo\n', false);
    expect(await readFile(file, 'utf8')).toBe('one\r\nTWO\r\n');
    expect(await status(refs.save('a.md', 'x', 'one\ntwo\n', false))).toBe(412);
    await refs.save('a.md', 'x', 'stale', true);
    expect(await readFile(file, 'utf8')).toBe('x');
    expect(await status(refs.save('none.md', 'x', '', false))).toBe(412);
  });

  it('creates todo lists and never overwrites', async () => {
    expect(await refs.createTodo(' home ')).toBe('home.todo.md');
    expect(await readFile(path.join(dir, 'home.todo.md'), 'utf8')).toBe('- [ ] \n');
    expect(await status(refs.createTodo('home.todo.md'))).toBe(409);
    expect(await status(refs.createTodo('../x'))).toBe(400);
    expect(await status(refs.createTodo(''))).toBe(400);
  });

  it('lists text files, without hidden folders, node_modules or boards', async () => {
    await mkdir(path.join(dir, 'notes'));
    await mkdir(path.join(dir, '.git'));
    await mkdir(path.join(dir, 'node_modules'));
    for (const f of ['b.md', 'a.todo.md', 'notes/c.txt', '.git/x.md', 'node_modules/y.md', 'board.canvas', '.hidden.md']) await writeFile(path.join(dir, f), '');
    expect(await refs.list()).toEqual(['a.todo.md', 'b.md', 'notes/c.txt']);
  });

  it('maps watched file names to board paths', () => {
    expect(refs.pathOf(path.join(dir, 'notes', 'a.md'))).toBe('notes/a.md');
    expect(refs.pathOf(path.join(dir, 'b.canvas'))).toBeUndefined();
    expect(refs.pathOf(path.join(root, 'x.md'))).toBeUndefined();
  });
});
