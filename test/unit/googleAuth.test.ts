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

function setup(
  opts: { hint?: string; token?: { token: string; expiresAt: number }; now?: number; storage?: MemoryStorage; local?: MemoryStorage; href?: string } = {},
) {
  const storage = opts.storage ?? new MemoryStorage();
  const local = opts.local ?? new MemoryStorage();
  const page = { href: opts.href ?? 'https://app.test/konekton/?board=b1', replaced: [] as string[], went: [] as string[] };
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
  const revoked: string[] = [];
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
    page: {
      href: () => page.href,
      replace: (url) => void page.replaced.push(url),
      go: (url) => void page.went.push(url),
    },
    redirectUri: 'https://app.test/konekton/',
    random: () => 'S1',
    revoke: (t) => void revoked.push(t),
  });
  const runTimers = () => {
    for (const t of timers.splice(0)) if (!t.cleared) t.fn();
  };
  const states: AuthState[] = [];
  auth.onChange((s) => states.push(s));
  return { auth, storage, local, target, clock, requests, cfg, states, runTimers, page, revoked };
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

  it('a popup that failed to open needs a reconnect, which then signs in on Google\'s page', () => {
    const a = setup({ hint: 'me@example.com' });
    a.target.fire('pointerdown');
    a.cfg.error_callback?.({ type: 'popup_failed_to_open' });
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'The browser blocked the Google window. Reconnect signs in on this page instead.' });
    a.auth.signIn();
    expect(a.requests).toHaveLength(1);
    expect(a.page.went).toHaveLength(1);
  });

  it('a popup closed without a token switches this browser to the sign-in on Google\'s page', () => {
    const a = setup({ hint: 'me@example.com' });
    a.target.fire('pointerdown');
    a.cfg.error_callback?.({ type: 'popup_closed' });
    a.runTimers();
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'The Google window closed without signing in. Reconnect signs in on this page instead.' });
    a.auth.signIn();
    expect(a.requests).toHaveLength(1);
    const url = new URL(a.page.went[0]);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'client',
      redirect_uri: 'https://app.test/konekton/',
      response_type: 'token',
      scope: 'https://www.googleapis.com/auth/drive.file',
      include_granted_scopes: 'true',
      state: 'S1',
      login_hint: 'me@example.com',
    });
    expect(JSON.parse(a.storage.getItem('konekton.google.pending') ?? '')).toEqual({ state: 'S1', back: '/konekton/?board=b1' });
  });

  it('back from Google\'s page: takes the token, restores the address and keeps the token', () => {
    const storage = new MemoryStorage();
    storage.setItem('konekton.google.pending', JSON.stringify({ state: 'S1', back: '/konekton/?board=b1' }));
    const href = 'https://app.test/konekton/#state=S1&access_token=T5&token_type=Bearer&expires_in=3599&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file';
    const a = setup({ storage, href });
    expect(a.auth.state()).toMatchObject({ kind: 'signedIn', token: 'T5', expiresAt: 1_000_000 + 3_599_000 });
    expect(a.page.replaced).toEqual(['/konekton/?board=b1']);
    expect(storage.getItem('konekton.google.pending')).toBeNull();
    expect(JSON.parse(storage.getItem('konekton.google.token') ?? '')).toMatchObject({ token: 'T5' });
  });

  it('back from Google\'s page with a wrong state or a refusal: no token', () => {
    const storage = new MemoryStorage();
    storage.setItem('konekton.google.pending', JSON.stringify({ state: 'S1', back: '/konekton/' }));
    const wrong = setup({ storage, href: 'https://app.test/konekton/#state=EVIL&access_token=T6&expires_in=3599' });
    expect(wrong.auth.state().kind).toBe('needsReconnect');
    expect(wrong.auth.token()).toBeUndefined();
    storage.setItem('konekton.google.pending', JSON.stringify({ state: 'S1', back: '/konekton/' }));
    const refused = setup({ storage, href: 'https://app.test/konekton/#state=S1&error=access_denied' });
    expect(refused.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'Sign-in was cancelled.' });
  });

  it('with the page sign-in an ended token waits for Reconnect, not for any click', () => {
    const local = new MemoryStorage();
    local.setItem('konekton.google.redirect', '1');
    const a = setup({ hint: 'me@example.com', local });
    expect(a.auth.state()).toEqual({ kind: 'needsReconnect', reason: 'The Google sign-in ended (it lasts an hour).' });
    expect(a.target.count()).toBe(0);
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
    expect(a.revoked).toEqual(['T1']);
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
