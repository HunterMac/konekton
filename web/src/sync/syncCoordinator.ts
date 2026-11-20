import type { ChannelLike } from './localStore';
import { statusEquals, type SyncControl, type SyncEngine, type SyncStatus } from './syncEngine';

/** The Web Lock of the engine of one space: tabs of two spaces (during an account change) each get their own leader. */
export const lockName = (space: string): string => `konekton-sync:${space}`;

type SpaceMessage =
  | { type: 'status'; status: SyncStatus }
  | { type: 'hello' }
  | { type: 'syncNow' }
  | { type: 'focus' }
  | { type: 'online' }
  /** `account`: the `permissionId` Drive gave for this token. */
  | { type: 'token'; token: string; expiresAt: number; account: string };

/** For every tab of the browser, whatever its space. */
type BrowserMessage = { type: 'reload' } | { type: 'signOut' };

type Message = (SpaceMessage & { space: string }) | BrowserMessage;

interface LockManagerLike {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

/**
 * One tab per space runs the `SyncEngine`: the one that holds the space's Web Lock. The other tabs show its status and
 * pass `syncNow`, focus and tokens to it through a `BroadcastChannel`. When the leader closes, the next tab takes over.
 */
export class SyncCoordinator implements SyncControl {
  private leader = false;
  private mirrored: SyncStatus = { kind: 'notSynced', detail: 'checking' };
  private readonly listeners = new Set<(s: SyncStatus) => void>();

  constructor(
    private readonly engine: SyncEngine,
    private readonly channel: ChannelLike,
    private readonly space: string,
    private readonly opts: {
      locks?: LockManagerLike;
      onReload?: () => void;
      /** Another tab signed out: forget the account here too (then reload). */
      onSignOut?: () => void;
      /** This tab runs the engine from now on (before the engine starts). */
      onLeader?: () => void;
      /** The leader got a token of another tab; the receiver checks `account` before it uses it. */
      onToken?: (token: string, expiresAt: number, account: string) => void;
    } = {},
  ) {}

  isLeader(): boolean {
    return this.leader;
  }

  start(): void {
    this.channel.onmessage = (e) => this.onMessage(e.data as Message);
    this.engine.onStatus((s) => {
      if (this.leader) {
        this.post({ type: 'status', status: s });
        this.emit(s);
      }
    });
    const becomeLeader = async (): Promise<never> => {
      this.leader = true;
      this.opts.onLeader?.();
      await this.engine.start();
      this.emit(this.engine.status());
      this.post({ type: 'status', status: this.engine.status() });
      // Hold the lock until this tab closes.
      return new Promise<never>(() => undefined);
    };
    if (this.opts.locks) {
      void this.opts.locks.request(lockName(this.space), becomeLeader);
      this.post({ type: 'hello' });
    } else {
      void becomeLeader();
    }
  }

  /** Pass a token whose account Drive confirmed to the leader, so it need not ask the person again. */
  shareToken(token: string, expiresAt: number, account: string): void {
    this.post({ type: 'token', token, expiresAt, account });
  }

  /** Another tab of this browser must reload (the account changed). */
  reloadOthers(): void {
    this.channel.postMessage({ type: 'reload' } satisfies Message);
  }

  /** Every other tab of this browser must sign out too: a tab left signed in would bring the account back. */
  signOutOthers(): void {
    this.channel.postMessage({ type: 'signOut' } satisfies Message);
  }

  private post(m: SpaceMessage): void {
    this.channel.postMessage({ ...m, space: this.space } satisfies Message);
  }

  private emit(s: SyncStatus): void {
    for (const l of [...this.listeners]) l(s);
  }

  private onMessage(m: Message | undefined): void {
    if (!m || typeof m !== 'object') return;
    if (m.type === 'reload') {
      this.opts.onReload?.();
      return;
    }
    if (m.type === 'signOut') {
      this.opts.onSignOut?.();
      return;
    }
    if (m.space !== this.space) return;
    switch (m.type) {
      case 'status':
        if (!this.leader && !statusEquals(this.mirrored, m.status)) {
          this.mirrored = m.status;
          this.emit(m.status);
        }
        break;
      case 'hello':
        if (this.leader) this.post({ type: 'status', status: this.engine.status() });
        break;
      case 'syncNow':
        if (this.leader) this.engine.syncNow();
        break;
      case 'focus':
        if (this.leader) this.engine.onFocus();
        break;
      case 'online':
        if (this.leader) this.engine.onOnline();
        break;
      case 'token':
        if (this.leader && typeof m.account === 'string') this.opts.onToken?.(m.token, m.expiresAt, m.account);
        break;
    }
  }

  status(): SyncStatus {
    return this.leader ? this.engine.status() : this.mirrored;
  }

  onStatus(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncNow(): void {
    if (this.leader) this.engine.syncNow();
    else this.post({ type: 'syncNow' });
  }

  onFocus(): void {
    if (this.leader) this.engine.onFocus();
    else this.post({ type: 'focus' });
  }

  onOnline(): void {
    if (this.leader) this.engine.onOnline();
    else this.post({ type: 'online' });
  }
}
