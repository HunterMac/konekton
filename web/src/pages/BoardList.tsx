import { useCallback, useEffect, useState } from 'react';
import { emptyDoc, serialize } from '../../../src/shared/canvasFormat';
import type { BoardInfo } from '../../shared/api';
import { toBoardName } from '../../shared/boardNames';
import type { BoardStorage, Dialogs } from '../ports/types';
import { boardHref } from '../routes';

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

function shortDate(mtime: number): string {
  return new Date(mtime).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/** Start page: the boards in the boards folder and "New board". */
export function BoardList({ storage, dialogs, note }: { storage: BoardStorage; dialogs: Dialogs; note?: string }) {
  const [boards, setBoards] = useState<BoardInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const newBoard = async () => {
    const input = dialogs.prompt('Board name');
    if (input === undefined) return;
    const name = toBoardName(input);
    if (!name) {
      dialogs.alert('Use a plain file name, for example "plan".');
      return;
    }
    try {
      const created = await storage.create(name, serialize(emptyDoc()));
      if (created === 'exists') {
        dialogs.alert(`A board named ${name} already exists.`);
        return;
      }
      window.location.assign(boardHref(created.name));
    } catch (err) {
      dialogs.alert(`The board was not created: ${message(err)}`);
    }
  };

  return (
    <main className="kw-page">
      <h1>Konekton boards</h1>
      {note && <p className="kw-note">{note}</p>}
      {error && <p className="kw-note kw-error">Cannot list the boards: {error}</p>}
      <p>
        <button type="button" className="kw-primary" onClick={() => void newBoard()}>
          New board
        </button>
      </p>
      {boards && boards.length === 0 && <p>No boards yet.</p>}
      {boards && boards.length > 0 && (
        <ul className="kw-boards">
          {boards.map((b) => (
            <li key={b.name}>
              <a href={boardHref(b.name)}>{b.name}</a>
              <span className="kw-date">{shortDate(b.mtime)}</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
