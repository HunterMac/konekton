import type { GoogleAuth } from './googleAuth';
import type { EngineAuthState } from './syncEngine';

/**
 * The sign-in as the sync engine of one space sees it. A token counts only after Drive said it belongs to the account
 * of that space (`confirm`); until then the state is `verifying` and `token()` gives nothing. So a token of another
 * account (a different account picked in the Google window, a token of another tab) never reads or writes this space.
 */
export class AccountGate {
  /** A set, not one token: a token confirmed for another tab may arrive here before or after it becomes current. */
  private readonly confirmed = new Set<string>();
  private readonly listeners = new Set<(s: EngineAuthState) => void>();

  constructor(private readonly auth: Pick<GoogleAuth, 'state' | 'onChange' | 'token' | 'rejected'>) {
    auth.onChange(() => this.emit());
  }

  /** Drive said `token` belongs to the account of this space. */
  confirm(token: string): void {
    if (this.confirmed.has(token)) return;
    this.confirmed.add(token);
    this.emit();
  }

  isConfirmed(token: string): boolean {
    return this.confirmed.has(token);
  }

  state(): EngineAuthState {
    const s = this.auth.state();
    return s.kind === 'signedIn' && !this.confirmed.has(s.token) ? { kind: 'verifying' } : s;
  }

  onChange(listener: (s: EngineAuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The current token, only when confirmed. */
  token(): string | undefined {
    const token = this.auth.token();
    return token !== undefined && this.confirmed.has(token) ? token : undefined;
  }

  rejected(): void {
    this.auth.rejected();
  }

  private emit(): void {
    const s = this.state();
    for (const l of [...this.listeners]) l(s);
  }
}
