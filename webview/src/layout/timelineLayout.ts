import type { BoardNode } from '../../../src/shared/canvasFormat';
import { originFor, segmentIndex, segmentLabel, type Scale } from './dates';
import { CARD, GAP, type CardBox, type PlanLayout, type Point, type Region } from './types';

export const SEGMENT_WIDTH = CARD.width + 2 * GAP;
export const ARROW_HEIGHT = 36;
export const UNSCHEDULED_KEY = 'unscheduled';
const UNSCHEDULED_TOP = ARROW_HEIGHT + GAP * 2;
const UNSCHEDULED_COLUMNS = 4;

const segmentKey = (i: number) => `segment:${i}`;

export interface SegmentRange {
  from: number;
  to: number;
}

/** Most segments `coverRange` returns, so one far-away date cannot build thousands of segments. */
export const MAX_COVER_SEGMENTS = 600;

/**
 * The segment range that holds `range` and the dated cards, so far-away cards still show. It grows
 * past `range` by at most `MAX_COVER_SEGMENTS` in total, shared between both sides. Cards further
 * away get their segments when the view pans near them.
 */
export function coverRange(nodes: BoardNode[], scale: Scale, todayDate: string, range: SegmentRange): SegmentRange {
  const origin = originFor(todayDate, scale);
  let lo = range.from;
  let hi = range.to;
  for (const n of nodes) {
    if (n.date === undefined) continue;
    const i = segmentIndex(n.date, origin, scale);
    lo = Math.min(lo, i);
    hi = Math.max(hi, i);
  }
  const needDown = range.from - lo;
  const needUp = hi - range.to;
  const room = Math.max(0, MAX_COVER_SEGMENTS - (range.to - range.from + 1));
  const down = Math.min(needDown, Math.max(Math.floor(room / 2), room - needUp));
  const up = Math.min(needUp, room - down);
  return { from: range.from - down, to: range.to + up };
}

/**
 * A horizontal row of segments at `y = 0`. Dated cards stack upwards above their segment, in
 * `nodes` order. Cards without a date go to the Unscheduled area below the arrow.
 */
export function layoutTimeline(nodes: BoardNode[], scale: Scale, todayDate: string, range: SegmentRange): PlanLayout {
  const origin = originFor(todayDate, scale);
  const { from, to } = coverRange(nodes, scale, todayDate, range);
  const todayIndex = segmentIndex(todayDate, origin, scale);

  const regions: Region[] = [];
  for (let i = from; i <= to; i++) {
    regions.push({ key: segmentKey(i), label: segmentLabel(i, origin, scale), x: i * SEGMENT_WIDTH, y: 0, width: SEGMENT_WIDTH, height: ARROW_HEIGHT, highlight: i === todayIndex });
  }

  const cards: CardBox[] = [];
  const stacked = new Map<number, number>();
  const unscheduled: BoardNode[] = [];
  for (const n of nodes) {
    if (n.date === undefined) {
      unscheduled.push(n);
      continue;
    }
    const i = segmentIndex(n.date, origin, scale);
    const row = stacked.get(i) ?? 0;
    stacked.set(i, row + 1);
    cards.push({ id: n.id, x: i * SEGMENT_WIDTH + GAP, y: -(row + 1) * (CARD.height + GAP), width: CARD.width, height: CARD.height });
  }

  // Undated cards start at segment 0, the left edge of the home view, so panning does not move them.
  // The strip spans the visible range and always reaches over them.
  const columns = UNSCHEDULED_COLUMNS;
  const rows = Math.max(1, Math.ceil(unscheduled.length / columns));
  const areaFrom = Math.min(from, 0);
  const areaTo = Math.max(to, columns - 1);
  unscheduled.forEach((n, k) => {
    cards.push({
      id: n.id,
      x: GAP + (k % columns) * SEGMENT_WIDTH,
      y: UNSCHEDULED_TOP + GAP + Math.floor(k / columns) * (CARD.height + GAP),
      width: CARD.width,
      height: CARD.height,
    });
  });
  regions.push({
    key: UNSCHEDULED_KEY,
    label: 'Unscheduled',
    x: areaFrom * SEGMENT_WIDTH,
    y: UNSCHEDULED_TOP,
    width: (areaTo - areaFrom + 1) * SEGMENT_WIDTH,
    height: GAP + rows * (CARD.height + GAP) + GAP,
  });
  return { cards, regions };
}

/** Segment column or the Unscheduled area under `p`. The columns reach up over the stacked cards. */
export function timelineDropTarget(layout: PlanLayout, p: Point): { kind: 'segment'; index: number } | { kind: 'unscheduled' } | null {
  const area = layout.regions.find((r) => r.key === UNSCHEDULED_KEY);
  if (area && p.x >= area.x && p.x < area.x + area.width && p.y >= area.y && p.y <= area.y + area.height) return { kind: 'unscheduled' };
  const segments = layout.regions.filter((r) => r.key.startsWith('segment:'));
  if (segments.length === 0) return null;
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (p.x < first.x || p.x >= last.x + last.width || p.y >= first.y + first.height) return null;
  return { kind: 'segment', index: Math.floor(p.x / SEGMENT_WIDTH) };
}
