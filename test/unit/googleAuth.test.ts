import { describe, expect, it } from 'vitest';
import { GoogleAuth, type AuthState } from '../../web/src/sync/googleAuth';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

class FakeTarget {
  readonly handlers = new Map<string, Set<() => void>>();
  addEventListener(type: string, fn: () => void) {
    this.handlers.set(type, (this.handlers.get(type) ?? new Set()).add(fn));
  }
  removeEventListener(type: string, fn: () => void) {
    this.handlers.get(type)?.delete(fn);
  }
  fire(type: string) {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn();
  }
  count(): number {
    return [...this.handlers.values()].reduce((sum, s) => sum + s.size, 0);
  }
}

function setup(opts: { hint?: string; token?: { token: string; expiresAt: number }; now?: number } = {}) {
  const storage = new MemoryStorage();
  const local = new MemoryStorage();
  const target = new FakeTarget();
  const clock = { now: opts.now ?? 1_000_000 };
  if (opts.hint) local.setItem('konekton.google.hint', opts.hint);
  if (opts.token) storage.setItem('konekton.google.token', JSON.stringify(opts.token));
  const requests: { prompt?: string; login_hint?: string }[] = [];
  const cfg: { callback?: (r: GisTokenResponse) => void; error_callback?: (e: GisTokenError) => void } = {};
  const gis: GisOauth2 = {
    initTokenClient(c) {
      cfg.callback = c.callback;
      cfg.error_callback = c.error_callback;
      return { requestAccessToken: (o) => void requests.push(o ?? {}) };
    },
    revoke: () => undefined,
  };
  const auth = new GoogleAuth('client', { now: () => clock.now, storage, local, gis: () => gis, target });
  const states: AuthState[] = [];
  auth.onChange((s) => states.push(s));
  return { auth, storage, local, target, clock, requests, cfg, states };
}

describe('GoogleAuth', () => {
  it('starts signed out without token and hint', () => {
    expect(setup().auth.state().kind).toBe('signedOut');
  });

  it('stores the token and restores it from the session storage', () => {
    const a = setup();
    a.auth.signIn();
    expect(a.requests).toEqual([{ prompt: 'select_account' }]);
    a.cfg.callback?.({ access_token: 'T1', expires_in: 3600 });
    expect(a.auth.state()).toMatchObject({ kind: 'signedIn', token: 'T1', expiresAt: 1_000_000 + 3_600_000 });
    expect(a.auth.token()).toBe('T1');
    const b = setup({ token: { token: 'T1', expiresAt: a.clock.now + 3_600_000 }, now: a.clock.now + 1000 });
    expect(b.auth.state().kind).toBe('signedIn');
    expect(b.auth.token()).toBe('T1');
  });

  it('counts the token as ended 60 s early and then waits for a gesture', () => {
    const a = setup();
    a.auth.signIn();
    a.cfg.callback?.({ access_token: 'T1', expires_in: 3600 });
    a.clock.now += 3_600_000 - 61_000;
    expect(a.auth.token()).toBe('T1');
    a.clock.now += 2000;
    expect(a.auth.token()).toBeUndefined();
    expect(a.auth.state().kind).toBe('needsGesture');
    expect(a.target.count()).toBe(2);
  });

  it('the first keydown asks for a token with prompt "" and the login hint, then stops listening', () => {
    const a = setup({ hint: 'me@example.com' });
    expect(a.auth.state().kind).toBe('needsGesture');
    expect(a.target.count()).toBe(2);
    a.target.fire('keydown');
    expect(a.requests).toEqual([{ prompt: '', login_hint: 'me@example.com' }]);
    expect(a.target.count()).toBe(0);
  });

  it('a popup that failed to open needs a reconnect', () => {
    const a = setup({ hint: 'me@example.com' });
    a.target.fire('pointerdown');
    a.cfg.error_callback?.({ type: 'popup_failed_to_open' });
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'The browser blocked the Google window.' });
    a.cfg.error_callback?.({ type: 'popup_closed' });
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'Sign-in was closed.' });
  });

  it('signIn after the first time uses the hint and no account list', () => {
    const a = setup({ hint: 'me@example.com' });
    a.auth.signIn();
    expect(a.requests).toEqual([{ prompt: '', login_hint: 'me@example.com' }]);
  });

  it('signOut forgets token and hint', () => {
    const a = setup({ hint: 'me@example.com' });
    a.auth.signIn();
    a.cfg.callback?.({ access_token: 'T1', expires_in: 3600 });
    a.auth.signOut();
    expect(a.auth.state().kind).toBe('signedOut');
    expect(a.storage.getItem('konekton.google.token')).toBeNull();
    expect(a.local.getItem('konekton.google.hint')).toBeNull();
    expect(a.auth.token()).toBeUndefined();
    expect(setup().auth.state().kind).toBe('signedOut');
  });

  it('a 401 (rejected) forgets the token and waits for a gesture', () => {
    const a = setup();
    a.auth.signIn();
    a.cfg.callback?.({ access_token: 'T1', expires_in: 3600 });
    a.auth.rejected();
    expect(a.auth.state().kind).toBe('needsGesture');
    expect(a.storage.getItem('konekton.google.token')).toBeNull();
  });

  it('adopts a token of another tab', () => {
    const a = setup({ hint: 'me@example.com' });
    a.auth.adoptToken('T9', a.clock.now + 3_600_000);
    expect(a.auth.state()).toMatchObject({ kind: 'signedIn', token: 'T9' });
    expect(a.target.count()).toBe(0);
  });
});
