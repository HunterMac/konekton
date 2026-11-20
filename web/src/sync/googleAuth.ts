/** The only scope: files this app created. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export type AuthState =
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; token: string; expiresAt: number; email?: string }
  | { kind: 'needsGesture' }
  | { kind: 'needsReconnect'; reason: string };

const TOKEN_KEY = 'konekton.google.token';
const HINT_KEY = 'konekton.google.hint';
/** Set once the Google window failed in this browser: sign-in then leaves the page for Google and comes back. */
const REDIRECT_KEY = 'konekton.google.redirect';
/** The `state` of a sign-in on Google's page and the address to come back to. */
const PENDING_KEY = 'konekton.google.pending';
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** A token counts as ended this long before its end time. */
const MARGIN_MS = 60_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface EventTargetLike {
  addEventListener(type: string, listener: (e?: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (e?: Event) => void, capture?: boolean): void;
}

interface PageLike {
  href(): string;
  /** Change the address without loading a page. */
  replace(url: string): void;
  /** Leave for another page. */
  go(url: string): void;
}

export interface GoogleAuthDeps {
  now(): number;
  /** Token, for the length of the tab session. */
  storage: StorageLike;
  /** The last account (`login_hint`). */
  local: StorageLike;
  gis(): GisOauth2 | undefined;
  /** Where the click and key listeners go (`window`). */
  target: EventTargetLike;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  log(message: string): void;
  page: PageLike;
  /** Where Google's page sends the token back. Listed under "Authorized redirect URIs" of the OAuth client. */
  redirectUri: string;
  random(): string;
  /** End the token at Google. Must survive the reload that follows a sign-out. */
  revoke(token: string): void;
}

const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

function withDefaults(d: Partial<GoogleAuthDeps>): GoogleAuthDeps {
  return {
    now: d.now ?? (() => Date.now()),
    storage: d.storage ?? sessionStorage,
    local: d.local ?? localStorage,
    gis: d.gis ?? (() => window.google?.accounts.oauth2),
    target: d.target ?? window,
    setTimer: d.setTimer ?? ((fn, ms) => setTimeout(fn, ms)),
    clearTimer: d.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>)),
    log: d.log ?? ((m) => console.info(`[konekton] ${m}`)),
    page: d.page ?? {
      href: () => window.location.href,
      replace: (url) => history.replaceState(null, '', url),
      go: (url) => window.location.assign(url),
    },
    redirectUri: d.redirectUri ?? `${window.location.origin}${import.meta.env.BASE_URL}`,
    random: d.random ?? (() => crypto.randomUUID()),
    revoke:
      d.revoke ??
      ((token) => {
        // `keepalive`: the page reloads right after.
        void fetch(REVOKE_URL, { method: 'POST', body: new URLSearchParams({ token }), keepalive: true }).catch(() => undefined);
      }),
  };
}

/**
 * How long a "popup closed" report waits for the token. Google's library cannot always see the popup (the
 * Cross-Origin-Opener-Policy of Google's page blocks `window.closed`), and may report it closed although the token
 * is on its way.
 */
const CLOSED_GRACE_MS = 3000;

/**
 * Google sign-in with the browser-only token client: no refresh token, no server. A token lasts about an hour;
 * a new one needs a user gesture, so after the end the next click or key press asks for it again.
 * Some browsers never pass the token from Google's window back to the page; after one such failure, sign-in
 * goes through Google's page in this tab instead (the token comes back in the address, `#access_token=...`).
 */
export class GoogleAuth {
  private readonly deps: GoogleAuthDeps;
  private readonly listeners = new Set<(s: AuthState) => void>();
  private current: AuthState = { kind: 'signedOut' };
  private client: GisTokenClient | undefined;
  private gestureListening = false;
  private closedTimer: unknown;
  /** Google answered the current request (token or error). */
  private answered = false;

  constructor(
    private readonly clientId: string,
    deps: Partial<GoogleAuthDeps> = {},
  ) {
    this.deps = withDefaults(deps);
    if (this.takeRedirectAnswer()) return;
    const stored = this.readToken();
    if (stored && this.deps.now() < stored.expiresAt - MARGIN_MS) this.current = { kind: 'signedIn', token: stored.token, expiresAt: stored.expiresAt, email: this.hint() };
    else if (this.hint() !== undefined) this.waitForGesture();
  }

  /** Back from Google's page: take the token out of the address and restore the address of before. */
  private takeRedirectAnswer(): boolean {
    const url = new URL(this.deps.page.href());
    const answer = new URLSearchParams(url.hash.slice(1));
    if (!answer.has('state') || !(answer.has('access_token') || answer.has('error'))) return false;
    let pending: { state?: unknown; back?: unknown } | undefined;
    try {
      pending = JSON.parse(this.deps.storage.getItem(PENDING_KEY) ?? 'null') ?? undefined;
      this.deps.storage.removeItem(PENDING_KEY);
    } catch {
      pending = undefined;
    }
    this.deps.page.replace(typeof pending?.back === 'string' ? pending.back : `${url.pathname}${url.search}`);
    if (pending?.state !== answer.get('state')) {
      this.deps.log('sign-in answer: unknown state');
      this.set({ kind: 'needsReconnect', reason: 'The answer from Google does not belong to this page. Sign in again.' });
      return true;
    }
    const error = answer.get('error') ?? undefined;
    this.deps.log(`sign-in answer (page): ${error ? `error ${error}` : `token, scope "${answer.get('scope') ?? ''}"`}`);
    this.onToken({
      access_token: answer.get('access_token') ?? undefined,
      expires_in: Number(answer.get('expires_in') ?? 3600),
      scope: answer.get('scope') ?? undefined,
      error: error,
      error_description: error === 'access_denied' ? 'Sign-in was cancelled.' : undefined,
    });
    return true;
  }

  private usesRedirect(): boolean {
    try {
      return this.deps.local.getItem(REDIRECT_KEY) !== null;
    } catch {
      return false;
    }
  }

  /** The Google window failed in this browser: from now on sign in through Google's page. */
  private switchToRedirect(reason: string): void {
    try {
      this.deps.local.setItem(REDIRECT_KEY, '1');
    } catch {
      // Not kept: the next sign-in tries the window again.
    }
    this.set({ kind: 'needsReconnect', reason: `${reason} Reconnect signs in on this page instead.` });
  }

  /** Leave for Google's sign-in page; it comes back to `redirectUri` with the token. */
  private redirect(prompt: string): void {
    const state = this.deps.random();
    const href = new URL(this.deps.page.href());
    try {
      this.deps.storage.setItem(PENDING_KEY, JSON.stringify({ state, back: `${href.pathname}${href.search}` }));
    } catch {
      this.set({ kind: 'needsReconnect', reason: 'This browser does not allow the storage the sign-in needs.' });
      return;
    }
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.deps.redirectUri,
      response_type: 'token',
      scope: DRIVE_SCOPE,
      include_granted_scopes: 'true',
      state,
    });
    if (prompt) params.set('prompt', prompt);
    const hint = this.hint();
    if (hint !== undefined) params.set('login_hint', hint);
    this.deps.log('sign-in requested (page)');
    this.deps.page.go(`${GOOGLE_AUTH_URL}?${params.toString()}`);
  }

  state(): AuthState {
    return this.current;
  }

  onChange(listener: (s: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(next: AuthState): void {
    this.current = next;
    for (const l of [...this.listeners]) l(next);
  }

  private readToken(): { token: string; expiresAt: number } | undefined {
    try {
      const raw = this.deps.storage.getItem(TOKEN_KEY);
      if (!raw) return undefined;
      const v = JSON.parse(raw) as { token?: unknown; expiresAt?: unknown };
      return typeof v.token === 'string' && typeof v.expiresAt === 'number' ? { token: v.token, expiresAt: v.expiresAt } : undefined;
    } catch {
      return undefined;
    }
  }

  private hint(): string | undefined {
    try {
      return this.deps.local.getItem(HINT_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  }

  /** Remember the account of the token (the page learns it from Drive after sign-in). */
  setEmail(email: string): void {
    try {
      this.deps.local.setItem(HINT_KEY, email);
    } catch {
      // Storage refused: the hint is only a convenience.
    }
    if (this.current.kind === 'signedIn') this.set({ ...this.current, email });
  }

  private tokenClient(): GisTokenClient | undefined {
    if (this.client) return this.client;
    const oauth2 = this.deps.gis();
    if (!oauth2) return undefined;
    this.client = oauth2.initTokenClient({
      client_id: this.clientId,
      scope: DRIVE_SCOPE,
      callback: (r) => {
        this.deps.log(`sign-in answer: ${r.error ? `error ${r.error}` : `token, scope "${r.scope ?? ''}"`}`);
        this.answered = true;
        this.clearClosedTimer();
        this.onToken(r);
      },
      error_callback: (e) => {
        this.deps.log(`sign-in error: ${e.type}${e.message ? ` (${e.message})` : ''}`);
        if (e.type === 'popup_failed_to_open') this.switchToRedirect('The browser blocked the Google window.');
        else if (e.type === 'popup_closed') {
          // A token that came first wins; one that comes soon after cancels the timer.
          if (this.answered) return;
          this.clearClosedTimer();
          // Closed by the person, or the browser kept the token from the page: both look the same here.
          this.closedTimer = this.deps.setTimer(() => {
            this.closedTimer = undefined;
            this.switchToRedirect('The Google window closed without signing in.');
          }, CLOSED_GRACE_MS);
        } else this.set({ kind: 'needsReconnect', reason: e.message ?? 'Sign-in failed.' });
      },
    });
    return this.client;
  }

  private onToken(r: GisTokenResponse): void {
    if (r.error || !r.access_token) {
      this.set({ kind: 'needsReconnect', reason: r.error_description ?? r.error ?? 'Sign-in failed.' });
      return;
    }
    // Google's consent screen lets the person untick Drive; the token then works for nothing here.
    if (r.scope !== undefined && !r.scope.split(' ').includes(DRIVE_SCOPE)) {
      this.set({ kind: 'needsReconnect', reason: 'Google Drive access was not allowed. Sign in again and tick the Google Drive box.' });
      return;
    }
    const expiresAt = this.deps.now() + (r.expires_in ?? 3600) * 1000;
    try {
      this.deps.storage.setItem(TOKEN_KEY, JSON.stringify({ token: r.access_token, expiresAt }));
    } catch {
      // Not kept across reloads.
    }
    this.stopGestureListening();
    this.set({ kind: 'signedIn', token: r.access_token, expiresAt, email: this.hint() });
  }

  /** Ask for a token. Call it from a click or key press: the popup needs the user activation of that event. */
  private request(prompt: string): void {
    if (this.usesRedirect()) {
      this.redirect(prompt);
      return;
    }
    const client = this.tokenClient();
    if (!client) {
      this.set({ kind: 'needsReconnect', reason: 'Google sign-in is not loaded.' });
      return;
    }
    const hint = this.hint();
    this.answered = false;
    this.clearClosedTimer();
    this.deps.log('sign-in requested');
    client.requestAccessToken(hint !== undefined ? { prompt, login_hint: hint } : { prompt });
  }

  private clearClosedTimer(): void {
    if (this.closedTimer !== undefined) this.deps.clearTimer(this.closedTimer);
    this.closedTimer = undefined;
  }

  /** From a click. The first time Google shows its account list; later `login_hint` skips it. */
  signIn(): void {
    this.stopGestureListening();
    this.request(this.hint() === undefined ? 'select_account' : '');
  }

  /** Forget token and account, and end the token at Google (with it the consent: the next sign-in asks again). The Google session stays. */
  signOut(): void {
    this.stopGestureListening();
    // A token kept elsewhere (a restored tab keeps its session storage) must not work any more.
    const token = this.current.kind === 'signedIn' ? this.current.token : this.readToken()?.token;
    if (token !== undefined) this.deps.revoke(token);
    try {
      this.deps.storage.removeItem(TOKEN_KEY);
      this.deps.local.removeItem(HINT_KEY);
    } catch {
      // Nothing to forget.
    }
    this.set({ kind: 'signedOut' });
  }

  /** A valid token, or undefined after moving to `needsGesture`. Never opens a popup by itself. */
  token(): string | undefined {
    const s = this.current;
    if (s.kind !== 'signedIn') return undefined;
    if (this.deps.now() < s.expiresAt - MARGIN_MS) return s.token;
    this.needGesture();
    return undefined;
  }

  /** A token another tab of this browser got: use it instead of asking again. */
  adoptToken(token: string, expiresAt: number): void {
    if (this.current.kind === 'signedIn' && this.current.token === token) return;
    if (this.deps.now() >= expiresAt - MARGIN_MS) return;
    this.onToken({ access_token: token, expires_in: (expiresAt - this.deps.now()) / 1000 });
  }

  /** Signed in, but Drive cannot be used (refused, not enabled, ...): forget the token and show why. */
  failed(reason: string): void {
    try {
      this.deps.storage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing to forget.
    }
    this.stopGestureListening();
    this.set({ kind: 'needsReconnect', reason });
  }

  /** Drive answered 401: forget the token, move to `needsGesture`. */
  rejected(): void {
    try {
      this.deps.storage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing to forget.
    }
    this.needGesture();
  }

  private needGesture(): void {
    if (this.current.kind === 'signedOut') return;
    try {
      this.deps.storage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing to forget.
    }
    this.waitForGesture();
  }

  /** The token ended. The Google window opens on the next gesture; a page sign-in waits for the Reconnect button. */
  private waitForGesture(): void {
    if (this.usesRedirect()) {
      this.set({ kind: 'needsReconnect', reason: 'The Google sign-in ended (it lasts an hour).' });
      return;
    }
    this.listenForGesture();
    this.set({ kind: 'needsGesture' });
  }

  private readonly onGesture = (e?: Event): void => {
    // "Sign out" and the like must not open the Google window first.
    const target = e?.target;
    if (typeof Element !== 'undefined' && target instanceof Element && target.closest('[data-no-reconnect]')) return;
    this.stopGestureListening();
    // Synchronous, inside the event handler: the popup needs its user activation.
    this.request('');
  };

  private listenForGesture(): void {
    if (this.gestureListening) return;
    this.gestureListening = true;
    this.deps.target.addEventListener('keydown', this.onGesture, true);
    this.deps.target.addEventListener('pointerdown', this.onGesture, true);
  }

  private stopGestureListening(): void {
    if (!this.gestureListening) return;
    this.gestureListening = false;
    this.deps.target.removeEventListener('keydown', this.onGesture, true);
    this.deps.target.removeEventListener('pointerdown', this.onGesture, true);
  }
}
