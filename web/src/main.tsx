import { StrictMode, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { bootstrap, bootstrapTodo } from '../../webview/src/bootstrap';
import type { BoardStore } from '../../webview/src/store';
import { isBoardName } from '../shared/boardNames';
import { installKeys } from './host/keys';
import { WebHost } from './host/WebHost';
import { WebTodoHost } from './host/WebTodoHost';
import { BoardList } from './pages/BoardList';
import { RawBoard } from './pages/RawBoard';
import { RawFile } from './pages/RawFile';
import { createBrowserEnv } from './ports/browserEnv';
import { BrowserDialogs, DialogHost } from './ports/browserDialogs';
import { createBrowserSettings } from './ports/browserSettings';
import { createDevServerFiles, createDevServerStorage } from './ports/devServerStorage';
import type { BoardStorage, FileStore } from './ports/types';
import { SessionViewState } from './ports/sessionViewState';
import { boardHref, goneHref, homeHref } from './routes';
import { startDriveMode, type DriveMode } from './sync/setup';
import { SyncBadge } from './ui/SyncBadge';
import { isTodoPath } from '../../src/shared/todoFormat';
import './web.css';

const rootEl = document.getElementById('root') as HTMLElement;
const uiEl = document.getElementById('web-ui') as HTMLElement;
// Set by `boot()` before the first page is shown.
let storage!: BoardStorage;
let files!: FileStore;
/** Only in Drive mode: local copy plus Google Drive sync. */
let drive: DriveMode | undefined;
/** The board that is open on this page. */
let currentBoard: string | undefined;

/** `npm run dev` keeps the dev server's boards folder; a build and `VITE_KONEKTON_STORAGE=drive` use the local copy and Drive. */
const useDrive = import.meta.env.VITE_KONEKTON_STORAGE === 'drive' || (import.meta.env.PROD && import.meta.env.VITE_KONEKTON_STORAGE !== 'devserver');
const dialogs = new BrowserDialogs(useDrive ? 'Drive' : 'the server');

/** The sync badge, top right (Drive mode only). */
const badge = (): ReactNode => (drive ? <SyncBadge sync={drive.sync} auth={drive.auth} onSignIn={drive.signIn} onSignOut={drive.signOut} /> : null);

const titleFor = (name: string) => `${name} – Konekton`;

function render(el: HTMLElement, node: ReactNode): void {
  createRoot(el).render(<StrictMode>{node}</StrictMode>);
}

function showStartPage(note?: string): void {
  document.body.classList.add('kw-scroll');
  document.title = 'Konekton boards';
  const signedOut = drive?.auth.state().kind === 'signedOut';
  render(
    rootEl,
    <>
      <BoardList
        storage={storage}
        files={files}
        dialogs={dialogs}
        note={note}
        emptyHint={signedOut ? 'Sign in with Google to see your boards from Drive. Boards made now stay in this browser until you sign in.' : undefined}
      />
      <DialogHost dialogs={dialogs} />
    </>,
  );
  render(uiEl, badge());
}

async function openBoard(name: string): Promise<void> {
  let loaded;
  try {
    loaded = await storage.load(name);
  } catch (err) {
    showStartPage(`Cannot open ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  if (!loaded) {
    history.replaceState(null, '', homeHref());
    showStartPage(`Board not found: ${name}`);
    return;
  }

  document.title = titleFor(name);
  currentBoard = name;
  const viewState = new SessionViewState(name);
  // Set right after bootstrap; the host needs it before then only in theory.
  const board: { store?: BoardStore } = {};
  const host = new WebHost({ storage, files, env: createBrowserEnv(), dialogs, settings: createBrowserSettings(), viewState }, name, loaded, {
    // Same calls as the tab-hide handler in App.tsx. EditableText commits its draft when `editing` turns off,
    // so render at once, then give a later effect one more turn.
    async closeTextFields() {
      if (!board.store) return;
      const api = board.store.getState();
      flushSync(() => {
        api.setEditing(null);
        api.setLabelEditing(null);
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    renamed(next) {
      viewState.rename(next);
      currentBoard = next;
      history.replaceState(null, '', boardHref(next));
      document.title = titleFor(next);
    },
    gone(gone) {
      window.location.assign(goneHref(gone));
    },
  });
  board.store = bootstrap(host, rootEl, { fileReferences: true, todoFullscreen: true });
  installKeys(host.doc, drive ? () => drive?.sync.syncNow() : undefined);
  render(
    uiEl,
    <>
      <a className="kw-boards-link" href={homeHref()}>
        Boards
      </a>
      {badge()}
      <DialogHost dialogs={dialogs} />
    </>,
  );
}

/** The full todo editor for one todo file in the boards folder. */
function openTodo(path: string, from: string | undefined): void {
  document.title = `${path} – Konekton`;
  const host = new WebTodoHost({ storage, files, env: createBrowserEnv(), dialogs, viewState: new SessionViewState(`todo:${path}`) }, path, from, {
    openBoard(name, closeThisTab) {
      if (closeThisTab) {
        // A tab opened from the board's card closes and shows the board tab again. A tab that cannot close goes to the board.
        window.close();
        window.setTimeout(() => window.location.assign(boardHref(name)), 200);
      } else {
        window.location.assign(boardHref(name));
      }
    },
  });
  bootstrapTodo(host, rootEl);
  render(
    uiEl,
    <>
      {badge()}
      <DialogHost dialogs={dialogs} />
    </>,
  );
}

function start(): void {
  const params = new URLSearchParams(window.location.search);
  const todo = params.get('todo');
  if (todo !== null) {
    if (!isTodoPath(todo)) {
      history.replaceState(null, '', homeHref());
      showStartPage(`Not a todo file: ${todo}`);
      return;
    }
    const from = params.get('from');
    openTodo(todo, from !== null && isBoardName(from) ? from : undefined);
    return;
  }
  const file = params.get('file');
  if (file !== null) {
    document.body.classList.add('kw-scroll');
    document.title = `${file} – Konekton`;
    render(rootEl, <RawFile files={files} path={file} />);
    render(uiEl, badge());
    return;
  }
  const board = params.get('board');
  if (board === null) {
    const gone = params.get('gone');
    if (gone !== null) history.replaceState(null, '', homeHref());
    showStartPage(gone !== null ? (drive ? `${gone} was removed on Drive.` : 'The board was deleted on the server.') : undefined);
    return;
  }
  if (!isBoardName(board)) {
    history.replaceState(null, '', homeHref());
    showStartPage(`Not a board name: ${board}`);
    return;
  }
  if (params.get('view') === 'raw') {
    document.body.classList.add('kw-scroll');
    document.title = `${board} (text) – Konekton`;
    render(rootEl, <RawBoard storage={storage} name={board} />);
    render(uiEl, badge());
    return;
  }
  void openBoard(board);
}

async function boot(): Promise<void> {
  if (useDrive) {
    try {
      drive = await startDriveMode(dialogs, {
        savedAsCopy(original, copy) {
          if (currentBoard === original) window.location.assign(boardHref(copy));
        },
      });
    } catch (err) {
      rootEl.textContent = `Cannot open the local storage of this browser: ${err instanceof Error ? err.message : String(err)}`;
      return;
    }
    storage = drive.storage;
    files = drive.files;
    const focus = () => drive?.sync.onFocus();
    window.addEventListener('focus', focus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') focus();
    });
  } else {
    storage = createDevServerStorage();
    files = createDevServerFiles();
  }
  start();
}

void boot();
