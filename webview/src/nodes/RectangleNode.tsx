import type { NodeProps, Node } from '@xyflow/react';
import { resolveColor, type RectangleNode as RectangleModel } from '../../../src/shared/canvasFormat';
import { useBoard, useBoardStore } from '../useBoard';
import { EditableText } from '../ui/EditableText';
import { TextToolbar } from '../ui/TextToolbar';
import { ConnectionBalls } from './ConnectionBalls';
import { PlanBadges, isDone, type ObjectData } from './PlanBadges';
import { ResizeCorner } from './ResizeCorner';

export type RectangleRFNode = Node<ObjectData<RectangleModel>, 'rectangle'>;

export function RectangleNode({ id, data }: NodeProps<RectangleRFNode>) {
  const node = data.model;
  const store = useBoardStore();
  const editing = useBoard((s) => (s.editing?.nodeId === id ? s.editing.field : null));
  const colors = resolveColor(node.color) ?? { fill: '#FFFFFF', border: '#C4C4C4' };
  const showTitle = node.title !== '' || editing === 'title';

  return (
    <>
      <TextToolbar node={node} />
      <div
        className={`eb-node eb-rectangle${isDone(node) ? ' eb-done' : ''}`}
        style={{ background: colors.fill, borderColor: colors.border, textAlign: node.align, fontSize: node.fontSize, fontWeight: node.bold ? 700 : 400 }}
      >
        {showTitle && (
          <EditableText
            className="eb-rect-title"
            style={{ fontSize: node.fontSize + 2, fontWeight: 700 }}
            multiline={false}
            value={node.title}
            editing={editing === 'title'}
            onCommit={(title) => store.getState().updateNode(id, { title })}
            onExit={(reason) => store.getState().setEditing(reason === 'next' ? { nodeId: id, field: 'body' } : null)}
            onDoubleClick={() => store.getState().setEditing({ nodeId: id, field: 'title' })}
          />
        )}
        <EditableText
          className="eb-rect-body"
          value={node.text}
          editing={editing === 'body'}
          onCommit={(text) => store.getState().updateNode(id, { text })}
          onExit={(reason) => store.getState().setEditing(reason === 'next' ? { nodeId: id, field: 'title' } : null)}
          onDoubleClick={() => store.getState().setEditing({ nodeId: id, field: 'body' })}
        />
      </div>
      <PlanBadges node={node} plans={data.plans} />
      <ConnectionBalls />
      <ResizeCorner id={id} />
    </>
  );
}
