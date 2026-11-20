import type { LocalDb } from './kv';

/** One board or text file in the local copy. */
export interface Entry {
  /** Board name (`plan.canvas`) or reference path (`docs/a.md`); relative to the `konekton` folder. */
  path: string;
  kind: 'board' | 'file';
  text: string;
  /** Local version: `"` + SHA-256 hex of the UTF-8 text + `"`. */
  etag: string;
  /** The text is what Drive has. */
  synced: boolean;
  driveId?: string;
  /** Content version on Drive (`contentVersion`) the text is based on. */
  remoteVersion?: string;
  /** A question is open; no sync for this entry. */
  asking?: 'conflict' | 'removed';
  changedAt: number;
  /** Counts every write of the entry; a write based on an older read is refused and read again. */
  rev: number;
}

export type LocalEvent =
  | { kind: 'changed'; path: string; etag: string; entryKind: 'board' | 'file'; synced: boolean; byThisPage: boolean }
  | { kind: 'removed'; path: string; byThisPage: boolean }
  | { kind: 'list'; byThisPage: boolean };

/** The part of `BroadcastChannel` the store uses. */
export interface ChannelLike {
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close?(): void;
}

export interface PutOptions {
  synced: boolean;
  driveId?: string;
  remoteVersion?: string;
  asking?: Entry['asking'];
  changedAt?: number;
  /** Write only if the stored entry still has this etag. */
  ifEtag?: string;
}

/** What a change decides after it saw the stored entry (`undefined` = no entry). */
export type Decision<R> =
  | { result: R }
  | { result: R; write: { kind: Entry['kind']; text: string } }
  | { result: R; remove: true };

/** A `BroadcastChannel` as a `ChannelLike`. */
export function broadcastChannel(name: string): ChannelLike {
  const bc = new BroadcastChannel(name);
  return {
    postMessage: (m) => bc.postMessage(m),
    set onmessage(fn: ((event: { data: unknown }) => void) | null) {
      bc.onmessage = fn ? (e: MessageEvent) => fn({ data: e.data as unknown }) : null;
    },
    get onmessage() {
      return null;
    },
    close: () => bc.close(),
  };
}

const encoder = new TextEncoder();

/** `"` + SHA-256 hex + `"` of the UTF-8 text. */
export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  let hex = '';
  for (const b of new Uint8Array(digest)) hex += b.toString(16).padStart(2, '0');
  return `"${hex}"`;
}

type Plan<R> =
  | { result: R }
  | { result: R; remove: true }
  | { result: R; next: Omit<Entry, 'etag' | 'rev' | 'path'> };

/**
 * The local copy of the files of one space: entries, their local versions, and events for this tab and the others.
 * Writes from the page (`change`, `saveIfMatch`, `createNew`) mark the entry unsynced. Writes of the sync engine
 * (`put`, `update`, `remove`) say what they are.
 */
export class LocalStore {
  private readonly listeners = new Set<(event: LocalEvent) => void>();
  private readonly channel: ChannelLike | undefined;
  private readonly now: () => number;

  constructor(
    private readonly db: LocalDb,
    opts: { channel?: ChannelLike; now?: () => number } = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.channel = opts.channel;
    if (this.channel) {
      this.channel.onmessage = (e) => {
        const event = e.data as LocalEvent | undefined;
        if (!event || typeof event !== 'object' || !('kind' in event)) return;
        // Written by another tab: never "by this page".
        this.emit({ ...event, byThisPage: false }, false);
      };
    }
  }

  close(): void {
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close?.();
    }
    this.listeners.clear();
  }

  onEvent(listener: (event: LocalEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: LocalEvent, post: boolean): void {
    for (const listener of [...this.listeners]) listener(event);
    if (post) this.channel?.postMessage(event);
  }

  get(path: string): Promise<Entry | undefined> {
    return this.db.entries.get(path);
  }

  async list(kind?: Entry['kind']): Promise<Entry[]> {
    const all = await this.db.entries.getAll();
    return (kind === undefined ? all : all.filter((e) => e.kind === kind)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  /** Entries whose text Drive does not have yet (also the ones with a question open). */
  async unsynced(): Promise<Entry[]> {
    return (await this.list()).filter((e) => !e.synced);
  }

  getMeta<T>(key: string): Promise<T | undefined> {
    return this.db.meta.get(key) as Promise<T | undefined>;
  }

  setMeta(key: string, value: unknown): Promise<void> {
    return this.db.meta.put(key, value);
  }

  /** Read the entry, decide, write; again from the read if another write came in between. */
  private async run<R>(path: string, byPage: boolean, decide: (cur: Entry | undefined) => Plan<R>): Promise<R> {
    for (;;) {
      const cur = await this.db.entries.get(path);
      const plan = decide(cur);
      let entry: Entry | undefined;
      if ('remove' in plan) {
        if (!cur) return plan.result;
      } else if ('next' in plan) {
        const etag = cur !== undefined && cur.text === plan.next.text ? cur.etag : await hashText(plan.next.text);
        entry = { ...plan.next, path, etag, rev: Math.max(this.now(), (cur?.rev ?? 0) + 1) };
      } else {
        return plan.result;
      }
      const written = await this.db.entries.modify(path, (stored) => {
        if (stored?.rev !== cur?.rev) return { result: false };
        return entry ? { write: entry, result: true } : { remove: true, result: true };
      });
      if (!written) continue;
      if (entry) {
        this.emit({ kind: 'changed', path, etag: entry.etag, entryKind: entry.kind, synced: entry.synced, byThisPage: byPage }, true);
        if (!cur) this.emit({ kind: 'list', byThisPage: byPage }, true);
      } else {
        this.emit({ kind: 'removed', path, byThisPage: byPage }, true);
        this.emit({ kind: 'list', byThisPage: byPage }, true);
      }
      return plan.result;
    }
  }

  /**
   * A write from the page: `decide` sees the stored entry and may return `write`; the entry is then unsynced.
   * Its text is the only thing that changes; Drive data stays.
   */
  change<R>(path: string, decide: (cur: Entry | undefined) => Decision<R>): Promise<R> {
    return this.run(path, true, (cur) => {
      const d = decide(cur);
      if ('remove' in d) return { result: d.result, remove: true };
      if (!('write' in d)) return { result: d.result };
      return {
        result: d.result,
        next: {
          kind: d.write.kind,
          text: d.write.text,
          synced: false,
          driveId: cur?.driveId,
          remoteVersion: cur?.remoteVersion,
          asking: cur?.asking,
          changedAt: this.now(),
        },
      };
    });
  }

  /** Save only if the stored text is still the version `etag` names. */
  async saveIfMatch(path: string, text: string, etag: string): Promise<{ ok: true; etag: string } | { ok: false }> {
    const stored = await this.change<boolean>(path, (cur) => (cur && cur.etag === etag ? { result: true, write: { kind: cur.kind, text } } : { result: false }));
    return stored ? { ok: true, etag: await hashText(text) } : { ok: false };
  }

  /** Create only; never overwrite. 'exists' when the path is taken. */
  async createNew(path: string, kind: Entry['kind'], text: string): Promise<{ etag: string } | 'exists'> {
    const created = await this.change<boolean>(path, (cur) => (cur ? { result: false } : { result: true, write: { kind, text } }));
    if (!created) return 'exists';
    return { etag: await hashText(text) };
  }

  /** A write of the sync engine. Returns the new entry; `undefined` when `ifEtag` no longer matches. */
  async put(path: string, kind: Entry['kind'], text: string, opts: PutOptions): Promise<Entry | undefined> {
    const ok = await this.run<boolean>(path, false, (cur) => {
      if (opts.ifEtag !== undefined && cur?.etag !== opts.ifEtag) return { result: false };
      return {
        result: true,
        next: { kind, text, synced: opts.synced, driveId: opts.driveId, remoteVersion: opts.remoteVersion, asking: opts.asking, changedAt: opts.changedAt ?? this.now() },
      };
    });
    return ok ? this.get(path) : undefined;
  }

  /** Change flags and Drive data of an entry; the text stays. Quiet: no event. */
  update(path: string, patch: Partial<Pick<Entry, 'synced' | 'driveId' | 'remoteVersion' | 'asking'>>): Promise<Entry | undefined> {
    return this.db.entries.modify<Entry | undefined>(path, (cur) => {
      if (!cur) return { result: undefined };
      // `undefined` in the patch clears the field.
      const next: Entry = { ...cur, ...patch, rev: Math.max(this.now(), cur.rev + 1) };
      return { write: next, result: next };
    });
  }

  /** Delete the entry (engine: answer "Delete my copy"). */
  remove(path: string): Promise<void> {
    return this.run<void>(path, false, () => ({ result: undefined, remove: true }));
  }
}
