import { Panel } from '@xyflow/react';
import { useBoard, useBoardStore } from '../useBoard';
import type { Mode } from '../plans';

const VIEWS: { mode: Mode; label: string; title: string }[] = [
  { mode: 'chaos', label: 'Chaos', title: 'Create: the free board' },
  { mode: 'board', label: 'Board', title: 'Plan: Todo, In progress, Done' },
  { mode: 'timeline', label: 'Timeline', title: 'Do: items on a date arrow' },
];

/** Top center: switch between Chaos, Board and Timeline. */
export function ViewSwitcher() {
  const store = useBoardStore();
  const mode = useBoard((s) => s.mode);
  return (
    <Panel position="top-center" className="eb-ui eb-switcher">
      {VIEWS.map((v) => (
        <button
          key={v.mode}
          type="button"
          className={`eb-btn eb-switch${mode === v.mode ? ' active' : ''}`}
          title={v.title}
          onClick={() => store.getState().setMode(v.mode)}
        >
          {v.label}
        </button>
      ))}
    </Panel>
  );
}
