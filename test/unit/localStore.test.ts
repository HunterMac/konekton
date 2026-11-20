import { describe, expect, it } from 'vitest';
import { createLocalFiles, createLocalStorage } from '../../web/src/sync/localPorts';
import { memoryKeyValue } from '../../web/src/sync/kv';
import { LocalStore, type ChannelLike, type Entry, type LocalEvent } from '../../web/src/sync/localStore';
import { moveEntries } from '../../web/src/sync/localMove';

/** Two channels that talk to each other, like two tabs. */
function channelPair(): [ChannelLike, ChannelLike] {
  const a: ChannelLike = { postMessage: (m) => queueMicrotask(() => b.onmessage?.({ data: m })), onmessage: null };
  const b: ChannelLike = { postMessage: (m) => queueMicrotask(() => a.onmessage?.({ data: m })), onmessage: null };
  return [a, b];
}

const newStore = (channel?: ChannelLike) => new LocalStore({ entries: memoryKeyValue<Entry>(), meta: memoryKeyValue<unknown>() }, { channel });

describe('LocalStore', () => {
  it('page writes are unsynced, engine writes are synced', async () => {
    const store = newStore();
    await store.createNew('a.canvas', 'board', '{}');
    expect((await store.get('a.canvas'))?.synced).toBe(false);
    await store.put('a.canvas', 'board', '{}', { synced: true, driveId: 'd1', remoteVersion: '3' });
    const e = await store.get('a.canvas');
    expect(e).toMatchObject({ synced: true, driveId: 'd1', remoteVersion: '3' });
    const saved = await store.saveIfMatch('a.canvas', '{"x":1}', e!.etag);
    expect(saved.ok).toBe(true);
    expect(await store.get('a.canvas')).toMatchObject({ synced: false, driveId: 'd1', remoteVersion: '3', text: '{"x":1}' });
    expect((await store.unsynced()).map((x) => x.path)).toEqual(['a.canvas']);
  });

  it('saveIfMatch refuses a stale etag and a missing entry', async () => {
    const store = newStore();
    const created = await store.createNew('a.canvas', 'board', 'one');
    if (created === 'exists') throw new Error('unexpected');
    expect((await store.saveIfMatch('a.canvas', 'two', created.etag)).ok).toBe(true);
    expect((await store.saveIfMatch('a.canvas', 'three', created.etag)).ok).toBe(false);
    expect((await store.saveIfMatch('none.canvas', 'x', created.etag)).ok).toBe(false);
  });

  it('createNew refuses a taken path', async () => {
    const store = newStore();
    await store.createNew('a.canvas', 'board', 'one');
    expect(await store.createNew('a.canvas', 'board', 'two')).toBe('exists');
    expect((await store.get('a.canvas'))?.text).toBe('one');
  });

  it('put with ifEtag writes only when the etag still matches', async () => {
    const store = newStore();
    const first = await store.createNew('a.canvas', 'board', 'one');
    if (first === 'exists') throw new Error('unexpected');
    await store.saveIfMatch('a.canvas', 'two', first.etag);
    expect(await store.put('a.canvas', 'board', 'one', { synced: true, ifEtag: first.etag })).toBeUndefined();
    expect((await store.get('a.canvas'))?.text).toBe('two');
  });

  it('the etag depends on the text only', async () => {
    const store = newStore();
    const a = await store.createNew('a.canvas', 'board', 'same');
    const b = await store.createNew('b.canvas', 'board', 'same');
    expect(a).toEqual(b);
    expect(a).toMatchObject({ etag: expect.stringMatching(/^"[0-9a-f]{64}"$/) });
  });

  it('events say whether this page wrote', async () => {
    const [ca, cb] = channelPair();
    // Same database for both tabs.
    const shared = { entries: memoryKeyValue<Entry>(), meta: memoryKeyValue<unknown>() };
    const tabA = new LocalStore(shared, { channel: ca });
    const tabB = new LocalStore(shared, { channel: cb });
    const a: LocalEvent[] = [];
    const b: LocalEvent[] = [];
    tabA.onEvent((e) => a.push(e));
    tabB.onEvent((e) => b.push(e));
    await tabA.createNew('x.canvas', 'board', 'one');
    await new Promise((r) => setTimeout(r, 0));
    expect(a.filter((e) => e.kind === 'changed')).toMatchObject([{ path: 'x.canvas', byThisPage: true, synced: false }]);
    expect(b.filter((e) => e.kind === 'changed')).toMatchObject([{ path: 'x.canvas', byThisPage: false }]);
    expect(a.some((e) => e.kind === 'list')).toBe(true);
    expect(b.some((e) => e.kind === 'list')).toBe(true);
    await tabA.put('x.canvas', 'board', 'two', { synced: true });
    expect(a.at(-1)).toMatchObject({ kind: 'changed', byThisPage: false, synced: true });
    await tabA.remove('x.canvas');
    await new Promise((r) => setTimeout(r, 0));
    expect(b.some((e) => e.kind === 'removed' && e.path === 'x.canvas')).toBe(true);
  });
});

describe('local ports', () => {
  it('lists boards by name and loads them', async () => {
    const store = newStore();
    const storage = createLocalStorage(store);
    await storage.create('b.canvas', 'bb');
    await storage.create('a.canvas', 'aaa');
    expect((await storage.list()).map((b) => [b.name, b.size])).toEqual([
      ['a.canvas', 3],
      ['b.canvas', 2],
    ]);
    expect(await storage.load('a.canvas')).toMatchObject({ text: 'aaa' });
    expect(await storage.load('none.canvas')).toBeUndefined();
    expect(await storage.create('a.canvas', 'x')).toBe('exists');
  });

  it('save: conflict on a stale etag; saveAs picks the first free name', async () => {
    const storage = createLocalStorage(newStore());
    const made = await storage.create('a.canvas', 'one');
    if (made === 'exists') throw new Error('unexpected');
    const ok = await storage.save('a.canvas', 'two', made.etag);
    expect(ok.ok).toBe(true);
    expect(await storage.save('a.canvas', 'three', made.etag)).toEqual({ ok: false, conflict: true });
    expect((await storage.saveAs('a.canvas', 'mine')).name).toBe('a_web.canvas');
    expect((await storage.saveAs('a.canvas', 'mine2')).name).toBe('a_web-2.canvas');
  });

  it('board watch: only changes that this page did not make', async () => {
    const store = newStore();
    const storage = createLocalStorage(store);
    const seen: string[] = [];
    storage.watch((e) => seen.push(e.kind));
    const made = await storage.create('a.canvas', 'one');
    if (made === 'exists') throw new Error('unexpected');
    expect(seen).toEqual([]);
    await store.put('a.canvas', 'board', 'remote', { synced: true });
    expect(seen).toEqual(['changed']);
  });

  it('file save behaves like the dev server: baseText, force, CRLF', async () => {
    const store = newStore();
    const files = createLocalFiles(store);
    await store.put('docs/a.md', 'file', 'one\r\ntwo\r\n', { synced: true });
    expect(await files.save('docs/a.md', 'x', 'other', false)).toEqual({ ok: false, conflict: true });
    expect(await files.save('docs/a.md', 'one\nthree\n', 'one\ntwo\n', false)).toEqual({ ok: true });
    expect((await store.get('docs/a.md'))?.text).toBe('one\r\nthree\r\n');
    expect(await files.save('docs/a.md', 'forced', 'whatever', true)).toEqual({ ok: true });
    expect(await files.save('docs/missing.md', 'x', '', false)).toEqual({ ok: false, conflict: true });
    expect(await files.save('docs/missing.md', 'x', '', true)).toMatchObject({ ok: false, conflict: false });
    expect(await files.read('docs/a.md')).toEqual({ status: 'ok', text: 'forced' });
    expect(await files.read('docs/none.md')).toEqual({ status: 'missing' });
  });

  it('lists only reference files; createTodo; watch sees own writes', async () => {
    const store = newStore();
    const files = createLocalFiles(store);
    await store.put('docs/a.md', 'file', 'x', { synced: true });
    await store.put('b.canvas', 'board', 'x', { synced: true });
    expect(await files.list()).toEqual(['docs/a.md']);
    const seen: string[] = [];
    files.watch((p) => seen.push(p));
    expect(await files.createTodo('plan')).toEqual({ path: 'plan.todo.md' });
    expect(await files.createTodo('plan')).toBe('exists');
    expect(await files.createTodo('bad/name')).toMatchObject({ error: expect.any(String) });
    expect(seen).toEqual(['plan.todo.md']);
  });
});

describe('moveEntries', () => {
  it('moves entries as unsynced and saves a clash under a copy name', async () => {
    const from = newStore();
    const to = newStore();
    await from.put('a.canvas', 'board', 'signed out', { synced: false });
    await from.put('docs/n.md', 'file', 'mine', { synced: false });
    await from.put('same.canvas', 'board', 'same', { synced: false });
    await to.put('a.canvas', 'board', 'account', { synced: true, driveId: 'd', remoteVersion: '1' });
    await to.put('same.canvas', 'board', 'same', { synced: true, driveId: 'd2', remoteVersion: '1' });
    const notes = await moveEntries(from, to);
    expect(notes).toEqual(['Saved your signed-out version of a.canvas as a_web.canvas.']);
    expect(await from.list()).toEqual([]);
    expect((await to.get('a.canvas'))?.text).toBe('account');
    expect(await to.get('a_web.canvas')).toMatchObject({ text: 'signed out', synced: false });
    expect(await to.get('docs/n.md')).toMatchObject({ text: 'mine', synced: false });
    expect((await to.get('same.canvas'))?.synced).toBe(true);
  });
});
