import { useCallback, useEffect, useState } from 'react';
import type { FileResponse } from '../../shared/api';
import type { FileStore } from '../ports/types';

/** "Open in editor" for a file reference in the web version: the file's text, read-only, updated when it changes. */
export function RawFile({ files, path }: { files: FileStore; path: string }) {
  const [state, setState] = useState<FileResponse | { status: 'loading' }>({ status: 'loading' });

  const load = useCallback(() => {
    void files.read(path).then(setState);
  }, [files, path]);

  useEffect(() => {
    load();
    return files.watch((changed) => {
      if (changed === path) load();
    });
  }, [files, path, load]);

  return (
    <main className="kw-page kw-raw">
      <h1>{path}</h1>
      <p>
        <a href="/">Boards</a>
      </p>
      {state.status === 'loading' && <p>Loading…</p>}
      {state.status === 'missing' && <p className="kw-note">File not found: {path}</p>}
      {state.status === 'binary' && <p className="kw-note">Not a text file.</p>}
      {state.status === 'tooLarge' && <p className="kw-note">File too large to show.</p>}
      {/* A React text child: the file is never rendered as HTML. */}
      {state.status === 'ok' && <pre className="kw-raw-text">{state.text}</pre>}
    </main>
  );
}
