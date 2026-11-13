import { useCallback, useEffect, useState } from 'react';
import { parse } from '../../../src/shared/canvasFormat';
import type { BoardStorage } from '../ports/types';
import { boardHref } from '../routes';

type RawState =
  | { kind: 'loading' }
  | { kind: 'missing' }
  | { kind: 'failed'; message: string }
  | { kind: 'loaded'; text: string; error: string | null };

/** "Open as text": a read-only view of a board file, mainly to see why it cannot be read. */
export function RawBoard({ storage, name }: { storage: BoardStorage; name: string }) {
  const [state, setState] = useState<RawState>({ kind: 'loading' });

  const load = useCallback(() => {
    storage.load(name).then(
      (board) => {
        if (!board) {
          setState({ kind: 'missing' });
          return;
        }
        const result = parse(board.text);
        setState({ kind: 'loaded', text: board.text, error: result.ok ? null : result.error });
      },
      (err: unknown) => setState({ kind: 'failed', message: err instanceof Error ? err.message : String(err) }),
    );
  }, [storage, name]);

  useEffect(() => {
    load();
    return storage.watch((event) => {
      if ((event.kind === 'changed' || event.kind === 'removed') && event.name === name) load();
    });
  }, [storage, name, load]);

  return (
    <main className="kw-page kw-raw">
      <h1>{name}</h1>
      <p>
        <a href="/">Boards</a>
      </p>
      {state.kind === 'loading' && <p>Loading…</p>}
      {state.kind === 'missing' && <p className="kw-note">Board not found: {name}</p>}
      {state.kind === 'failed' && <p className="kw-note kw-error">Cannot load this board: {state.message}</p>}
      {state.kind === 'loaded' && state.error === null && (
        <p className="kw-note">
          This board is valid. <a href={boardHref(name)}>Open the board</a>
        </p>
      )}
      {state.kind === 'loaded' && state.error !== null && (
        <>
          <p className="kw-note kw-error">Cannot read this board: {state.error}</p>
          <p>The board never saves over a broken file. Fix it in an editor; the board reloads when the file is valid.</p>
        </>
      )}
      {/* A React text child: the file is never rendered as HTML. */}
      {state.kind === 'loaded' && <pre className="kw-raw-text">{state.text}</pre>}
    </main>
  );
}
