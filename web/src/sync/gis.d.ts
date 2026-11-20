// The part of Google Identity Services (https://accounts.google.com/gsi/client) the token client uses.

interface GisTokenResponse {
  access_token?: string;
  /** Seconds. */
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

interface GisTokenError {
  type: 'popup_failed_to_open' | 'popup_closed' | 'unknown' | string;
  message?: string;
}

interface GisTokenClientConfig {
  client_id: string;
  scope: string;
  callback: (response: GisTokenResponse) => void;
  error_callback?: (error: GisTokenError) => void;
  /** '' = ask only the first time; 'none' = never; 'consent'; 'select_account'. */
  prompt?: string;
  login_hint?: string;
}

interface GisTokenClient {
  requestAccessToken(overrideConfig?: { prompt?: string; login_hint?: string }): void;
}

interface GisOauth2 {
  initTokenClient(config: GisTokenClientConfig): GisTokenClient;
  revoke(token: string, done?: () => void): void;
}

interface Window {
  google?: { accounts: { oauth2: GisOauth2 } };
}
