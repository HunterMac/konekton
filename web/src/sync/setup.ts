import { BrowserDialogs } from '../ports/browserDialogs';
import type { BoardStorage, FileStore } from '../ports/types';
import { AuthError, HttpDriveApi } from './driveApi';
import { GoogleAuth, type AuthState } from './googleAuth';
import { openIndexedDb } from './kv';
import { moveEntries } from './localMove';
import { createLocalFiles, createLocalStorage } from './localPorts';
import { broadcastChannel, LocalStore } from './localStore';
import { SyncCoordinator } from './syncCoordinator';
import { SyncEngine } from './syncEngine';

const SPACE_KEY = 'konekton.space';
const NOTE_KEY = 'konekton.note';
const LOCAL_SPACE = 'local';

export interface DriveMode {
  storage: BoardStorage;
  files: FileStore;
  sync: SyncCoordinator;
  auth: GoogleAuth;
  /** Sign in with Google (from a click). */
  signIn(): void;
  /** Forget the account in this browser (its local copies stay) and show the signed-out space. */
  signOut(): void;
}

const openStore = async (space: string, channel: boolean): Promise<LocalStore> =>
  new LocalStore(await openIndexedDb(`konekton-${space}`), channel ? { channel: broadcastChannel(`konekton-local:${space}`) } : {});

/**
 * The web version with Google Drive: a local copy in IndexedDB, and a sync engine in one tab per browser.
 * The local space is `local` while signed out and the Drive account key (`permissionId`) after sign-in.
 */
export async function startDriveMode(dialogs: BrowserDialogs, hooks: { savedAsCopy(original: string, copy: string): void }): Promise<DriveMode> {
  const auth = new GoogleAuth(import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '');
  const drive = new HttpDriveApi(auth);
  const reload = () => window.location.reload();

  const note = sessionStorage.getItem(NOTE_KEY);
  if (note) {
    sessionStorage.removeItem(NOTE_KEY);
    window.setTimeout(() => dialogs.notify(note), 0);
  }

  // Which space? Signed out: `local`. Otherwise the account of the last sign-in.
  let space = LOCAL_SPACE;
  if (auth.state().kind === 'signedOut') {
    localStorage.removeItem(SPACE_KEY);
  } else {
    let key = localStorage.getItem(SPACE_KEY);
    if (!key && auth.state().kind === 'signedIn') {
      try {
        const about = await drive.about();
        key = about.permissionId;
        localStorage.setItem(SPACE_KEY, key);
        if (about.emailAddress) auth.setEmail(about.emailAddress);
      } catch {
        key = null;
      }
    }
    if (key) space = key;
  }

  const store = await openStore(space, true);
  // The `local` space never syncs: it moves into the account's space at sign-in.
  const signedOutView = { state: (): AuthState => ({ kind: 'signedOut' }), onChange: () => () => undefined };
  const engine = new SyncEngine({
    store,
    drive,
    auth: space === LOCAL_SPACE ? signedOutView : auth,
    dialogs,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
    savedAsCopy: hooks.savedAsCopy,
  });
  const coordinator = new SyncCoordinator(engine, auth, broadcastChannel('konekton-sync'), {
    locks: typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined,
    onReload: reload,
  });

  /** After a sign-in (also a renewal): is this still the account of the open space? */
  let identifying = false;
  const identify = async () => {
    if (identifying) return;
    identifying = true;
    try {
      const about = await drive.about();
      if (about.emailAddress) auth.setEmail(about.emailAddress);
      if (about.permissionId === space) return;
      if (space === LOCAL_SPACE) {
        const account = await openStore(about.permissionId, false);
        const notes = await moveEntries(await openStore(LOCAL_SPACE, false), account);
        if (notes.length > 0) sessionStorage.setItem(NOTE_KEY, notes.join(' '));
      }
      localStorage.setItem(SPACE_KEY, about.permissionId);
      coordinator.reloadOthers();
      reload();
    } catch (err) {
      // A 401 already moved `auth` on. Offline: the next sign-in or reload tries again.
      // Anything else would leave the page signed in but unsynced without a word, so the badge shows it.
      if (!(err instanceof AuthError) && !(err instanceof TypeError)) auth.failed(`Signed in, but Drive refused: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      identifying = false;
    }
  };
  auth.onChange((s) => {
    if (s.kind === 'signedIn') void identify();
  });
  if (auth.state().kind === 'signedIn') void identify();

  coordinator.start();
  window.addEventListener('online', () => coordinator.onOnline());

  return {
    storage: createLocalStorage(store),
    files: createLocalFiles(store),
    sync: coordinator,
    auth,
    signIn() {
      if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) {
        void dialogs.alert('Google sign-in is not set up: VITE_GOOGLE_CLIENT_ID is missing in this build.');
        return;
      }
      auth.signIn();
    },
    signOut() {
      auth.signOut();
      localStorage.removeItem(SPACE_KEY);
      coordinator.reloadOthers();
      reload();
    },
  };
}
