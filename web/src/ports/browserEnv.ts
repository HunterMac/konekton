import { isHttpUrl } from '../../../src/shared/protocol';
import { fileHref, rawBoardHref, todoHref } from '../routes';
import type { Env } from './types';

/** Clipboard and new tabs. The clipboard needs a secure context: `http://localhost` is one, a LAN address is not. */
export function createBrowserEnv(): Env {
  return {
    async clipboardRead() {
      try {
        return await navigator.clipboard.readText();
      } catch {
        return '';
      }
    },
    async clipboardWrite(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Refused: nothing to do.
      }
    },
    openExternal(url) {
      if (isHttpUrl(url)) window.open(url, '_blank', 'noopener,noreferrer');
    },
    openRaw(name) {
      window.open(rawBoardHref(name), '_blank', 'noopener');
    },
    openFile(path) {
      window.open(fileHref(path), '_blank', 'noopener');
    },
    openTodo(path, from) {
      window.open(todoHref(path, from), '_blank');
    },
  };
}
