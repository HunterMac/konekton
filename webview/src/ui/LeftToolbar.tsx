import { Panel } from '@xyflow/react';
import type { ReactNode } from 'react';
import { useBoard, useBoardStore } from '../useBoard';
import type { Tool } from '../store';
import { Codicon, RectangleIcon, StickyIcon } from './icons';

const TOOLS: { tool: Tool; title: string; icon: ReactNode }[] = [
  { tool: 'select', title: 'Select', icon: <Codicon name="cursor" /> },
  { tool: 'sticky', title: 'Sticky note', icon: <StickyIcon /> },
  { tool: 'rectangle', title: 'Rectangle', icon: <RectangleIcon /> },
  { tool: 'file', title: 'File reference (or drag files from the Explorer while holding Shift)', icon: <Codicon name="file" /> },
  { tool: 'link', title: 'Link', icon: <Codicon name="link" /> },
];

/** Vertical tool palette. Pick a tool, then click the board. */
export function LeftToolbar() {
  const store = useBoardStore();
  const tool = useBoard((s) => s.tool);
  const fileReferences = useBoard((s) => s.features.fileReferences);
  const tools = fileReferences ? TOOLS : TOOLS.filter((t) => t.tool !== 'file');
  return (
    <Panel position="center-left" className="eb-ui eb-left-toolbar">
      {tools.map((t) => (
        <button
          key={t.tool}
          type="button"
          className={`eb-btn eb-tool${tool === t.tool ? ' active' : ''}`}
          title={t.title}
          onClick={() => store.getState().setTool(t.tool)}
        >
          {t.icon}
        </button>
      ))}
    </Panel>
  );
}
