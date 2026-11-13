import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebDocument } from '../../web/src/host/WebDocument';
import { FakeDialogs, FakeStorage, tick } from './fakes/webPorts';

const NAME = 'sample.canvas';

function setup() {
  const storage = new FakeStorage();
  const etag = storage.put(NAME, 'v0');
  const dialogs = new FakeDialogs();
  const shown: string[] = [];
  const order: string[] = [];
  const gone: string[] = [];
  const renamed: string[] = [];
  /** Text an open text field commits when it is closed. */
  const typing: { text: string | undefined } = { text: undefined };
  const closeTextFields = vi.fn(async () => {
    order.push('close');
    if (typing.text !== undefined) {
      const text = typing.text;
      typing.text = undefined;
      doc.edit(text);
    }
  });
  const askConflict = dialogs.askConflict.bind(dialogs);
  dialogs.askConflict = (name, copyName) => {
    order.push('ask');
    return askConflict(name, copyName);
  };
  const doc: WebDocument = new WebDocument(NAME, { text: 'v0', etag }, storage, dialogs, {
    show: (text) => shown.push(text),
    closeTextFields,
    renamed: (name) => renamed.push(name),
    gone: (name) => gone.push(name),
  });
  return { storage, dialogs, doc, shown, order, gone, renamed, typing, closeTextFields };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('WebDocument auto save', () => {
  it('saves once with the last text after edits within 300 ms', async () => {
    const { doc, storage } = setup();
    doc.edit('a');
    await vi.advanceTimersByTimeAsync(100);
    doc.edit('b');
    await vi.advanceTimersByTimeAsync(100);
    doc.edit('c');
    await vi.advanceTimersByTimeAsync(299);
    expect(storage.saves).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(storage.saves.map((s) => s.text)).toEqual(['c']);
    expect(storage.disk.get(NAME)?.text).toBe('c');
    expect(doc.isDirty()).toBe(false);
  });

  it('saveNow saves at once, and does nothing with nothing to save', async () => {
    const { doc, storage } = setup();
    await doc.saveNow();
    expect(storage.saves).toEqual([]);
    doc.edit('a');
    await doc.saveNow();
    expect(storage.saves.map((s) => s.text)).toEqual(['a']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.saves).toHaveLength(1);
  });

  it('saves again after a running save, with the new etag', async () => {
    const { doc, storage } = setup();
    let release: (() => void) | undefined;
    storage.saveImpl = (name, text, etag) =>
      new Promise((resolve) => {
        release = () => resolve(storage.saveNow(name, text, etag));
      });
    doc.edit('a');
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.saves).toHaveLength(1);
    doc.edit('b');
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.saves).toHaveLength(1);
    storage.saveImpl = undefined;
    release?.();
    await tick();
    expect(storage.saves.map((s) => s.text)).toEqual(['a', 'b']);
    expect(storage.saves[1].etag).not.toBe(storage.saves[0].etag);
    expect(storage.disk.get(NAME)?.text).toBe('b');
    expect(doc.isDirty()).toBe(false);
  });

  it('shows "Not saved" on other errors, stays dirty, and tries again on the next edit', async () => {
    const { doc, storage, dialogs } = setup();
    storage.saveImpl = async () => ({ ok: false, conflict: false, error: 'disk full' });
    doc.edit('a');
    await vi.advanceTimersByTimeAsync(300);
    expect(dialogs.notices).toEqual(['Not saved: disk full']);
    expect(doc.isDirty()).toBe(true);
    storage.saveImpl = undefined;
    doc.edit('b');
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.disk.get(NAME)?.text).toBe('b');
    expect(doc.isDirty()).toBe(false);
  });
});

describe('WebDocument conflicts', () => {
  it('asks after a refused save, then saves nothing while locked', async () => {
    const { doc, storage, dialogs, order, closeTextFields } = setup();
    storage.put(NAME, 'outside');
    doc.edit('mine');
    await vi.advanceTimersByTimeAsync(300);
    await tick();
    expect(closeTextFields).toHaveBeenCalled();
    expect(order).toEqual(['close', 'ask']);
    expect(dialogs.conflicts).toEqual([{ name: NAME, copyName: 'sample_web.canvas' }]);
    expect(doc.isLocked()).toBe(true);
    doc.edit('mine 2');
    await doc.saveNow();
    await vi.advanceTimersByTimeAsync(1000);
    expect(storage.saves).toHaveLength(1);
  });

  it('ignores a change with its own etag', async () => {
    const { doc, storage } = setup();
    doc.edit('a');
    await vi.advanceTimersByTimeAsync(300);
    doc.changed(NAME, storage.disk.get(NAME)!.etag);
    await tick();
    expect(storage.loads).toEqual([]);
  });

  it('reloads a clean board on an outside change', async () => {
    const { doc, storage, dialogs, shown } = setup();
    doc.edit('a');
    await vi.advanceTimersByTimeAsync(300);
    const etag = storage.put(NAME, 'outside');
    doc.changed(NAME, etag);
    await doc.settled();
    expect(shown).toEqual(['outside']);
    expect(dialogs.notices).toEqual(['Reloaded: the file changed on server']);
    expect(dialogs.conflicts).toEqual([]);
    doc.undo();
    expect(shown).toEqual(['outside']);
    expect(doc.text).toBe('outside');
  });

  it('asks instead of reloading when a closed text field commits text', async () => {
    const { doc, storage, dialogs, typing, shown } = setup();
    typing.text = 'typed';
    const etag = storage.put(NAME, 'outside');
    doc.changed(NAME, etag);
    await tick();
    expect(dialogs.conflicts).toHaveLength(1);
    expect(shown).toEqual([]);
    expect(doc.text).toBe('typed');
  });

  it('asks when dirty', async () => {
    const { doc, storage, dialogs } = setup();
    doc.edit('mine');
    const etag = storage.put(NAME, 'outside');
    doc.changed(NAME, etag);
    await tick();
    expect(dialogs.conflicts).toHaveLength(1);
    expect(doc.isLocked()).toBe(true);
  });

  it('Reload shows the disk text, clears history, unlocks, and later saves use the disk etag', async () => {
    const { doc, storage, dialogs, shown } = setup();
    doc.edit('mine');
    const etag = storage.put(NAME, 'outside');
    doc.changed(NAME, etag);
    await tick();
    dialogs.answer('reload');
    await doc.settled();
    expect(shown).toEqual(['outside']);
    expect(doc.isLocked()).toBe(false);
    doc.undo();
    expect(shown).toEqual(['outside']);
    doc.edit('after');
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.saves.at(-1)).toEqual({ name: NAME, text: 'after', etag });
    expect(storage.disk.get(NAME)?.text).toBe('after');
  });

  it('Save-as writes the local text to a copy and continues there', async () => {
    const { doc, storage, dialogs, renamed } = setup();
    doc.edit('mine');
    const etag = storage.put(NAME, 'outside');
    doc.changed(NAME, etag);
    await tick();
    dialogs.answer('saveAs');
    await doc.settled();
    expect(renamed).toEqual(['sample_web.canvas']);
    expect(storage.disk.get('sample_web.canvas')?.text).toBe('mine');
    expect(storage.disk.get(NAME)?.text).toBe('outside');
    expect(dialogs.notices).toContain('Saved as sample_web.canvas');
    expect(doc.isLocked()).toBe(false);
    doc.edit('more');
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.saves.at(-1)?.name).toBe('sample_web.canvas');
    expect(storage.disk.get('sample_web.canvas')?.text).toBe('more');
    // The undo history is kept.
    doc.undo();
    expect(doc.text).toBe('mine');
  });

  it('leaves a clean board that was deleted', async () => {
    const { doc, storage, gone } = setup();
    storage.disk.delete(NAME);
    doc.removed(NAME);
    await doc.settled();
    expect(gone).toEqual([NAME]);
  });

  it('asks for a dirty deleted board; Reload then leaves it', async () => {
    const { doc, storage, dialogs, gone } = setup();
    doc.edit('mine');
    storage.disk.delete(NAME);
    doc.removed(NAME);
    await tick();
    expect(dialogs.conflicts).toHaveLength(1);
    dialogs.answer('reload');
    await doc.settled();
    expect(gone).toEqual([NAME]);
  });

  it('ignores events for other boards', async () => {
    const { doc, storage, dialogs } = setup();
    doc.edit('mine');
    doc.changed('other.canvas', storage.put('other.canvas', 'x'));
    await tick();
    expect(dialogs.conflicts).toEqual([]);
  });
});
