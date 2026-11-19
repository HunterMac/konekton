import { describe, expect, it } from 'vitest';
import { createBoardStore } from '../../webview/src/store';
import type { WebviewMessage } from '../../src/shared/protocol';

const PATH = 'home.todo.md';

function setup(text = '- [ ] A\n') {
  const sent: WebviewMessage[] = [];
  const store = createBoardStore((m) => sent.push(m));
  store.getState().init('', { gridEnabled: false });
  store.getState().handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text });
  const saves = () => sent.filter((m): m is Extract<WebviewMessage, { type: 'saveFile' }> => m.type === 'saveFile');
  const shown = () => store.getState().files[PATH]?.text;
  return { store, sent, saves, shown };
}

describe('todo mode saves', () => {
  it('shows the edit at once and saves it against the disk text', () => {
    const { store, saves, shown } = setup();
    store.getState().writeTodo(PATH, '- [x] A\n');
    expect(shown()).toBe('- [x] A\n');
    expect(saves()).toEqual([{ type: 'saveFile', path: PATH, text: '- [x] A\n', baseText: '- [ ] A\n' }]);
  });

  it('sends one save at a time and only the newest waiting text', () => {
    const { store, saves, shown } = setup();
    const api = store.getState();
    api.writeTodo(PATH, 'one');
    api.writeTodo(PATH, 'two');
    api.writeTodo(PATH, 'three');
    expect(saves()).toHaveLength(1);
    expect(shown()).toBe('three');
    // Our own change comes back from the watcher before the save result: it must not flash back.
    api.handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text: 'one' });
    expect(shown()).toBe('three');
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: true });
    expect(saves().map((m) => [m.text, m.baseText])).toEqual([
      ['one', '- [ ] A\n'],
      ['three', 'one'],
    ]);
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: true });
    expect(saves()).toHaveLength(2);
  });

  it('uses the newest disk text as the base after an outside change', () => {
    const { store, saves } = setup();
    const api = store.getState();
    api.writeTodo(PATH, 'one');
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: true });
    api.handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text: 'outside' });
    expect(store.getState().files[PATH].text).toBe('outside');
    api.writeTodo(PATH, 'two');
    expect(saves()[1]).toMatchObject({ text: 'two', baseText: 'outside' });
  });

  it('keeps the unsaved text on a conflict until Reload or Overwrite', () => {
    const { store, saves, shown } = setup();
    const api = store.getState();
    api.writeTodo(PATH, 'mine');
    api.handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text: 'theirs' });
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: false, conflict: true });
    expect(store.getState().todoSaveErrors[PATH]).toEqual({ conflict: true, message: 'File changed on disk' });
    expect(shown()).toBe('mine');
    api.writeTodo(PATH, 'mine 2');
    expect(saves()).toHaveLength(1);
    api.overwriteTodo(PATH);
    expect(saves()[1]).toMatchObject({ text: 'mine 2', baseText: 'theirs', force: true });
    expect(store.getState().todoSaveErrors[PATH]).toBeUndefined();
  });

  it('retries a save that failed without a conflict against the disk text, not forced', () => {
    const { store, saves } = setup();
    const api = store.getState();
    api.writeTodo(PATH, 'mine');
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: false, error: 'offline' });
    api.handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text: 'theirs' });
    api.overwriteTodo(PATH);
    expect(saves()[1]).toEqual({ type: 'saveFile', path: PATH, text: 'mine', baseText: 'theirs' });
  });

  it('reloads the disk text after a failed save', () => {
    const { store, shown } = setup();
    const api = store.getState();
    api.writeTodo(PATH, 'mine');
    api.handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text: 'theirs' });
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: false, error: 'disk full' });
    expect(store.getState().todoSaveErrors[PATH]).toEqual({ conflict: false, message: 'disk full' });
    api.reloadTodo(PATH);
    expect(shown()).toBe('theirs');
    expect(store.getState().todoSaveErrors[PATH]).toBeUndefined();
    expect(api.undoTodo(PATH)).toBe(false);
  });

  it('undoes and redoes todo edits', () => {
    const { store, shown } = setup('a');
    const api = store.getState();
    api.writeTodo(PATH, 'b');
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: true });
    api.writeTodo(PATH, 'c');
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: true });
    expect(api.undoTodo(PATH)).toBe(true);
    expect(shown()).toBe('b');
    expect(api.undoTodo(PATH)).toBe(true);
    expect(shown()).toBe('a');
    expect(api.undoTodo(PATH)).toBe(false);
    expect(api.redoTodo(PATH)).toBe(true);
    expect(shown()).toBe('b');
  });

  it('forgets the undo history when the file changes outside', () => {
    const { store } = setup('a');
    const api = store.getState();
    api.writeTodo(PATH, 'b');
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: true });
    api.handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text: 'b' });
    expect(api.undoTodo(PATH)).toBe(true);
    api.handleMessage({ type: 'fileSaveResult', path: PATH, ok: true });
    api.handleMessage({ type: 'fileContent', path: PATH, status: 'ok', text: 'edited elsewhere' });
    expect(api.undoTodo(PATH)).toBe(false);
  });

  it('asks the host to create a todo file', async () => {
    const { store, sent } = setup();
    const result = store.getState().createTodoFile();
    const req = sent.find((m) => m.type === 'createTodoFile') as Extract<WebviewMessage, { type: 'createTodoFile' }>;
    store.getState().handleMessage({ type: 'createTodoFileResult', requestId: req.requestId, path: 'home.todo.md' });
    await expect(result).resolves.toBe('home.todo.md');
  });
});
