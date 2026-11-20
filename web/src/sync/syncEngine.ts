import { webCopyName } from '../../shared/boardNames';
import type { Dialogs } from '../ports/types';
import { fileCopyName } from './copyNames';
import { AuthError, GoneError, mimeOf, type DriveApi } from './driveApi';
import { buildTree, kindOfPath, pickRoot, ROOT_NAME, type DriveTree, type RemoteFile } from './driveTree';
import type { AuthState } from './googleAuth';
import type { Entry, LocalStore } from './localStore';

export const THROTTLE_MS = 15_000;
export const REFRESH_MS = 5 * 60_000;
const RETRY_FIRST_MS = 15_000;
const RETRY_MAX_MS = 5 * 60_000;
const META_LAST_REFRESH = 'lastRefreshAt';

export type SyncStatus =
  | { kind: 'synced' }
  | { kind: 'notSynced'; detail: 'signedOut' | 'waiting' | 'syncing' | 'checking' | 'needsGesture' | 'needsReconnect' | 'asking' | 'error'; message?: string };

export const statusEquals = (a: SyncStatus, b: SyncStatus): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What the page and the badge use; the engine itself or a mirror of the engine in another tab. */
export interface SyncControl {
  status(): SyncStatus;
  onStatus(listener: (s: SyncStatus) => void): () => void;
  syncNow(): void;
  onFocus(): void;
}

export interface SyncDeps {
  store: LocalStore;
  drive: DriveApi;
  auth: { state(): AuthState; onChange(listener: (s: AuthState) => void): () => void };
  dialogs: Dialogs;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  refreshMs?: number;
  throttleMs?: number;
  /** "Save my version as a copy" was chosen for `original`. */
  savedAsCopy?(original: string, copy: string): void;
}

type Op = 'push' | 'refresh';

const byPath = (a: { path: string }, b: { path: string }): number => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

/**
 * Keeps the local copy and Drive equal. One engine per browser (see `SyncCoordinator`).
 * Push: at once if nothing was synced for `throttleMs`, else `throttleMs` after the last sync; only while
 * something is unsynced. Refresh: on start, and on focus when the last one is older than `refreshMs`.
 * A push overwrites; it does not look at Drive first (a refresh finds outside changes).
 */
export class SyncEngine implements SyncControl {
  private readonly store: LocalStore;
  private readonly drive: DriveApi;
  private readonly throttleMs: number;
  private readonly refreshMs: number;

  private readonly dirty = new Set<string>();
  /** Paths with an open question: no sync for them. */
  private readonly open = new Set<string>();
  private readonly listeners = new Set<(s: SyncStatus) => void>();
  private readonly cleanups: (() => void)[] = [];
  private lastStatus: SyncStatus = { kind: 'notSynced', detail: 'checking' };

  private started = false;
  private lastSyncAt = Number.NEGATIVE_INFINITY;
  private lastRefreshAt = Number.NEGATIVE_INFINITY;
  private needRefresh = true;
  private syncing = false;
  /** Reading Drive for outside changes; the local copy itself has nothing to send. */
  private refreshing = false;
  private error: string | undefined;
  private attempt = 0;
  private pushTimer: unknown;
  private retryTimer: unknown;
  private retryOp: Op = 'push';

  private rootId: string | undefined;
  private folders = new Map<string, string>();
  private warnedPaths = new Set<string>();
  private warnedRoots = false;

  private readonly queue: Op[] = [];
  private draining = false;
  private questions: Promise<void> = Promise.resolve();

  constructor(private readonly deps: SyncDeps) {
    this.store = deps.store;
    this.drive = deps.drive;
    this.throttleMs = deps.throttleMs ?? THROTTLE_MS;
    this.refreshMs = deps.refreshMs ?? REFRESH_MS;
  }

  status(): SyncStatus {
    const a = this.deps.auth.state();
    if (a.kind === 'signedOut') return { kind: 'notSynced', detail: 'signedOut' };
    if (a.kind === 'needsGesture') return { kind: 'notSynced', detail: 'needsGesture' };
    if (a.kind === 'needsReconnect') return { kind: 'notSynced', detail: 'needsReconnect', message: a.reason };
    if (this.error !== undefined) return { kind: 'notSynced', detail: 'error', message: this.error };
    if (this.open.size > 0) return { kind: 'notSynced', detail: 'asking' };
    if (this.syncing) return { kind: 'notSynced', detail: 'syncing' };
    if (this.dirty.size > 0) return { kind: 'notSynced', detail: 'waiting' };
    if (this.refreshing || this.needRefresh) return { kind: 'notSynced', detail: 'checking' };
    return { kind: 'synced' };
  }

  onStatus(listener: (s: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emitStatus(): void {
    const next = this.status();
    if (statusEquals(next, this.lastStatus)) return;
    this.lastStatus = next;
    for (const l of [...this.listeners]) l(next);
  }

  private signedIn(): boolean {
    return this.deps.auth.state().kind === 'signedIn';
  }

  /** Refresh now, then follow the changes of the page and of the sign-in. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    // A question that was open when the page closed is asked again by the refresh.
    let hadQuestion = false;
    for (const e of await this.store.list()) {
      if (e.asking) {
        hadQuestion = true;
        await this.store.update(e.path, { asking: undefined });
      }
      if (!e.synced) this.dirty.add(e.path);
    }
    const lastRefresh = await this.store.getMeta<number>(META_LAST_REFRESH);
    if (typeof lastRefresh === 'number') this.lastRefreshAt = lastRefresh;
    // Every page of the app is its own load: a refresh from a moment ago (the previous page) is fresh enough,
    // unless a question was open then (only a refresh asks it again).
    if (this.deps.now() - this.lastRefreshAt < this.refreshMs && !hadQuestion) this.needRefresh = false;
    this.cleanups.push(
      this.store.onEvent((event) => {
        if (event.kind === 'removed') this.dirty.delete(event.path);
        else if (event.kind === 'changed') {
          if (event.synced) this.dirty.delete(event.path);
          else {
            this.dirty.add(event.path);
            this.schedulePush();
          }
        }
        this.emitStatus();
      }),
      this.deps.auth.onChange((a) => {
        if (a.kind === 'signedIn') {
          if (this.needRefresh) this.enqueue('refresh');
          else this.schedulePush();
        }
        this.emitStatus();
      }),
    );
    if (this.signedIn()) {
      if (this.needRefresh) this.enqueue('refresh');
      else this.schedulePush();
    }
    this.emitStatus();
  }

  stop(): void {
    this.started = false;
    for (const c of this.cleanups.splice(0)) c();
    if (this.pushTimer !== undefined) this.deps.clearTimer(this.pushTimer);
    if (this.retryTimer !== undefined) this.deps.clearTimer(this.retryTimer);
    this.pushTimer = undefined;
    this.retryTimer = undefined;
  }

  /** Ctrl/Cmd+S: push now. */
  syncNow(): void {
    if (!this.signedIn()) return;
    this.enqueue('push');
  }

  /** Tab focus: refresh when the last refresh is older than `refreshMs`. */
  onFocus(): void {
    if (!this.signedIn()) return;
    if (this.deps.now() - this.lastRefreshAt >= this.refreshMs) this.enqueue('refresh');
  }

  /** The browser is online again: retry what failed. */
  onOnline(): void {
    if (this.retryTimer === undefined) return;
    this.deps.clearTimer(this.retryTimer);
    this.retryTimer = undefined;
    this.enqueue(this.retryOp);
  }

  // --- The 15 s rule ---------------------------------------------------------------------------

  private activeDirty(): string[] {
    return [...this.dirty].filter((p) => !this.open.has(p));
  }

  private schedulePush(): void {
    if (!this.started || !this.signedIn()) return;
    if (this.activeDirty().length === 0) {
      this.clearPushTimer();
      return;
    }
    if (this.retryTimer !== undefined) return;
    const due = this.lastSyncAt + this.throttleMs;
    const now = this.deps.now();
    if (now >= due) {
      this.clearPushTimer();
      this.enqueue('push');
    } else if (this.pushTimer === undefined) {
      this.pushTimer = this.deps.setTimer(() => {
        this.pushTimer = undefined;
        this.enqueue('push');
      }, due - now);
    }
  }

  private clearPushTimer(): void {
    if (this.pushTimer !== undefined) this.deps.clearTimer(this.pushTimer);
    this.pushTimer = undefined;
  }

  // --- One operation at a time -----------------------------------------------------------------

  private enqueue(op: Op): void {
    if (!this.started) return;
    if (!this.queue.includes(op)) this.queue.push(op);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const op = this.queue.shift() as Op;
        if (!this.signedIn()) {
          if (op === 'refresh') this.needRefresh = true;
          continue;
        }
        try {
          if (op === 'push') await this.doPush();
          else await this.doRefresh();
          this.attempt = 0;
          this.error = undefined;
        } catch (err) {
          this.fail(err, op);
        }
        this.syncing = false;
        this.refreshing = false;
        this.emitStatus();
      }
    } finally {
      this.draining = false;
      this.emitStatus();
    }
  }

  private fail(err: unknown, op: Op): void {
    if (op === 'refresh') this.needRefresh = true;
    if (err instanceof AuthError) return; // `GoogleAuth` asks the person; the token coming back starts the work again.
    if (err instanceof GoneError) {
      // Remembered folders may be stale: the next try (Retry) reads the tree first.
      this.forgetFolders();
      this.needRefresh = true;
    }
    const retry = err instanceof TypeError || (err instanceof Error && err.name === 'RetryError');
    this.error = err instanceof TypeError ? 'Offline' : err instanceof Error ? err.message : String(err);
    if (!retry) return;
    const delay = Math.min(RETRY_FIRST_MS * 2 ** this.attempt, RETRY_MAX_MS);
    this.attempt++;
    this.retryOp = op;
    if (this.retryTimer !== undefined) this.deps.clearTimer(this.retryTimer);
    this.retryTimer = this.deps.setTimer(() => {
      this.retryTimer = undefined;
      this.enqueue(op);
    }, delay);
  }

  // --- Drive tree ------------------------------------------------------------------------------

  /** Find (or make) the folder `konekton` and read what is in it. */
  private async loadTree(): Promise<DriveTree> {
    const all = await this.drive.listAll();
    const root = pickRoot(all);
    if (!root) {
      this.rootId = (await this.drive.createFolder(ROOT_NAME, 'root')).id;
      this.folders = new Map();
      return { folders: this.folders, files: new Map(), duplicates: [] };
    }
    this.rootId = root.id;
    if (root.extra && !this.warnedRoots) {
      this.warnedRoots = true;
      this.deps.dialogs.notify(`${root.all.length} folders named konekton in Drive; reading all of them, new files go to the oldest.`);
    }
    const tree = buildTree(all, root.all);
    this.folders = new Map(tree.folders);
    return tree;
  }

  private forgetFolders(): void {
    this.rootId = undefined;
    this.folders = new Map();
  }

  private async folderFor(dir: string): Promise<string> {
    if (this.rootId === undefined) await this.loadTree();
    let parent = this.rootId as string;
    if (dir === '') return parent;
    let path = '';
    for (const part of dir.split('/')) {
      path = path === '' ? part : `${path}/${part}`;
      let id = this.folders.get(path);
      if (id === undefined) {
        id = (await this.drive.createFolder(part, parent)).id;
        this.folders.set(path, id);
      }
      parent = id;
    }
    return parent;
  }

  // --- Push ------------------------------------------------------------------------------------

  private async doPush(): Promise<void> {
    this.clearPushTimer();
    // Outside changes first: a push never goes before the refresh of this start.
    if (this.needRefresh) await this.doRefresh();
    const entries = (await this.store.unsynced()).filter((e) => !this.open.has(e.path)).sort(byPath);
    for (const e of entries) this.dirty.add(e.path);
    if (entries.length === 0) return;
    this.lastSyncAt = this.deps.now();
    this.syncing = true;
    this.emitStatus();
    for (const entry of entries) await this.write(entry);
    this.syncing = false;
    // Entries that changed during the upload are still unsynced: the rule runs again.
    this.schedulePush();
  }

  private async write(entry: Entry): Promise<void> {
    const mime = mimeOf(entry.path);
    let written;
    if (entry.driveId !== undefined) {
      try {
        written = await this.drive.update(entry.driveId, entry.text, mime);
      } catch (err) {
        if (err instanceof GoneError) {
          this.askRemoved(entry.path);
          return;
        }
        throw err;
      }
    } else {
      const slash = entry.path.lastIndexOf('/');
      const dir = slash < 0 ? '' : entry.path.slice(0, slash);
      const name = entry.path.slice(slash + 1);
      try {
        written = await this.drive.create(name, await this.folderFor(dir), entry.text, mime);
      } catch (err) {
        if (!(err instanceof GoneError)) throw err;
        // A remembered folder is gone (deleted in Drive meanwhile): read the tree again, once.
        this.forgetFolders();
        written = await this.drive.create(name, await this.folderFor(dir), entry.text, mime);
      }
    }
    const done = await this.store.put(entry.path, entry.kind, entry.text, {
      synced: true,
      driveId: written.id,
      remoteVersion: written.version,
      changedAt: entry.changedAt,
      ifEtag: entry.etag,
    });
    // Changed during the upload: keep it unsynced, but remember where it lives on Drive.
    if (!done) await this.store.update(entry.path, { driveId: written.id, remoteVersion: written.version });
    else this.dirty.delete(entry.path);
  }

  // --- Refresh ---------------------------------------------------------------------------------

  private async doRefresh(): Promise<void> {
    this.refreshing = true;
    this.emitStatus();
    const tree = await this.loadTree();
    const fresh = tree.duplicates.filter((p) => !this.warnedPaths.has(p));
    for (const path of fresh) this.warnedPaths.add(path);
    // One note, not one per path: a Drive with many copies would bury the page in notes.
    if (fresh.length === 1) this.deps.dialogs.notify(`Two files named ${fresh[0]} in Drive; using the newest.`);
    else if (fresh.length > 1) this.deps.dialogs.notify(`${fresh.length} files exist twice in Drive (${fresh.slice(0, 3).join(', ')}${fresh.length > 3 ? ', …' : ''}); using the newest of each.`);

    const locals = new Map((await this.store.list()).map((e) => [e.path, e]));
    for (const [path, remote] of [...tree.files].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const kind = kindOfPath(path);
      if (kind === undefined) continue;
      await this.reconcile(path, kind, remote, locals.get(path), tree);
    }
    for (const local of [...locals.values()].sort(byPath)) {
      if (local.driveId === undefined || tree.files.has(local.path) || this.open.has(local.path)) continue;
      this.askRemoved(local.path);
    }

    this.lastRefreshAt = this.deps.now();
    this.needRefresh = false;
    await this.store.setMeta(META_LAST_REFRESH, this.lastRefreshAt);
    this.refreshing = false;
    this.schedulePush();
  }

  private async reconcile(path: string, kind: Entry['kind'], remote: RemoteFile, local: Entry | undefined, tree: DriveTree): Promise<void> {
    const adopt = async (text: string) => {
      await this.store.put(path, kind, text, { synced: true, driveId: remote.id, remoteVersion: remote.version, changedAt: Date.parse(remote.modifiedTime) || undefined });
      this.dirty.delete(path);
    };
    const download = async (): Promise<string | undefined> => {
      try {
        return await this.drive.download(remote.id);
      } catch (err) {
        if (err instanceof GoneError) return undefined; // Deleted between the list and now: the next refresh sees it.
        throw err;
      }
    };

    if (!local) {
      const text = await download();
      if (text !== undefined) await adopt(text);
      return;
    }
    if (this.open.has(path)) return;
    const changed = local.driveId !== remote.id || local.remoteVersion !== remote.version;
    if (!changed) return;
    const text = await download();
    if (text === undefined) return;
    if (local.synced || text === local.text) {
      // Re-check: the page may have written while the file came down.
      const now = await this.store.get(path);
      if (now && now.etag !== local.etag && !now.synced) {
        this.askConflict(path, kind, remote, tree);
        return;
      }
      await adopt(text);
      return;
    }
    this.askConflict(path, kind, remote, tree);
  }

  // --- Questions (one at a time, in the order they came) ---------------------------------------

  private enqueueQuestion(path: string, asking: 'conflict' | 'removed', task: () => Promise<void>): void {
    this.open.add(path);
    void this.store.update(path, { asking }).catch(() => undefined);
    this.questions = this.questions
      .then(task)
      .catch((err: unknown) => this.deps.dialogs.notify(`Not synced: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => {
        this.open.delete(path);
        void this.store.update(path, { asking: undefined }).catch(() => undefined);
        this.schedulePush();
        this.emitStatus();
      });
    this.emitStatus();
  }

  private askConflict(path: string, kind: Entry['kind'], remote: RemoteFile, tree: DriveTree): void {
    if (this.open.has(path)) return;
    this.enqueueQuestion(path, 'conflict', async () => {
      const copy = await this.freeCopyName(path, kind, tree);
      const answer = await this.deps.dialogs.askConflict(path, copy);
      const text = await this.drive.download(remote.id).catch((err: unknown) => {
        if (err instanceof GoneError) return undefined;
        throw err;
      });
      if (text === undefined) return;
      const mine = await this.store.get(path);
      if (answer === 'saveAs' && mine) {
        // My version goes to the copy (unsynced: it is created on Drive by the next push); the original takes Drive's text.
        await this.store.createNew(copy, kind, mine.text);
        this.dirty.add(copy);
      }
      await this.store.put(path, kind, text, { synced: true, driveId: remote.id, remoteVersion: remote.version });
      this.dirty.delete(path);
      if (answer === 'saveAs' && mine) this.deps.savedAsCopy?.(path, copy);
    });
  }

  private async freeCopyName(path: string, kind: Entry['kind'], tree: DriveTree): Promise<string> {
    for (let n = 1; n < 1000; n++) {
      const copy = kind === 'board' ? webCopyName(path, n) : fileCopyName(path, n);
      if (!tree.files.has(copy) && !(await this.store.get(copy))) return copy;
    }
    throw new Error('Too many copies');
  }

  private askRemoved(path: string): void {
    if (this.open.has(path)) return;
    this.enqueueQuestion(path, 'removed', async () => {
      const answer = await this.deps.dialogs.askRemoved(path);
      if (answer === 'write') {
        // The next push creates it again, folders too.
        await this.store.update(path, { driveId: undefined, remoteVersion: undefined, synced: false });
        this.dirty.add(path);
      } else {
        await this.store.remove(path);
        this.dirty.delete(path);
      }
    });
  }
}
