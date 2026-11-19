import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { Handle, Position, useStore, useUpdateNodeInternals } from '@xyflow/react';
import {
  deleteTask,
  META_KEYS,
  retitle,
  retitleTask,
  taskFullText,
  taskMeta,
  descendants,
  expandDateShortcuts,
  getValue,
  taskById,
  indentTask,
  insertSubtask,
  insertTask,
  isCancelled,
  moveTask,
  moveTaskTo,
  outdentTask,
  parseTodo,
  setDone,
  setDoneWithSubtasks,
  setStatus,
  statusOf,
  subtreeEnd,
  summary,
  type DropPlace,
  type TodoDoc,
  type TodoEdit,
} from '../../../../src/shared/todoFormat';
import { isBoardEdge } from '../../../../src/shared/canvasFormat';
import { setTaskAnchors } from '../../edges/taskAnchors';
import { today as localToday } from '../../layout/dates';
import { useBoard, useBoardStore } from '../../useBoard';
import { Codicon, ProgressIcon } from '../../ui/icons';
import { isValidTitle, TitleEditor, type TitleNext } from './TitleEditor';
import { TaskPanel, type NodeBox } from './TaskPanel';
import { TaskChips } from './TaskChips';
import { refAt, remap, resolve, type TaskRef } from './taskRefs';

/** Below this zoom only a summary shows (TODO-IMPLEMENTATION.md, "Zoom levels"). */
export const FAR_ZOOM = 0.4;

export const isField = (el: EventTarget | null) => {
  const tag = (el as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export function countWords(doc: TodoDoc, kind: 'tags' | 'people'): string[] {
  const counts = new Map<string, number>();
  for (const t of doc.tasks) for (const w of taskMeta(t)[kind]) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
}

interface Props {
  path: string;
  text: string;
  fontSize: number;
  /** Node width, to fit the summary shown when zoomed far out. */
  width: number;
  /** Where the object is, for the details panel beside it. */
  box: NodeBox;
  /** The object's id: only one details panel is open on the board. */
  nodeId: string;
  /** The full todo editor: no board around the list, so no lines, no height fitting, and the page scrolls. */
  standalone?: boolean;
}

/** Todo mode of a `*.todo.md` file reference: one block per task (TODO-IMPLEMENTATION.md). */
export function TodoList({ path, text, fontSize, width, box, nodeId, standalone = false }: Props) {
  const store = useBoardStore();
  const panelOwner = useBoard((s) => s.todoPanelOwner);
  const zoom = useStore((s) => s.transform[2]);
  const doc = useMemo(() => parseTodo(text), [text]);
  const today = localToday();
  const listRef = useRef<HTMLDivElement>(null);
  /** Everything in the list; its height is what the object needs. */
  const contentRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<TaskRef | null>(null);
  const [open, setOpenRef] = useState<TaskRef | null>(null);
  /** Open (or with null close) the details panel of a task; opening closes the panel of any other object. */
  const setOpen = (ref: TaskRef | null) => {
    setOpenRef(ref);
    const owner = store.getState().todoPanelOwner;
    if (ref) store.getState().setTodoPanelOwner(nodeId);
    else if (owner === nodeId) store.getState().setTodoPanelOwner(null);
  };
  const [editing, setEditing] = useState<TaskRef | null>(null);
  const [confirm, setConfirm] = useState<TaskRef | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [drag, setDrag] = useState<{ from: number; target?: number; place?: DropPlace } | null>(null);
  const [overflow, setOverflow] = useState(false);
  /** Goes up when a click on a title opens the panel: the panel then puts the caret in its title. */
  const [titleFocus, setTitleFocus] = useState(0);
  useReleasePanel(nodeId);

  // Keep the refs on their tasks when the text changes (our edits and outside edits).
  const prevDoc = useRef(doc);
  const pendingFocus = useRef<{ line: number; edit: boolean } | null>(null);
  useLayoutEffect(() => {
    const from = prevDoc.current;
    prevDoc.current = doc;
    if (from === doc) return;
    setOpenRef((r) => remap(from, doc, r));
    setConfirm((r) => remap(from, doc, r));
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
  }, [doc]);

  const selIndex = resolve(doc, selected);
  // The panel shows only while this object owns it.
  const openIndex = panelOwner === nodeId ? resolve(doc, open) : -1;
  const editIndex = resolve(doc, editing);
  const confirmIndex = resolve(doc, confirm);
  const tags = useMemo(() => countWords(doc, 'tags'), [doc]);

  // Lines from the tasks of this list to other objects: they follow the rows.
  const edges = useBoard((s) => s.doc.edges);
  const linked = useMemo(() => {
    const ids = new Set<string>();
    for (const e of edges) if (isBoardEdge(e) && e.fromNode === nodeId && e.fromTask !== undefined) ids.add(e.fromTask);
    return ids;
  }, [edges, nodeId]);
  const updateInternals = useUpdateNodeInternals();
  // The balls at the row ends move with the rows: React Flow measures them again.
  useLayoutEffect(() => {
    if (!standalone) updateInternals(nodeId);
  }, [updateInternals, nodeId, doc, collapsed, box.width, box.height, standalone]);
  // Tell the lines where their rows are (a fraction of the object's height). A task folded away uses its parent's row.
  useLayoutEffect(() => {
    if (standalone) return;
    const nodeEl = listRef.current?.closest('.react-flow__node');
    const found = new Map<string, number>();
    if (nodeEl && linked.size > 0) {
      const nodeRect = nodeEl.getBoundingClientRect();
      for (const id of linked) {
        let i = taskById(doc, id);
        while (i >= 0) {
          const ball = nodeEl.querySelector(`[data-task-index="${i}"] .eb-task-ball`);
          if (ball) {
            const r = ball.getBoundingClientRect();
            if (nodeRect.height > 0) found.set(id, Math.min(1, Math.max(0, (r.top + r.height / 2 - nodeRect.top) / nodeRect.height)));
            break;
          }
          i = doc.tasks[i].parent ?? -1;
        }
      }
    }
    setTaskAnchors(nodeId, found);
  });
  const people = useMemo(() => countWords(doc, 'people'), [doc]);

  const focusList = () => listRef.current?.focus({ preventScroll: true });

  /** Write an edit. `focus` selects the task at `edit.focus`; `editTitle` also opens its title editor. */
  const apply = (edit: TodoEdit, opts: { editTitle?: boolean } = {}) => {
    if (edit.focus !== undefined) pendingFocus.current = { line: edit.focus, edit: opts.editTitle === true };
    if (edit.text === doc.lines.join('\n')) {
      pendingFocus.current = null;
      if (edit.focus !== undefined) {
        const at = doc.tasks.findIndex((t) => t.line === edit.focus);
        if (at >= 0) {
          setSelected(refAt(doc, at));
          if (opts.editTitle) setEditing(refAt(doc, at));
        }
      }
      return;
    }
    store.getState().writeTodo(path, edit.text);
  };

  /** Run `fn` on the task at `edit.focus` in the edited text. */
  const then = (edit: TodoEdit, fn: (d: TodoDoc, i: number) => TodoEdit): TodoEdit => {
    const d = parseTodo(edit.text);
    const i = d.tasks.findIndex((t) => t.line === edit.focus);
    return i >= 0 ? fn(d, i) : edit;
  };

  const collapseKey = (i: number) => getValue(doc.tasks[i], 'id') ?? `L${doc.tasks[i].line}`;
  const toggleCollapsed = (i: number, value?: boolean) => {
    const key = collapseKey(i);
    const next = new Set(collapsed);
    if (value ?? !next.has(key)) next.add(key);
    else next.delete(key);
    setCollapsed(next);
  };

  // Tasks in display order, without the subtasks of folded tasks.
  const visible = useMemo(() => {
    const out: number[] = [];
    const hidden = new Set<number>();
    doc.tasks.forEach((t, i) => {
      if (hidden.has(i)) return;
      out.push(i);
      if (t.children.length > 0 && collapsed.has(getValue(t, 'id') ?? `L${t.line}`)) for (const d of descendants(doc, i)) hidden.add(d);
    });
    return out;
  }, [doc, collapsed]);

  // The wheel scrolls the list only when it overflows; otherwise it zooms the board as usual.
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const check = () => setOverflow(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doc, visible, openIndex, confirmIndex, zoom]);

  // The object is as tall as its list needs, also when subtasks are folded or unfolded. The new height is
  // kept in the open board only: it is written to the file with the next change of the board.
  useLayoutEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (standalone || !list || !content) return;
    const fit = () => {
      const style = getComputedStyle(list);
      const natural = Math.ceil(content.offsetHeight + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom));
      // The rendered object can lag behind `box.height` (the height transition of a view switch), so the target is
      // measured from what is on screen, not added to `box.height`: a second pass then asks for the same height.
      const frame = list.closest<HTMLElement>('.react-flow__node')?.offsetHeight ?? box.height;
      const target = natural + frame - list.clientHeight;
      // Less than the target would show a scrollbar; a spare pixel is fine.
      if (target > box.height || target < box.height - 1) store.getState().resizeNode(nodeId, box.width, target);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(content);
    return () => ro.disconnect();
  }, [store, nodeId, box.width, box.height, doc, visible, zoom, standalone]);

  const toggleDone = (i: number) => {
    const t = doc.tasks[i];
    if (t.checked) {
      apply(setDone(doc, i, false, today));
      return;
    }
    // The checkbox cycles Todo -> In progress -> Done -> Todo.
    if (statusOf(t) !== 'inProgress') {
      apply(setStatus(doc, i, 'inProgress', today));
      return;
    }
    const open = descendants(doc, i).filter((d) => !doc.tasks[d].checked && !isCancelled(doc.tasks[d]));
    if (open.length > 0) {
      setSelected(refAt(doc, i));
      setConfirm(refAt(doc, i));
      return;
    }
    apply(setDone(doc, i, true, today));
  };

  const newTask = (after: number | null) => apply(insertTask(doc, after), { editTitle: true });

  const commitTitle = (i: number, value: string, next: TitleNext, kept: string[]) => {
    const task = doc.tasks[i];
    // A title shorter than MIN_TITLE_LENGTH is not saved: the old title stays.
    const title = isValidTitle(value) ? value : taskMeta(task).title;
    const full = taskFullText(task);
    const text = retitle(full, expandDateShortcuts(title.trim(), today), kept);
    setEditing(null);
    if (text === '' && task.data.every((e) => META_KEYS.includes(e.key)) && task.children.length === 0 && next !== 'indent' && next !== 'outdent') {
      apply(deleteTask(doc, i));
      focusList();
      return;
    }
    let edit: TodoEdit = text === full ? { text: doc.lines.join('\n'), focus: task.line } : retitleTask(doc, i, text);
    if (next === 'newBelow') edit = then(edit, (d, j) => insertTask(d, j));
    else if (next === 'indent') edit = then(edit, indentTask);
    else if (next === 'outdent') edit = then(edit, outdentTask);
    apply(edit, { editTitle: next !== 'none' });
    if (next === 'none') focusList();
  };

  const moveSelection = (dir: -1 | 1) => {
    if (visible.length === 0) return;
    const pos = visible.indexOf(selIndex);
    const next = pos < 0 ? (dir === 1 ? 0 : visible.length - 1) : Math.min(visible.length - 1, Math.max(0, pos + dir));
    setSelected(refAt(doc, visible[next]));
    listRef.current?.querySelector(`[data-task-index="${visible[next]}"]`)?.scrollIntoView({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Keys typed in a field stay in the field; the board must not see them either.
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
      const redo = key.toLowerCase() === 'y' || e.shiftKey;
      if (redo) store.getState().redoTodo(path);
      else store.getState().undoTodo(path);
      return;
    }
    if (mod && key === 'Enter') {
      handled();
      newTask(selIndex >= 0 ? selIndex : null);
      return;
    }
    if ((key === 'ArrowDown' || key === 'ArrowUp') && !e.altKey) {
      handled();
      moveSelection(key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (key === 'Escape') {
      handled();
      if (openIndex >= 0) setOpen(null);
      else {
        setSelected(null);
        listRef.current?.blur();
      }
      return;
    }
    const i = selIndex;
    if (i < 0) return;
    const t = doc.tasks[i];
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
    } else if (key === 'Tab') {
      handled();
      apply(e.shiftKey ? outdentTask(doc, i) : indentTask(doc, i));
    } else if ((key === 'ArrowDown' || key === 'ArrowUp') && e.altKey) {
      handled();
      apply(moveTask(doc, i, key === 'ArrowUp' ? -1 : 1));
    } else if (key === 'ArrowLeft' && t.children.length > 0) {
      handled();
      toggleCollapsed(i, true);
    } else if (key === 'ArrowRight' && t.children.length > 0) {
      handled();
      toggleCollapsed(i, false);
    } else if (key === 'Delete' || key === 'Backspace') {
      handled();
      // Select the task that comes after the deleted lines.
      const end = subtreeEnd(doc, i);
      const next = doc.tasks.find((x) => x.line > end);
      const edit = deleteTask(doc, i);
      apply(next ? { ...edit, focus: next.line - (end - t.line + 1) } : edit);
    }
  };

  // --- Drag a block by its grip ------------------------------------------------------------

  const onGripDown = (e: ReactPointerEvent, i: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setSelected(refAt(doc, i));
    setDrag({ from: i });
  };

  const onGripMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-task-index]');
    if (!row || !listRef.current?.contains(row)) {
      if (drag.target !== undefined) setDrag({ from: drag.from });
      return;
    }
    const target = Number(row.dataset.taskIndex);
    const rect = row.getBoundingClientRect();
    const textLeft = row.querySelector('.eb-todo-check')?.getBoundingClientRect().right ?? rect.left;
    const place: DropPlace = e.clientY < rect.top + rect.height / 2 ? 'before' : e.clientX > textLeft + ((24 * fontSize) / 14) * zoom ? 'child' : 'after';
    if (target !== drag.target || place !== drag.place) setDrag({ from: drag.from, target, place });
  };

  const onGripUp = () => {
    if (drag && drag.target !== undefined && drag.place !== undefined) apply(moveTaskTo(doc, drag.from, drag.target, drag.place));
    setDrag(null);
  };

  // --- Render ------------------------------------------------------------------------------

  const style = { fontSize };

  if (zoom < FAR_ZOOM) return <FarSummary doc={doc} today={today} zoom={zoom} width={width} />;

  const headingAt = new Map(doc.headings.map((h) => [h.line, h]));
  const items: ReactNode[] = [];
  let lastLine = -1;
  // The tint alternates among top tasks. The subtasks of a task alternate among themselves, the first with the
  // tint opposite to its parent. A parent comes before its subtasks, so its tint is known by then.
  const tinted: boolean[] = [];
  let topCount = 0;
  doc.tasks.forEach((t, i) => {
    if (t.parent === null) tinted[i] = topCount++ % 2 === 0;
    else tinted[i] = doc.tasks[t.parent].children.indexOf(i) % 2 === 0 ? !tinted[t.parent] : tinted[t.parent];
  });

  for (const i of visible) {
    const t = doc.tasks[i];
    for (let l = lastLine + 1; l < t.line; l++) {
      const h = headingAt.get(l);
      if (h)
        items.push(
          <div key={`h${l}`} className={`eb-todo-heading level-${h.level}`}>
            {h.title}
          </div>,
        );
    }
    lastLine = t.line;
    const isOpen = openIndex === i;
    items.push(
      <TaskRow
        key={`t${t.line}`}
        doc={doc}
        index={i}
        today={today}
        odd={tinted[i]}
        standalone={standalone}
        tree={treeLines(doc, i, collapsed.has(collapseKey(i)))}
        selected={selIndex === i}
        open={isOpen}
        collapsed={collapsed.has(collapseKey(i))}
        drop={drag && drag.target === i ? drag.place : undefined}
        dragging={drag?.from === i}
        title={
          editIndex === i ? (
            <TitleEditor key={`edit${t.line}`} initial={taskFullText(t)} tags={tags} people={people} onCommit={(v, next, kept) => commitTitle(i, v, next, kept)} />
          ) : undefined
        }
        onSelect={() => {
          setSelected(refAt(doc, i));
          focusList();
        }}
        onToggle={() => toggleDone(i)}
        onFold={() => toggleCollapsed(i)}
        onOpen={() => {
          // A second click on the title of the open task closes the details.
          if (isOpen) {
            setOpen(null);
            return;
          }
          setOpen(refAt(doc, i));
          setTitleFocus((n) => n + 1);
        }}
        onGripDown={(e) => onGripDown(e, i)}
        onGripMove={onGripMove}
        onGripUp={onGripUp}
      />,
    );
    if (confirmIndex === i) {
      const n = descendants(doc, i).filter((d) => !doc.tasks[d].checked && !isCancelled(doc.tasks[d])).length;
      items.push(
        <div key={`c${t.line}`} className="eb-todo-confirm" style={{ marginLeft: `${1.6 + t.depth * INDENT}em` }}>
          <span>
            {n} open subtask{n === 1 ? '' : 's'}.
          </span>
          <button
            type="button"
            onClick={() => {
              setConfirm(null);
              apply(setDoneWithSubtasks(doc, i, today));
            }}
          >
            Mark all done
          </button>
          <button
            type="button"
            onClick={() => {
              setConfirm(null);
              apply(setDone(doc, i, true, today));
            }}
          >
            Only this one
          </button>
          <button type="button" onClick={() => setConfirm(null)}>
            Cancel
          </button>
        </div>,
      );
    }
  }
  for (let l = lastLine + 1; l < doc.lines.length; l++) {
    const h = headingAt.get(l);
    if (h)
      items.push(
        <div key={`h${l}`} className={`eb-todo-heading level-${h.level}`}>
          {h.title}
        </div>,
      );
  }

  return (
    <div
      ref={listRef}
      className={`eb-todo-list nodrag${overflow && !standalone ? ' nowheel' : ''}${standalone ? ' standalone' : ''}`}
      data-todo-root
      style={style}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget || e.target === contentRef.current) setSelected(null);
      }}
    >
      <div ref={contentRef} className="eb-todo-list-content">
        <SaveBanner path={path} />
        {doc.tasks.length === 0 && <div className="eb-todo-empty">No tasks yet.</div>}
        {items}
        <button type="button" className="eb-todo-add" onClick={() => newTask(null)}>
          <Codicon name="add" /> Add task
        </button>
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
          anchor={() => listRef.current?.querySelector<HTMLElement>(`[data-task-index="${openIndex}"]`) ?? null}
          scroller={() => listRef.current}
          focusTitle={titleFocus}
          apply={(edit) => apply(edit)}
          onAddSubtask={() => {
            toggleCollapsed(openIndex, false);
            apply(insertSubtask(doc, openIndex), { editTitle: true });
          }}
          onClose={() => {
            setOpen(null);
            focusList();
          }}
        />
      )}
    </div>
  );
}

/** When the todo view goes away (Text mode, object deleted) while it owns the details panel, free the panel. */
export function useReleasePanel(nodeId: string): void {
  const store = useBoardStore();
  useEffect(
    () => () => {
      if (store.getState().todoPanelOwner === nodeId) store.getState().setTodoPanelOwner(null);
    },
    [store, nodeId],
  );
}

/** After a failed save of a todo file: the message, Reload and Overwrite (or Retry). */
export function SaveBanner({ path }: { path: string }) {
  const store = useBoardStore();
  const error = useBoard((s) => s.todoSaveErrors[path]);
  if (!error) return null;
  return (
    <div className="eb-banner">
      <span>{error.message}</span>
      <button type="button" onClick={() => store.getState().reloadTodo(path)}>
        Reload
      </button>
      <button type="button" onClick={() => store.getState().overwriteTodo(path)}>
        {error.conflict ? 'Overwrite' : 'Retry'}
      </button>
    </div>
  );
}

/** Zoomed far out: only `done/total` and the overdue count, about 14 screen pixels, never wider than the node. */
export function FarSummary({ doc, today, zoom, width }: { doc: TodoDoc; today: string; zoom: number; width: number }) {
  const s = summary(doc, today);
  return (
    <div className="eb-todo-far" style={{ fontSize: Math.min(14 / zoom, width / 9) }}>
      <span>
        {s.done}/{s.total} done
      </span>
      {s.overdue > 0 && <span className="overdue"> · {s.overdue} overdue</span>}
    </div>
  );
}

// --- One task --------------------------------------------------------------------------------

/** Tree lines of a row, like `tree` in a terminal: `├──` and `└──` to the parent, `│` for ancestors with later siblings. */
interface TreeLines {
  /** Levels (1 = child of a top task) that get a vertical line through the whole row. */
  through: number[];
  /** The elbow to the parent: `tee` (more siblings follow) or `corner` (last sibling). Null for top tasks. */
  elbow: 'tee' | 'corner' | null;
  /** A line goes down from the fold button to the first subtask. */
  down: boolean;
}

/** Tree lines of the task `i`, for a list where subtasks of folded tasks are hidden. */
function treeLines(doc: TodoDoc, i: number, folded: boolean): TreeLines {
  const isLast = (k: number) => {
    const parent = doc.tasks[k].parent;
    return parent === null || doc.tasks[parent].children[doc.tasks[parent].children.length - 1] === k;
  };
  const t = doc.tasks[i];
  const through: number[] = [];
  for (let cur = t.parent; cur !== null && doc.tasks[cur].parent !== null; cur = doc.tasks[cur].parent) {
    if (!isLast(cur)) through.push(doc.tasks[cur].depth);
  }
  return { through, elbow: t.parent === null ? null : isLast(i) ? 'corner' : 'tee', down: t.children.length > 0 && !folded };
}

/** Indent of one subtask level, in em. */
const INDENT = 1.3;
/**
 * Distance of the vertical line of a level from the row's left edge: the middle of the parent's checkbox.
 * Row layout: padding, grip (0.86em, shifted 4px left, then a 4px gap), fold button 1.15em, 4px gap, checkbox 1.07em.
 */
const treeX = (level: number) => `calc(${0.3 + (level - 1) * INDENT + 0.86 + 1.15 + 1.07 / 2}em + 3px)`;
/** Top of the horizontal line: the middle of the first text line (the line is 2px thick). */
const TREE_Y = 'calc(3px + 0.675em - 1px)';

interface RowProps {
  doc: TodoDoc;
  index: number;
  today: string;
  tree: TreeLines;
  /** Light blue tint: alternates among top tasks, and separately among the subtasks of each task. */
  odd: boolean;
  /** No Handle for lines: there is no board. */
  standalone: boolean;
  selected: boolean;
  open: boolean;
  collapsed: boolean;
  drop?: DropPlace;
  dragging: boolean;
  /** The title editor, while the title is edited. */
  title?: ReactNode;
  onSelect(): void;
  onToggle(): void;
  onFold(): void;
  onOpen(): void;
  onGripDown(e: ReactPointerEvent): void;
  onGripMove(e: ReactPointerEvent): void;
  onGripUp(): void;
}

function TaskRow(p: RowProps) {
  const { doc, index, today } = p;
  const t = doc.tasks[index];
  const tokens = taskMeta(t);
  const status = getValue(t, 'status');
  const cancelled = status === 'cancelled';
  const priority = getValue(t, 'priority');
  const kids = t.children.filter((c) => !isCancelled(doc.tasks[c]));
  const kidsDone = kids.filter((c) => doc.tasks[c].checked).length;
  const classes = [
    'eb-todo-row',
    p.odd ? (t.depth > 0 ? 'odd-sub' : 'odd') : '',
    p.selected ? 'selected' : '',
    t.checked ? 'done' : '',
    cancelled ? 'cancelled' : '',
    priority === 'high' || priority === 'medium' || priority === 'low' ? `prio-${priority}` : '',
    p.drop ? `drop-${p.drop}` : '',
    p.dragging ? 'dragging' : '',
    p.open ? 'open' : '',
  ].filter((c) => c !== '');

  return (
    <div
      className={classes.join(' ')}
      data-task-index={index}
      style={{ paddingLeft: `${0.3 + t.depth * INDENT}em` }}
      onPointerDown={(e) => {
        if (!isField(e.target) && !(e.target as HTMLElement).closest('button, .eb-task-ball')) p.onSelect();
      }}
    >
      {p.tree.through.map((level) => (
        <span key={`v${level}`} className="eb-todo-tree" style={{ left: treeX(level), top: 0, bottom: 0, width: 0, borderLeftWidth: 2 }} />
      ))}
      {p.tree.elbow !== null &&
        (t.children.length === 0 ? (
          <>
            <span className="eb-todo-tree" style={{ left: treeX(t.depth), top: 0, ...(p.tree.elbow === 'tee' ? { bottom: 0 } : { height: 'calc(3px + 0.675em + 1px)' }), width: 0, borderLeftWidth: 2 }} />
            <span className="eb-todo-tree" style={{ left: treeX(t.depth), top: TREE_Y, width: '0.6em', height: 0, borderTopWidth: 2 }} />
          </>
        ) : (
          // The fold button sits on the line: the line stops above it and goes on below it.
          <>
            <span className="eb-todo-tree" style={{ left: treeX(t.depth), top: 0, height: 'calc(3px + 0.2em)', width: 0, borderLeftWidth: 2 }} />
            {p.tree.elbow === 'tee' && <span className="eb-todo-tree" style={{ left: treeX(t.depth), top: 'calc(3px + 1.15em)', bottom: 0, width: 0, borderLeftWidth: 2 }} />}
          </>
        ))}
      {p.tree.down && <span className="eb-todo-tree" style={{ left: treeX(t.depth + 1), top: 'calc(3px + 1.25em)', bottom: 0, width: 0, borderLeftWidth: 2 }} />}
      {/* The grip keeps its place in the row but is shifted back to the left edge, where the grip of a top task is. */}
      {!p.standalone && <Handle id={`task:${getValue(t, 'id') ?? `@${t.line}`}`} type="source" position={Position.Right} className="eb-task-ball nodrag nopan" />}
      <span className="eb-todo-grip" style={{ transform: `translateX(${-t.depth * INDENT}em)` }} title="Drag to move" onPointerDown={p.onGripDown} onPointerMove={p.onGripMove} onPointerUp={p.onGripUp} onPointerCancel={p.onGripUp}>
        <Codicon name="gripper" />
      </span>
      {t.children.length > 0 ? (
        <button type="button" className="eb-todo-fold" title={p.collapsed ? 'Show subtasks' : 'Hide subtasks'} onClick={p.onFold}>
          <Codicon name={p.collapsed ? 'chevron-right' : 'chevron-down'} />
        </button>
      ) : (
        <span className="eb-todo-fold" />
      )}
      <button
        type="button"
        className={`eb-todo-check${t.checked ? ' checked' : status === 'inProgress' ? ' progress' : status === 'waiting' ? ' waiting' : ''}`}
        title={t.checked ? 'Mark not done (Space)' : status === 'inProgress' ? 'Mark done (Space)' : 'Start (Space)'}
        onClick={p.onToggle}
      >
        {t.checked ? <Codicon name="check" /> : status === 'inProgress' ? <ProgressIcon /> : null}
      </button>
      <div className="eb-todo-main">
        {p.title ?? (
          <div className="eb-todo-line1">
            <span className={`eb-todo-title${tokens.title === '' ? ' empty' : ''}`} title="Details (Enter)" onClick={p.onOpen}>
              {tokens.title === '' ? 'Untitled' : tokens.title}
            </span>
            <TaskChips doc={doc} index={index} today={today} />
          </div>
        )}
      </div>
      {kids.length > 0 && (
        <span className="eb-todo-progress" title="Subtasks done">
          {kidsDone}/{kids.length}
        </span>
      )}
      {t.problems.length > 0 && (
        <span className="eb-warning" title={t.problems.join('\n')}>
          <Codicon name="warning" />
        </span>
      )}
    </div>
  );
}
