import type { GoogleAuth } from './googleAuth';
import type { DriveFile } from './driveTree';

/** The token was refused or is missing; `GoogleAuth` has moved on to ask the person. */
export class AuthError extends Error {
  constructor(message = 'Not signed in to Google.') {
    super(message);
    this.name = 'AuthError';
  }
}

/** Rate limit or a server problem: try again later. */
export class RetryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryError';
  }
}

/** The file does not exist (any more). */
export class GoneError extends Error {
  constructor(message = 'The file is gone from Drive.') {
    super(message);
    this.name = 'GoneError';
  }
}

export interface WriteResult {
  id: string;
  version: string;
  modifiedTime: string;
}

/** The Drive calls the sync engine needs. */
export interface DriveApi {
  about(): Promise<{ permissionId: string; emailAddress?: string }>;
  /** Every item of the app (with `drive.file`: only what this app made), not trashed. */
  listAll(): Promise<DriveFile[]>;
  createFolder(name: string, parentId: string): Promise<{ id: string }>;
  download(id: string): Promise<string>;
  /** The current `version` of a file; `GoneError` when it is gone or in the trash. */
  version(id: string): Promise<string>;
  create(name: string, parentId: string, text: string, mime: string): Promise<WriteResult>;
  update(id: string, text: string, mime: string): Promise<WriteResult>;
}

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const WRITE_FIELDS = 'id,version,modifiedTime';

/** MIME type of a file for upload. Drive never converts: these are plain files. */
export function mimeOf(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.canvas') || lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.md')) return 'text/markdown';
  return 'text/plain';
}

/** Drive API v3 with `fetch` and the token of `GoogleAuth`. */
export class HttpDriveApi implements DriveApi {
  constructor(
    private readonly auth: Pick<GoogleAuth, 'token' | 'rejected'>,
    private readonly fetchFn: typeof fetch = (...args) => fetch(...args),
  ) {}

  private async call(url: string, init: RequestInit = {}): Promise<Response> {
    const token = this.auth.token();
    if (token === undefined) throw new AuthError();
    const res = await this.fetchFn(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` } });
    if (res.ok) return res;
    if (res.status === 401) {
      this.auth.rejected();
      throw new AuthError();
    }
    let reason = '';
    let message = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[] } };
      reason = body.error?.errors?.[0]?.reason ?? '';
      if (body.error?.message) message = `${body.error.message} (HTTP ${res.status})`;
    } catch {
      // Not JSON.
    }
    if (res.status === 404) throw new GoneError();
    if (res.status === 429 || res.status >= 500 || (res.status === 403 && /ratelimit/i.test(reason))) throw new RetryError(`Drive: ${message}`);
    throw new Error(`Drive: ${message}`);
  }

  async about() {
    const res = await this.call(`${API}/about?fields=${encodeURIComponent('user(permissionId,emailAddress)')}`);
    const user = ((await res.json()) as { user?: { permissionId?: string; emailAddress?: string } }).user;
    if (!user?.permissionId) throw new Error('Drive did not say which account this is.');
    return { permissionId: user.permissionId, emailAddress: user.emailAddress };
  }

  async listAll(): Promise<DriveFile[]> {
    const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType,parents,version,modifiedTime,createdTime,size)');
    const q = encodeURIComponent('trashed=false');
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const res = await this.call(`${API}/files?q=${q}&spaces=drive&pageSize=1000&fields=${fields}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`);
      const body = (await res.json()) as { nextPageToken?: string; files?: DriveFile[] };
      out.push(...(body.files ?? []));
      pageToken = body.nextPageToken;
    } while (pageToken);
    return out;
  }

  async createFolder(name: string, parentId: string): Promise<{ id: string }> {
    const res = await this.call(`${API}/files?fields=id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
    });
    return (await res.json()) as { id: string };
  }

  async download(id: string): Promise<string> {
    const res = await this.call(`${API}/files/${encodeURIComponent(id)}?alt=media`);
    return res.text();
  }

  async version(id: string): Promise<string> {
    const res = await this.call(`${API}/files/${encodeURIComponent(id)}?fields=${encodeURIComponent('version,trashed')}`);
    const file = (await res.json()) as { version?: string; trashed?: boolean };
    if (file.trashed) throw new GoneError();
    if (typeof file.version !== 'string') throw new Error('Drive did not give the version of the file.');
    return file.version;
  }

  async create(name: string, parentId: string, text: string, mime: string): Promise<WriteResult> {
    const boundary = `konekton-${Math.random().toString(36).slice(2)}`;
    const metadata = JSON.stringify({ name, parents: [parentId], mimeType: mime });
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${mime}; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    const res = await this.call(`${UPLOAD}/files?uploadType=multipart&fields=${WRITE_FIELDS}`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
    return (await res.json()) as WriteResult;
  }

  async update(id: string, text: string, mime: string): Promise<WriteResult> {
    const res = await this.call(`${UPLOAD}/files/${encodeURIComponent(id)}?uploadType=media&fields=${WRITE_FIELDS}`, {
      method: 'PATCH',
      headers: { 'Content-Type': `${mime}; charset=UTF-8` },
      body: text,
    });
    return (await res.json()) as WriteResult;
  }
}
