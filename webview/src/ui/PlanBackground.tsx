import { ViewportPortal } from '@xyflow/react';
import type { Mode } from '../plans';
import type { PlanLayout } from '../layout/types';
import { GAP } from '../layout/types';
import { ARROW_HEIGHT } from '../layout/timelineLayout';

/** Depth of the point and the notch of a timeline segment. Must match `--eb-chevron` in styles.css. */
const CHEVRON = ARROW_HEIGHT / 2;

/** One of four colors, by segment index, so a segment keeps its color while the view pans. */
const colorOf = (key: string) => (((Number(key.slice('segment:'.length)) % 4) + 4) % 4);

/**
 * Lanes, the timeline arrow, the today mark and the Unscheduled area. Drawn in flow coordinates, so
 * it pans and zooms with the cards. It sits behind the cards and ignores the pointer.
 */
export function PlanBackground({ mode, layout, activeKey }: { mode: Mode; layout: PlanLayout; activeKey: string | null }) {
  // The columns above the arrow reach as high as the highest stacked card.
  const top = Math.min(0, ...layout.cards.map((c) => c.y)) - GAP;
  return (
    <ViewportPortal>
      <div className="eb-plan-bg">
        {layout.regions.map((r) => {
          const isSegment = r.key.startsWith('segment:');
          const cls = [
            'eb-region',
            mode === 'board' ? 'lane' : isSegment ? `segment c${colorOf(r.key)}` : 'unscheduled',
            r.highlight ? 'today' : '',
            activeKey === r.key ? 'active' : '',
          ].join(' ');
          return (
            <div key={r.key}>
              {isSegment && <div className={`eb-column${r.highlight ? ' today' : ''}${activeKey === r.key ? ' active' : ''}`} style={{ left: r.x, top, width: r.width, height: -top }} />}
              {/* A segment reaches into the notch of the next one, so the arrow reads >===>===>. */}
              <div className={cls} style={{ left: r.x, top: r.y, width: r.width + (isSegment ? CHEVRON : 0), height: r.height }}>
                <span className="eb-region-label">{r.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ViewportPortal>
  );
}
