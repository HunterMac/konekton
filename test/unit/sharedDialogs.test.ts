import { describe, expect, it, vi } from 'vitest';
import { BrowserDialogs } from '../../web/src/ports/browserDialogs';
import type { ChannelLike } from '../../web/src/sync/localStore';
import { SharedDialogs } from '../../web/src/sync/sharedDialogs';

/** BroadcastChannels of one name: a message goes to every other tab, never back to the sender. */
class Bus {
  readonly tabs: Channel[] = [];
  channel(): Channel {
    const c = new Channel(this);
    this.tabs.push(c);
    return c;
  }
}

class Channel implements ChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  constructor(private readonly bus: Bus) {}
  postMessage(m: unknown) {
    for (const t of this.bus.tabs) if (t !== this) t.onmessage?.({ data: structuredClone(m) });
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function tab(bus: Bus, copies: string[] = []) {
  const dialogs = new BrowserDialogs('Drive');
  let n = 0;
  const shared = new SharedDialogs(dialogs, bus.channel(), { savedAsCopy: (o, c) => copies.push(`${o}>${c}`), newId: () => `q${++n}` });
  shared.start();
  return { dialogs, shared, copies, open: () => dialogs.snapshot().questions.map((q) => q.kind) };
}

describe('SharedDialogs', () => {
  it('a question of the leader shows in every tab; an answer in any tab counts and closes it everywhere', async () => {
    const bus = new Bus();
    const leader = tab(bus);
    const other = tab(bus);
    const answer = leader.shared.askConflict('a.canvas', 'a_web.canvas');
    expect(leader.open()).toEqual(['conflict']);
    expect(other.open()).toEqual(['conflict']);

    other.dialogs.answer('saveAs');
    expect(await answer).toBe('saveAs');
    await flush();
    expect(leader.open()).toEqual([]);
    expect(other.open()).toEqual([]);
  });

  it('a tab opened later gets the open questions', async () => {
    const bus = new Bus();
    const leader = tab(bus);
    const answer = leader.shared.askRemoved('docs/a.md');
    const late = tab(bus);
    expect(late.open()).toEqual(['removed']);
    late.dialogs.answer('write');
    expect(await answer).toBe('write');
  });

  it('a new leader takes back the questions of the closed one', () => {
    const bus = new Bus();
    const old = tab(bus);
    const a = tab(bus);
    const b = tab(bus);
    void old.shared.askRemoved('docs/a.md');
    bus.tabs.splice(0, 1); // the old leader closes
    a.shared.becameLeader();
    expect(a.open()).toEqual([]);
    expect(b.open()).toEqual([]);
  });

  it('notes and "saved as copy" reach every tab', () => {
    vi.stubGlobal('window', { setTimeout: () => 0 });
    const bus = new Bus();
    const leader = tab(bus, []);
    const other = tab(bus, []);
    leader.shared.notify('Two files named a.md in Drive; using the newest.');
    expect(other.dialogs.snapshot().notice?.text).toContain('a.md');
    leader.shared.savedAsCopy('a.canvas', 'a_web.canvas');
    expect(leader.copies).toEqual(['a.canvas>a_web.canvas']);
    expect(other.copies).toEqual(['a.canvas>a_web.canvas']);
    vi.unstubAllGlobals();
  });
});
