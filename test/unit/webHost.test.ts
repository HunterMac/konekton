import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardNodes, serialize } from '../../src/shared/canvasFormat';
import type { ExtensionMessage } from '../../src/shared/protocol';
import { createBoardStore } from '../../webview/src/store';
import { NO_FILE_REFERENCES, WebHost } from '../../web/src/host/WebHost';
import { FakeDialogs, FakeEnv, FakeSettings, FakeStorage, FakeViewState, tick } from './fakes/webPorts';

const sample = readFileSync(join(__dirname, '..', 'fixtures', 'sample.canvas'), 'utf8');
const NAME = 'sample.canvas';

function setup() {
  const storage = new FakeStorage();
  const etag = storage.put(NAME, sample);
  const ports = { storage, env: new FakeEnv(), dialogs: new FakeDialogs(), settings: new FakeSettings(), viewState: new FakeViewState() };
  const host = new WebHost(ports, NAME, { text: sample, etag }, { closeTextFields: async () => {}, renamed: () => {}, gone: () => {} });
  const received: ExtensionMessage[] = [];
  host.onMessage((m) => received.push(m));
  return { host, received, ...ports };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WebHost', () => {
  it('answers ready with init, the text and the grid setting', async () => {
    const { host, received, settings } = setup();
    settings.grid = true;
    host.post({ type: 'ready' });
    expect(received).toEqual([]);
    await tick();
    expect(received).toEqual([{ type: 'init', text: sample, version: 1, settings: { gridEnabled: true }, canvasDir: '' }]);
  });

  it('echoes each edit as docChanged', async () => {
    const { host, received } = setup();
    host.post({ type: 'edit', text: 'a' });
    host.post({ type: 'edit', text: 'b' });
    await tick();
    expect(received).toEqual([
      { type: 'docChanged', text: 'a', version: 1 },
      { type: 'docChanged', text: 'b', version: 2 },
    ]);
    expect(host.doc.text).toBe('b');
  });

  it('undoes and redoes board actions with the real store', async () => {
    const { host } = setup();
    const store = createBoardStore((m) => host.post(m));
    host.onMessage((m) => store.getState().handleMessage(m));
    host.post({ type: 'ready' });
    await tick();
    const first = serialize(store.getState().doc);
    const count = () => boardNodes(store.getState().doc).length;
    const start = count();

    store.getState().createNode({ kind: 'rectangle', center: { x: 0, y: 0 } });
    store.getState().createNode({ kind: 'rectangle', center: { x: 400, y: 0 } });
    await tick();
    expect(count()).toBe(start + 2);
    const last = serialize(store.getState().doc);

    host.doc.undo();
    await tick();
    expect(count()).toBe(start + 1);
    host.doc.undo();
    await tick();
    expect(serialize(store.getState().doc)).toBe(first);

    host.doc.redo();
    host.doc.redo();
    await tick();
    expect(serialize(store.getState().doc)).toBe(last);
  });

  it('asks for a URL until it is valid or cancelled', async () => {
    const { host, received, dialogs } = setup();
    dialogs.promptAnswers = [undefined];
    host.post({ type: 'promptUrl', requestId: 1 });
    dialogs.promptAnswers = ['ftp://x', ' https://a.b '];
    host.post({ type: 'promptUrl', requestId: 2, initial: 'https://old' });
    await tick();
    expect(received).toEqual([
      { type: 'promptUrlResult', requestId: 1, url: undefined },
      { type: 'promptUrlResult', requestId: 2, url: 'https://a.b' },
    ]);
    expect(dialogs.alerts).toEqual(['Only http: and https: URLs are supported.']);
    expect(dialogs.prompts.map((p) => p.initial)).toEqual([undefined, 'https://old', 'ftp://x']);
  });

  it('opens only http and https links', () => {
    const { host, env } = setup();
    host.post({ type: 'openUrl', url: 'javascript:alert(1)' });
    host.post({ type: 'openUrl', url: 'https://example.com' });
    expect(env.opened).toEqual(['https://example.com']);
  });

  it('opens the raw page for the current board', () => {
    const { host, env } = setup();
    host.post({ type: 'reopenAsText' });
    expect(env.raw).toEqual([NAME]);
  });

  it('has no file references', async () => {
    const { host, received } = setup();
    host.post({ type: 'pickFile', requestId: 1 });
    host.post({ type: 'resolveDroppedFiles', requestId: 2, uris: ['file:///x'] });
    host.post({ type: 'saveFile', path: 'a.md', text: 'x', baseText: '' });
    host.post({ type: 'watchFiles', paths: ['a.md'] });
    host.post({ type: 'openFile', path: 'a.md' });
    await tick();
    expect(received).toEqual([
      { type: 'pickFileResult', requestId: 1 },
      { type: 'droppedFilesResult', requestId: 2, paths: [] },
      { type: 'fileSaveResult', path: 'a.md', ok: false, error: NO_FILE_REFERENCES },
    ]);
  });

  it('stores the grid setting and follows other tabs', async () => {
    const { host, received, settings } = setup();
    host.post({ type: 'setGrid', enabled: true });
    expect(settings.grid).toBe(true);
    settings.changeElsewhere(false);
    await tick();
    expect(received).toEqual([{ type: 'settings', gridEnabled: false }]);
  });

  it('answers a refused clipboard read with an empty text', async () => {
    const { host, received, env } = setup();
    env.clipboard = new Error('denied');
    host.post({ type: 'clipboardRead', requestId: 7 });
    await tick();
    expect(received).toEqual([{ type: 'clipboardReadResult', requestId: 7, text: '' }]);
  });

  it('writes the clipboard and keeps view state in the port', () => {
    const { host, env, viewState } = setup();
    host.post({ type: 'clipboardWrite', text: 'copied' });
    expect(env.written).toEqual(['copied']);
    host.setState({ mode: 'board' });
    expect(viewState.state).toEqual({ mode: 'board' });
    expect(host.getState()).toEqual({ mode: 'board' });
  });

  it('passes outside changes of its board to the document', async () => {
    const { host, storage, received, dialogs } = setup();
    const etag = storage.put(NAME, 'outside');
    storage.emit({ kind: 'changed', name: 'other.canvas', etag: '"x"' });
    storage.emit({ kind: 'changed', name: NAME, etag });
    await host.doc.settled();
    await tick();
    expect(received).toEqual([{ type: 'docChanged', text: 'outside', version: 1 }]);
    expect(dialogs.notices).toEqual(['Reloaded: the file changed on server']);
  });
});

describe('createBoardStore features', () => {
  it('keeps the host features', () => {
    expect(createBoardStore(() => {}, 'chaos', { fileReferences: false }).getState().features.fileReferences).toBe(false);
    expect(createBoardStore(() => {}).getState().features.fileReferences).toBe(true);
  });
});
