import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@vscode/codicons/dist/codicon.css';
import '@xyflow/react/dist/style.css';
import './styles.css';
import { App } from './App';
import { ALL_FEATURES, loadViewState, setHost, type Host, type HostFeatures } from './host';
import { createBoardStore, type BoardStore } from './store';
import { BoardContext } from './useBoard';

export type { HostFeatures } from './host';

/** Start the board inside `root`, talking to `host`. Shared by the VS Code webview and the web app. */
export function bootstrap(host: Host, root: HTMLElement, features: HostFeatures = ALL_FEATURES): BoardStore {
  setHost(host);
  const store = createBoardStore((m) => host.post(m), loadViewState().mode, features);
  host.onMessage((m) => store.getState().handleMessage(m));
  createRoot(root).render(
    <StrictMode>
      <BoardContext.Provider value={store}>
        <App />
      </BoardContext.Provider>
    </StrictMode>,
  );
  host.post({ type: 'ready' });
  return store;
}
