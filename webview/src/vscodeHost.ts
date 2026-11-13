import type { ExtensionMessage, WebviewMessage } from '../../src/shared/protocol';
import type { Host } from './host';

interface VsCodeApi {
  postMessage(message: WebviewMessage): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

/** The board inside a VS Code webview. `acquireVsCodeApi` may be called only once, so call this once. */
export function createVsCodeHost(): Host {
  const api: VsCodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : { postMessage: () => {}, getState: () => undefined, setState: () => {} };
  return {
    post: (message) => api.postMessage(message),
    onMessage(listener) {
      const onMessage = (event: MessageEvent<ExtensionMessage>) => listener(event.data);
      window.addEventListener('message', onMessage);
      return () => window.removeEventListener('message', onMessage);
    },
    getState: () => api.getState(),
    setState: (state) => api.setState(state),
  };
}
