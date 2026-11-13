import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardNodes, parse, serialize, type CanvasDoc } from '../../src/shared/canvasFormat';
import { membership, placeInLane, planNodes, planOf, statusOf, withPlan, withoutNodes } from '../../webview/src/plans';
import { createBoardStore } from '../../webview/src/store';
import type { WebviewMessage } from '../../src/shared/protocol';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');
const docOf = (text: string): CanvasDoc => {
  const r = parse(text);
  if (!r.ok) throw new Error(r.error);
  return r.doc;
};

describe('plan helpers', () => {
  const doc = docOf(fixture('plans.canvas'));

  it('finds the plan of a type, or a default that is not stored', () => {
    expect(planOf(doc, 'board').id).toBe('p1');
    const plain = docOf(fixture('sample.canvas'));
    const def = planOf(plain, 'timeline');
    expect(def).toMatchObject({ type: 'timeline', items: [] });
    expect(plain.plans).toHaveLength(0);
  });

  it('skips plan items that point to missing nodes', () => {
    const d = withPlan(doc, { ...planOf(doc, 'board'), items: ['n2', 'gone', 'n1'] });
    expect(planNodes(d, planOf(d, 'board')).map((n) => n.id)).toEqual(['n2', 'n1']);
  });

  it('replaces a plan by id or appends it', () => {
    const plain = docOf(fixture('sample.canvas'));
    const added = withPlan(plain, { ...planOf(plain, 'board'), items: ['x'] });
    expect(added.plans).toHaveLength(1);
    const again = withPlan(added, { ...added.plans[0], items: ['x', 'y'] });
    expect(again.plans).toHaveLength(1);
    expect(again.plans[0].items).toEqual(['x', 'y']);
  });

  it('removes node ids from every plan', () => {
    const d = withoutNodes(doc, new Set(['n1']));
    expect(d.plans.map((p) => p.items)).toEqual([['n2'], []]);
    expect(withoutNodes(doc, new Set(['zzz']))).toBe(doc);
  });

  it('treats a missing status as todo', () => {
    expect(statusOf(boardNodes(doc)[0])).toBe('inProgress');
    expect(statusOf({ ...boardNodes(doc)[1], status: undefined })).toBe('todo');
  });

  it('lists the plans of each node', () => {
    const m = membership(doc);
    expect(m.get('n1')).toEqual(['board', 'timeline']);
    expect(m.get('n2')).toEqual(['board']);
  });

  it('places a card inside a lane', () => {
    const items = ['a', 'b', 'c', 'd'];
    expect(placeInLane(items, 'd', ['a', 'c'], 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(placeInLane(items, 'd', ['a', 'c'], 1)).toEqual(['a', 'b', 'd', 'c']);
    expect(placeInLane(items, 'a', ['b', 'c', 'd'], 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(placeInLane(items, 'a', [], 0)).toEqual(['b', 'c', 'd', 'a']);
  });
});

describe('plan actions', () => {
  function setup(text = fixture('sample.canvas')) {
    const posted: WebviewMessage[] = [];
    const store = createBoardStore((m) => posted.push(m));
    store.getState().init(text, { gridEnabled: false });
    const edits = () => posted.filter((m) => m.type === 'edit');
    return { store, edits, s: () => store.getState() };
  }
  const A = 'a1b2c3d4e5f60718';
  const B = 'b2c3d4e5f6071829';

  it('switching modes is UI only', () => {
    const { s, edits } = setup();
    s().setSelection([A], []);
    s().setMode('board');
    expect(s().mode).toBe('board');
    expect(s().selNodes).toEqual([]);
    s().setMode('timeline');
    s().setMode('chaos');
    expect(edits()).toHaveLength(0);
  });

  it('adds and removes items, one edit each, and stays out of the file when nothing changes', () => {
    const { s, edits } = setup();
    s().addToPlan('board', [A, B]);
    expect(edits()).toHaveLength(1);
    expect(planOf(s().doc, 'board').items).toEqual([A, B]);
    s().addToPlan('board', [A, 'nope']);
    expect(edits()).toHaveLength(1);
    s().removeFromPlan('board', [A]);
    expect(edits()).toHaveLength(2);
    expect(planOf(s().doc, 'board').items).toEqual([B]);
    s().removeFromPlan('board', [A]);
    expect(edits()).toHaveLength(2);
  });

  it('keeps the same item in the Board and the Timeline', () => {
    const { s } = setup();
    s().addToPlan('board', [A]);
    s().addToPlan('timeline', [A]);
    expect(s().doc.plans.map((p) => p.type)).toEqual(['board', 'timeline']);
  });

  it('sets status and date as metadata only', () => {
    const { s, edits } = setup();
    const before = boardNodes(s().doc).find((n) => n.id === A)!;
    s().setStatus([A], 'done');
    s().setDate([A], '2026-11-03');
    const after = boardNodes(s().doc).find((n) => n.id === A)!;
    expect(after).toMatchObject({ status: 'done', date: '2026-11-03', x: before.x, y: before.y, width: before.width, height: before.height });
    expect(edits()).toHaveLength(2);
    s().setStatus([A], 'todo');
    expect(boardNodes(s().doc).find((n) => n.id === A)).not.toHaveProperty('status');
    s().setDate([A], undefined);
    expect(boardNodes(s().doc).find((n) => n.id === A)).not.toHaveProperty('date');
    s().setDate([A], undefined);
    expect(edits()).toHaveLength(4);
  });

  it('moves a card with status and order in one edit', () => {
    const { s, edits } = setup();
    s().addToPlan('board', [A, B]);
    const n = edits().length;
    s().moveCard('board', B, { status: 'done', index: 0 });
    expect(edits()).toHaveLength(n + 1);
    expect(boardNodes(s().doc).find((x) => x.id === B)?.status).toBe('done');
    s().moveCard('board', A, { status: 'done', index: 0 });
    expect(planOf(s().doc, 'board').items).toEqual([A, B]);
    // Same slot: no new edit.
    const m = edits().length;
    s().moveCard('board', A, { status: 'done', index: 0 });
    expect(edits()).toHaveLength(m);
  });

  it('sets a date from the Timeline in one edit', () => {
    const { s, edits } = setup();
    s().addToPlan('timeline', [A]);
    const n = edits().length;
    s().moveCard('timeline', A, { date: '2026-11-09' });
    expect(edits()).toHaveLength(n + 1);
    s().moveCard('timeline', A, { date: undefined });
    expect(boardNodes(s().doc).find((x) => x.id === A)).not.toHaveProperty('date');
  });

  it('deleting a node removes it from every plan in the same edit', () => {
    const { s, edits } = setup();
    s().addToPlan('board', [A, B]);
    s().addToPlan('timeline', [A]);
    const n = edits().length;
    s().setSelection([A], []);
    s().deleteSelection();
    expect(edits()).toHaveLength(n + 1);
    expect(s().doc.plans.map((p) => p.items)).toEqual([[B], []]);
  });

  it('blocks content changes outside Chaos', () => {
    const { s, edits } = setup();
    s().setMode('board');
    s().updateNode(A, { text: 'x' });
    s().moveNodes([{ id: A, x: 5, y: 5 }]);
    s().createNode({ kind: 'sticky', center: { x: 0, y: 0 } });
    s().setSelection([A], []);
    s().deleteSelection();
    s().duplicateSelection();
    expect(edits()).toHaveLength(0);
    expect(boardNodes(s().doc)).toHaveLength(6);
    expect(boardNodes(s().doc)[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('does not copy status and date to duplicates', () => {
    const { s } = setup();
    s().setStatus([A], 'done');
    s().setDate([A], '2026-11-03');
    s().setSelection([A], []);
    s().duplicateSelection();
    const copy = boardNodes(s().doc).at(-1)!;
    expect(copy.id).not.toBe(A);
    expect(copy.status).toBeUndefined();
    expect(copy.date).toBeUndefined();
  });

  it('a file without plan actions keeps serializing like before', () => {
    const { s } = setup();
    expect(serialize(s().doc)).toBe(fixture('sample.canvas'));
  });
});
