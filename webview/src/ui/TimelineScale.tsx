import { Panel } from '@xyflow/react';
import { SCALES, type Scale } from '../layout/dates';

const LABELS: Record<Scale, string> = { days: 'Days', weeks: 'Weeks', months: 'Months' };

/** Top right of the Timeline: the size of one segment of the arrow. */
export function TimelineScale({ scale, onChange }: { scale: Scale; onChange(scale: Scale): void }) {
  return (
    <Panel position="top-right" className="eb-ui eb-scale">
      {SCALES.map((s) => (
        <button key={s} type="button" className={`eb-btn eb-switch${scale === s ? ' active' : ''}`} onClick={() => onChange(s)}>
          {LABELS[s]}
        </button>
      ))}
    </Panel>
  );
}
