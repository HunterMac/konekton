import { BrowserDialogs } from '../ports/browserDialogs';
import type { BoardStorage, FileStore } from '../ports/types';
import { AccountGate } from './accountGate';
import { AuthError, HttpDriveApi } from './driveApi';
import { GoogleAuth, type AuthState } from './googleAuth';
import { openIndexedDb } from './kv';
import { moveEntries } from './localMove';
import { SharedDialogs } from './sharedDialogs';
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
  // A variable pasted with a line break gives "Error 401: invalid_client".
  const clientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '').trim();
  const auth = new GoogleAuth(clientId);
  const reload = () => window.location.reload();
  /** `about` with exactly this token: the current token may change while the call runs. */
  const aboutWith = (token: string) =>
    new HttpDriveApi({
      token: () => token,
      rejected: () => {
        const s = auth.state();
        if (s.kind === 'signedIn' && s.token === token) auth.rejected();
      },
    }).about();

  // Which space? Signed out: `local`. Otherwise the account of the last sign-in.
  let space = LOCAL_SPACE;
  /** The token whose account picked the space below. */
  let checkedToken: string | undefined;
  if (auth.state().kind === 'signedOut') {
    localStorage.removeItem(SPACE_KEY);
  } else {
    let key = localStorage.getItem(SPACE_KEY);
    const s = auth.state();
    if (!key && s.kind === 'signedIn') {
      // Signed in on Google's page: the page loads signed in, so the signed-out files move here.
      try {
        const about = await aboutWith(s.token);
        key = about.permissionId;
        checkedToken = s.token;
        const notes = await moveEntries(await openStore(LOCAL_SPACE, false), await openStore(key, false));
        if (notes.length > 0) sessionStorage.setItem(NOTE_KEY, notes.join(' '));
        localStorage.setItem(SPACE_KEY, key);
        if (about.emailAddress) auth.setEmail(about.emailAddress);
      } catch {
        key = null;
        checkedToken = undefined;
      }
    }
    if (key) space = key;
  }

  const note = sessionStorage.getItem(NOTE_KEY);
  if (note) {
    sessionStorage.removeItem(NOTE_KEY);
    window.setTimeout(() => dialogs.notify(note), 0);
  }

  const store = await openStore(space, true);
  // The `local` space never syncs: it moves into the account's space at sign-in.
  const signedOutView = { state: (): AuthState => ({ kind: 'signedOut' }), onChange: () => () => undefined };
  // The engine reads and writes Drive only with a token Drive confirmed for this space's account.
  const gate = new AccountGate(auth);
  if (checkedToken !== undefined) gate.confirm(checkedToken);
  // The engine runs in one tab; its questions show in every tab of the space.
  const shared = new SharedDialogs(dialogs, broadcastChannel(`konekton-questions:${space}`), { savedAsCopy: hooks.savedAsCopy });
  const engine = new SyncEngine({
    store,
    drive: new HttpDriveApi(gate),
    auth: space === LOCAL_SPACE ? signedOutView : gate,
    dialogs: shared,
    now: () => Date.now(),
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => window.clearTimeout(h as number),
    savedAsCopy: (original, copy) => shared.savedAsCopy(original, copy),
  });
  const forgetAccount = () => {
    auth.signOut();
    localStorage.removeItem(SPACE_KEY);
  };
  const coordinator = new SyncCoordinator(engine, broadcastChannel('konekton-sync'), space, {
    locks: typeof navigator !== 'undefined' && 'locks' in navigator ? navigator.locks : undefined,
    onReload: reload,
    onSignOut() {
      forgetAccount();
      reload();
    },
    onLeader: () => shared.becameLeader(),
    onToken(token, expiresAt, account) {
      if (space === LOCAL_SPACE || account !== space) return;
      gate.confirm(token);
      auth.adoptToken(token, expiresAt);
    },
  });

  /**
   * After a sign-in (also a renewal): whose token is it? The account of the open space: the engine may use it.
   * Signed out until now: the signed-out files move to the account. Another account: refused; the open space never
   * switches by itself (two tabs with tokens of two accounts would reload each other forever).
   */
  let identifying = false;
  const identify = async () => {
    if (identifying) return;
    identifying = true;
    try {
      // Again while a newer token came during the check.
      for (;;) {
        const s = auth.state();
        if (s.kind !== 'signedIn' || gate.isConfirmed(s.token)) return;
        const about = await aboutWith(s.token);
        if (about.permissionId === space) {
          if (about.emailAddress) auth.setEmail(about.emailAddress);
          gate.confirm(s.token);
          coordinator.shareToken(s.token, s.expiresAt, space);
          continue;
        }
        if (space !== LOCAL_SPACE) {
          auth.failed(`Signed in as ${about.emailAddress ?? 'another Google account'}, but the open files belong to another account. Sign out first to switch accounts.`);
          return;
        }
        if (about.emailAddress) auth.setEmail(about.emailAddress);
        const account = await openStore(about.permissionId, false);
        const notes = await moveEntries(await openStore(LOCAL_SPACE, false), account);
        if (notes.length > 0) sessionStorage.setItem(NOTE_KEY, notes.join(' '));
        localStorage.setItem(SPACE_KEY, about.permissionId);
        coordinator.reloadOthers();
        reload();
        return;
      }
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

  shared.start();
  coordinator.start();
  window.addEventListener('online', () => coordinator.onOnline());

  return {
    storage: createLocalStorage(store),
    files: createLocalFiles(store),
    sync: coordinator,
    auth,
    signIn() {
      if (!clientId) {
        void dialogs.alert('Google sign-in is not set up: VITE_GOOGLE_CLIENT_ID is missing in this build.');
        return;
      }
      auth.signIn();
    },
    signOut() {
      forgetAccount();
      coordinator.signOutOthers();
      reload();
    },
  };
}
