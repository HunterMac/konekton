import { StrictMode, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { bootstrap } from '../../webview/src/bootstrap';
import type { BoardStore } from '../../webview/src/store';
import { isBoardName } from '../shared/boardNames';
import { installKeys } from './host/keys';
import { WebHost } from './host/WebHost';
import { BoardList } from './pages/BoardList';
import { RawBoard } from './pages/RawBoard';
import { createBrowserEnv } from './ports/browserEnv';
import { BrowserDialogs, DialogHost } from './ports/browserDialogs';
import { createBrowserSettings } from './ports/browserSettings';
import { createDevServerStorage } from './ports/devServerStorage';
import { SessionViewState } from './ports/sessionViewState';
import { boardHref } from './routes';
import './web.css';

const rootEl = document.getElementById('root') as HTMLElement;
const uiEl = document.getElementById('web-ui') as HTMLElement;
const storage = createDevServerStorage();
const dialogs = new BrowserDialogs();

const titleFor = (name: string) => `${name} – Konekton`;

function render(el: HTMLElement, node: ReactNode): void {
  createRoot(el).render(<StrictMode>{node}</StrictMode>);
}

function showStartPage(note?: string): void {
  document.body.classList.add('kw-scroll');
  document.title = 'Konekton boards';
  render(
    rootEl,
    <>
      <BoardList storage={storage} dialogs={dialogs} note={note} />
      <DialogHost dialogs={dialogs} />
    </>,
  );
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
    history.replaceState(null, '', '/');
    showStartPage(`Board not found: ${name}`);
    return;
  }

  document.title = titleFor(name);
  const viewState = new SessionViewState(name);
  // Set right after bootstrap; the host needs it before then only in theory.
  const board: { store?: BoardStore } = {};
  const host = new WebHost({ storage, env: createBrowserEnv(), dialogs, settings: createBrowserSettings(), viewState }, name, loaded, {
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
      history.replaceState(null, '', boardHref(next));
      document.title = titleFor(next);
    },
    gone(gone) {
      window.location.assign(`/?gone=${encodeURIComponent(gone)}`);
    },
  });
  board.store = bootstrap(host, rootEl, { fileReferences: false });
  installKeys(host.doc);
  render(
    uiEl,
    <>
      <a className="kw-boards-link" href="/">
        Boards
      </a>
      <DialogHost dialogs={dialogs} />
    </>,
  );
}

function start(): void {
  const params = new URLSearchParams(window.location.search);
  const board = params.get('board');
  if (board === null) {
    const gone = params.get('gone');
    if (gone !== null) history.replaceState(null, '', '/');
    showStartPage(gone !== null ? 'The board was deleted on the server.' : undefined);
    return;
  }
  if (!isBoardName(board)) {
    history.replaceState(null, '', '/');
    showStartPage(`Not a board name: ${board}`);
    return;
  }
  if (params.get('view') === 'raw') {
    document.body.classList.add('kw-scroll');
    document.title = `${board} (text) – Konekton`;
    render(rootEl, <RawBoard storage={storage} name={board} />);
    return;
  }
  void openBoard(board);
}

start();
