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
  fire(type: string, event?: Event) {
    for (const fn of [...(this.handlers.get(type) ?? [])]) (fn as (e?: Event) => void)(event);
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
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const auth = new GoogleAuth('client', {
    now: () => clock.now,
    storage,
    local,
    gis: () => gis,
    target,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
    log: () => undefined,
  });
  const runTimers = () => {
    for (const t of timers.splice(0)) if (!t.cleared) t.fn();
  };
  const states: AuthState[] = [];
  auth.onChange((s) => states.push(s));
  return { auth, storage, local, target, clock, requests, cfg, states, runTimers };
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

  it('a token without the Drive scope (box unticked) needs a reconnect and is not kept', () => {
    const a = setup();
    a.auth.signIn();
    a.cfg.callback?.({ access_token: 'T1', expires_in: 3600, scope: 'openid email' });
    expect(a.auth.state()).toMatchObject({ kind: 'needsReconnect' });
    expect(a.auth.token()).toBeUndefined();
    expect(a.storage.getItem('konekton.google.token')).toBeNull();
    a.auth.signIn();
    a.cfg.callback?.({ access_token: 'T2', expires_in: 3600, scope: 'https://www.googleapis.com/auth/drive.file' });
    expect(a.auth.token()).toBe('T2');
  });

  it('failed() drops the token and shows the reason', () => {
    const a = setup();
    a.auth.signIn();
    a.cfg.callback?.({ access_token: 'T1', expires_in: 3600 });
    a.auth.failed('Signed in, but Drive refused: x');
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'Signed in, but Drive refused: x' });
    expect(a.auth.token()).toBeUndefined();
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

  it('a click on a [data-no-reconnect] element (Sign out) does not open the Google window', () => {
    const a = setup({ hint: 'me@example.com' });
    const inside = { closest: (sel: string) => (sel === '[data-no-reconnect]' ? {} : null) };
    const ElementLike = class {};
    Object.setPrototypeOf(inside, ElementLike.prototype);
    const g = globalThis as { Element?: unknown };
    const had = g.Element;
    g.Element = ElementLike;
    try {
      a.target.fire('pointerdown', { target: inside } as unknown as Event);
      expect(a.requests).toEqual([]);
      expect(a.target.count()).toBe(2);
      a.target.fire('pointerdown');
      expect(a.requests).toHaveLength(1);
    } finally {
      g.Element = had;
    }
  });

  it('a popup that failed to open needs a reconnect', () => {
    const a = setup({ hint: 'me@example.com' });
    a.target.fire('pointerdown');
    a.cfg.error_callback?.({ type: 'popup_failed_to_open' });
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'The browser blocked the Google window.' });
    a.cfg.error_callback?.({ type: 'popup_closed' });
    a.runTimers();
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'Sign-in was closed.' });
  });

  it('"popup closed" right before or after the token does not undo the sign-in', () => {
    const a = setup();
    a.auth.signIn();
    a.cfg.error_callback?.({ type: 'popup_closed' });
    a.cfg.callback?.({ access_token: 'T1', expires_in: 3600 });
    a.runTimers();
    expect(a.auth.state()).toMatchObject({ kind: 'signedIn', token: 'T1' });
    a.cfg.error_callback?.({ type: 'popup_closed' });
    a.runTimers();
    expect(a.auth.state()).toMatchObject({ kind: 'signedIn', token: 'T1' });
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
