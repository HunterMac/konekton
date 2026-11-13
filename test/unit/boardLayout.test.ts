import { describe, expect, it } from 'vitest';
import type { BoardNode, Status } from '../../src/shared/canvasFormat';
import { LANE_HEADER, LANE_MIN_HEIGHT, LANE_WIDTH, boardDropTarget, layoutBoard } from '../../webview/src/layout/boardLayout';
import { CARD, GAP } from '../../webview/src/layout/types';

const link = (id: string, status?: Status): BoardNode => ({ kind: 'link', id, x: 0, y: 0, width: 280, height: 60, url: 'https://x.y', ...(status ? { status } : {}), extra: {}, elExtra: {} });

describe('boardLayout', () => {
  const nodes = [link('a', 'done'), link('b'), link('c', 'inProgress'), link('d', 'todo'), link('e', 'done')];
  const layout = layoutBoard(nodes);
  const box = (id: string) => layout.cards.find((c) => c.id === id)!;

  it('puts cards in the lane of their status; a missing status means todo', () => {
    expect(box('b').x).toBe(GAP);
    expect(box('d').x).toBe(GAP);
    expect(box('c').x).toBe(LANE_WIDTH + GAP);
    expect(box('a').x).toBe(2 * LANE_WIDTH + GAP);
    expect(box('e').x).toBe(2 * LANE_WIDTH + GAP);
  });

  it('keeps the plan order inside a lane', () => {
    expect(box('b').y).toBeLessThan(box('d').y);
    expect(box('a').y).toBeLessThan(box('e').y);
    expect(box('b').y).toBe(LANE_HEADER + GAP);
  });

  it('makes an empty board with three drop-able lanes', () => {
    const empty = layoutBoard([]);
    expect(empty.regions.map((r) => r.label)).toEqual(['Todo', 'In progress', 'Done']);
    expect(empty.regions.every((r) => r.height === LANE_MIN_HEIGHT)).toBe(true);
  });

  it('grows lanes with the longest one', () => {
    const many = layoutBoard(Array.from({ length: 10 }, (_, i) => link(String(i))));
    expect(many.regions[0].height).toBeGreaterThan(LANE_MIN_HEIGHT);
    expect(many.regions[1].height).toBe(many.regions[0].height);
  });

  it('finds the drop index at the top, middle and end of a lane', () => {
    const x = GAP + 10;
    expect(boardDropTarget(layout, nodes, 'x', { x, y: 0 })).toEqual({ status: 'todo', index: 0 });
    const middle = box('b').y + CARD.height / 2 + 5;
    expect(boardDropTarget(layout, nodes, 'x', { x, y: middle })).toEqual({ status: 'todo', index: 1 });
    expect(boardDropTarget(layout, nodes, 'x', { x, y: 5000 - 1 })).toBeNull();
    expect(boardDropTarget(layout, nodes, 'x', { x, y: layout.regions[0].height })).toEqual({ status: 'todo', index: 2 });
  });

  it('ignores the dragged card', () => {
    const y = box('d').y + CARD.height; // below d
    expect(boardDropTarget(layout, nodes, 'b', { x: 20, y })).toEqual({ status: 'todo', index: 1 });
    expect(boardDropTarget(layout, nodes, 'x', { x: 20, y })).toEqual({ status: 'todo', index: 2 });
  });

  it('drops into an empty lane at index 0', () => {
    const only = [link('a')];
    const l = layoutBoard(only);
    expect(boardDropTarget(l, only, 'a', { x: 2 * LANE_WIDTH + 30, y: 100 })).toEqual({ status: 'done', index: 0 });
  });

  it('returns null outside every lane', () => {
    expect(boardDropTarget(layout, nodes, 'a', { x: -5, y: 50 })).toBeNull();
    expect(boardDropTarget(layout, nodes, 'a', { x: 3 * LANE_WIDTH + 5, y: 50 })).toBeNull();
    expect(boardDropTarget(layout, nodes, 'a', { x: 50, y: -5 })).toBeNull();
  });
});
