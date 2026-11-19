import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionMessage } from '../../src/shared/protocol';
import { WebHost } from '../../web/src/host/WebHost';
import { WebTodoHost } from '../../web/src/host/WebTodoHost';
import { FakeDialogs, FakeEnv, FakeFiles, FakeSettings, FakeStorage, FakeViewState, tick } from './fakes/webPorts';

const PATH = 'work/home.todo.md';

const canvas = (...files: string[]) =>
  JSON.stringify({ nodes: files.map((file, i) => ({ id: `n${i}`, type: 'file', x: i * 400, y: 0, width: 300, height: 200, file })), edges: [] });

function setup(from?: string) {
  const storage = new FakeStorage();
  storage.put('plan.canvas', canvas(PATH));
  storage.put('other.canvas', canvas('elsewhere.md'));
  storage.put('zeta.canvas', canvas(PATH));
  const files = new FakeFiles();
  files.disk.set(PATH, '- [ ] A\n');
  const env = new FakeEnv();
  const dialogs = new FakeDialogs();
  const opened: { name: string; close: boolean }[] = [];
  const host = new WebTodoHost({ storage, files, env, dialogs, viewState: new FakeViewState() }, PATH, from, { openBoard: (name, close) => opened.push({ name, close }) });
  const received: ExtensionMessage[] = [];
  host.onMessage((m) => received.push(m));
  return { host, storage, files, env, dialogs, opened, received };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WebTodoHost', () => {
  it('answers ready with the file and the boards that show it, the opening board first', async () => {
    const { host, received } = setup('zeta.canvas');
    host.post({ type: 'ready' });
    await tick();
    expect(received).toContainEqual({ type: 'initTodo', path: PATH });
    expect(received).toContainEqual({ type: 'todoReferences', canvases: ['zeta.canvas', 'plan.canvas'] });
  });

  it('reads the watched file and follows outside changes', async () => {
    const { host, files, received } = setup();
    host.post({ type: 'watchFiles', paths: [PATH] });
    await tick();
    expect(received).toContainEqual({ type: 'fileContent', path: PATH, status: 'ok', text: '- [ ] A\n' });
    files.change(PATH, '- [x] A\n');
    await tick();
    expect(received.at(-1)).toEqual({ type: 'fileContent', path: PATH, status: 'ok', text: '- [x] A\n' });
  });

  it('saves against the base text, answers, and reads the file again', async () => {
    const { host, files, received } = setup();
    host.post({ type: 'watchFiles', paths: [PATH] });
    await tick();
    host.post({ type: 'saveFile', path: PATH, text: '- [x] A\n', baseText: '- [ ] A\n' });
    await tick();
    expect(files.saves).toEqual([{ path: PATH, text: '- [x] A\n', baseText: '- [ ] A\n', force: false }]);
    expect(received).toContainEqual({ type: 'fileSaveResult', path: PATH, ok: true });
  });

  it('reports a conflict, and ignores another file', async () => {
    const { host, files, received } = setup();
    host.post({ type: 'saveFile', path: PATH, text: 'mine', baseText: 'stale' });
    host.post({ type: 'saveFile', path: 'other.md', text: 'x', baseText: 'x' });
    await tick();
    expect(files.saves).toHaveLength(1);
    expect(received).toContainEqual({ type: 'fileSaveResult', path: PATH, ok: false, conflict: true });
  });

  it('goes back to the opening board and closes this tab; else to the first board', async () => {
    const a = setup('zeta.canvas');
    a.host.post({ type: 'backToCanvas' });
    await tick();
    expect(a.opened).toEqual([{ name: 'zeta.canvas', close: true }]);
    const b = setup();
    b.host.post({ type: 'backToCanvas' });
    await tick();
    expect(b.opened).toEqual([{ name: 'plan.canvas', close: false }]);
  });

  it('says so when no board shows the file', async () => {
    const { host, storage, dialogs, opened } = setup();
    storage.disk.delete('plan.canvas');
    storage.disk.delete('zeta.canvas');
    host.post({ type: 'backToCanvas' });
    await tick();
    expect(opened).toEqual([]);
    expect(dialogs.alerts).toEqual([`No board shows ${PATH}.`]);
  });

  it('opens the text page for Text', () => {
    const { host, env } = setup();
    host.post({ type: 'reopenAsText' });
    expect(env.files).toEqual([PATH]);
  });
});

describe('WebHost: open fullscreen', () => {
  it('opens the full todo editor for the card, with the board name', async () => {
    const storage = new FakeStorage();
    const etag = storage.put('plan.canvas', canvas(PATH));
    const env = new FakeEnv();
    const host = new WebHost({ storage, files: new FakeFiles(), env, dialogs: new FakeDialogs(), settings: new FakeSettings(), viewState: new FakeViewState() }, 'plan.canvas', { text: canvas(PATH), etag }, { closeTextFields: async () => {}, renamed: () => {}, gone: () => {} });
    host.post({ type: 'openTodoFullscreen', path: PATH, nodeId: 'n0' });
    expect(env.todos).toEqual([{ path: PATH, from: 'plan.canvas' }]);
  });
});
