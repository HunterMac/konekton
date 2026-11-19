import { describe, expect, it } from 'vitest';
import { entriesFor } from '../../web/src/pages/BoardList';

const boards = [
  { name: 'b.canvas', size: 1, mtime: 2 },
  { name: 'a.canvas', size: 1, mtime: 1 },
];
const paths = ['notes.md', 'work.todo.md', 'sub/home.todo.md', 'data.json', 'todo.md'];

describe('entriesFor', () => {
  it('All: boards in the given order, then todo files by path', () => {
    expect(entriesFor('all', boards, paths).map((e) => (e.kind === 'canvas' ? e.name : e.path))).toEqual(['b.canvas', 'a.canvas', 'sub/home.todo.md', 'todo.md', 'work.todo.md']);
  });

  it('Canvas: boards only', () => {
    expect(entriesFor('canvas', boards, paths).every((e) => e.kind === 'canvas')).toBe(true);
    expect(entriesFor('canvas', boards, paths)).toHaveLength(2);
  });

  it('Todo: todo files only, no other text files', () => {
    expect(entriesFor('todo', boards, paths).map((e) => e.kind === 'todo' && e.path)).toEqual(['sub/home.todo.md', 'todo.md', 'work.todo.md']);
  });

  it('works with nothing listed', () => {
    expect(entriesFor('all', [], [])).toEqual([]);
  });
});
