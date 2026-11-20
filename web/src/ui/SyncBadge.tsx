import { useEffect, useState } from 'react';
import type { GoogleAuth } from '../sync/googleAuth';
import type { SyncControl, SyncStatus } from '../sync/syncEngine';

interface Props {
  sync: SyncControl;
  auth: GoogleAuth;
  onSignIn(): void;
  onSignOut(): void;
}

interface View {
  text: string;
  action?: { label: string; run(): void };
}

function viewOf(status: SyncStatus, props: Props): View {
  const reconnect = { label: 'Reconnect', run: props.onSignIn };
  const auth = props.auth.state();
  // A refused or closed sign-in window shows even before the account space is open.
  if (auth.kind === 'needsReconnect') return { text: `Not synced · ${auth.reason}`, action: reconnect };
  if (status.kind === 'synced') return { text: 'Synced' };
  switch (status.detail) {
    case 'signedOut':
      return { text: 'Not synced · Signed out', action: { label: 'Sign in with Google', run: props.onSignIn } };
    case 'waiting':
      return { text: 'Not synced', action: { label: 'Sync now', run: () => props.sync.syncNow() } };
    case 'syncing':
      return { text: 'Not synced · Syncing…' };
    case 'needsGesture':
      return { text: 'Not synced · Click or type to reconnect' };
    case 'needsReconnect':
      return { text: `Not synced · ${status.message ?? 'Reconnect to Google'}`, action: reconnect };
    case 'asking':
      return { text: 'Not synced · Question open' };
    case 'error':
      return { text: `Not synced · ${status.message ?? 'Error'}`, action: { label: 'Retry', run: () => props.sync.syncNow() } };
  }
}

/** Top right: whether the files are on Drive, and what to do when they are not. */
export function SyncBadge(props: Props) {
  const { sync, auth } = props;
  const [status, setStatus] = useState<SyncStatus>(() => sync.status());
  // Re-render when the sign-in changes (a closed sign-in window does not change the sync status).
  const [, setAuthTick] = useState(0);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    setStatus(sync.status());
    const offStatus = sync.onStatus(setStatus);
    const offAuth = auth.onChange(() => setAuthTick((n) => n + 1));
    return () => {
      offStatus();
      offAuth();
    };
  }, [sync, auth]);

  const view = viewOf(status, props);
  const synced = status.kind === 'synced';
  const email = (() => {
    const s = props.auth.state();
    return s.kind === 'signedIn' ? s.email : undefined;
  })();

  return (
    <div className={`kw-sync ${synced ? 'kw-sync-ok' : 'kw-sync-pending'}`}>
      <span role="status" className="kw-sync-text">
        {view.text}
      </span>
      {view.action && (
        <button type="button" onClick={view.action.run}>
          {view.action.label}
        </button>
      )}
      {synced && (
        <button type="button" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          Account
        </button>
      )}
      {menu && (
        <div className="kw-sync-menu">
          {email && <div>{email}</div>}
          <button
            type="button"
            onClick={() => {
              setMenu(false);
              props.onSignOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
