import type { PointerEvent } from 'react';
import { BaseEdge, ViewportPortal, useReactFlow, useStore, type Edge, type EdgeProps } from '@xyflow/react';
import { boardNodes, type BoardEdge } from '../../../src/shared/canvasFormat';
import { anchorPoint, contains, curveBetween, hitTest, nearestBorderAnchor, type Point, type Rect } from '../geometry';
import { useBoard, useBoardStore } from '../useBoard';
import type { EndpointDrag } from '../store';
import { EdgeLabel } from './EdgeLabel';
import { LineToolbar } from '../ui/LineToolbar';
import { useTaskAnchor } from './taskAnchors';

export interface CurvedEdgeData extends Record<string, unknown> {
  model: BoardEdge;
  fromRect: Rect;
  toRect: Rect;
}

export type CurvedRFEdge = Edge<CurvedEdgeData, 'curved'>;

/** How far outside its own object an end can be dragged and still slide along that object (screen px). */
const OWN_NODE_MARGIN_PX = 24;

const ARROW = 'url(#eb-arrow)';

export function CurvedEdge({ id, data, selected }: EdgeProps<CurvedRFEdge>) {
  const { model, fromRect, toRect } = data as CurvedEdgeData;
  const store = useBoardStore();
  const rf = useReactFlow();
  const zoom = useStore((s) => s.transform[2]);
  const drag = useBoard((s) => (s.endpointDrag?.edgeId === id ? s.endpointDrag : null));
  const showToolbar = useBoard((s) => s.selEdges.length === 1 && s.selEdges[0] === id && s.selNodes.length === 0 && s.labelEditing !== id);

  // A line that starts at a task follows the row of the task.
  const taskAt = useTaskAnchor(model.fromNode, model.fromSide === 'right' ? model.fromTask : undefined);
  let start = anchorPoint(fromRect, model.fromSide, taskAt ?? model.fromOffset);
  let end = anchorPoint(toRect, model.toSide, model.toOffset);
  let fromSide = model.fromSide;
  let toSide = model.toSide;
  if (drag) {
    const point = drag.hover ? drag.hover.point : drag.pointer;
    if (drag.end === 'from') {
      start = point;
      fromSide = drag.hover ? drag.hover.anchor.side : fromSide;
    } else {
      end = point;
      toSide = drag.hover ? drag.hover.anchor.side : toSide;
    }
  }
  const curve = curveBetween(start, fromSide, end, toSide);

  const hoverFor = (end: 'from' | 'to', p: Point): EndpointDrag['hover'] => {
    const zoom = rf.getZoom();
    const nodes = boardNodes(store.getState().doc);
    const ownId = end === 'from' ? model.fromNode : model.toNode;
    const otherId = end === 'from' ? model.toNode : model.fromNode;
    let target = hitTest(nodes, p);
    if (!target) {
      const own = nodes.find((n) => n.id === ownId);
      const margin = OWN_NODE_MARGIN_PX / zoom;
      if (own && contains({ x: own.x - margin, y: own.y - margin, width: own.width + 2 * margin, height: own.height + 2 * margin }, p)) target = own;
    }
    if (!target || target.id === otherId) return undefined;
    const anchor = nearestBorderAnchor(target, p, zoom);
    return { nodeId: target.id, anchor, point: anchorPoint(target, anchor.side, anchor.offset) };
  };

  const startDrag = (which: 'from' | 'to') => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    store.getState().setEndpointDrag({ edgeId: id, end: which, pointer: p, hover: hoverFor(which, p) });
  };
  const moveDrag = (which: 'from' | 'to') => (e: PointerEvent<HTMLDivElement>) => {
    if (store.getState().endpointDrag?.edgeId !== id) return;
    const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    store.getState().setEndpointDrag({ edgeId: id, end: which, pointer: p, hover: hoverFor(which, p) });
  };
  const endDrag = (which: 'from' | 'to') => (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.releasePointerCapture(e.pointerId);
    const d = store.getState().endpointDrag;
    store.getState().setEndpointDrag(null);
    // Drop on empty space cancels the change.
    if (d && d.edgeId === id && d.hover) store.getState().reconnect(id, which, d.hover.nodeId, d.hover.anchor);
  };

  // The dots live above the objects (and their balls), at a constant screen size.
  const dot = (which: 'from' | 'to', p: Point) => (
    <div
      className="eb-endpoint nodrag nopan"
      style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${1 / zoom}) translate(-50%, -50%)` }}
      onPointerDown={startDrag(which)}
      onPointerMove={moveDrag(which)}
      onPointerUp={endDrag(which)}
      onPointerCancel={() => store.getState().setEndpointDrag(null)}
    />
  );

  return (
    <>
      {selected && <path d={curve.path} className="eb-edge-halo" />}
      <BaseEdge
        id={id}
        path={curve.path}
        interactionWidth={12}
        className="eb-edge"
        markerStart={model.fromEnd === 'arrow' ? ARROW : undefined}
        markerEnd={model.toEnd === 'arrow' ? ARROW : undefined}
      />
      <ViewportPortal>
        <EdgeLabel edgeId={id} label={model.label} at={curve.mid} />
        {selected && dot('from', start)}
        {selected && dot('to', end)}
        {showToolbar && !drag && <LineToolbar edge={model} at={curve.mid} zoom={zoom} hasLabel={model.label !== ''} />}
      </ViewportPortal>
    </>
  );
}
