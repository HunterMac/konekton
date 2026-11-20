/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID of the Google Cloud project (public by design). */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** `drive`: local copy plus Google Drive sync. `devserver`: the dev server's boards folder. Default: `devserver` in dev, `drive` in a build. */
  readonly VITE_KONEKTON_STORAGE?: 'drive' | 'devserver';
}
