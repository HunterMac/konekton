import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  getViewportForBounds,
  useReactFlow,
  useStore,
  useStoreApi,
  type Connection,
  type EdgeChange,
  type FinalConnectionState,
  type Node,
  type NodeChange,
  type Viewport,
} from '@xyflow/react';
import { boardNodes, drawableEdges, isBoardNode, type Side } from '../../src/shared/canvasFormat';
import { GRID_STEP } from './store';
import { CLIPBOARD_MIME } from './clipboard';
import { boundsOf, hitTest, nearestBorderAnchor, type Point, type Rect } from './geometry';
import { intersects, snapMove } from './snapping';
import { useBoard, useBoardStore } from './useBoard';
import { loadViewState, updateViewState, type SavedViewport } from './host';
import { membership, planNodes, planOf, type Mode } from './plans';
import { dropDate, originFor, today, type Scale } from './layout/dates';
import { boardDropTarget, layoutBoard } from './layout/boardLayout';
import { SEGMENT_WIDTH, UNSCHEDULED_KEY, layoutTimeline, timelineDropTarget } from './layout/timelineLayout';
import { CARD, type PlanLayout } from './layout/types';
import { StickyNode } from './nodes/StickyNode';
import { RectangleNode } from './nodes/RectangleNode';
import { FileNode } from './nodes/FileNode';
import { LinkNode } from './nodes/LinkNode';
import { CardNode } from './nodes/CardNode';
import { CurvedEdge, type CurvedRFEdge } from './edges/CurvedEdge';
import { ConnectionLine } from './edges/ConnectionLine';
import { LeftToolbar } from './ui/LeftToolbar';
import { ZoomControls } from './ui/ZoomControls';
import { NewObjectChooser } from './ui/NewObjectChooser';
import { ContextMenu } from './ui/ContextMenu';
import { SnapGuides } from './ui/SnapGuides';
import { ViewSwitcher } from './ui/ViewSwitcher';
import { TimelineScale } from './ui/TimelineScale';
import { PlanBackground } from './ui/PlanBackground';

const nodeTypes = { sticky: StickyNode, rectangle: RectangleNode, file: FileNode, link: LinkNode, card: CardNode };
const edgeTypes = { curved: CurvedEdge };

type Move = { id: string; x: number; y: number };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
/** Length of the switch between views. */
const MORPH_MS = 300;
/** Segments shown beyond the visible part of the Timeline arrow. */
const RANGE_MARGIN = 4;
/** The most segments the arrow draws at once, so a far zoom-out stays light. */
const MAX_SEGMENTS = 300;

const EMPTY_HINTS: Record<'board' | 'timeline', string> = {
  board: 'Nothing here yet. In Chaos, right-click an item and choose Add to Board.',
  timeline: 'Nothing here yet. In Chaos, right-click an item and choose Add to Timeline.',
};

const prefersReducedMotion = (): boolean => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** What the switch between two views animates: nodes that leave fade out, nodes that enter fade in. */
interface Morph {
  ghosts: Node[];
  entering: ReadonlySet<string>;
}

const isTextField = (target: EventTarget | null): boolean => {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

export function App() {
  const ready = useBoard((s) => s.ready);
  if (!ready) return <div className="eb-loading" />;
  return (
    <ReactFlowProvider>
      <Board />
    </ReactFlowProvider>
  );
}

function ArrowMarkers() {
  return (
    <svg className="eb-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <marker id="eb-arrow" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="12" markerHeight="12" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
          <path d="M1 1.5L10.5 6L1 10.5z" fill="#1A1A1A" stroke="#1A1A1A" strokeWidth="1" strokeLinejoin="round" />
        </marker>
      </defs>
    </svg>
  );
}

function Board() {
  const store = useBoardStore();
  const rf = useReactFlow();
  const rootRef = useRef<HTMLDivElement>(null);
  const initial = useMemo(() => loadViewState(), []);
  const viewports = useRef(initial.viewports ?? {});
  const savedViewport = useMemo(() => viewports.current[store.getState().mode], [store]);
  const [scale, setScale] = useState<Scale>(initial.timelineScale ?? 'days');
  const [dragPreview, setDragPreview] = useState<{ id: string; x: number; y: number } | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [morph, setMorph] = useState<Morph | null>(null);

  const doc = useBoard((s) => s.doc);
  const selNodes = useBoard((s) => s.selNodes);
  const selEdges = useBoard((s) => s.selEdges);
  const editingId = useBoard((s) => s.editing?.nodeId ?? null);
  const gridEnabled = useBoard((s) => s.settings.gridEnabled);
  const tool = useBoard((s) => s.tool);
  const parseError = useBoard((s) => s.parseError);
  const dropHint = useBoard((s) => s.dropHint);
  const mode = useBoard((s) => s.mode);
  const [todayDate, setTodayDate] = useState(today);

  // The date moves on at midnight. A check each minute also catches a wake from sleep, and a tab shown again.
  useEffect(() => {
    const check = () => setTodayDate(today());
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);

  // Every mode change is saved, whether it came from the switcher or from "Show in Chaos".
  useEffect(() => {
    updateViewState({ mode });
  }, [mode]);

  const viewCenter = useCallback((): Point => {
    const rect = rootRef.current?.getBoundingClientRect();
    return rf.screenToFlowPosition({ x: (rect?.left ?? 0) + (rect?.width ?? 0) / 2, y: (rect?.top ?? 0) + (rect?.height ?? 0) / 2 });
  }, [rf]);

  const origin = () => {
    const r = rootRef.current?.getBoundingClientRect();
    return { left: r?.left ?? 0, top: r?.top ?? 0 };
  };

  // --- Derived React Flow state ------------------------------------------------------------

  // The visible part of the Timeline arrow, in segments. A string, so panning inside one segment does not re-render.
  // Other views do not use it, so there it stays constant and panning never re-renders.
  const rangeKey = useStore((st) => {
    if (mode !== 'timeline') return '0:0';
    const [x, , zoom] = st.transform;
    const from = Math.floor(-x / zoom / SEGMENT_WIDTH) - RANGE_MARGIN;
    const to = Math.ceil((-x + st.width) / zoom / SEGMENT_WIDTH) + RANGE_MARGIN;
    return `${from}:${Math.min(to, from + MAX_SEGMENTS)}`;
  });
  const range = useMemo(() => {
    const [from, to] = rangeKey.split(':').map(Number);
    return { from, to };
  }, [rangeKey]);

  const planned = useMemo(() => (mode === 'chaos' ? [] : planNodes(doc, planOf(doc, mode))), [doc, mode]);
  const layout = useMemo<PlanLayout | null>(
    () => (mode === 'board' ? layoutBoard(planned) : mode === 'timeline' ? layoutTimeline(planned, scale, todayDate, range) : null),
    [mode, planned, scale, todayDate, range],
  );
  const plansOf = useMemo(() => membership(doc), [doc]);

  /** Latest values for handlers that run inside React Flow callbacks. */
  const live = useRef({ layout, planned, scale, todayDate });
  useEffect(() => {
    live.current = { layout, planned, scale, todayDate };
  }, [layout, planned, scale, todayDate]);

  const baseNodes = useMemo<Node[]>(() => {
    const selected = new Set(selNodes);
    if (layout) {
      const models = new Map(planned.map((n) => [n.id, n]));
      return layout.cards.map((box) => {
        const at = dragPreview?.id === box.id ? dragPreview : box;
        return {
          id: box.id,
          type: 'card',
          position: { x: at.x, y: at.y },
          width: box.width,
          height: box.height,
          measured: { width: box.width, height: box.height },
          data: { model: models.get(box.id)!, showDate: mode === 'timeline' },
          selected: selected.has(box.id),
          connectable: false,
        };
      });
    }
    return boardNodes(doc).map((n) => ({
      id: n.id,
      type: n.kind,
      position: { x: n.x, y: n.y },
      width: n.width,
      height: n.height,
      // Without `measured`, React Flow drops the handle bounds on every update and lines flicker.
      measured: { width: n.width, height: n.height },
      data: { model: n, plans: plansOf.get(n.id) },
      selected: selected.has(n.id),
      draggable: editingId !== n.id,
    }));
  }, [doc, selNodes, editingId, layout, planned, dragPreview, mode, plansOf]);

  const nodes = useMemo<Node[]>(() => {
    if (!morph) return baseNodes;
    const entering = baseNodes.map((n) => (morph.entering.has(n.id) ? { ...n, className: 'eb-entering' } : n));
    return [...entering, ...morph.ghosts];
  }, [baseNodes, morph]);

  const edges = useMemo<CurvedRFEdge[]>(() => {
    if (mode !== 'chaos') return [];
    const rects = new Map(boardNodes(doc).map((n) => [n.id, n]));
    const selected = new Set(selEdges);
    return drawableEdges(doc).map((e) => ({
      id: e.id,
      type: 'curved',
      source: e.fromNode,
      target: e.toNode,
      sourceHandle: e.fromSide,
      targetHandle: e.toSide,
      selected: selected.has(e.id),
      data: { model: e, fromRect: rects.get(e.fromNode)!, toRect: rects.get(e.toNode)! },
    }));
  }, [doc, selEdges, mode]);

  // --- Viewport per view, and the switch between views -------------------------------------

  const rememberViewport = useCallback(
    (at: Mode, viewport: SavedViewport) => {
      viewports.current = { ...viewports.current, [at]: viewport };
      updateViewState({ viewports: viewports.current });
    },
    [],
  );

  /** A viewport that shows the whole view, never zoomed in past 100%. */
  const homeViewport = (at: Mode): SavedViewport => {
    const size = rootRef.current?.getBoundingClientRect();
    const current = store.getState().doc;
    let rects: Rect[];
    if (at === 'chaos') {
      rects = boardNodes(current);
    } else if (at === 'board') {
      const l = layoutBoard(planNodes(current, planOf(current, 'board')));
      rects = [...l.regions, ...l.cards];
    } else {
      // The segments around today, and the cards that sit above them.
      const l = layoutTimeline(planNodes(current, planOf(current, 'timeline')), scale, todayDate, { from: 0, to: 7 });
      rects = [...l.regions.filter((r) => r.x < 8 * SEGMENT_WIDTH), ...l.cards.filter((c) => c.x >= 0 && c.x < 8 * SEGMENT_WIDTH)];
    }
    const bounds = boundsOf(rects);
    if (!bounds || !size || size.width === 0) return { x: 0, y: 0, zoom: 1 };
    return getViewportForBounds(bounds, size.width, size.height, MIN_ZOOM, 1, '60px');
  };

  const morphTimer = useRef<number | undefined>(undefined);
  const lastRendered = useRef<{ mode: Mode; nodes: Node[] }>({ mode, nodes: baseNodes });
  useEffect(() => {
    lastRendered.current = { mode, nodes: baseNodes };
  }, [mode, baseNodes]);

  // First paint of a plan view that was never opened: show the whole view.
  useLayoutEffect(() => {
    if (mode !== 'chaos' && !viewports.current[mode]) void rf.setViewport(homeViewport(mode));
    // Runs once, for the mode the editor was restored in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flowStore = useStoreApi();
  const shownMode = useRef(mode);
  /** The camera a running view-switch animation moves to. Null when no animation runs. */
  const cameraTarget = useRef<{ at: Mode; viewport: SavedViewport } | null>(null);
  useLayoutEffect(() => {
    const from = shownMode.current;
    if (from === mode) return;
    shownMode.current = mode;
    const duration = prefersReducedMotion() ? 0 : MORPH_MS;

    // Each view keeps its own camera. Mid-animation, that is where the camera was going, not where it is.
    const running = cameraTarget.current;
    rememberViewport(from, running && running.at === from ? running.viewport : rf.getViewport());

    if (duration > 0) {
      const previous = lastRendered.current.nodes;
      const nowIds = new Set(baseNodes.map((n) => n.id));
      const beforeIds = new Set(previous.map((n) => n.id));
      const ghosts = previous
        .filter((n) => !nowIds.has(n.id))
        .map((n) => ({ ...n, selected: false, draggable: false, selectable: false, className: 'eb-leaving' }));
      const entering = new Set([...nowIds].filter((id) => !beforeIds.has(id)));
      setMorph({ ghosts, entering });
      window.clearTimeout(morphTimer.current);
      morphTimer.current = window.setTimeout(() => setMorph(null), duration);
    }

    const focus = store.getState().focusNode;
    const target = focus ? boardNodes(store.getState().doc).find((n) => n.id === focus) : undefined;
    if (focus) store.setState({ focusNode: null });
    let next: SavedViewport;
    if (mode === 'chaos' && target) {
      // Centered on the card, like `rf.setCenter`.
      const { width, height } = flowStore.getState();
      const zoom = viewports.current.chaos?.zoom ?? 1;
      next = { x: width / 2 - (target.x + target.width / 2) * zoom, y: height / 2 - (target.y + target.height / 2) * zoom, zoom };
    } else {
      next = viewports.current[mode] ?? homeViewport(mode);
    }
    const entry = duration > 0 ? { at: mode, viewport: next } : null;
    cameraTarget.current = entry;
    void rf.setViewport(next, { duration });
    // A timer, not the returned promise: that one never settles when a pan interrupts the animation.
    if (entry) {
      window.setTimeout(() => {
        if (cameraTarget.current === entry) cameraTarget.current = null;
      }, duration);
    }
    // Only a change of view triggers this; the rest is read when it runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  useEffect(() => () => window.clearTimeout(morphTimer.current), []);

  const watchedPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const n of boardNodes(doc)) if (n.kind === 'file' && n.file !== '') paths.add(n.file);
    return [...paths].sort();
  }, [doc]);
  const watchedKey = watchedPaths.join('\n');
  useEffect(() => {
    store.getState().watchFiles(watchedPaths);
    // `watchedKey` is the identity of the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, watchedKey]);

  // --- React Flow change handlers ----------------------------------------------------------

  /** True while Ctrl or Cmd is held: object snapping is off. */
  const snapOff = useRef(false);
  /** The running node drag: ids and the last raw (unsnapped) positions from React Flow. */
  const drag = useRef<{ ids: Set<string>; raw: Move[] } | null>(null);

  /** Move the dragged nodes to `raw` shifted onto nearby object edges (or the grid), and show the guides. */
  const applySnap = useCallback(
    (raw: Move[]) => {
      const api = store.getState();
      const dragged = drag.current?.ids ?? new Set(raw.map((m) => m.id));
      const nodes = boardNodes(api.doc);
      const sizes = new Map(nodes.map((n) => [n.id, n]));
      const rects: Rect[] = [];
      for (const m of raw) {
        const n = sizes.get(m.id);
        if (n) rects.push({ x: m.x, y: m.y, width: n.width, height: n.height });
      }
      const box = boundsOf(rects);
      if (!box) {
        api.moveNodes(raw);
        return;
      }
      const bounds = rootRef.current?.getBoundingClientRect();
      let targets = nodes.filter((n) => !dragged.has(n.id));
      if (bounds) {
        const a = rf.screenToFlowPosition({ x: bounds.left, y: bounds.top });
        const b = rf.screenToFlowPosition({ x: bounds.right, y: bounds.bottom });
        const visible = { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y };
        targets = targets.filter((n) => intersects(visible, n));
      }
      const { dx, dy, guides } = snapMove({
        box,
        ref: raw[0],
        targets,
        zoom: rf.getViewport().zoom,
        objects: !snapOff.current,
        gridStep: api.settings.gridEnabled ? GRID_STEP : undefined,
      });
      api.moveNodes(raw.map((m) => ({ id: m.id, x: m.x + dx, y: m.y + dy })));
      api.setSnapGuides(guides);
    },
    [rf, store],
  );

  /** The card being dragged in Board or Timeline. Only that one moves, even with several selected. */
  const planDragId = useRef<string | null>(null);
  const lastPreview = useRef<{ id: string; x: number; y: number } | null>(null);

  /** The lane or segment under the center of a card at `at`. */
  const planTarget = useCallback(
    (id: string, at: Point) => {
      const { layout: l, planned: nodes, scale: sc, todayDate: t } = live.current;
      const mode = store.getState().mode;
      if (!l) return null;
      const center = { x: at.x + CARD.width / 2, y: at.y + CARD.height / 2 };
      if (mode === 'board') {
        const target = boardDropTarget(l, nodes, id, center);
        return target ? { key: `lane:${target.status}`, apply: () => store.getState().moveCard('board', id, { status: target.status, index: target.index }) } : null;
      }
      const target = timelineDropTarget(l, center);
      if (!target) return null;
      if (target.kind === 'unscheduled') return { key: UNSCHEDULED_KEY, apply: () => store.getState().setDate([id], undefined) };
      const model = nodes.find((n) => n.id === id);
      return {
        key: `segment:${target.index}`,
        apply: () => store.getState().moveCard('timeline', id, { date: dropDate(model?.date, target.index, originFor(t, sc), sc) }),
      };
    },
    [store],
  );

  const onPlanChanges = useCallback(
    (changes: NodeChange[]) => {
      const api = store.getState();
      const sel = new Set(api.selNodes);
      let selChanged = false;
      for (const c of changes) {
        if (c.type === 'select') {
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
          selChanged = true;
        } else if (c.type === 'position') {
          if (c.dragging === true && c.position) {
            planDragId.current ??= c.id;
            if (planDragId.current !== c.id) continue;
            lastPreview.current = { id: c.id, x: c.position.x, y: c.position.y };
            setDragPreview(lastPreview.current);
            setActiveKey(planTarget(c.id, c.position)?.key ?? null);
          } else if (c.dragging === false && planDragId.current === c.id) {
            const at = c.position ?? lastPreview.current;
            planDragId.current = null;
            lastPreview.current = null;
            setDragPreview(null);
            setActiveKey(null);
            // One drop is one store action, so one undo step.
            if (at) planTarget(c.id, at)?.apply();
          }
        }
      }
      if (selChanged) api.setSelection([...sel], api.selEdges);
    },
    [planTarget, store],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const api = store.getState();
      if (api.mode !== 'chaos') {
        onPlanChanges(changes);
        return;
      }
      const sel = new Set(api.selNodes);
      let selChanged = false;
      let dragging = false;
      let dragEnded = false;
      const moves: Move[] = [];
      for (const c of changes) {
        if (c.type === 'select') {
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
          selChanged = true;
        } else if (c.type === 'position' && c.position) {
          moves.push({ id: c.id, x: c.position.x, y: c.position.y });
          if (c.dragging === true) dragging = true;
          if (c.dragging === false) dragEnded = true;
        }
      }
      if (moves.length > 0) {
        if (dragging || drag.current) {
          drag.current = { ids: drag.current?.ids ?? new Set(moves.map((m) => m.id)), raw: moves };
          applySnap(moves);
          // React Flow ends a drag with a change that carries the last raw position again.
          if (dragEnded) {
            api.setSnapGuides([]);
            drag.current = null;
          }
        } else {
          api.moveNodes(moves);
        }
      }
      if (selChanged) api.setSelection([...sel], api.selEdges);
    },
    [applySnap, onPlanChanges, store],
  );

  // Ctrl/Cmd switches object snapping off, also in the middle of a drag.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Meta') return;
      const off = e.ctrlKey || e.metaKey;
      if (off === snapOff.current) return;
      snapOff.current = off;
      if (drag.current) applySnap(drag.current.raw);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, [applySnap]);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const api = store.getState();
      const sel = new Set(api.selEdges);
      let selChanged = false;
      for (const c of changes) {
        if (c.type === 'select') {
          if (c.selected) sel.add(c.id);
          else sel.delete(c.id);
          selChanged = true;
        }
      }
      if (selChanged) api.setSelection(api.selNodes, [...sel]);
    },
    [store],
  );

  /** Plan drags commit through their store action, so only Chaos commits here. */
  const commit = useCallback(() => {
    if (store.getState().mode === 'chaos') store.getState().commit();
  }, [store]);

  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      const from = state.fromNode;
      const handle = state.fromHandle;
      if (!from || !handle) return;
      const touch = 'changedTouches' in event ? event.changedTouches[0] : event;
      const screen = { x: touch.clientX, y: touch.clientY };
      const target = (touch === event ? event.target : document.elementFromPoint(screen.x, screen.y)) as Element | null;
      if (target?.closest('.eb-ui')) return;

      const api = store.getState();
      const flow = rf.screenToFlowPosition(screen);
      const side = handle.id as Side;
      const hit = hitTest(boardNodes(api.doc), flow);
      if (hit) {
        if (hit.id === from.id) return;
        api.connect({ nodeId: from.id, anchor: { side, offset: 0.5 } }, { nodeId: hit.id, anchor: nearestBorderAnchor(hit, flow, rf.getZoom()) });
      } else {
        api.setChooser({ at: flow, screen, sourceNodeId: from.id, sourceSide: side, sourceOffset: 0.5 });
      }
    },
    [rf, store],
  );

  // Lines are only created in onConnectEnd: dropping on a ball must not create a second one.
  const onConnect = useCallback((_c: Connection) => {}, []);

  /** With an object tool active, a click anywhere on the board (also on an object) places a new object. */
  const placeWithTool = useCallback(
    (event: React.MouseEvent) => {
      const api = store.getState();
      const kind = api.tool;
      if (kind === 'select') return false;
      const at = rf.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      void (async () => {
        if (kind === 'sticky' || kind === 'rectangle') {
          api.createNode({ kind, center: at });
        } else if (kind === 'file') {
          const file = await api.pickFile();
          if (file) api.createNode({ kind, center: at, file });
          else api.setTool('select');
        } else if (kind === 'link') {
          const url = await api.promptUrl();
          if (url) api.createNode({ kind, center: at, url });
          else api.setTool('select');
        }
      })();
      return true;
    },
    [rf, store],
  );

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      const api = store.getState();
      api.setContextMenu(null);
      if (placeWithTool(event)) return;
      api.setEditing(null);
      api.setLabelEditing(null);
    },
    [placeWithTool, store],
  );

  const onNodeClick = useCallback(
    (event: React.MouseEvent, node: Node) => {
      const api = store.getState();
      api.setContextMenu(null);
      if (placeWithTool(event)) return;
      if (api.editing && api.editing.nodeId !== node.id) api.setEditing(null);
    },
    [placeWithTool, store],
  );

  const showMenu = (event: React.MouseEvent, target: { kind: 'node' | 'edge'; id: string } | { kind: 'board' }) => {
    event.preventDefault();
    const api = store.getState();
    if (api.mode !== 'chaos' && target.kind !== 'node') return;
    if (target.kind === 'node' && !api.selNodes.includes(target.id)) api.setSelection([target.id], []);
    if (target.kind === 'edge' && !api.selEdges.includes(target.id)) api.setSelection([], [target.id]);
    api.setContextMenu({
      screen: { x: event.clientX, y: event.clientY },
      flow: rf.screenToFlowPosition({ x: event.clientX, y: event.clientY }),
      target,
    });
  };

  // --- Wheel: mouse wheel zooms, trackpad scroll pans, pinch zooms -------------------------

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let saveTimer: number | undefined;
    const persist = (viewport: Viewport) => {
      const at = store.getState().mode;
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => rememberViewport(at, viewport), 200);
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as Element | null)?.closest('.nowheel')) return;
      e.preventDefault();
      e.stopPropagation();
      const vp = rf.getViewport();
      const trackpadScroll = !e.ctrlKey && e.deltaMode === 0 && (e.deltaX !== 0 || !Number.isInteger(e.deltaY));
      let next: Viewport;
      if (trackpadScroll) {
        next = { x: vp.x - e.deltaX, y: vp.y - e.deltaY, zoom: vp.zoom };
      } else {
        const rect = el.getBoundingClientRect();
        const px = e.clientX - rect.left;
        const py = e.clientY - rect.top;
        const delta = e.ctrlKey ? Math.max(-50, Math.min(50, e.deltaY)) : e.deltaY * (e.deltaMode === 1 ? 33 : 1);
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, vp.zoom * Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015))));
        const k = zoom / vp.zoom;
        next = { x: px - (px - vp.x) * k, y: py - (py - vp.y) * k, zoom };
      }
      void rf.setViewport(next);
      persist(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => {
      el.removeEventListener('wheel', onWheel, { capture: true });
      window.clearTimeout(saveTimer);
    };
  }, [rf, rememberViewport, store]);

  // --- Keyboard and clipboard --------------------------------------------------------------

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const api = store.getState();
      if (e.key === 'Escape') {
        if (api.endpointDrag) api.setEndpointDrag(null);
        else if (api.contextMenu) api.setContextMenu(null);
        else if (api.chooser) api.setChooser(null);
        else if (api.editing) api.setEditing(null);
        else if (api.tool !== 'select') api.setTool('select');
        else if (api.mode !== 'chaos' && api.selNodes.length > 0) api.setSelection([], []);
        return;
      }
      if (isTextField(e.target) || api.editing || api.labelEditing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (api.mode !== 'chaos') {
        // Plan views never delete or copy items: Delete only takes a card out of the plan.
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          api.removeFromPlan(api.mode, api.selNodes);
        } else if (mod && ['c', 'v', 'd', 'x'].includes(e.key.toLowerCase())) {
          e.preventDefault();
        }
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        api.deleteSelection();
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        api.duplicateSelection();
      }
    };
    const onCopy = (e: ClipboardEvent) => {
      const api = store.getState();
      if (api.mode !== 'chaos' || isTextField(e.target) || api.editing) return;
      const text = api.copyText();
      if (!text || !e.clipboardData) return;
      e.clipboardData.setData(CLIPBOARD_MIME, text);
      e.clipboardData.setData('text/plain', text);
      e.preventDefault();
    };
    const onPaste = (e: ClipboardEvent) => {
      const api = store.getState();
      if (api.mode !== 'chaos' || isTextField(e.target) || api.editing || !e.clipboardData) return;
      const text = e.clipboardData.getData(CLIPBOARD_MIME) || e.clipboardData.getData('text/plain');
      if (!text) return;
      e.preventDefault();
      api.pasteText(text, viewCenter());
    };
    // A tab switch destroys the webview: finish any text edit first so it is not lost.
    const onVisibility = () => {
      if (document.hidden) {
        const api = store.getState();
        api.setEditing(null);
        api.setLabelEditing(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [store, viewCenter]);

  // --- Mouse position (for paste) and drops from the Explorer ------------------------------

  const onPointerMove = (e: ReactPointerEvent) => {
    // pointermove fires before the mousemove React Flow's drag uses, so this is current in onNodesChange.
    snapOff.current = e.ctrlKey || e.metaKey;
    if ((e.target as Element).closest('.eb-ui')) {
      store.getState().setMouseFlow(null);
      return;
    }
    store.getState().setMouseFlow(rf.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  const uriList = (e: DragEvent): string | undefined => {
    const dt = e.dataTransfer;
    return dt.getData('application/vnd.code.uri-list') || dt.getData('text/uri-list') || undefined;
  };
  const hasUris = (e: DragEvent) => Array.from(e.dataTransfer.types).some((t) => t === 'application/vnd.code.uri-list' || t === 'text/uri-list');

  const fileReferences = useBoard((s) => s.features.fileReferences);
  const onDragOver = (e: DragEvent) => {
    if (!fileReferences || mode !== 'chaos' || !hasUris(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    store.getState().setDropHint(true);
  };
  const onDrop = (e: DragEvent) => {
    store.getState().setDropHint(false);
    if (!fileReferences || mode !== 'chaos') return;
    const list = uriList(e);
    if (!list) return;
    e.preventDefault();
    const uris = list
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== '' && !l.startsWith('#'));
    const at = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    void store
      .getState()
      .resolveDropped(uris)
      .then((paths) => store.getState().createFileNodes(paths, at));
  };

  const persistViewport = useCallback(
    (_e: unknown, viewport: Viewport) => {
      // An interrupted view-switch animation ends with an in-between camera; that is not worth keeping.
      if (cameraTarget.current) return;
      rememberViewport(store.getState().mode, viewport);
    },
    [rememberViewport, store],
  );

  const onScale = (next: Scale) => {
    setScale(next);
    updateViewState({ timelineScale: next });
  };

  return (
    <div
      ref={rootRef}
      className={`eb-board${tool !== 'select' ? ' eb-tool-active' : ''}${morph ? ' eb-morphing' : ''}`}
      data-vscode-context='{"preventDefaultContextMenuItems": true}'
      onContextMenu={(e) => e.preventDefault()}
      onPointerMove={onPointerMove}
      onPointerLeave={() => store.getState().setMouseFlow(null)}
      onDragOver={onDragOver}
      onDragLeave={() => store.getState().setDropHint(false)}
      onDrop={onDrop}
    >
      <ArrowMarkers />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={mode === 'chaos' ? onConnectEnd : undefined}
        nodesConnectable={mode === 'chaos'}
        connectionMode={ConnectionMode.Loose}
        connectionLineComponent={ConnectionLine}
        defaultViewport={savedViewport ?? { x: 0, y: 0, zoom: 1 }}
        fitView={mode === 'chaos' && !savedViewport && doc.nodes.some(isBoardNode)}
        fitViewOptions={{ maxZoom: 1, padding: 0.2 }}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        snapToGrid={false}
        selectionOnDrag={mode === 'chaos'}
        selectionMode={SelectionMode.Partial}
        panOnDrag={mode === 'chaos' ? [1] : [0, 1]}
        panActivationKeyCode="Space"
        multiSelectionKeyCode="Shift"
        zoomOnScroll={false}
        panOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        elevateNodesOnSelect={false}
        disableKeyboardA11y
        attributionPosition="bottom-left"
        onNodeDragStart={(_e, node) => {
          planDragId.current = store.getState().mode === 'chaos' ? null : node.id;
        }}
        onNodeDoubleClick={(_e, node) => {
          if (store.getState().mode !== 'chaos') store.getState().showInChaos(node.id);
        }}
        onNodeDragStop={commit}
        onSelectionDragStop={commit}
        onSelectionStart={() => store.getState().setEditing(null)}
        onMoveEnd={persistViewport}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        onEdgeDoubleClick={(_e, edge) => store.getState().setLabelEditing(edge.id)}
        onNodeContextMenu={(e, node) => showMenu(e, { kind: 'node', id: node.id })}
        onEdgeContextMenu={(e, edge) => showMenu(e, { kind: 'edge', id: edge.id })}
        onPaneContextMenu={(e) => showMenu(e as unknown as React.MouseEvent, { kind: 'board' })}
      >
        {gridEnabled && <Background variant={BackgroundVariant.Lines} gap={GRID_STEP} color="#EDEDED" lineWidth={1} />}
        {layout && <PlanBackground mode={mode} layout={layout} activeKey={activeKey} />}
        <ViewSwitcher />
        {mode === 'timeline' && <TimelineScale scale={scale} onChange={onScale} />}
        {mode === 'chaos' && <LeftToolbar />}
        <SnapGuides />
        <ZoomControls />
      </ReactFlow>
      <NewObjectChooser origin={origin()} />
      <ContextMenu origin={origin()} viewCenter={viewCenter} />
      {layout && mode !== 'chaos' && layout.cards.length === 0 && <div className="eb-empty-hint">{EMPTY_HINTS[mode]}</div>}
      {dropHint && <div className="eb-drop-hint">Hold Shift to drop files onto the board</div>}
      {parseError !== null && (
        <div className="eb-error">
          <div className="eb-error-card">
            <strong>Cannot read this board: {parseError}</strong>
            <button type="button" onClick={() => store.getState().reopenAsText()}>
              Open as text
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
