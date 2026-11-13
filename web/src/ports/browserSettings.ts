import type { Settings } from './types';

const GRID_KEY = 'konekton.grid.enabled';

/** Grid on/off for all boards, in `localStorage`. Other tabs follow through the `storage` event. */
export function createBrowserSettings(storage: Storage = window.localStorage): Settings {
  return {
    gridEnabled: () => storage.getItem(GRID_KEY) === 'true',
    setGridEnabled(enabled) {
      try {
        storage.setItem(GRID_KEY, String(enabled));
      } catch {
        // Storage full or blocked: the setting lasts for this page only.
      }
    },
    onChange(listener) {
      const onStorage = (e: StorageEvent) => {
        if (e.key === GRID_KEY) listener(e.newValue === 'true');
      };
      window.addEventListener('storage', onStorage);
      return () => window.removeEventListener('storage', onStorage);
    },
  };
}
