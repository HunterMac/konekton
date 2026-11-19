import { useEffect, useLayoutEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { loadViewState, updateViewState } from '../host';
import { useBoard, useBoardStore } from '../useBoard';
import { Codicon } from '../ui/icons';
import { TodoBoard } from '../nodes/todo/TodoBoard';
import { TodoList } from '../nodes/todo/TodoList';
import { TodoTimeline } from '../nodes/todo/TodoTimeline';
import { todoFontSize } from './fontSize';

/** Not on a board: no position, and one panel owner. */
const BOX = { x: 0, y: 0, width: 0, height: 0 };
const OWNER = 'standalone';

type View = 'todo' | 'board' | 'timeline';

/**
 * The full todo editor: one `*.todo.md` file as a whole editor tab (TODO-STANDALONE.md). The same list and lanes as
 * on the board, with a fixed text size that follows the width of the editor, and the page scrolls.
 */
export function TodoApp() {
  const store = useBoardStore();
  const path = useBoard((s) => s.todoFile);
  const file = useBoard((s) => (s.todoFile === null ? undefined : s.files[s.todoFile]));
  const canvases = useBoard((s) => s.todoCanvases);
  const [view, setViewState] = useState<View>(() => loadViewState().todoView ?? 'todo');
  const [fontSize, setFontSize] = useState(() => todoFontSize(window.innerWidth));

  useEffect(() => {
    const onResize = () => setFontSize(todoFontSize(window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (path !== null) store.getState().watchFiles([path]);
  }, [store, path]);

  const ok = file?.status === 'ok';
  // Keys work at once: the list or lanes take the focus when they show.
  useLayoutEffect(() => {
    if (ok) document.querySelector<HTMLElement>('[data-todo-root]')?.focus({ preventScroll: true });
  }, [ok, view]);

  if (path === null) return <div className="eb-loading" />;

  const setView = (v: View) => {
    setViewState(v);
    updateViewState({ todoView: v });
  };

  let body;
  if (file === undefined) body = <div className="eb-todo-page-note">Loading…</div>;
  else if (file.status === 'missing') body = <div className="eb-todo-page-note">Missing file: {path}</div>;
  else if (file.status === 'tooLarge') body = <div className="eb-todo-page-note">File too large to show</div>;
  else if (file.status === 'binary') body = <div className="eb-todo-page-note">Not a text file</div>;
  else if (view === 'board') body = <TodoBoard path={path} text={file.text ?? ''} fontSize={fontSize} width={0} box={BOX} nodeId={OWNER} standalone />;
  else if (view === 'timeline') body = <TodoTimeline path={path} text={file.text ?? ''} fontSize={fontSize} width={0} box={BOX} nodeId={OWNER} standalone />;
  else body = <TodoList path={path} text={file.text ?? ''} fontSize={fontSize} width={0} box={BOX} nodeId={OWNER} standalone />;

  const back = canvases.length === 1 ? `Back to ${canvases[0]}` : 'Back to a canvas that shows this file';

  return (
    <ReactFlowProvider>
      <div className="eb-todo-page" style={{ fontSize }}>
        <header className="eb-todo-page-head">
          {canvases.length > 0 && (
            <button type="button" className="eb-todo-back" title={back} onClick={() => store.getState().backToCanvas()}>
              <Codicon name="arrow-left" /> Canvas
            </button>
          )}
          <Codicon name="checklist" className="eb-file-icon" />
          <span className="eb-todo-page-name" title={path}>
            {path}
          </span>
          <span className="eb-view-switch" role="group" aria-label="View">
            <button type="button" className={view === 'todo' ? 'active' : ''} title="Show as todo list" onClick={() => setView('todo')}>
              Todo
            </button>
            <button type="button" className={view === 'board' ? 'active' : ''} title="Show this list as Todo / In progress / Done lanes" onClick={() => setView('board')}>
              Board
            </button>
            <button type="button" className={view === 'timeline' ? 'active' : ''} title="Show this list on a date arrow by due date" onClick={() => setView('timeline')}>
              Timeline
            </button>
            <button type="button" title="Show the Markdown text" onClick={() => store.getState().reopenAsText()}>
              Text
            </button>
          </span>
        </header>
        <main className="eb-todo-page-body">{body}</main>
      </div>
    </ReactFlowProvider>
  );
}
