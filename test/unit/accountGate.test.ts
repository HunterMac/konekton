import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountGate } from '../../web/src/sync/accountGate';
import type { AuthState } from '../../web/src/sync/googleAuth';
import { memoryKeyValue } from '../../web/src/sync/kv';
import { LocalStore, type ChannelLike, type Entry } from '../../web/src/sync/localStore';
import { SyncCoordinator } from '../../web/src/sync/syncCoordinator';
import { SyncEngine } from '../../web/src/sync/syncEngine';
import { FakeDrive } from './fakes/fakeDrive';
import { FakeDialogs } from './fakes/webPorts';

const tokenOf = (token: string): AuthState => ({ kind: 'signedIn', token, expiresAt: Number.MAX_SAFE_INTEGER });

class FakeAuth {
  private s: AuthState = tokenOf('T1');
  private listeners = new Set<(s: AuthState) => void>();
  rejects = 0;
  state() {
    return this.s;
  }
  onChange(l: (s: AuthState) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  token() {
    return this.s.kind === 'signedIn' ? this.s.token : undefined;
  }
  rejected() {
    this.rejects++;
  }
  set(s: AuthState) {
    this.s = s;
    for (const l of [...this.listeners]) l(s);
  }
}

class FakeChannel implements ChannelLike {
  readonly sent: unknown[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(m: unknown) {
    this.sent.push(m);
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}

async function settle(): Promise<void> {
  for (let i = 0; i < 25; i++) await new Promise((r) => setImmediate(r));
}

function setup() {
  const auth = new FakeAuth();
  const gate = new AccountGate(auth);
  const store = new LocalStore({ entries: memoryKeyValue<Entry>(), meta: memoryKeyValue<unknown>() });
  const drive = new FakeDrive();
  const engine = new SyncEngine({
    store,
    drive,
    auth: gate,
    dialogs: new FakeDialogs(),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  });
  return { auth, gate, store, drive, engine };
}

beforeEach(() => {
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

describe('AccountGate', () => {
  it('a token is `verifying` and gives nothing until confirmed', () => {
    const { auth, gate } = setup();
    expect(gate.state()).toEqual({ kind: 'verifying' });
    expect(gate.token()).toBeUndefined();
    gate.confirm('T1');
    expect(gate.state()).toEqual(auth.state());
    expect(gate.token()).toBe('T1');
  });

  it('a new token (maybe another account) is not used until it is confirmed too', () => {
    const { auth, gate } = setup();
    gate.confirm('T1');
    const seen: string[] = [];
    gate.onChange((s) => seen.push(s.kind));
    auth.set(tokenOf('T2'));
    expect(seen).toEqual(['verifying']);
    expect(gate.token()).toBeUndefined();
    gate.confirm('T2');
    expect(seen).toEqual(['verifying', 'signedIn']);
    expect(gate.token()).toBe('T2');
  });

  it('a token confirmed before it becomes current counts once it does', () => {
    const { auth, gate } = setup();
    gate.confirm('T2');
    expect(gate.state()).toEqual({ kind: 'verifying' });
    auth.set(tokenOf('T2'));
    expect(gate.token()).toBe('T2');
  });

  it('other states pass through', () => {
    const { auth, gate } = setup();
    auth.set({ kind: 'needsGesture' });
    expect(gate.state()).toEqual({ kind: 'needsGesture' });
  });
});

describe('the engine behind the gate', () => {
  it('never touches Drive with an unconfirmed token; starts once it is confirmed', async () => {
    const t = setup();
    await t.store.createNew('plan.canvas', 'board', '{}');
    await t.engine.start();
    await settle();
    expect(t.drive.log).toEqual([]);
    expect(t.engine.status()).toEqual({ kind: 'notSynced', detail: 'checking' });

    t.gate.confirm('T1');
    await settle();
    expect(t.drive.count('listAll')).toBe(1);
    expect(t.drive.textOf('plan.canvas')).toBe('{}');
    expect(t.engine.status()).toEqual({ kind: 'synced' });
  });

  it('stops at a token of another account that comes later', async () => {
    const t = setup();
    t.gate.confirm('T1');
    await t.engine.start();
    await settle();
    const calls = t.drive.log.length;

    t.auth.set(tokenOf('OTHER'));
    await t.store.createNew('plan.canvas', 'board', '{}');
    t.engine.syncNow();
    await vi.advanceTimersByTimeAsync(60_000);
    await settle();
    expect(t.drive.log.length).toBe(calls);
    expect(t.engine.status()).toEqual({ kind: 'notSynced', detail: 'checking' });
  });
});

describe('SyncCoordinator', () => {
  const coordinator = (t: ReturnType<typeof setup>, opts: ConstructorParameters<typeof SyncCoordinator>[3] = {}) => {
    const channel = new FakeChannel();
    const c = new SyncCoordinator(t.engine, channel, 'acct1', opts);
    return { c, channel };
  };

  it('does not broadcast a sign-in by itself', async () => {
    const t = setup();
    const { c, channel } = coordinator(t);
    c.start();
    t.auth.set(tokenOf('T2'));
    await settle();
    expect(channel.sent.some((m) => (m as { type: string }).type === 'token')).toBe(false);
  });

  it('shares a token with its account; the leader passes it on, account and all', async () => {
    const t = setup();
    const got: [string, number, string][] = [];
    const { c, channel } = coordinator(t, { onToken: (...args) => got.push(args) });
    c.start();
    await settle();
    c.shareToken('T9', 123, 'acct1');
    expect(channel.sent).toContainEqual({ type: 'token', token: 'T9', expiresAt: 123, account: 'acct1', space: 'acct1' });

    channel.receive({ type: 'token', token: 'T9', expiresAt: 123, account: 'acct1', space: 'acct1' });
    channel.receive({ type: 'token', token: 'T8', expiresAt: 123, space: 'acct1' });
    expect(got).toEqual([['T9', 123, 'acct1']]);
  });

  it('ignores the messages of another space', async () => {
    const t = setup();
    const got: string[] = [];
    const { c, channel } = coordinator(t, { onToken: (token) => got.push(token) });
    c.start();
    await settle();
    channel.receive({ type: 'token', token: 'T9', expiresAt: 123, account: 'acct2', space: 'acct2' });
    channel.receive({ type: 'status', status: { kind: 'synced' }, space: 'acct2' });
    expect(got).toEqual([]);
    expect(c.status()).toEqual(t.engine.status());
  });

  it('takes the lock of its own space and tells the leader hook first', async () => {
    const t = setup();
    const names: string[] = [];
    const order: string[] = [];
    const locks = { request: (name: string, cb: () => Promise<unknown>) => (names.push(name), cb()) };
    const { c } = coordinator(t, { locks, onLeader: () => order.push('leader') });
    c.start();
    await settle();
    expect(names).toEqual(['konekton-sync:acct1']);
    expect(order).toEqual(['leader']);
  });

  it('a sign-out in another tab reaches every tab, whatever its space', () => {
    const t = setup();
    let signedOut = 0;
    const { c, channel } = coordinator(t, { onSignOut: () => signedOut++ });
    c.start();
    channel.receive({ type: 'signOut' });
    expect(signedOut).toBe(1);
    c.signOutOthers();
    expect(channel.sent).toContainEqual({ type: 'signOut' });
  });
});
