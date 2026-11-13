import { ViewportPortal } from '@xyflow/react';
import type { Mode } from '../plans';
import type { PlanLayout } from '../layout/types';
import { GAP } from '../layout/types';

/**
 * Lanes, the timeline arrow, the today mark and the Unscheduled area. Drawn in flow coordinates, so
 * it pans and zooms with the cards. It sits behind the cards and ignores the pointer.
 */
export function PlanBackground({ mode, layout, activeKey }: { mode: Mode; layout: PlanLayout; activeKey: string | null }) {
  const segments = layout.regions.filter((r) => r.key.startsWith('segment:'));
  // The columns above the arrow reach as high as the highest stacked card.
  const top = Math.min(0, ...layout.cards.map((c) => c.y)) - GAP;
  const first = segments[0];
  const last = segments[segments.length - 1];
  return (
    <ViewportPortal>
      <div className="eb-plan-bg">
        {layout.regions.map((r) => {
          const isSegment = r.key.startsWith('segment:');
          const cls = [
            'eb-region',
            mode === 'board' ? 'lane' : isSegment ? 'segment' : 'unscheduled',
            r.highlight ? 'today' : '',
            activeKey === r.key ? 'active' : '',
          ].join(' ');
          return (
            <div key={r.key}>
              {isSegment && <div className={`eb-column${r.highlight ? ' today' : ''}${activeKey === r.key ? ' active' : ''}`} style={{ left: r.x, top, width: r.width, height: -top }} />}
              <div className={cls} style={{ left: r.x, top: r.y, width: r.width, height: r.height }}>
                <span className="eb-region-label">{r.label}</span>
              </div>
            </div>
          );
        })}
        {first && last && <div className="eb-arrow-head" style={{ left: last.x + last.width, top: first.y }} />}
      </div>
    </ViewportPortal>
  );
}
