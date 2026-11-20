/** The only scope: files this app created. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export type AuthState =
  | { kind: 'signedOut' }
  | { kind: 'signedIn'; token: string; expiresAt: number; email?: string }
  | { kind: 'needsGesture' }
  | { kind: 'needsReconnect'; reason: string };

const TOKEN_KEY = 'konekton.google.token';
const HINT_KEY = 'konekton.google.hint';
/** A token counts as ended this long before its end time. */
const MARGIN_MS = 60_000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface EventTargetLike {
  addEventListener(type: string, listener: () => void, capture?: boolean): void;
  removeEventListener(type: string, listener: () => void, capture?: boolean): void;
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
}

function withDefaults(d: Partial<GoogleAuthDeps>): GoogleAuthDeps {
  return {
    now: d.now ?? (() => Date.now()),
    storage: d.storage ?? sessionStorage,
    local: d.local ?? localStorage,
    gis: d.gis ?? (() => window.google?.accounts.oauth2),
    target: d.target ?? window,
  };
}

/**
 * Google sign-in with the browser-only token client: no refresh token, no server. A token lasts about an hour;
 * a new one needs a user gesture, so after the end the next click or key press asks for it again.
 */
export class GoogleAuth {
  private readonly deps: GoogleAuthDeps;
  private readonly listeners = new Set<(s: AuthState) => void>();
  private current: AuthState = { kind: 'signedOut' };
  private client: GisTokenClient | undefined;
  private gestureListening = false;

  constructor(
    private readonly clientId: string,
    deps: Partial<GoogleAuthDeps> = {},
  ) {
    this.deps = withDefaults(deps);
    const stored = this.readToken();
    if (stored && this.deps.now() < stored.expiresAt - MARGIN_MS) this.current = { kind: 'signedIn', token: stored.token, expiresAt: stored.expiresAt, email: this.hint() };
    else if (this.hint() !== undefined) {
      this.current = { kind: 'needsGesture' };
      this.listenForGesture();
    }
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
      callback: (r) => this.onToken(r),
      error_callback: (e) => {
        if (e.type === 'popup_failed_to_open') this.set({ kind: 'needsReconnect', reason: 'The browser blocked the Google window.' });
        else if (e.type === 'popup_closed') this.set({ kind: 'needsReconnect', reason: 'Sign-in was closed.' });
        else this.set({ kind: 'needsReconnect', reason: e.message ?? 'Sign-in failed.' });
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
    const client = this.tokenClient();
    if (!client) {
      this.set({ kind: 'needsReconnect', reason: 'Google sign-in is not loaded.' });
      return;
    }
    const hint = this.hint();
    client.requestAccessToken(hint !== undefined ? { prompt, login_hint: hint } : { prompt });
  }

  /** From a click. The first time Google shows its account list; later `login_hint` skips it. */
  signIn(): void {
    this.stopGestureListening();
    this.request(this.hint() === undefined ? 'select_account' : '');
  }

  /** Forget token and account. The Google session and the consent stay. */
  signOut(): void {
    this.stopGestureListening();
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
    this.listenForGesture();
    this.set({ kind: 'needsGesture' });
  }

  private readonly onGesture = (): void => {
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
