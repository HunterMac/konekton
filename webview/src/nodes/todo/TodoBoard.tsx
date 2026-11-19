import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '@xyflow/react';
import {
  retitle,
  retitleTask,
  taskFullText,
  taskMeta,
  deleteTask,
  descendants,
  expandDateShortcuts,
  getValue,
  insertTask,
  isCancelled,
  laneOf,
  LANES,
  moveTaskTo,
  parseTodo,
  setDoneWithSubtasks,
  setLane,
  subtreeEnd,
  type Lane,
  type TodoEdit,
} from '../../../../src/shared/todoFormat';
import { today as localToday } from '../../layout/dates';
import { useBoard, useBoardStore } from '../../useBoard';
import { Codicon, ProgressIcon } from '../../ui/icons';
import { STATUS_LABELS } from '../../ui/statusLabels';
import { TaskChips } from './TaskChips';
import { refAt, remap, resolve, type TaskRef } from './taskRefs';
import { TaskPanel, type NodeBox } from './TaskPanel';
import { isValidTitle, TitleEditor, type TitleNext } from './TitleEditor';
import { countWords, FAR_ZOOM, FarSummary, isField, SaveBanner, useReleasePanel } from './TodoList';

/** A drop target: a lane, and a card in it to go before or after (none = the end of the lane). */
interface Drop {
  lane: Lane;
  target?: number;
  place?: 'before' | 'after';
}

/** A drop to Done that waits for an answer, because the task has open subtasks. */
interface PendingDone {
  ref: TaskRef;
  drop: Drop;
}

const DRAG_START_PX = 4;

interface Props {
  path: string;
  text: string;
  fontSize: number;
  width: number;
  /** Where the object is, for the details panel beside it. */
  box: NodeBox;
  /** The object's id: only one details panel is open on the board. */
  nodeId: string;
  /** The full todo editor: the page scrolls, not the lanes. */
  standalone?: boolean;
}

/**
 * Board mode of a `*.todo.md` file reference: the top-level tasks of this one list as cards in Todo,
 * In progress and Done. Separate from the board-wide Chaos / Board / Timeline switch.
 */
export function TodoBoard({ path, text, fontSize, width, box, nodeId, standalone = false }: Props) {
  const store = useBoardStore();
  const panelOwner = useBoard((s) => s.todoPanelOwner);
  const zoom = useStore((s) => s.transform[2]);
  const doc = useMemo(() => parseTodo(text), [text]);
  const today = localToday();
  const rootRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<TaskRef | null>(null);
  const [editing, setEditing] = useState<TaskRef | null>(null);
  const [open, setOpenRef] = useState<TaskRef | null>(null);
  /** Open (or with null close) the details panel of a task; opening closes the panel of any other object. */
  const setOpen = (ref: TaskRef | null) => {
    setOpenRef(ref);
    const owner = store.getState().todoPanelOwner;
    if (ref) store.getState().setTodoPanelOwner(nodeId);
    else if (owner === nodeId) store.getState().setTodoPanelOwner(null);
  };
  const [pending, setPending] = useState<PendingDone | null>(null);
  /** `onTitle`: the press started on the card title; released without a move, it opens the details. */
  const [drag, setDrag] = useState<{ from: number; startX: number; startY: number; moving: boolean; onTitle: boolean; drop?: Drop } | null>(null);
  /** Goes up when a click on a title opens the panel: the panel then puts the caret in its title. */
  const [titleFocus, setTitleFocus] = useState(0);
  useReleasePanel(nodeId);

  // Keep the refs on their tasks when the text changes.
  const prevDoc = useRef(doc);
  const pendingFocus = useRef<{ line: number; edit: boolean } | null>(null);
  useLayoutEffect(() => {
    const from = prevDoc.current;
    prevDoc.current = doc;
    if (from === doc) return;
    setPending((p) => {
      const ref = p ? remap(from, doc, p.ref) : null;
      return p && ref ? { ...p, ref } : null;
    });
    const focus = pendingFocus.current;
    pendingFocus.current = null;
    const at = focus ? doc.tasks.findIndex((t) => t.line === focus.line) : -1;
    if (focus && at >= 0) {
      setSelected(refAt(doc, at));
      setEditing(focus.edit ? refAt(doc, at) : null);
    } else {
      setSelected((r) => remap(from, doc, r));
      setEditing((r) => remap(from, doc, r));
    }
    setOpenRef((r) => remap(from, doc, r));
  }, [doc]);

  const selIndex = resolve(doc, selected);
  const editIndex = resolve(doc, editing);
  // The panel shows only while this object owns it.
  const openIndex = panelOwner === nodeId ? resolve(doc, open) : -1;
  const tags = useMemo(() => countWords(doc, 'tags'), [doc]);
  const people = useMemo(() => countWords(doc, 'people'), [doc]);

  /** Top-level tasks of each lane, in file order. */
  const lanes = useMemo(() => {
    const out: Record<Lane, number[]> = { todo: [], inProgress: [], done: [] };
    doc.tasks.forEach((t, i) => {
      if (t.parent === null) out[laneOf(t)].push(i);
    });
    return out;
  }, [doc]);

  // The wheel scrolls a lane only when that lane overflows; otherwise it zooms the board as usual.
  const laneRefs = useRef<Partial<Record<Lane, HTMLDivElement | null>>>({});
  const [overflowing, setOverflowing] = useState<ReadonlySet<Lane>>(new Set());
  useLayoutEffect(() => {
    const check = () => {
      const next = new Set(LANES.filter((l) => {
        const el = laneRefs.current[l];
        return el !== null && el !== undefined && el.scrollHeight > el.clientHeight + 1;
      }));
      setOverflowing((prev) => (prev.size === next.size && [...next].every((l) => prev.has(l)) ? prev : next));
    };
    check();
    const ro = new ResizeObserver(check);
    for (const l of LANES) {
      const el = laneRefs.current[l];
      if (el) ro.observe(el);
    }
    return () => ro.disconnect();
  }, [doc, editIndex, pending, zoom]);

  const focusBoard = () => rootRef.current?.focus({ preventScroll: true });

  const apply = (edit: TodoEdit, opts: { editTitle?: boolean } = {}) => {
    if (edit.text === doc.lines.join('\n')) {
      const at = edit.focus !== undefined ? doc.tasks.findIndex((t) => t.line === edit.focus) : -1;
      if (at >= 0) {
        setSelected(refAt(doc, at));
        if (opts.editTitle) setEditing(refAt(doc, at));
      }
      return;
    }
    if (edit.focus !== undefined) pendingFocus.current = { line: edit.focus, edit: opts.editTitle === true };
    store.getState().writeTodo(path, edit.text);
  };

  const openSubtasks = (i: number) => descendants(doc, i).filter((d) => !doc.tasks[d].checked && !isCancelled(doc.tasks[d]));

  /**
   * Move task `from` to a lane and a place in it, as one edit. A move to Done of a task with open subtasks asks
   * first; `subtasks` is the answer: 'all' marks them done too, 'one' only the task.
   */
  const moveCard = (from: number, drop: Drop, subtasks?: 'all' | 'one') => {
    const task = doc.tasks[from];
    let edit: TodoEdit = { text: doc.lines.join('\n'), focus: task.line };
    if (drop.lane !== laneOf(task)) {
      if (drop.lane === 'done' && subtasks === undefined && openSubtasks(from).length > 0) {
        setSelected(refAt(doc, from));
        setPending({ ref: refAt(doc, from), drop });
        return;
      }
      edit = subtasks === 'all' ? setDoneWithSubtasks(doc, from, today) : setLane(doc, from, drop.lane, today);
    }
    // A lane change edits only the task's own lines, so the task indexes stay the same.
    const d = parseTodo(edit.text);
    const inLane = d.tasks.map((_t, i) => i).filter((i) => i !== from && d.tasks[i].parent === null && laneOf(d.tasks[i]) === drop.lane);
    const target = drop.target !== undefined && drop.target !== from ? drop.target : inLane[inLane.length - 1];
    if (target !== undefined && (drop.target !== undefined || laneOf(task) !== drop.lane)) {
      edit = moveTaskTo(d, from, target, drop.target !== undefined ? (drop.place ?? 'before') : 'after');
    }
    apply(edit);
  };

  const toggleDone = (i: number) => {
    const t = doc.tasks[i];
    // The checkbox cycles Todo -> In progress -> Done -> Todo.
    if (t.checked || isCancelled(t)) apply(setLane(doc, i, 'todo', today));
    else if (laneOf(t) === 'inProgress') moveCard(i, { lane: 'done' });
    else moveCard(i, { lane: 'inProgress' });
  };

  /** A new card at the end of the file: new tasks start in Todo. */
  const addCard = () => apply(insertTask(doc, null), { editTitle: true });

  const commitTitle = (i: number, value: string, next: TitleNext, kept: string[]) => {
    const task = doc.tasks[i];
    // A title shorter than MIN_TITLE_LENGTH is not saved: the old title stays.
    const title = isValidTitle(value) ? value : taskMeta(task).title;
    const full = taskFullText(task);
    const text = retitle(full, expandDateShortcuts(title.trim(), today), kept);
    setEditing(null);
    if (text === '' && task.children.length === 0 && full === '') {
      apply(deleteTask(doc, i));
      focusBoard();
      return;
    }
    const edit: TodoEdit = text === full ? { text: doc.lines.join('\n'), focus: task.line } : retitleTask(doc, i, text);
    if (next === 'newBelow' && text !== '') {
      // A new card right after this one, in the same lane.
      const d = parseTodo(edit.text);
      const j = d.tasks.findIndex((t) => t.line === edit.focus);
      const inserted = insertTask(d, j);
      const lane = laneOf(d.tasks[j]);
      const d2 = parseTodo(inserted.text);
      const k = d2.tasks.findIndex((t) => t.line === inserted.focus);
      apply(lane === 'inProgress' && k >= 0 ? setLane(d2, k, lane, today) : inserted, { editTitle: true });
      return;
    }
    apply(edit);
    focusBoard();
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
      return;
    }
    if (key === 'Escape') {
      handled();
      if (openIndex >= 0) setOpen(null);
      else {
        setSelected(null);
        rootRef.current?.blur();
      }
      return;
    }
    const i = selIndex;
    if (i < 0 || doc.tasks[i].parent !== null) return;
    const lane = laneOf(doc.tasks[i]);
    const list = lanes[lane];
    const pos = list.indexOf(i);
    if (key === ' ') {
      handled();
      toggleDone(i);
    } else if (key === 'Enter') {
      handled();
      setTitleFocus(0);
      setOpen(openIndex === i ? null : refAt(doc, i));
    } else if (key === 'F2') {
      handled();
      setEditing(refAt(doc, i));
    } else if (key === 'ArrowUp' || key === 'ArrowDown') {
      handled();
      const next = list[pos + (key === 'ArrowUp' ? -1 : 1)];
      if (next !== undefined) setSelected(refAt(doc, next));
    } else if (key === 'ArrowLeft' || key === 'ArrowRight') {
      handled();
      const to = LANES[LANES.indexOf(lane) + (key === 'ArrowLeft' ? -1 : 1)];
      if (to) moveCard(i, { lane: to });
    } else if (key === 'Delete' || key === 'Backspace') {
      handled();
      const end = subtreeEnd(doc, i);
      const next = list[pos + 1] ?? list[pos - 1];
      const edit = deleteTask(doc, i);
      const nextLine = next === undefined ? undefined : doc.tasks[next].line > end ? doc.tasks[next].line - (end - doc.tasks[i].line + 1) : doc.tasks[next].line;
      apply(nextLine !== undefined ? { ...edit, focus: nextLine } : edit);
    }
  };

  // --- Drag cards ------------------------------------------------------------------------

  const dropAt = (x: number, y: number, from: number): Drop | undefined => {
    for (const el of document.elementsFromPoint(x, y)) {
      if (!rootRef.current?.contains(el)) continue;
      const card = el.closest<HTMLElement>('[data-card]');
      if (card && Number(card.dataset.card) === from) continue;
      const laneEl = el.closest<HTMLElement>('[data-lane]');
      if (!laneEl) continue;
      const lane = laneEl.dataset.lane as Lane;
      if (!card) return { lane };
      const rect = card.getBoundingClientRect();
      return { lane, target: Number(card.dataset.card), place: y < rect.top + rect.height / 2 ? 'before' : 'after' };
    }
    return undefined;
  };

  const onCardDown = (e: ReactPointerEvent, i: number) => {
    if (e.button !== 0 || isField(e.target) || (e.target as HTMLElement).closest('button')) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(refAt(doc, i));
    focusBoard();
    setDrag({ from: i, startX: e.clientX, startY: e.clientY, moving: false, onTitle: (e.target as HTMLElement).closest('.eb-todo-title') !== null });
  };

  const onCardMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const moving = drag.moving || Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > DRAG_START_PX;
    if (!moving) return;
    const drop = dropAt(e.clientX, e.clientY, drag.from);
    const same = drag.moving && drop?.lane === drag.drop?.lane && drop?.target === drag.drop?.target && drop?.place === drag.drop?.place;
    if (!same) setDrag({ ...drag, moving, drop });
  };

  const onCardUp = () => {
    if (drag?.moving && drag.drop) moveCard(drag.from, drag.drop);
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

  const pendingIndex = pending ? resolve(doc, pending.ref) : -1;
  const card = (i: number) => {
    const t = doc.tasks[i];
    const tokens = taskMeta(t);
    const status = getValue(t, 'status');
    const priority = getValue(t, 'priority');
    const kids = t.children.filter((c) => !isCancelled(doc.tasks[c]));
    const kidsDone = kids.filter((c) => doc.tasks[c].checked).length;
    const drop = drag?.moving && drag.drop?.target === i ? drag.drop.place : undefined;
    const classes = [
      'eb-todo-card',
      selIndex === i ? 'selected' : '',
      t.checked ? 'done' : '',
      isCancelled(t) ? 'cancelled' : '',
      priority === 'high' || priority === 'medium' || priority === 'low' ? `prio-${priority}` : '',
      drag?.moving && drag.from === i ? 'dragging' : '',
      openIndex === i ? 'open' : '',
      drop ? `drop-${drop}` : '',
    ].filter((c) => c !== '');
    return (
      <div key={`c${t.line}`} className={classes.join(' ')} data-card={i} onPointerDown={(e) => onCardDown(e, i)} onPointerMove={onCardMove} onPointerUp={onCardUp} onPointerCancel={() => setDrag(null)}>
        <div className="eb-todo-card-head">
          <button
            type="button"
            className={`eb-todo-check${t.checked ? ' checked' : status === 'inProgress' ? ' progress' : status === 'waiting' ? ' waiting' : ''}`}
            title={t.checked ? 'Mark not done (Space)' : status === 'inProgress' ? 'Mark done (Space)' : 'Start (Space)'}
            onClick={() => toggleDone(i)}
          >
            {t.checked ? <Codicon name="check" /> : status === 'inProgress' ? <ProgressIcon /> : null}
          </button>
          {editIndex === i ? (
            <div className="eb-todo-main">
              <TitleEditor key={`edit${t.line}`} initial={taskFullText(t)} tags={tags} people={people} onCommit={(v, next, kept) => commitTitle(i, v, next, kept)} />
            </div>
          ) : (
            <span className={`eb-todo-title${tokens.title === '' ? ' empty' : ''}`} title="Details (Enter)">
              {tokens.title === '' ? 'Untitled' : tokens.title}
            </span>
          )}
          {t.problems.length > 0 && (
            <span className="eb-warning" title={t.problems.join('\n')}>
              <Codicon name="warning" />
            </span>
          )}
        </div>
        {editIndex !== i && (
          <div className="eb-todo-card-chips">
            <TaskChips doc={doc} index={i} today={today} />
            {kids.length > 0 && (
              <span className="eb-todo-progress" title="Subtasks done">
                {kidsDone}/{kids.length}
              </span>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={rootRef} className={`eb-todo-board nodrag${standalone ? ' standalone' : ''}`} data-todo-root style={{ fontSize }} tabIndex={0} onKeyDown={onKeyDown}>
      <SaveBanner path={path} />
      {pending && pendingIndex >= 0 && (
        <div className="eb-todo-confirm">
          <span>
            {openSubtasks(pendingIndex).length} open subtask{openSubtasks(pendingIndex).length === 1 ? '' : 's'}.
          </span>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              moveCard(pendingIndex, pending.drop, 'all');
            }}
          >
            Mark all done
          </button>
          <button
            type="button"
            onClick={() => {
              setPending(null);
              moveCard(pendingIndex, pending.drop, 'one');
            }}
          >
            Only this one
          </button>
          <button type="button" onClick={() => setPending(null)}>
            Cancel
          </button>
        </div>
      )}
      <div className="eb-todo-lanes">
        {LANES.map((lane) => (
          <div
            key={lane}
            ref={(el) => {
              laneRefs.current[lane] = el;
            }}
            className={`eb-todo-lane${overflowing.has(lane) && !standalone ? ' nowheel' : ''}${drag?.moving && drag.drop?.lane === lane && drag.drop.target === undefined ? ' drop-end' : ''}`}
            data-lane={lane}
          >
            <div className="eb-todo-lane-head">
              <span>{STATUS_LABELS[lane]}</span>
              {lane === 'todo' && (
                <button type="button" className="eb-todo-new" title="New task" onClick={addCard}>
                  Add new
                </button>
              )}
              <span className="eb-todo-lane-count">{lanes[lane].length}</span>
            </div>
            <div className="eb-todo-lane-cards">{lanes[lane].map(card)}</div>
          </div>
        ))}
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
          scroller={() => rootRef.current?.querySelector<HTMLElement>(`[data-card="${openIndex}"]`)?.closest<HTMLElement>('[data-lane]') ?? null}
          focusTitle={titleFocus}
          apply={(edit) => apply(edit)}
          onClose={() => {
            setOpen(null);
            focusBoard();
          }}
        />
      )}
    </div>
  );
}
