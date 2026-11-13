import { isHttpUrl } from '../../../src/shared/protocol';
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
      window.open(`/?board=${encodeURIComponent(name)}&view=raw`, '_blank', 'noopener');
    },
  };
}
