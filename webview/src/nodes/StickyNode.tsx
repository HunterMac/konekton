import type { NodeProps, Node } from '@xyflow/react';
import { resolveColor, type StickyNode as StickyModel } from '../../../src/shared/canvasFormat';
import { useBoard, useBoardStore } from '../useBoard';
import { EditableText } from '../ui/EditableText';
import { TextToolbar } from '../ui/TextToolbar';
import { ConnectionBalls } from './ConnectionBalls';
import { PlanBadges, isDone, type ObjectData } from './PlanBadges';
import { ResizeCorner } from './ResizeCorner';

export type StickyRFNode = Node<ObjectData<StickyModel>, 'sticky'>;

export function StickyNode({ id, data }: NodeProps<StickyRFNode>) {
  const node = data.model;
  const store = useBoardStore();
  const editing = useBoard((s) => s.editing?.nodeId === id);
  const fill = resolveColor(node.color)?.fill ?? '#FFF9B1';

  return (
    <>
      <TextToolbar node={node} />
      <div
        className={`eb-node eb-sticky${isDone(node) ? ' eb-done' : ''}`}
        style={{ background: fill, textAlign: node.align, fontSize: node.fontSize, fontWeight: node.bold ? 700 : 400 }}
        onDoubleClick={() => store.getState().setEditing({ nodeId: id, field: 'body' })}
      >
        <EditableText
          value={node.text}
          editing={editing}
          onCommit={(text) => store.getState().updateNode(id, { text })}
          onExit={() => store.getState().setEditing(null)}
        />
      </div>
      <PlanBadges node={node} plans={data.plans} />
      <ConnectionBalls />
      <ResizeCorner id={id} square />
    </>
  );
}
