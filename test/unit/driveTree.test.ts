import { describe, expect, it } from 'vitest';
import { buildTree, FOLDER_MIME, kindOfPath, pickRoot, type DriveFile } from '../../web/src/sync/driveTree';

let n = 0;
const file = (name: string, parent: string, over: Partial<DriveFile> = {}): DriveFile => ({
  id: `f${++n}`,
  name,
  mimeType: 'text/plain',
  parents: [parent],
  version: '1',
  modifiedTime: '2026-01-01T00:00:01.000Z',
  createdTime: '2026-01-01T00:00:01.000Z',
  ...over,
});
const folder = (name: string, parent: string, over: Partial<DriveFile> = {}): DriveFile => file(name, parent, { mimeType: FOLDER_MIME, ...over });

describe('buildTree', () => {
  it('builds nested paths from parents', () => {
    const root = folder('konekton', 'MYDRIVE', { id: 'R' });
    const docs = folder('docs', 'R', { id: 'D' });
    const sub = folder('sub', 'D', { id: 'S' });
    const tree = buildTree([root, docs, sub, file('a.canvas', 'R'), file('n.md', 'D'), file('deep.md', 'S')], ['R']);
    expect([...tree.files.keys()].sort()).toEqual(['a.canvas', 'docs/n.md', 'docs/sub/deep.md']);
    expect([...tree.folders.keys()].sort()).toEqual(['docs', 'docs/sub']);
  });

  it('leaves out items whose chain does not reach the root', () => {
    const root = folder('konekton', 'MYDRIVE', { id: 'R' });
    const other = folder('other', 'MYDRIVE', { id: 'O' });
    const tree = buildTree([root, other, file('moved.canvas', 'MYDRIVE'), file('x.md', 'O')], ['R']);
    expect(tree.files.size).toBe(0);
    expect(tree.folders.size).toBe(0);
  });

  it('keeps the newest of files with the same path and reports them', () => {
    const root = folder('konekton', 'MYDRIVE', { id: 'R' });
    const old = file('a.canvas', 'R', { id: 'old', modifiedTime: '2026-01-01T00:00:01.000Z' });
    const newer = file('a.canvas', 'R', { id: 'new', modifiedTime: '2026-01-02T00:00:01.000Z' });
    const tree = buildTree([root, newer, old], ['R']);
    expect(tree.files.get('a.canvas')?.id).toBe('new');
    expect(tree.duplicates).toEqual(['a.canvas']);
  });

  it('reads several konekton folders as one tree; the newest file of a path wins', () => {
    const r1 = folder('konekton', 'MYDRIVE', { id: 'R1' });
    const r2 = folder('konekton', 'MYDRIVE', { id: 'R2' });
    const d1 = folder('docs', 'R1', { id: 'D1' });
    const d2 = folder('docs', 'R2', { id: 'D2', createdTime: '2026-01-05T00:00:00.000Z' });
    const files = [
      r1,
      r2,
      d1,
      d2,
      file('only1.canvas', 'R1'),
      file('n.md', 'D2'),
      file('a.canvas', 'R1', { id: 'a-old', modifiedTime: '2026-01-01T00:00:01.000Z' }),
      file('a.canvas', 'R2', { id: 'a-new', modifiedTime: '2026-01-03T00:00:01.000Z' }),
    ];
    const tree = buildTree(files, ['R1', 'R2']);
    expect([...tree.files.keys()].sort()).toEqual(['a.canvas', 'docs/n.md', 'only1.canvas']);
    expect(tree.files.get('a.canvas')?.id).toBe('a-new');
    expect(tree.folders.get('docs')).toBe('D1');
    expect(tree.duplicates).toEqual(['a.canvas']);
  });

  it('ignores Google documents and names with a slash', () => {
    const root = folder('konekton', 'MYDRIVE', { id: 'R' });
    const tree = buildTree([root, file('doc', 'R', { mimeType: 'application/vnd.google-apps.document' }), file('a/b.md', 'R')], ['R']);
    expect(tree.files.size).toBe(0);
  });
});

describe('pickRoot', () => {
  it('picks the oldest konekton folder in My Drive and flags extras', () => {
    const young = folder('konekton', 'MYDRIVE', { id: 'young', createdTime: '2026-02-01T00:00:00.000Z' });
    const old = folder('konekton', 'MYDRIVE', { id: 'old', createdTime: '2026-01-01T00:00:00.000Z' });
    expect(pickRoot([young, old])).toEqual({ id: 'old', all: ['old', 'young'], extra: true });
    expect(pickRoot([old])).toEqual({ id: 'old', all: ['old'], extra: false });
  });

  it('is undefined without a root; a nested konekton is not a root', () => {
    expect(pickRoot([])).toBeUndefined();
    // Top level = the parent is not an item the app sees.
    expect(pickRoot([folder('konekton', 'root')])).toEqual({ id: expect.any(String), all: [expect.any(String)], extra: false });
    // A `konekton` inside another folder of the app is not the root.
    const outer = folder('docs', 'MYDRIVE', { id: 'D' });
    expect(pickRoot([outer, folder('konekton', 'D')])).toBeUndefined();
  });
});

describe('kindOfPath', () => {
  it('knows boards, reference files and the rest', () => {
    expect(kindOfPath('a.canvas')).toBe('board');
    expect(kindOfPath('docs/a.canvas')).toBeUndefined();
    expect(kindOfPath('docs/a.md')).toBe('file');
    expect(kindOfPath('image.png')).toBeUndefined();
  });
});
