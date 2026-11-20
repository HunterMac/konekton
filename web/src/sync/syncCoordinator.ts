import type { GoogleAuth } from './googleAuth';
import type { ChannelLike } from './localStore';
import { statusEquals, type SyncControl, type SyncEngine, type SyncStatus } from './syncEngine';

export const LOCK_NAME = 'konekton-sync';

type Message =
  | { type: 'status'; status: SyncStatus }
  | { type: 'hello' }
  | { type: 'syncNow' }
  | { type: 'focus' }
  | { type: 'online' }
  | { type: 'token'; token: string; expiresAt: number }
  | { type: 'reload' };

interface LockManagerLike {
  request(name: string, callback: () => Promise<unknown>): Promise<unknown>;
}

/**
 * One tab per browser runs the `SyncEngine`: the one that holds the Web Lock. The other tabs show its status and
 * pass `syncNow`, focus and tokens to it through a `BroadcastChannel`. When the leader closes, the next tab takes over.
 */
export class SyncCoordinator implements SyncControl {
  private leader = false;
  private mirrored: SyncStatus = { kind: 'notSynced', detail: 'checking' };
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private lastToken: string | undefined;

  constructor(
    private readonly engine: SyncEngine,
    private readonly auth: GoogleAuth,
    private readonly channel: ChannelLike,
    private readonly opts: { locks?: LockManagerLike; onReload?: () => void } = {},
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
    this.auth.onChange((s) => {
      if (s.kind !== 'signedIn' || s.token === this.lastToken) return;
      this.lastToken = s.token;
      this.post({ type: 'token', token: s.token, expiresAt: s.expiresAt });
    });
    const becomeLeader = async (): Promise<never> => {
      this.leader = true;
      await this.engine.start();
      this.emit(this.engine.status());
      this.post({ type: 'status', status: this.engine.status() });
      // Hold the lock until this tab closes.
      return new Promise<never>(() => undefined);
    };
    if (this.opts.locks) {
      void this.opts.locks.request(LOCK_NAME, becomeLeader);
      this.post({ type: 'hello' });
    } else {
      void becomeLeader();
    }
  }

  /** Another tab of this browser must reload (the account changed). */
  reloadOthers(): void {
    this.post({ type: 'reload' });
  }

  private post(m: Message): void {
    this.channel.postMessage(m);
  }

  private emit(s: SyncStatus): void {
    for (const l of [...this.listeners]) l(s);
  }

  private onMessage(m: Message | undefined): void {
    if (!m || typeof m !== 'object') return;
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
        if (this.leader) {
          this.lastToken = m.token;
          this.auth.adoptToken(m.token, m.expiresAt);
        }
        break;
      case 'reload':
        this.opts.onReload?.();
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
