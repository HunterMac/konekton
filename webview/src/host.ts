import type { ExtensionMessage, WebviewMessage } from '../../src/shared/protocol';
import type { Scale } from './layout/dates';
import type { Mode } from './plans';

/** What the board needs from the program around it: VS Code or the web app. */
export interface Host {
  post(message: WebviewMessage): void;
  /** Returns a function that removes the listener. */
  onMessage(listener: (message: ExtensionMessage) => void): () => void;
  /** View state: lives with the tab, never in the file. Synchronous, like the VS Code API. */
  getState(): unknown;
  setState(state: unknown): void;
}

/** What the host can do beyond the message protocol. */
export interface HostFeatures {
  /** File reference objects: preview, edit, open, pick, drop. */
  fileReferences: boolean;
}

export const ALL_FEATURES: HostFeatures = { fileReferences: true };

export interface SavedViewport {
  x: number;
  y: number;
  zoom: number;
}

/** Webview state: lives with the editor tab, never in the file. */
export interface ViewState {
  mode?: Mode;
  viewports?: Partial<Record<Mode, SavedViewport>>;
  timelineScale?: Scale;
  /** Old single viewport. Read as the Chaos viewport. */
  viewport?: SavedViewport;
}

const noHost: Host = { post: () => {}, onMessage: () => () => {}, getState: () => undefined, setState: () => {} };
let current: Host = noHost;

/** Set the host that view state is read from and written to. Called once by `bootstrap`. */
export function setHost(host: Host): void {
  current = host;
}

export function loadViewState(): ViewState {
  const state = current.getState();
  const saved = typeof state === 'object' && state !== null ? (state as ViewState) : {};
  const { viewport, ...rest } = saved;
  if (viewport && !rest.viewports?.chaos) return { ...rest, viewports: { ...rest.viewports, chaos: viewport } };
  return rest;
}

/** Merge `patch` into the saved state, so one writer does not wipe the keys of another. */
export function updateViewState(patch: ViewState): void {
  current.setState({ ...loadViewState(), ...patch });
}
