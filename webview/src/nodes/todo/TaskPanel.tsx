import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { expandDateShortcuts, listTokens, readTokens, replaceTaskLines, retitle, retitleTask, taskFullText, taskMeta, type TodoDoc, type TodoEdit } from '../../../../src/shared/todoFormat';
import { Codicon } from '../../ui/icons';
import { TodoDetails } from './TodoDetails';
import { isValidTitle, MIN_TITLE_LENGTH } from './TitleEditor';

/** Where the todo object is on the board, in flow coordinates. */
export interface NodeBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Space between the task title and the panel, in flow pixels. */
const GAP = 12;
/** Width of the panel in em: the same as `.eb-todo-panel` in styles.css. */
const PANEL_EM = 24;

interface Props {
  doc: TodoDoc;
  index: number;
  today: string;
  box: NodeBox;
  fontSize: number;
  zoom: number;
  /** The full todo editor: the panel sits inside the list or lanes (`[data-todo-root]`), not in a board viewport. */
  standalone?: boolean;
  /** The row or card of the task: the panel lines up with its top. */
  anchor(): HTMLElement | null;
  /** The element that scrolls the anchor, so the panel follows it. */
  scroller(): HTMLElement | null;
  apply(edit: TodoEdit): void;
  /** Unset: no "+ Add subtask". */
  onAddSubtask?(): void;
  onClose(): void;
  /** Each new value (above 0) puts the caret in the title. */
  focusTitle?: number;
}

/**
 * The details of one task in a square window just right of the clicked task title. It is drawn in the flow viewport,
 * above all objects, so it moves and zooms with the board and no other object covers it.
 */
export function TaskPanel(p: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [top, setTop] = useState(0);
  /** Right end of the task title from the todo object's left edge, in flow pixels. */
  const [titleRight, setTitleRight] = useState(p.box.width);
  const [raw, setRaw] = useState(false);
  /** Width of the list or lanes (standalone), so the panel stays inside. */
  const [rootWidth, setRootWidth] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const task = p.doc.tasks[p.index];
  const standalone = p.standalone === true;

  // Find the viewport, and line the panel up with the task, also while the list scrolls.
  useLayoutEffect(() => {
    const anchor = p.anchor();
    if (standalone) {
      const root = anchor?.closest<HTMLElement>('[data-todo-root]') ?? null;
      setHost(root);
      const measureRoot = () => {
        const a = p.anchor();
        if (!a || !root) return;
        const rr = root.getBoundingClientRect();
        setTop(Math.max(0, Math.round(a.getBoundingClientRect().top - rr.top)));
        const end = (a.querySelector('.eb-todo-title') ?? a).getBoundingClientRect().right;
        setTitleRight(Math.max(0, Math.round(end - rr.left)));
        setRootWidth(Math.round(rr.width));
      };
      measureRoot();
      window.addEventListener('resize', measureRoot);
      return () => window.removeEventListener('resize', measureRoot);
    }
    const viewport = anchor?.closest<HTMLElement>('.react-flow__viewport') ?? null;
    setHost(viewport);
    const node = anchor?.closest<HTMLElement>('.react-flow__node');
    const measure = () => {
      const a = p.anchor();
      if (!a || !node) return;
      const offset = (a.getBoundingClientRect().top - node.getBoundingClientRect().top) / p.zoom;
      setTop(Math.max(0, Math.round(offset)));
      // The panel opens just right of the title that was clicked (of the row, while no title shows).
      const end = (a.querySelector('.eb-todo-title') ?? a).getBoundingClientRect().right;
      setTitleRight(Math.max(0, Math.round((end - node.getBoundingClientRect().left) / p.zoom)));
    };
    measure();
    const scroller = p.scroller();
    scroller?.addEventListener('scroll', measure);
    return () => scroller?.removeEventListener('scroll', measure);
    // `anchor` and `scroller` are new functions each render; the task and the text are what move the row.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.doc, p.index, p.zoom, p.box.y, standalone]);

  // A panel low on the page is brought into view.
  useEffect(() => {
    if (standalone && host) panelRef.current?.scrollIntoView({ block: 'nearest' });
    // Once, when the panel first has its place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standalone, host !== null]);

  if (!host) return null;

  // In the board the panel sits right of the title in flow pixels. In the full editor it is in screen pixels and kept inside.
  const place = standalone
    ? { left: Math.max(0, Math.min(titleRight + GAP, rootWidth - p.fontSize * PANEL_EM)), top }
    : { left: p.box.x + titleRight + GAP, top: p.box.y + top };

  const onKeyDown = (e: KeyboardEvent) => {
    // Keys in the panel stay in the panel: the list must not toggle or move tasks.
    e.stopPropagation();
    if (e.key === 'Escape' && !(e.target as HTMLElement).closest('input, textarea, select')) {
      e.preventDefault();
      p.onClose();
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      className="eb-todo-panel nodrag nowheel nopan"
      style={{ ...place, fontSize: p.fontSize }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <div className="eb-todo-panel-head">
        <PanelTitle
          key={taskMeta(task).title}
          text={taskMeta(task).title}
          done={task.checked}
          focus={p.focusTitle ?? 0}
          onCommit={(title) => {
            // Title and meta together, so the tokens of the task stay when only the title changes.
            const full = taskFullText(task);
            const text = retitle(full, expandDateShortcuts(title.trim(), p.today), listTokens(full).map((t) => t.raw));
            if (text !== '' && text !== full) p.apply(retitleTask(p.doc, p.index, text));
          }}
        />
        <button type="button" className="eb-todo-panel-close" title="Close (Esc)" onClick={p.onClose}>
          <Codicon name="close" />
        </button>
      </div>
      <div className="eb-todo-panel-body">
        {raw ? (
          <RawEditor
            initial={p.doc.lines.slice(task.line, task.end + 1).join('\n')}
            onDone={(value) => {
              setRaw(false);
              if (value !== undefined) p.apply(replaceTaskLines(p.doc, p.index, value));
            }}
          />
        ) : (
          <TodoDetails doc={p.doc} index={p.index} today={p.today} apply={p.apply} onRawEdit={() => setRaw(true)} onAddSubtask={p.onAddSubtask} />
        )}
      </div>
    </div>,
    host,
  );
}

/** The task title, editable in place. Enter or a click outside saves, Esc goes back. Tokens stay; new ones can be typed. */
function PanelTitle({ text, done, focus, onCommit }: { text: string; done: boolean; focus: number; onCommit(title: string): void }) {
  const initial = readTokens(text).title;
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (focus > 0 && el) {
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
    }
  }, [focus]);
  return (
    <input
      ref={ref}
      className={`eb-todo-panel-title${done ? ' done' : ''}${value.trim() !== '' && !isValidTitle(value) ? ' invalid' : ''}`}
      value={value}
      placeholder="Untitled"
      spellCheck={false}
      title={isValidTitle(value) ? value : `At least ${MIN_TITLE_LENGTH} characters, or the old title stays`}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        // Too short: the old title comes back.
        if (!isValidTitle(value)) setValue(initial);
        else if (value !== initial) onCommit(value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setValue(initial);
          // Blur after the reset, so nothing is saved.
          const el = e.currentTarget;
          requestAnimationFrame(() => el.blur());
        }
      }}
    />
  );
}

/** The Markdown of one task (its line and comment), for fixing by hand. */
function RawEditor({ initial, onDone }: { initial: string; onDone(value: string | undefined): void }) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);
  const finish = (v: string | undefined) => {
    if (finished.current) return;
    finished.current = true;
    onDone(v === initial ? undefined : v);
  };
  return (
    <div className="eb-todo-rawedit">
      <textarea
        className="eb-todo-input eb-todo-raw"
        value={value}
        spellCheck={false}
        autoFocus
        rows={Math.min(12, value.split('\n').length + 1)}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish(undefined);
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            finish(value);
          }
        }}
      />
      <span className="eb-todo-hint">Ctrl+Enter or click outside saves · Esc cancels</span>
    </div>
  );
}
