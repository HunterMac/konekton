import { PLAN_NAMES, type BoardNode, type PlanType } from '../../../src/shared/canvasFormat';
import { shortDate } from '../layout/dates';
import { statusOf } from '../plans';
import { STATUS_LABELS } from '../ui/statusLabels';
import { Codicon } from '../ui/icons';

/** Data every Chaos object gets from `App.tsx`. */
export interface ObjectData<M extends BoardNode> extends Record<string, unknown> {
  model: M;
  /** The plans this object is in. */
  plans?: PlanType[];
}

export const isDone = (node: BoardNode): boolean => node.status === 'done';

function tooltip(node: BoardNode, plans: PlanType[]): string {
  const parts = [plans.map((p) => PLAN_NAMES[p]).join(' + ')];
  parts.push(STATUS_LABELS[statusOf(node)]);
  if (node.date !== undefined) parts.push(shortDate(node.date));
  return parts.join(' · ');
}

/** Small dots in the top right corner, one per plan the object is in, and a check mark when done. */
export function PlanBadges({ node, plans = [] }: { node: BoardNode; plans?: PlanType[] }) {
  const done = isDone(node);
  if (plans.length === 0 && !done) return null;
  return (
    <div className="eb-badges" title={tooltip(node, plans)}>
      {done && <Codicon name="check" className="eb-badge-check" />}
      {plans.map((p) => (
        <span key={p} className={`eb-badge-dot ${p}`} />
      ))}
    </div>
  );
}
