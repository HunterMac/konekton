import { API_PREFIX, MAX_BOARD_BYTES } from '../shared/api.ts';

export interface RequestInfo {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface GuardError {
  status: number;
  error: string;
}

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

function header(info: RequestInfo, name: string): string | undefined {
  const value = info.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Checks for the board endpoints, in order. `null` = allowed.
 * They do not rely on Vite's own CORS and Host checks: the board middleware may run before them.
 */
export function checkRequest(info: RequestInfo): GuardError | null {
  // 1. Only the board endpoints.
  if (!(info.url ?? '').startsWith(API_PREFIX)) return null;

  // 2. Host must be localhost: stops DNS rebinding, where a foreign page looks same-origin to the browser.
  const host = header(info, 'host');
  if (host === undefined || !LOCAL_HOST.test(host)) return { status: 403, error: 'Host not allowed' };

  // 3. Browsers say where the request comes from. Other localhost ports are `same-site`, so only `same-origin` passes.
  const site = header(info, 'sec-fetch-site');
  if (site !== undefined && site !== 'same-origin') return { status: 403, error: 'Cross-site request refused' };

  // 4. Origin, when present, must be this server.
  const origin = header(info, 'origin');
  if (origin !== undefined && origin !== `http://${host}`) return { status: 403, error: 'Origin not allowed' };

  // 5. Same-origin calls never preflight, so a preflight is always foreign. No CORS headers: the real request never follows.
  const method = (info.method ?? 'GET').toUpperCase();
  if (method === 'OPTIONS') return { status: 403, error: 'Preflight refused' };

  // 6. Methods.
  if (method !== 'GET' && method !== 'PUT') return { status: 405, error: 'Method not allowed' };

  if (method === 'PUT') {
    // 7. PUT and JSON both force a preflight for foreign pages.
    const type = header(info, 'content-type') ?? '';
    if (type.split(';')[0].trim().toLowerCase() !== 'application/json') return { status: 415, error: 'Content-Type must be application/json' };

    // 8. Size, when the client says it up front. The body reader counts the bytes too.
    const length = Number(header(info, 'content-length'));
    if (Number.isFinite(length) && length > MAX_BOARD_BYTES) return { status: 413, error: 'Body too large' };
  }
  return null;
}
