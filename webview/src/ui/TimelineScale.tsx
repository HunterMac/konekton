import { SCALES, type Scale } from '../layout/dates';

const LABELS: Record<Scale, string> = { days: 'Days', weeks: 'Weeks', months: 'Months' };

/** Right of the view switcher in the Timeline: the size of one segment of the arrow. Goes inside `ViewSwitcher`. */
export function TimelineScale({ scale, onChange }: { scale: Scale; onChange(scale: Scale): void }) {
  return (
    <div className="eb-chip-bar eb-scale">
      {SCALES.map((s) => (
        <button key={s} type="button" className={`eb-chip${scale === s ? ' active' : ''}`} onClick={() => onChange(s)}>
          {LABELS[s]}
        </button>
      ))}
    </div>
  );
}
