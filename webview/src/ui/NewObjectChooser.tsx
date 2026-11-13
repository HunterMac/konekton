import type { ReactNode } from 'react';
import type { NodeInit, NodeKind } from '../store';
import { useBoard, useBoardStore } from '../useBoard';
import { Codicon, RectangleIcon, StickyIcon } from './icons';

const CHOICES: { kind: NodeKind; label: string; icon: ReactNode }[] = [
  { kind: 'sticky', label: 'Sticky note', icon: <StickyIcon /> },
  { kind: 'rectangle', label: 'Rectangle', icon: <RectangleIcon /> },
  { kind: 'file', label: 'File reference', icon: <Codicon name="file" /> },
  { kind: 'link', label: 'Link', icon: <Codicon name="link" /> },
];

/** Shown when a line is released on empty space: pick the object to create there and connect. */
export function NewObjectChooser({ origin }: { origin: { left: number; top: number } }) {
  const store = useBoardStore();
  const chooser = useBoard((s) => s.chooser);
  const fileReferences = useBoard((s) => s.features.fileReferences);
  if (!chooser) return null;
  const choices = fileReferences ? CHOICES : CHOICES.filter((c) => c.kind !== 'file');

  const close = () => store.getState().setChooser(null);
  const choose = async (kind: NodeKind) => {
    const api = store.getState();
    api.setChooser(null);
    const init: NodeInit = { kind, center: chooser.at };
    if (kind === 'file') {
      const path = await api.pickFile();
      if (!path) return;
      init.file = path;
    } else if (kind === 'link') {
      const url = await api.promptUrl();
      if (!url) return;
      init.url = url;
    }
    api.createNode(init, { nodeId: chooser.sourceNodeId, side: chooser.sourceSide, offset: chooser.sourceOffset });
  };

  return (
    <>
      <div className="eb-backdrop" onPointerDown={close} onContextMenu={(e) => e.preventDefault()} />
      <div className="eb-menu eb-ui" style={{ left: chooser.screen.x - origin.left, top: chooser.screen.y - origin.top }}>
        {choices.map((c) => (
          <button key={c.kind} type="button" className="eb-menu-item" onClick={() => void choose(c.kind)}>
            {c.icon}
            {c.label}
          </button>
        ))}
      </div>
    </>
  );
}
