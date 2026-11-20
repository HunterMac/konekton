import { describe, expect, it } from 'vitest';
import { fileCopyName } from '../../web/src/sync/copyNames';

describe('fileCopyName', () => {
  it('adds _web before the extension', () => {
    expect(fileCopyName('docs/a.md', 1)).toBe('docs/a_web.md');
    expect(fileCopyName('a.txt', 1)).toBe('a_web.txt');
  });

  it('numbers later copies', () => {
    expect(fileCopyName('docs/a.md', 2)).toBe('docs/a_web-2.md');
  });

  it('keeps .todo.md together', () => {
    expect(fileCopyName('x.todo.md', 1)).toBe('x_web.todo.md');
    expect(fileCopyName('lists/x.todo.md', 3)).toBe('lists/x_web-3.todo.md');
  });

  it('does not take a dot of a folder for the extension', () => {
    expect(fileCopyName('v1.2/notes.md', 1)).toBe('v1.2/notes_web.md');
  });
});
