import type { ChannelLike } from './localStore';

type Ask = { kind: 'conflict'; name: string; copyName: string } | { kind: 'removed'; path: string };

type Message =
  | { type: 'ask'; id: string; ask: Ask }
  | { type: 'answer'; id: string; choice: string }
  /** A new leader: the questions of the closed one are void (its engine asks them again). */
  | { type: 'withdrawAll' }
  | { type: 'hello' }
  | { type: 'notify'; text: string }
  | { type: 'savedAsCopy'; original: string; copy: string };

/** Where a tab shows the questions (`BrowserDialogs`). */
export interface QuestionHost {
  askConflict(name: string, copyName: string, tag?: string): Promise<'reload' | 'saveAs'>;
  askRemoved(path: string, tag?: string): Promise<'write' | 'delete'>;
  withdraw(tag: string): void;
  notify(text: string): void;
}

/**
 * The questions and notes of the sync engine, in every tab of the space. The engine runs in one tab (the leader), but
 * the person may work in another one, or the leader may show a page without dialogs. The first answer counts; the
 * other tabs take the question back.
 */
export class SharedDialogs {
  /** Questions this tab asked (it is the leader), waiting for an answer from any tab. */
  private readonly pending = new Map<string, { ask: Ask; resolve(choice: string): void }>();
  /** Questions shown in this tab. */
  private readonly shown = new Set<string>();

  constructor(
    private readonly host: QuestionHost,
    private readonly channel: ChannelLike,
    private readonly opts: { savedAsCopy?(original: string, copy: string): void; newId?(): string } = {},
  ) {}

  start(): void {
    this.channel.onmessage = (e) => this.onMessage(e.data as Message | undefined);
    this.post({ type: 'hello' });
  }

  /** This tab runs the engine from now on. */
  becameLeader(): void {
    this.withdrawShown();
    this.post({ type: 'withdrawAll' });
  }

  notify(text: string): void {
    this.host.notify(text);
    this.post({ type: 'notify', text });
  }

  askConflict(name: string, copyName: string): Promise<'reload' | 'saveAs'> {
    return this.ask({ kind: 'conflict', name, copyName }) as Promise<'reload' | 'saveAs'>;
  }

  askRemoved(path: string): Promise<'write' | 'delete'> {
    return this.ask({ kind: 'removed', path }) as Promise<'write' | 'delete'>;
  }

  /** "Save my version as a copy" was done: every tab with the original open may follow it. */
  savedAsCopy(original: string, copy: string): void {
    this.opts.savedAsCopy?.(original, copy);
    this.post({ type: 'savedAsCopy', original, copy });
  }

  private ask(ask: Ask): Promise<string> {
    const id = this.opts.newId?.() ?? crypto.randomUUID();
    return new Promise((resolve) => {
      this.pending.set(id, { ask, resolve });
      this.show(id, ask);
      this.post({ type: 'ask', id, ask });
    });
  }

  private show(id: string, ask: Ask): void {
    if (this.shown.has(id)) return;
    this.shown.add(id);
    const answer = ask.kind === 'conflict' ? this.host.askConflict(ask.name, ask.copyName, id) : this.host.askRemoved(ask.path, id);
    void answer.then((choice) => {
      this.shown.delete(id);
      this.answered(id, choice);
      this.post({ type: 'answer', id, choice });
    });
  }

  private answered(id: string, choice: string): void {
    const p = this.pending.get(id);
    if (!p) return;
    this.pending.delete(id);
    p.resolve(choice);
  }

  private withdrawShown(): void {
    for (const id of this.shown) this.host.withdraw(id);
    this.shown.clear();
  }

  private onMessage(m: Message | undefined): void {
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'ask':
        this.show(m.id, m.ask);
        break;
      case 'answer':
        if (this.shown.delete(m.id)) this.host.withdraw(m.id);
        this.answered(m.id, m.choice);
        break;
      case 'withdrawAll':
        this.withdrawShown();
        break;
      case 'hello':
        for (const [id, p] of this.pending) this.post({ type: 'ask', id, ask: p.ask });
        break;
      case 'notify':
        this.host.notify(m.text);
        break;
      case 'savedAsCopy':
        this.opts.savedAsCopy?.(m.original, m.copy);
        break;
    }
  }

  private post(m: Message): void {
    this.channel.postMessage(m);
  }
}
