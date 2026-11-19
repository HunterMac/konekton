import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { fileNodeIds } from '../../src/shared/canvasRefs';
import type { WebviewMessage } from '../../src/shared/protocol';
import { createBoardStore } from '../../webview/src/store';
import { MAX_FONT_SIZE, MIN_FONT_SIZE, todoFontSize } from '../../webview/src/todo/fontSize';

const sample = readFileSync(join(__dirname, '..', 'fixtures', 'sample.canvas'), 'utf8');

describe('fileNodeIds', () => {
  it('finds the cards of a file, resolved against the canvas folder', () => {
    expect(fileNodeIds(sample, '/work/boards', '/work/boards/docs/notes.md')).toEqual(['c3d4e5f60718293a']);
    expect(fileNodeIds(sample, '/work/boards', '/work/boards/docs/../docs/data.json')).toEqual(['f60718293a4b5c6d']);
  });

  it('does not match another folder, another file, or a card of another kind', () => {
    expect(fileNodeIds(sample, '/work/boards', '/work/other/docs/notes.md')).toEqual([]);
    expect(fileNodeIds(sample, '/work/boards', '/work/boards/notes.md')).toEqual([]);
    expect(fileNodeIds(sample, '/work/boards', '/work/boards/Idea')).toEqual([]);
  });

  it('finds a file above the canvas folder, and every card that shows it', () => {
    const text = JSON.stringify({
      nodes: [
        { id: 'a', type: 'file', x: 0, y: 0, width: 100, height: 100, file: '../home.todo.md' },
        { id: 'b', type: 'file', x: 200, y: 0, width: 100, height: 100, file: '../home.todo.md' },
      ],
      edges: [],
    });
    expect(fileNodeIds(text, '/work/boards', '/work/home.todo.md')).toEqual(['a', 'b']);
  });

  it('finds nothing in a canvas that cannot be read', () => {
    expect(fileNodeIds('not json', '/work', '/work/home.todo.md')).toEqual([]);
  });
});

describe('todoFontSize', () => {
  it('follows the width and stays inside its limits', () => {
    expect(todoFontSize(1280)).toBe(16);
    expect(todoFontSize(1600)).toBe(20);
    expect(todoFontSize(200)).toBe(MIN_FONT_SIZE);
    expect(todoFontSize(5000)).toBe(MAX_FONT_SIZE);
  });

  it('never gets smaller when the editor gets wider', () => {
    let last = 0;
    for (let w = 100; w <= 3000; w += 37) {
      const size = todoFontSize(w);
      expect(size).toBeGreaterThanOrEqual(last);
      last = size;
    }
  });
});

describe('full todo editor in the store', () => {
  const setup = () => {
    const sent: WebviewMessage[] = [];
    const store = createBoardStore((m) => sent.push(m));
    return { store, sent };
  };

  it('shows the file and the canvases the extension names', () => {
    const { store } = setup();
    expect(store.getState().todoFile).toBeNull();
    store.getState().handleMessage({ type: 'initTodo', path: 'home.todo.md' });
    store.getState().handleMessage({ type: 'todoReferences', canvases: ['boards/plan.canvas'] });
    expect(store.getState().ready).toBe(true);
    expect(store.getState().todoFile).toBe('home.todo.md');
    expect(store.getState().todoCanvases).toEqual(['boards/plan.canvas']);
  });

  it('asks the extension to go back', () => {
    const { store, sent } = setup();
    store.getState().backToCanvas();
    expect(sent).toEqual([{ type: 'backToCanvas' }]);
  });

  it('opens a todo card fullscreen with the file and the card id', () => {
    const { store, sent } = setup();
    const text = JSON.stringify({ nodes: [{ id: 'n1', type: 'file', x: 0, y: 0, width: 300, height: 200, file: 'home.todo.md' }], edges: [] });
    store.getState().init(text, { gridEnabled: false });
    store.getState().openTodoFullscreen('n1');
    store.getState().openTodoFullscreen('missing');
    expect(sent).toEqual([{ type: 'openTodoFullscreen', path: 'home.todo.md', nodeId: 'n1' }]);
  });

  it('selects and centers the card named in init and in focusNode', () => {
    const { store } = setup();
    const text = JSON.stringify({
      nodes: [
        { id: 'n1', type: 'file', x: 0, y: 0, width: 300, height: 200, file: 'home.todo.md' },
        { id: 'n2', type: 'file', x: 400, y: 0, width: 300, height: 200, file: 'work.todo.md' },
      ],
      edges: [],
    });
    store.getState().init(text, { gridEnabled: false }, 'n1');
    expect(store.getState().selNodes).toEqual(['n1']);
    expect(store.getState().focusNode).toBe('n1');
    store.setState({ focusNode: null });
    store.getState().handleMessage({ type: 'focusNode', id: 'n2' });
    expect(store.getState().selNodes).toEqual(['n2']);
    expect(store.getState().focusNode).toBe('n2');
    // A card that is not on the board changes nothing.
    store.getState().handleMessage({ type: 'focusNode', id: 'gone' });
    expect(store.getState().selNodes).toEqual(['n2']);
  });
});
