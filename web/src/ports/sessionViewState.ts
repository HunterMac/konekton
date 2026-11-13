import type { ViewStateStore } from './types';

const keyFor = (board: string) => `konekton.view:${board}`;

function read(storage: Storage, board: string): unknown {
  try {
    const raw = storage.getItem(keyFor(board));
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function write(storage: Storage, board: string, state: unknown): void {
  try {
    storage.setItem(keyFor(board), JSON.stringify(state));
  } catch {
    // Storage full or blocked: the view is not kept.
  }
}

/** Copy the saved view of one board to another (after Save-as). */
export function copyViewState(from: string, to: string, storage: Storage = window.sessionStorage): void {
  const state = read(storage, from);
  if (state !== undefined) write(storage, to, state);
}

/** View, cameras and timeline scale: `sessionStorage`, per browser tab and per board. */
export class SessionViewState implements ViewStateStore {
  constructor(
    private board: string,
    private readonly storage: Storage = window.sessionStorage,
  ) {}

  get(): unknown {
    return read(this.storage, this.board);
  }

  set(state: unknown): void {
    write(this.storage, this.board, state);
  }

  /** The board was saved under a new name: keep its view. */
  rename(to: string): void {
    copyViewState(this.board, to, this.storage);
    this.board = to;
  }
}
