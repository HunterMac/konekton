import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthError, RetryError } from '../../web/src/sync/driveApi';
import type { AuthState } from '../../web/src/sync/googleAuth';
import { memoryKeyValue } from '../../web/src/sync/kv';
import { LocalStore, type Entry, type LocalEvent } from '../../web/src/sync/localStore';
import { SyncEngine } from '../../web/src/sync/syncEngine';
import { FakeDrive } from './fakes/fakeDrive';
import { FakeDialogs } from './fakes/webPorts';

const signedIn: AuthState = { kind: 'signedIn', token: 'T', expiresAt: Number.MAX_SAFE_INTEGER };

class FakeAuth {
  private s: AuthState = signedIn;
  private listeners = new Set<(s: AuthState) => void>();
  state() {
    return this.s;
  }
  onChange(l: (s: AuthState) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  set(s: AuthState) {
    this.s = s;
    for (const l of [...this.listeners]) l(s);
  }
}

/** Let the engine's promise chains run (real macrotasks; only timers are fake). */
async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
}

async function advance(ms: number): Promise<void> {
  await settle();
  vi.advanceTimersByTime(ms);
  await settle();
}

async function setup(opts: { signedOut?: boolean; start?: boolean; refreshMs?: number } = {}) {
  const store = new LocalStore({ entries: memoryKeyValue<Entry>(), meta: memoryKeyValue<unknown>() });
  const drive = new FakeDrive();
  const dialogs = new FakeDialogs();
  const auth = new FakeAuth();
  if (opts.signedOut) auth.set({ kind: 'signedOut' });
  const copies: [string, string][] = [];
  const engine = new SyncEngine({
    store,
    drive,
    auth,
    dialogs,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    refreshMs: opts.refreshMs,
    savedAsCopy: (o, c) => copies.push([o, c]),
  });
  if (opts.start !== false) {
    await engine.start();
    await settle();
  }
  return { store, drive, dialogs, auth, engine, copies };
}

const edit = async (store: LocalStore, path: string, text: string) => {
  const cur = await store.get(path);
  if (!cur) await store.createNew(path, path.endsWith('.canvas') ? 'board' : 'file', text);
  else await store.saveIfMatch(path, text, cur.etag);
};

beforeEach(() => {
  // The real digest finishes on another thread; this one in microtasks, so `settle` is enough.
  vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (_alg, data) => {
    const bytes = createHash('sha256').update(new Uint8Array(data as ArrayBuffer)).digest();
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-06-01T12:00:00Z'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('a new page load (switching views)', () => {
  const restart = (t: Awaited<ReturnType<typeof setup>>) =>
    new SyncEngine({
      store: t.store,
      drive: t.drive,
      auth: t.auth,
      dialogs: t.dialogs,
      now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    });

  it('right after a refresh: no Drive read, the badge says Synced at once', async () => {
    const t = await setup();
    t.engine.stop();
    await advance(10_000);
    const lists = t.drive.count('listAll');
    const next = restart(t);
    const seen: string[] = [];
    next.onStatus((s) => seen.push(s.kind === 'synced' ? 'synced' : s.detail));
    await next.start();
    await settle();
    expect(t.drive.count('listAll')).toBe(lists);
    expect(next.status()).toEqual({ kind: 'synced' });
    expect(seen).not.toContain('syncing');
    expect(seen).not.toContain('waiting');
  });

  it('after 5 min it reads Drive again, shown as checking, not as unsynced', async () => {
    const t = await setup();
    t.engine.stop();
    await advance(5 * 60_000 + 1000);
    const lists = t.drive.count('listAll');
    const next = restart(t);
    const seen: string[] = [];
    next.onStatus((s) => seen.push(s.kind === 'synced' ? 'synced' : s.detail));
    await next.start();
    await settle();
    expect(t.drive.count('listAll')).toBe(lists + 1);
    expect(seen.at(-1)).toBe('synced');
    expect(seen).not.toContain('syncing');
    expect(seen).not.toContain('waiting');
  });
});

describe('the 15 s rule', () => {
  it('pushes at once when nothing was synced for 15 s, then once 15 s after the last sync', async () => {
    const { store, drive } = await setup();
    expect(vi.getTimerCount()).toBe(0); // nothing changed, no timer
    await edit(store, 'a.canvas', 'one');
    await settle();
    expect(drive.count('create a.canvas')).toBe(1);
    await advance(3000);
    await edit(store, 'a.canvas', 'two');
    await advance(3000);
    await edit(store, 'a.canvas', 'three');
    await advance(8000);
    expect(drive.count('update a.canvas')).toBe(0); // 14 s since the first push
    await advance(1100);
    expect(drive.count('update a.canvas')).toBe(1);
    expect(drive.textOf('a.canvas')).toBe('three');
    expect(vi.getTimerCount()).toBe(0);
    expect((await store.get('a.canvas'))?.synced).toBe(true);
  });

  it('syncNow pushes at once and restarts the window', async () => {
    const { store, drive, engine } = await setup();
    await edit(store, 'a.canvas', 'one');
    await settle();
    await advance(1000);
    await edit(store, 'a.canvas', 'two');
    await advance(1000);
    expect(drive.count('update a.canvas')).toBe(0);
    engine.syncNow();
    await settle();
    expect(drive.count('update a.canvas')).toBe(1);
    await edit(store, 'a.canvas', 'three');
    await advance(14_000);
    expect(drive.count('update a.canvas')).toBe(1);
    await advance(1100);
    expect(drive.count('update a.canvas')).toBe(2);
  });

  it('an entry edited during its upload stays unsynced and is pushed again', async () => {
    const { store, drive } = await setup();
    drive.hook = async () => {
      drive.hook = undefined;
      await edit(store, 'a.canvas', 'second');
    };
    await edit(store, 'a.canvas', 'first');
    await settle();
    expect(drive.textOf('a.canvas')).toBe('first');
    const e = await store.get('a.canvas');
    expect(e).toMatchObject({ synced: false, text: 'second' });
    expect(e?.driveId).toBeDefined();
    await advance(15_100);
    expect(drive.count('create a.canvas')).toBe(1);
    expect(drive.textOf('a.canvas')).toBe('second');
    expect((await store.get('a.canvas'))?.synced).toBe(true);
  });

  it('creates folders for files in subfolders', async () => {
    const { store, drive } = await setup();
    await edit(store, 'docs/sub/n.md', 'text');
    await settle();
    expect(drive.textOf('docs/sub/n.md')).toBe('text');
    expect(drive.count('createFolder docs')).toBe(1);
    expect(drive.count('createFolder sub')).toBe(1);
  });
});

describe('refresh', () => {
  it('does not take its own upload for an outside change', async () => {
    const { store, drive, engine } = await setup();
    await edit(store, 'a.canvas', 'one');
    await settle();
    await advance(5 * 60_000 + 1000);
    engine.onFocus();
    await settle();
    expect(drive.count('download')).toBe(0);
  });

  it('refreshes on focus only when the last refresh is older than 5 minutes', async () => {
    const { drive, engine } = await setup();
    expect(drive.count('listAll')).toBe(1);
    await advance(60_000);
    engine.onFocus();
    await settle();
    expect(drive.count('listAll')).toBe(1);
    await advance(4 * 60_000 + 1000);
    engine.onFocus();
    await settle();
    expect(drive.count('listAll')).toBe(2);
  });

  it('downloads files that are new on Drive', async () => {
    const { store, drive } = await setup({ start: false });
    drive.putFile('plan.canvas', 'remote');
    drive.putFile('docs/a.md', 'doc');
    const engine = new SyncEngine({ store, drive, auth: new FakeAuth(), dialogs: new FakeDialogs(), now: () => Date.now(), setTimer: setTimeout, clearTimer: clearTimeout as never });
    await engine.start();
    await settle();
    expect(await store.get('plan.canvas')).toMatchObject({ text: 'remote', synced: true, kind: 'board' });
    expect(await store.get('docs/a.md')).toMatchObject({ text: 'doc', synced: true, kind: 'file' });
  });

  it('a remote change replaces a synced local copy and tells the page', async () => {
    const { store, drive, engine } = await setup();
    await edit(store, 'a.canvas', 'one');
    await settle();
    const events: LocalEvent[] = [];
    store.onEvent((e) => events.push(e));
    drive.editFile('a.canvas', 'remote edit');
    await advance(5 * 60_000 + 1000);
    engine.onFocus();
    await settle();
    expect(await store.get('a.canvas')).toMatchObject({ text: 'remote edit', synced: true });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'changed', path: 'a.canvas', byThisPage: false }));
  });

  describe('a remote change while the local copy is unsynced', () => {
    async function clash() {
      const t = await setup({ refreshMs: 2000 });
      await edit(t.store, 'a.canvas', 'one');
      await settle();
      await edit(t.store, 'a.canvas', 'mine'); // unsynced: the push is 15 s away
      t.drive.editFile('a.canvas', 'theirs');
      await advance(2500);
      t.engine.onFocus();
      await settle();
      return t;
    }

    it('asks; Reload takes the Drive version', async () => {
      const t = await clash();
      expect(t.dialogs.conflicts).toEqual([{ name: 'a.canvas', copyName: 'a_web.canvas' }]);
      t.dialogs.answer('reload');
      await settle();
      expect(await t.store.get('a.canvas')).toMatchObject({ text: 'theirs', synced: true });
      expect(t.drive.textOf('a.canvas')).toBe('theirs');
    });

    it('asks; Save as copy keeps my text in a copy (unsynced) and the original takes Drive', async () => {
      const t = await clash();
      t.dialogs.answer('saveAs');
      await settle();
      expect(await t.store.get('a.canvas')).toMatchObject({ text: 'theirs', synced: true });
      expect(await t.store.get('a_web.canvas')).toMatchObject({ text: 'mine' });
      expect(t.copies).toEqual([['a.canvas', 'a_web.canvas']]);
      await advance(15_100);
      expect(t.drive.textOf('a_web.canvas')).toBe('mine');
    });

    it('the entry does not sync while the question is open', async () => {
      const t = await clash();
      const before = t.drive.count('update a.canvas');
      t.engine.syncNow();
      await advance(20_000);
      expect(t.drive.count('update a.canvas')).toBe(before);
      expect(t.engine.status()).toEqual({ kind: 'notSynced', detail: 'asking' });
    });

    it('Save as copy never overwrites a file that took the shown name meanwhile', async () => {
      const t = await clash();
      await t.store.createNew('a_web.canvas', 'board', 'someone else');
      t.dialogs.answer('saveAs');
      await settle();
      expect(await t.store.get('a_web.canvas')).toMatchObject({ text: 'someone else' });
      expect(await t.store.get('a_web-2.canvas')).toMatchObject({ text: 'mine' });
      expect(await t.store.get('a.canvas')).toMatchObject({ text: 'theirs', synced: true });
      expect(t.copies).toEqual([['a.canvas', 'a_web-2.canvas']]);
      expect(t.dialogs.notices).toContainEqual(expect.stringContaining('a_web-2.canvas'));
    });

    it('an edit made after the answer is not dropped: the question comes again', async () => {
      const t = await clash();
      const answered = t.dialogs.conflicts.length;
      // The edit lands after the engine read my text for the copy, before it writes Drive's text.
      const createNew = t.store.createNew.bind(t.store);
      t.store.createNew = async (path, kind, text) => {
        const r = await createNew(path, kind, text);
        const cur = await t.store.get('a.canvas');
        await t.store.saveIfMatch('a.canvas', 'mine, later', cur!.etag);
        return r;
      };
      t.dialogs.answer('saveAs');
      await settle();
      t.store.createNew = createNew;
      expect(await t.store.get('a_web.canvas')).toMatchObject({ text: 'mine' });
      expect(await t.store.get('a.canvas')).toMatchObject({ text: 'mine, later', synced: false });
      await advance(15_100);
      expect(t.dialogs.conflicts.length).toBe(answered + 1);
      expect(t.drive.textOf('a.canvas')).toBe('theirs');
    });
  });

  it('a push does not overwrite a change made on Drive since the last refresh: it asks', async () => {
    const t = await setup();
    await edit(t.store, 'a.canvas', 'one');
    await settle();
    t.drive.editFile('a.canvas', 'theirs'); // another device, before any refresh here
    await edit(t.store, 'a.canvas', 'mine');
    await advance(15_100);
    expect(t.drive.textOf('a.canvas')).toBe('theirs');
    expect(t.dialogs.conflicts).toEqual([{ name: 'a.canvas', copyName: 'a_web.canvas' }]);
  });

  it('a push whose base is still the Drive version writes', async () => {
    const t = await setup();
    await edit(t.store, 'a.canvas', 'one');
    await settle();
    await edit(t.store, 'a.canvas', 'two');
    await advance(15_100);
    expect(t.drive.textOf('a.canvas')).toBe('two');
    expect(t.drive.count('version a.canvas')).toBe(1);
    expect(t.dialogs.conflicts).toEqual([]);
  });

  it('a sign-in clash (no remote version, other text) asks; equal text does not', async () => {
    const t = await setup({ start: false });
    t.drive.putFile('a.canvas', 'remote');
    t.drive.putFile('same.canvas', 'same');
    await t.store.put('a.canvas', 'board', 'signed out', { synced: false });
    await t.store.put('same.canvas', 'board', 'same', { synced: false });
    await t.engine.start();
    await settle();
    expect(t.dialogs.conflicts.map((c) => c.name)).toEqual(['a.canvas']);
    expect(await t.store.get('same.canvas')).toMatchObject({ synced: true });
  });

  describe('a synced file gone from Drive', () => {
    async function removed(how: 'delete' | 'moveOut') {
      const t = await setup();
      await edit(t.store, 'docs/a.md', 'one');
      await settle();
      if (how === 'delete') t.drive.deleteFile('docs/a.md');
      else t.drive.moveOut('docs/a.md');
      await advance(5 * 60_000 + 1000);
      t.engine.onFocus();
      await settle();
      return t;
    }

    it('asks, and while asked nothing changes or syncs', async () => {
      const t = await removed('delete');
      expect(t.dialogs.removals).toEqual(['docs/a.md']);
      expect(await t.store.get('docs/a.md')).toBeDefined();
      await edit(t.store, 'docs/a.md', 'edited meanwhile');
      await advance(20_000);
      expect(t.drive.count('update docs/a.md')).toBe(0);
      expect(t.drive.count('create docs/a.md')).toBe(1);
    });

    for (const how of ['delete', 'moveOut'] as const) {
      it(`"Write it again" creates it again (${how})`, async () => {
        const t = await removed(how);
        t.dialogs.answerRemoved('write');
        await advance(15_100);
        expect(t.drive.textOf('docs/a.md')).toBe('one');
        expect((await t.store.get('docs/a.md'))?.synced).toBe(true);
        expect(t.engine.status()).toEqual({ kind: 'synced' });
      });
    }

    it('"Delete my copy" removes it locally', async () => {
      const t = await removed('delete');
      t.dialogs.answerRemoved('delete');
      await settle();
      expect(await t.store.get('docs/a.md')).toBeUndefined();
    });

    it('a push into a file that vanished asks too', async () => {
      const t = await setup();
      await edit(t.store, 'a.canvas', 'one');
      await settle();
      t.drive.deleteFile('a.canvas');
      await advance(15_100);
      await edit(t.store, 'a.canvas', 'two');
      await settle();
      expect(t.dialogs.removals).toEqual(['a.canvas']);
    });
  });

  it('creates konekton once when there is none; with two it uses the oldest and warns', async () => {
    const t = await setup();
    expect(t.drive.count('createFolder konekton')).toBe(1);
    await advance(5 * 60_000 + 1000);
    t.engine.onFocus();
    await settle();
    expect(t.drive.count('createFolder konekton')).toBe(1);

    const two = await setup({ start: false });
    const first = two.drive.makeRoot();
    await two.drive.createFolder('konekton', 'root');
    two.drive.rootId = first;
    two.drive.putFile('x.canvas', 'in first');
    await two.engine.start();
    await settle();
    await settle();
    expect(await two.store.get('x.canvas')).toMatchObject({ text: 'in first' });
    expect(two.dialogs.notices.some((n) => n.includes('konekton'))).toBe(true);
  });

  it('files spread over several konekton folders: all are read, no removal questions, no new folder', async () => {
    const t = await setup();
    await edit(t.store, 'a.canvas', 'one');
    await settle();
    // A second top-level konekton with another synced file in it (what the old bug left behind).
    const first = t.drive.rootId as string;
    const second = t.drive.makeRoot();
    t.drive.putFile('b.canvas', 'in second');
    t.drive.rootId = first;
    await advance(5 * 60_000 + 1000);
    t.engine.onFocus();
    await settle();
    await settle();
    expect(await t.store.get('a.canvas')).toMatchObject({ text: 'one', synced: true });
    expect(await t.store.get('b.canvas')).toMatchObject({ text: 'in second', synced: true });
    expect(t.dialogs.removals).toEqual([]);
    expect(t.drive.count('createFolder konekton')).toBe(1);
    expect(second).not.toBe(first);
  });

  it('a remembered folder deleted in Drive: the next file makes konekton again, no error', async () => {
    const t = await setup();
    await edit(t.store, 'a.canvas', 'one');
    await settle();
    expect(t.drive.textOf('a.canvas')).toBe('one');
    t.drive.destroyAll();
    await advance(15_100);
    await edit(t.store, 'b.canvas', 'two');
    await settle();
    expect(t.drive.textOf('b.canvas')).toBe('two');
    expect(t.engine.status()).not.toMatchObject({ kind: 'error' });
  });

  it('two files with the same path: the newest is used, with a warning', async () => {
    const t = await setup({ start: false });
    t.drive.putFile('a.canvas', 'old');
    t.drive.putFile('a.canvas', 'new');
    await t.engine.start();
    await settle();
    expect(await t.store.get('a.canvas')).toMatchObject({ text: 'new' });
    expect(t.dialogs.notices).toContain('Two files named a.canvas in Drive; using the newest.');
  });
});

describe('errors and sign-in', () => {
  it('signed out: nothing runs and the status says so', async () => {
    const t = await setup({ signedOut: true });
    await edit(t.store, 'a.canvas', 'one');
    await advance(20_000);
    expect(t.drive.log).toEqual([]);
    expect(t.engine.status()).toEqual({ kind: 'notSynced', detail: 'signedOut' });
  });

  it('an AuthError ends the work without a retry loop; the token coming back pushes', async () => {
    const t = await setup();
    t.drive.failNext('create', new AuthError());
    const original = t.drive.create.bind(t.drive);
    t.drive.create = async (...args) => {
      try {
        return await original(...args);
      } catch (err) {
        t.auth.set({ kind: 'needsGesture' });
        throw err;
      }
    };
    await edit(t.store, 'a.canvas', 'one');
    await settle();
    expect(t.engine.status()).toEqual({ kind: 'notSynced', detail: 'needsGesture' });
    expect(vi.getTimerCount()).toBe(0);
    t.auth.set(signedIn);
    await advance(15_100);
    expect(t.drive.textOf('a.canvas')).toBe('one');
    expect(t.engine.status()).toEqual({ kind: 'synced' });
  });

  it('a RetryError backs off 15 s, 30 s, 60 s', async () => {
    const t = await setup();
    t.drive.failNext('create', new RetryError('busy'), new RetryError('busy'), new RetryError('busy'));
    await edit(t.store, 'a.canvas', 'one');
    await settle();
    expect(t.drive.count('create a.canvas')).toBe(1);
    expect(t.engine.status()).toMatchObject({ detail: 'error', message: 'busy' });
    await advance(14_000);
    expect(t.drive.count('create a.canvas')).toBe(1);
    await advance(1100);
    expect(t.drive.count('create a.canvas')).toBe(2);
    await advance(29_000);
    expect(t.drive.count('create a.canvas')).toBe(2);
    await advance(1100);
    expect(t.drive.count('create a.canvas')).toBe(3);
    await advance(59_000);
    expect(t.drive.count('create a.canvas')).toBe(3);
    await advance(1100);
    expect(t.drive.count('create a.canvas')).toBe(4);
    expect(t.engine.status()).toEqual({ kind: 'synced' });
  });

  it('offline: the status says so and the online event retries at once', async () => {
    const t = await setup();
    t.drive.failNext('create', new TypeError('Failed to fetch'));
    await edit(t.store, 'a.canvas', 'one');
    await settle();
    expect(t.engine.status()).toEqual({ kind: 'notSynced', detail: 'error', message: 'Offline' });
    t.engine.onOnline();
    await settle();
    expect(t.drive.textOf('a.canvas')).toBe('one');
    expect(t.engine.status()).toEqual({ kind: 'synced' });
  });
});
