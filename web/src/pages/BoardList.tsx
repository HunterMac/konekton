import { useCallback, useEffect, useState } from 'react';
import { emptyDoc, serialize } from '../../../src/shared/canvasFormat';
import { isTodoPath } from '../../../src/shared/todoFormat';
import type { BoardInfo } from '../../shared/api';
import { toBoardName } from '../../shared/boardNames';
import type { BoardStorage, Dialogs, FileStore } from '../ports/types';
import { boardHref, homeHref, todoHref } from '../routes';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function shortDate(mtime: number): string {
  return new Date(mtime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export type Filter = 'all' | 'canvas' | 'todo';

const TABS: { filter: Filter; label: string }[] = [
  { filter: 'all', label: 'All' },
  { filter: 'canvas', label: 'Canvas' },
  { filter: 'todo', label: 'Todo' },
];

const EMPTY: Record<Filter, string> = { all: 'No boards or todo lists yet.', canvas: 'No boards yet.', todo: 'No todo lists yet.' };

/** One line of the list: a board or a todo file. */
export type Entry = { kind: 'canvas'; name: string; mtime: number } | { kind: 'todo'; path: string };

/** The entries to show for a tab. Boards come first (newest first, as the server lists them), then todo files by path. */
export function entriesFor(filter: Filter, boards: BoardInfo[], paths: string[]): Entry[] {
  const out: Entry[] = [];
  if (filter !== 'todo') for (const b of boards) out.push({ kind: 'canvas', name: b.name, mtime: b.mtime });
  if (filter !== 'canvas') {
    for (const path of paths.filter(isTodoPath).sort((a, b) => a.localeCompare(b))) out.push({ kind: 'todo', path });
  }
  return out;
}

/** Start page: the boards and the todo lists in the boards folder, with tabs All / Canvas / Todo, and "New board". */
export function BoardList({ storage, files, dialogs, note, emptyHint }: { storage: BoardStorage; files: FileStore; dialogs: Dialogs; note?: string; emptyHint?: string }) {
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [paths, setPaths] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [filesError, setFilesError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    storage.list().then(
      (list) => {
        setBoards(list);
        setError(null);
      },
      (err: unknown) => setError(message(err)),
    );
  }, [storage]);

  useEffect(() => {
    refresh();
    return storage.watch((event) => {
      if (event.kind === 'list') refresh();
    });
  }, [storage, refresh]);

  const refreshFiles = useCallback(() => {
    files.list().then(
      (list) => {
        setPaths(list);
        setFilesError(null);
      },
      (err: unknown) => setFilesError(message(err)),
    );
  }, [files]);

  useEffect(() => {
    refreshFiles();
    // Todo files appear and go away without a board event.
    return files.watch(() => refreshFiles());
  }, [files, refreshFiles]);

  const newBoard = async () => {
    let value: string | undefined;
    let error: string | undefined;
    for (;;) {
      const input = await dialogs.prompt('Board name', value, { error, placeholder: 'e.g. plan', submitLabel: 'Create' });
      if (input === undefined) return;
      const name = toBoardName(input);
      value = input;
      if (!name) {
        error = 'Use a plain file name, for example "plan".';
        continue;
      }
      try {
        const created = await storage.create(name, serialize(emptyDoc()));
        if (created === 'exists') {
          error = `A board named ${name} already exists.`;
          continue;
        }
        window.location.assign(boardHref(created.name));
        return;
      } catch (err) {
        await dialogs.alert(`The board was not created: ${message(err)}`);
        return;
      }
    }
  };

  const loaded = boards !== null && (paths !== null || filesError !== null);
  const entries = loaded ? entriesFor(filter, boards, paths ?? []) : [];

  return (
    <main className="kw-page">
      <h1>Files</h1>
      {note && <p className="kw-note">{note}</p>}
      {error && <p className="kw-note kw-error">Cannot list the boards: {error}</p>}
      {filesError && filter !== 'canvas' && <p className="kw-note kw-error">Cannot list the todo lists: {filesError}</p>}
      <div className="kw-toolbar">
        <div className="kw-tabs" role="tablist" aria-label="Show">
          {TABS.map((t) => (
            <button key={t.filter} type="button" role="tab" aria-selected={filter === t.filter} className={filter === t.filter ? 'active' : ''} onClick={() => setFilter(t.filter)}>
              {t.label}
            </button>
          ))}
        </div>
        <button type="button" className="kw-primary" onClick={() => void newBoard()}>
          New board
        </button>
      </div>
      {loaded && entries.length === 0 && <p>{emptyHint ?? EMPTY[filter]}</p>}
      {entries.length > 0 && (
        <ul className="kw-boards">
          {entries.map((e) =>
            e.kind === 'canvas' ? (
              <li key={`c:${e.name}`}>
                <a href={boardHref(e.name)}>{e.name}</a>
                <span className="kw-date">{shortDate(e.mtime)}</span>
              </li>
            ) : (
              <li key={`t:${e.path}`}>
                <a href={todoHref(e.path)}>{e.path}</a>
                <span className="kw-date">todo</span>
              </li>
            ),
          )}
        </ul>
      )}
      <footer className="kw-legal">
        <a href={`${homeHref()}privacy.html`}>Privacy Policy</a>
        <a href={`${homeHref()}terms.html`}>Terms of Service</a>
      </footer>
    </main>
  );
}
