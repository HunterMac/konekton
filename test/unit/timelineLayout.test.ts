import { describe, expect, it } from 'vitest';
import type { BoardNode } from '../../src/shared/canvasFormat';
import { originFor, segmentIndex } from '../../webview/src/layout/dates';
import { ARROW_HEIGHT, MAX_COVER_SEGMENTS, SEGMENT_WIDTH, UNSCHEDULED_KEY, coverRange, layoutTimeline, timelineDropTarget } from '../../webview/src/layout/timelineLayout';
import { CARD } from '../../webview/src/layout/types';

const TODAY = '2026-11-04';
const link = (id: string, date?: string): BoardNode => ({ kind: 'link', id, x: 0, y: 0, width: 280, height: 60, url: 'https://x.y', ...(date ? { date } : {}), extra: {}, elExtra: {} });

describe('timelineLayout', () => {
  const nodes = [link('a', '2026-11-04'), link('b', '2026-11-04'), link('c'), link('d', '2026-11-06')];
  const layout = layoutTimeline(nodes, 'days', TODAY, { from: -3, to: 8 });
  const box = (id: string) => layout.cards.find((c) => c.id === id)!;
  const origin = originFor(TODAY, 'days');

  it('marks the segment with today', () => {
    const marked = layout.regions.filter((r) => r.highlight);
    expect(marked).toHaveLength(1);
    expect(marked[0].key).toBe(`segment:${segmentIndex(TODAY, origin, 'days')}`);
    expect(marked[0].y).toBe(0);
  });

  it('puts dated cards in their segment, stacked upwards in plan order', () => {
    const i = segmentIndex(TODAY, origin, 'days');
    expect(box('a').x).toBeGreaterThanOrEqual(i * SEGMENT_WIDTH);
    expect(box('a').x).toBeLessThan((i + 1) * SEGMENT_WIDTH);
    expect(box('a').y).toBeLessThan(0);
    expect(box('b').y).toBeLessThan(box('a').y);
    expect(box('d').x).toBe(box('a').x + 2 * SEGMENT_WIDTH);
    expect(box('d').y).toBe(box('a').y);
  });

  it('puts cards without a date in the Unscheduled area below the arrow', () => {
    const area = layout.regions.find((r) => r.key === UNSCHEDULED_KEY)!;
    expect(area.y).toBeGreaterThan(ARROW_HEIGHT);
    expect(box('c').y).toBeGreaterThanOrEqual(area.y);
    expect(box('c').y + CARD.height).toBeLessThanOrEqual(area.y + area.height);
  });

  it('keeps Unscheduled cards at segment 0 wherever the visible range is', () => {
    for (const range of [{ from: -3, to: 8 }, { from: -40, to: -30 }, { from: 50, to: 60 }]) {
      const l = layoutTimeline([link('c')], 'days', TODAY, range);
      const area = l.regions.find((r) => r.key === UNSCHEDULED_KEY)!;
      const c = l.cards.find((b) => b.id === 'c')!;
      expect(c.x).toBe(12);
      expect(c.x).toBeGreaterThanOrEqual(area.x);
      expect(c.x + CARD.width).toBeLessThanOrEqual(area.x + area.width);
      expect(area.x).toBeLessThanOrEqual(range.from * SEGMENT_WIDTH);
      expect(area.x + area.width).toBeGreaterThanOrEqual((range.to + 1) * SEGMENT_WIDTH);
    }
  });

  it('always covers the segments that hold cards', () => {
    const far = layoutTimeline([link('x', '2027-03-01'), link('y', '2026-01-01')], 'days', TODAY, { from: 0, to: 2 });
    const keys = new Set(far.regions.map((r) => r.key));
    expect(keys.has(`segment:${segmentIndex('2027-03-01', origin, 'days')}`)).toBe(true);
    expect(keys.has(`segment:${segmentIndex('2026-01-01', origin, 'days')}`)).toBe(true);
  });

  it('limits how far a far-away card stretches the range', () => {
    const range = { from: -3, to: 8 };
    const r = coverRange([link('old', '1900-01-01'), link('new', '2400-01-01')], 'days', TODAY, range);
    expect(r.to - r.from + 1).toBe(MAX_COVER_SEGMENTS);
    expect(r.from).toBeLessThanOrEqual(range.from);
    expect(r.to).toBeGreaterThanOrEqual(range.to);
    const one = coverRange([link('old', '1900-01-01')], 'days', TODAY, range);
    expect(one).toEqual({ from: range.to + 1 - MAX_COVER_SEGMENTS, to: range.to });
  });

  it('works for weeks and months', () => {
    const w = layoutTimeline([link('a', '2026-11-04')], 'weeks', TODAY, { from: -3, to: 3 });
    expect(w.regions.find((r) => r.highlight)?.key).toBe('segment:3');
    const m = layoutTimeline([link('a', '2026-12-10')], 'months', TODAY, { from: -3, to: 3 });
    expect(m.cards[0].x).toBe(4 * SEGMENT_WIDTH + 12);
  });

  it('finds the drop target', () => {
    const i = segmentIndex(TODAY, origin, 'days');
    const x = i * SEGMENT_WIDTH + 30;
    expect(timelineDropTarget(layout, { x, y: 10 })).toEqual({ kind: 'segment', index: i });
    expect(timelineDropTarget(layout, { x, y: -300 })).toEqual({ kind: 'segment', index: i });
    const area = layout.regions.find((r) => r.key === UNSCHEDULED_KEY)!;
    expect(timelineDropTarget(layout, { x: area.x + 10, y: area.y + 10 })).toEqual({ kind: 'unscheduled' });
    expect(timelineDropTarget(layout, { x, y: ARROW_HEIGHT + 5 })).toBeNull();
    expect(timelineDropTarget(layout, { x: -99999, y: 10 })).toBeNull();
  });
});
