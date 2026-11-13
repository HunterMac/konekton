import {
  boardNodes,
  isBoardEdge,
  newId,
  parse,
  serialize,
  type BoardEdge,
  type BoardNode,
  type CanvasDoc,
} from '../../src/shared/canvasFormat';
import { boundsOf, snap, type Point } from './geometry';

export const CLIPBOARD_MIME = 'application/x-konekton+json';

export interface Fragment {
  nodes: BoardNode[];
  edges: BoardEdge[];
}

/** JSON text for the selected objects, or null when nothing is selected. Only lines with both ends selected are copied. */
export function buildFragment(doc: CanvasDoc, nodeIds: readonly string[]): string | null {
  const ids = new Set(nodeIds);
  const nodes = boardNodes(doc).filter((n) => ids.has(n.id));
  if (nodes.length === 0) return null;
  const edges = doc.edges.filter(isBoardEdge).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
  return serialize({ nodes, edges, plans: [], otherPlans: [], konektonExtra: {}, extra: {} });
}

/** Parse clipboard text as a fragment. Returns null for anything that is not a board fragment. */
export function parseFragment(text: string): Fragment | null {
  const r = parse(text);
  if (!r.ok || r.empty) return null;
  const nodes = boardNodes(r.doc);
  if (nodes.length === 0) return null;
  const ids = new Set(nodes.map((n) => n.id));
  const edges = r.doc.edges.filter(isBoardEdge).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
  return { nodes, edges };
}

/** Copy of a fragment with new ids, moved by `delta`. Edge ends are remapped. Status and date are dropped. */
export function instantiate(fragment: Fragment, delta: Point): Fragment {
  const idMap = new Map<string, string>();
  const nodes = fragment.nodes.map((n) => {
    const id = newId();
    idMap.set(n.id, id);
    // A copy is a new idea, not the same task: it starts without status and date.
    const { status: _status, date: _date, ...rest } = n;
    return { ...rest, id, x: n.x + delta.x, y: n.y + delta.y };
  });
  const edges = fragment.edges.map((e) => ({
    ...e,
    id: newId(),
    fromNode: idMap.get(e.fromNode) as string,
    toNode: idMap.get(e.toNode) as string,
  }));
  return { nodes, edges };
}

/** Delta that puts the top-left of the fragment at `target` (snapped to `gridStep` when given). */
export function deltaToPlace(fragment: Fragment, target: Point, gridStep?: number): Point {
  const b = boundsOf(fragment.nodes);
  if (!b) return { x: 0, y: 0 };
  const x = gridStep ? snap(target.x, gridStep) : target.x;
  const y = gridStep ? snap(target.y, gridStep) : target.y;
  return { x: x - b.x, y: y - b.y };
}
