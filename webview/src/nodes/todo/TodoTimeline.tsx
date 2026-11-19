import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '@xyflow/react';
import { getValue, isCancelled, parseTodo, setMeta, taskMeta, type TodoEdit } from '../../../../src/shared/todoFormat';
import { dropDate, originFor, SCALES, segmentIndex, segmentLabel, today as localToday, type Scale } from '../../layout/dates';
import { useBoard, useBoardStore } from '../../useBoard';
import { Codicon } from '../../ui/icons';
import { TaskChips } from './TaskChips';
import { refAt, remap, resolve, type TaskRef } from './taskRefs';
import { TaskPanel, type NodeBox } from './TaskPanel';
import { FAR_ZOOM, FarSummary, isField, SaveBanner, useReleasePanel } from './TodoList';

const DRAG_START_PX = 4;
/** Segments shown from the start: three before the one with today, today, and the ones after. */
const FIRST_SEGMENTS = 12;
/** Most segments on each side of the start, so one far-away date cannot build thousands of columns. */
const MAX_SEGMENTS = 300;
const SCALE_LABELS: Record<Scale, string> = { days: 'Days', weeks: 'Weeks', months: 'Months' };

/** Where a card is dropped: a segment of the date arrow, or the tasks without a date. */
type Drop = number | 'none';

interface Props {
  path: string;
  text: string;
  fontSize: number;
  width: number;
  /** Where the object is, for the details panel beside it. */
  box: NodeBox;
  /** The object's id: only one details panel is open on the board. */
  nodeId: string;
  /** The full todo editor: the page scrolls, not the timeline. */
  standalone?: boolean;
}

/**
 * Timeline mode of a `*.todo.md` file reference: the top-level tasks of this one list as cards under the segment
 * (Days, Weeks or Months) of their due date; tasks without a due date are Unscheduled. Drag a card to another
 * segment to change its due date, or to Unscheduled to clear it.
 */
export function TodoTimeline({ path, text, fontSize, width, box, nodeId, standalone = false }: Props) {
  const store = useBoardStore();
  const panelOwner = useBoard((s) => s.todoPanelOwner);
  const zoom = useStore((s) => s.transform[2]);
  const doc = useMemo(() => parseTodo(text), [text]);
  const today = localToday();
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [scale, setScale] = useState<Scale>('weeks');
  const [selected, setSelected] = useState<TaskRef | null>(null);
  const [open, setOpenRef] = useState<TaskRef | null>(null);
  /** Open (or with null close) the details panel of a task; opening closes the panel of any other object. */
  const setOpen = (ref: TaskRef | null) => {
    setOpenRef(ref);
    const owner = store.getState().todoPanelOwner;
    if (ref) store.getState().setTodoPanelOwner(nodeId);
    else if (owner === nodeId) store.getState().setTodoPanelOwner(null);
  };
  /** `onTitle`: the press started on the card title; released without a move, it opens the details. */
  const [drag, setDrag] = useState<{ from: number; startX: number; startY: number; moving: boolean; onTitle: boolean; drop?: Drop } | null>(null);
  /** Goes up when a click on a title opens the panel: the panel then puts the caret in its title. */
  const [titleFocus, setTitleFocus] = useState(0);
  useReleasePanel(nodeId);

  // Keep the refs on their tasks when the text changes.
  const prevDoc = useRef(doc);
  useLayoutEffect(() => {
    const from = prevDoc.current;
    prevDoc.current = doc;
    if (from === doc) return;
    setSelected((r) => remap(from, doc, r));
    setOpenRef((r) => remap(from, doc, r));
  }, [doc]);

  const selIndex = resolve(doc, selected);
  // The panel shows only while this object owns it.
  const openIndex = panelOwner === nodeId ? resolve(doc, open) : -1;

  const origin = originFor(today, scale);
  const todayIndex = segmentIndex(today, origin, scale);

  /** Top-level tasks: those in a segment, by segment, and those without a due date. */
  const placed = useMemo(() => {
    const bySegment = new Map<number, number[]>();
    const unscheduled: number[] = [];
    let lo = 0;
    let hi = FIRST_SEGMENTS - 1;
    doc.tasks.forEach((t, i) => {
      if (t.parent !== null) return;
      const due = taskMeta(t).due;
      if (due === undefined) {
        unscheduled.push(i);
        return;
      }
      const at = Math.max(-MAX_SEGMENTS, Math.min(MAX_SEGMENTS, segmentIndex(due.slice(0, 10), origin, scale)));
      lo = Math.min(lo, at);
      hi = Math.max(hi, at);
      bySegment.set(at, [...(bySegment.get(at) ?? []), i]);
    });
    return { bySegment, unscheduled, lo, hi };
  }, [doc, origin, scale]);

  // The wheel scrolls the timeline only when it overflows; otherwise it zooms the board as usual.
  const [overflowing, setOverflowing] = useState(false);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc, scale, zoom]);

  const focusRoot = () => rootRef.current?.focus({ preventScroll: true });

  const apply = (edit: TodoEdit) => {
    if (edit.text === doc.lines.join('\n')) return;
    store.getState().writeTodo(path, edit.text);
  };

  /** Change the due date of task `from` to the segment (or clear it). */
  const moveCard = (from: number, drop: Drop) => {
    const due = taskMeta(doc.tasks[from]).due;
    if (drop === 'none') {
      if (due !== undefined) apply(setMeta(doc, from, 'due', undefined));
      return;
    }
    const day = due?.slice(0, 10);
    if (day !== undefined && segmentIndex(day, origin, scale) === drop) return;
    apply(setMeta(doc, from, 'due', dropDate(day, drop, origin, scale)));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isField(e.target)) {
      e.stopPropagation();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key;
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (mod && (key.toLowerCase() === 'z' || key.toLowerCase() === 'y')) {
      handled();
      if (key.toLowerCase() === 'y' || e.shiftKey) store.getState().redoTodo(path);
      else store.getState().undoTodo(path);
    } else if (key === 'Escape') {
      handled();
      if (openIndex >= 0) setOpen(null);
      else {
        setSelected(null);
        rootRef.current?.blur();
      }
    } else if (key === 'Enter' && selIndex >= 0) {
      handled();
      setTitleFocus(0);
      setOpen(openIndex === selIndex ? null : refAt(doc, selIndex));
    }
  };

  // --- Drag cards ------------------------------------------------------------------------

  const dropAt = (x: number, y: number): Drop | undefined => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!rootRef.current?.contains(el)) continue;
      const seg = el.closest<HTMLElement>('[data-seg]');
      if (seg) return seg.dataset.seg === 'none' ? 'none' : Number(seg.dataset.seg);
    }
    return undefined;
  };

  const onCardDown = (e: ReactPointerEvent, i: number) => {
    if (e.button !== 0 || isField(e.target)) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(refAt(doc, i));
    focusRoot();
    setDrag({ from: i, startX: e.clientX, startY: e.clientY, moving: false, onTitle: (e.target as HTMLElement).closest('.eb-todo-title') !== null });
  };

  const onCardMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const moving = drag.moving || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_START_PX;
    if (!moving) return;
    const drop = dropAt(e.clientX, e.clientY);
    if (!drag.moving || drop !== drag.drop) setDrag({ ...drag, moving, drop });
  };

  const onCardUp = () => {
    if (drag?.moving && drag.drop !== undefined) moveCard(drag.from, drag.drop);
    else if (drag && !drag.moving && drag.onTitle) {
      // A second click on the title of the open task closes the details.
      if (openIndex === drag.from) setOpen(null);
      else {
        setOpen(refAt(doc, drag.from));
        setTitleFocus((n) => n + 1);
      }
    }
    setDrag(null);
  };

  // --- Render ----------------------------------------------------------------------------

  if (zoom < FAR_ZOOM) return <FarSummary doc={doc} today={today} zoom={zoom} width={width} />;

  const card = (i: number) => {
    const t = doc.tasks[i];
    const title = taskMeta(t).title;
    const priority = getValue(t, 'priority');
    const kids = t.children.filter((c) => !isCancelled(doc.tasks[c]));
    const kidsDone = kids.filter((c) => doc.tasks[c].checked).length;
    const classes = [
      'eb-todo-card',
      selIndex === i ? 'selected' : '',
      t.checked ? 'done' : '',
      isCancelled(t) ? 'cancelled' : '',
      priority === 'high' || priority === 'medium' || priority === 'low' ? `prio-${priority}` : '',
      drag?.moving && drag.from === i ? 'dragging' : '',
      openIndex === i ? 'open' : '',
    ].filter((c) => c !== '');
    return (
      <div key={`c${t.line}`} className={classes.join(' ')} data-card={i} onPointerDown={(e) => onCardDown(e, i)} onPointerMove={onCardMove} onPointerUp={onCardUp} onPointerCancel={() => setDrag(null)}>
        <div className="eb-todo-card-head">
          {t.checked && <Codicon name="check" />}
          <span className={`eb-todo-title${title === '' ? ' empty' : ''}`} title="Details (Enter)">
            {title === '' ? 'Untitled' : title}
          </span>
          {t.problems.length > 0 && (
            <span className="eb-warning" title={t.problems.join('\n')}>
              <Codicon name="warning" />
            </span>
          )}
        </div>
        <div className="eb-todo-card-chips">
          <TaskChips doc={doc} index={i} today={today} />
          {kids.length > 0 && (
            <span className="eb-todo-progress" title="Subtasks done">
              {kidsDone}/{kids.length}
            </span>
          )}
        </div>
      </div>
    );
  };

  const dropping = (seg: Drop) => (drag?.moving && drag.drop === seg ? ' drop-end' : '');
  const segments: number[] = [];
  for (let s = placed.lo; s <= placed.hi; s++) segments.push(s);

  return (
    <div ref={rootRef} className={`eb-todo-timeline nodrag${standalone ? ' standalone' : ''}`} data-todo-root style={{ fontSize }} tabIndex={0} onKeyDown={onKeyDown}>
      <SaveBanner path={path} />
      <div className="eb-todo-tl-bar">
        <span className="eb-view-switch" role="group" aria-label="Timeline scale">
          {SCALES.map((s) => (
            <button key={s} type="button" className={scale === s ? 'active' : ''} onClick={() => setScale(s)}>
              {SCALE_LABELS[s]}
            </button>
          ))}
        </span>
      </div>
      <div ref={scrollRef} className={`eb-todo-tl-scroll${overflowing && !standalone ? ' nowheel' : ''}`}>
        <div className="eb-todo-tl-arrow">
          {segments.map((s) => (
            <div key={s} className={`eb-todo-tl-seg${s === todayIndex ? ' today' : ''}${dropping(s)}`} data-seg={s}>
              <div className="eb-todo-tl-head">{segmentLabel(s, origin, scale)}</div>
              <div className="eb-todo-lane-cards">{(placed.bySegment.get(s) ?? []).map(card)}</div>
            </div>
          ))}
        </div>
        <div className={`eb-todo-tl-unscheduled${dropping('none')}`} data-seg="none">
          <div className="eb-todo-tl-head">Unscheduled</div>
          <div className="eb-todo-tl-unscheduled-cards">{placed.unscheduled.map(card)}</div>
        </div>
      </div>
      {openIndex >= 0 && (
        <TaskPanel
          key={`${doc.tasks[openIndex].line}:${getValue(doc.tasks[openIndex], 'id') ?? ''}`}
          doc={doc}
          index={openIndex}
          today={today}
          box={box}
          fontSize={fontSize}
          zoom={zoom}
          standalone={standalone}
          anchor={() => rootRef.current?.querySelector<HTMLElement>(`[data-card="${openIndex}"]`) ?? null}
          scroller={() => scrollRef.current}
          focusTitle={titleFocus}
          apply={(edit) => apply(edit)}
          onClose={() => {
            setOpen(null);
            focusRoot();
          }}
        />
      )}
    </div>
  );
}
