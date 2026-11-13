import { STATUSES, type BoardNode, type Status } from '../../../src/shared/canvasFormat';
import { statusOf } from '../plans';
import { STATUS_LABELS } from '../ui/statusLabels';
import { CARD, GAP, type CardBox, type PlanLayout, type Point, type Region } from './types';

export const LANE_WIDTH = CARD.width + 2 * GAP;
export const LANE_HEADER = 36;
export const LANE_MIN_HEIGHT = 240;

const laneKey = (s: Status) => `lane:${s}`;

/** Three lanes side by side. Cards sit in the lane of their status, in the order of `nodes`. */
export function layoutBoard(nodes: BoardNode[]): PlanLayout {
  const cards: CardBox[] = [];
  const counts = STATUSES.map((status) => nodes.filter((n) => statusOf(n) === status).length);
  const height = Math.max(LANE_MIN_HEIGHT, LANE_HEADER + GAP + Math.max(...counts) * (CARD.height + GAP));
  const regions: Region[] = STATUSES.map((status, i) => ({
    key: laneKey(status),
    label: STATUS_LABELS[status],
    x: i * LANE_WIDTH,
    y: 0,
    width: LANE_WIDTH,
    height,
  }));
  STATUSES.forEach((status, lane) => {
    nodes
      .filter((n) => statusOf(n) === status)
      .forEach((n, row) => {
        cards.push({ id: n.id, x: lane * LANE_WIDTH + GAP, y: LANE_HEADER + GAP + row * (CARD.height + GAP), width: CARD.width, height: CARD.height });
      });
  });
  return { cards, regions };
}

/** Lane under `p` and the index between the lane cards (the dragged card ignored). Null outside every lane. */
export function boardDropTarget(layout: PlanLayout, nodes: BoardNode[], dragged: string, p: Point): { status: Status; index: number } | null {
  const lane = STATUSES.findIndex((s) => {
    const r = layout.regions.find((x) => x.key === laneKey(s));
    return r !== undefined && p.x >= r.x && p.x < r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
  });
  if (lane < 0) return null;
  const status = STATUSES[lane];
  const boxes = new Map(layout.cards.map((c) => [c.id, c]));
  const others = nodes.filter((n) => n.id !== dragged && statusOf(n) === status);
  let index = 0;
  for (const n of others) {
    const box = boxes.get(n.id);
    if (box && p.y > box.y + box.height / 2) index++;
  }
  return { status, index };
}
