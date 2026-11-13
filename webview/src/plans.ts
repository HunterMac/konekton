import { PLAN_NAMES, boardNodes, type BoardNode, type CanvasDoc, type Plan, type PlanType, type Status } from '../../src/shared/canvasFormat';

export type Mode = 'chaos' | 'board' | 'timeline';

const DEFAULT_PLANS: Record<PlanType, Plan> = {
  board: { id: 'board-default', type: 'board', name: PLAN_NAMES.board, items: [], extra: {} },
  timeline: { id: 'timeline-default', type: 'timeline', name: PLAN_NAMES.timeline, items: [], extra: {} },
};

/** The Phase 1 plan of this type: the first one in the file, or a default that is not saved yet. */
export function planOf(doc: CanvasDoc, type: PlanType): Plan {
  return doc.plans.find((p) => p.type === type) ?? DEFAULT_PLANS[type];
}

/** Plan items that point to visible nodes, in order. */
export function planNodes(doc: CanvasDoc, plan: Plan): BoardNode[] {
  const byId = new Map(boardNodes(doc).map((n) => [n.id, n]));
  const out: BoardNode[] = [];
  for (const id of plan.items) {
    const n = byId.get(id);
    if (n) out.push(n);
  }
  return out;
}

/** Return the doc with `plan` stored: replaces the plan with the same id, or appends it. */
export function withPlan(doc: CanvasDoc, plan: Plan): CanvasDoc {
  const exists = doc.plans.some((p) => p.id === plan.id);
  return { ...doc, plans: exists ? doc.plans.map((p) => (p.id === plan.id ? plan : p)) : [...doc.plans, plan] };
}

/** Remove node ids from every plan. Plans that do not contain them stay the same object. */
export function withoutNodes(doc: CanvasDoc, ids: ReadonlySet<string>): CanvasDoc {
  if (!doc.plans.some((p) => p.items.some((i) => ids.has(i)))) return doc;
  return { ...doc, plans: doc.plans.map((p) => (p.items.some((i) => ids.has(i)) ? { ...p, items: p.items.filter((i) => !ids.has(i)) } : p)) };
}

export function statusOf(n: BoardNode): Status {
  return n.status ?? 'todo';
}

/** Which plans each node is in. Built once per doc change. */
export function membership(doc: CanvasDoc): Map<string, PlanType[]> {
  const out = new Map<string, PlanType[]>();
  for (const type of ['board', 'timeline'] as const) {
    const plan = doc.plans.find((p) => p.type === type);
    if (!plan) continue;
    for (const id of plan.items) {
      const list = out.get(id);
      if (list) list.push(type);
      else out.set(id, [type]);
    }
  }
  return out;
}

/**
 * Move `id` inside `items` so it sits at lane position `index`. `lane` holds the ids of the target
 * lane in plan order, without `id`. The card goes before `lane[index]`, or after the last lane card.
 */
export function placeInLane(items: readonly string[], id: string, lane: readonly string[], index: number): string[] {
  const rest = items.filter((i) => i !== id);
  const before = index < lane.length ? lane[index] : undefined;
  if (before !== undefined) {
    const at = rest.indexOf(before);
    if (at >= 0) return [...rest.slice(0, at), id, ...rest.slice(at)];
  }
  const last = lane[lane.length - 1];
  const at = last !== undefined ? rest.indexOf(last) : -1;
  if (at >= 0) return [...rest.slice(0, at + 1), id, ...rest.slice(at + 1)];
  return [...rest, id];
}
