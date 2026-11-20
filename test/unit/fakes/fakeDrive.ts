// An in-memory Drive for the sync tests: folders and files with ids, versions and times; counts calls; can fail.

import { AuthError, GoneError, RetryError, type DriveApi, type WriteResult } from '../../../web/src/sync/driveApi';
import { FOLDER_MIME, type DriveFile } from '../../../web/src/sync/driveTree';

interface Item extends DriveFile {
  text?: string;
  trashed?: boolean;
}

/** Like the real Drive: `parents` of a top-level item holds this id, never the alias `root`. */
export const MY_DRIVE_ID = 'MYDRIVE';

/** `version` here is what `HttpDriveApi` gives the engine: the head revision, which changes only with the content. */
const nextRevision = (v: string): string => `rev${Number(v.replace(/^rev/, '')) + 1}`;

type Op = 'about' | 'listAll' | 'createFolder' | 'download' | 'version' | 'create' | 'update';

export class FakeDrive implements DriveApi {
  private items = new Map<string, Item>();
  private n = 0;
  private clock = 0;
  /** Every call, in order: `create docs/a.md`, `update <path>`, `download <path>`, ... */
  readonly log: string[] = [];
  /** Failures for the next calls of an operation, used up in order. */
  readonly failures: Partial<Record<Op, Error[]>> = {};
  /** Runs inside create/update before the answer, e.g. to edit the page while the upload is in flight. */
  hook: (() => Promise<void>) | undefined;
  rootId: string | undefined;

  count(prefix: string): number {
    return this.log.filter((l) => l.startsWith(prefix)).length;
  }

  failNext(op: Op, ...errors: Error[]): void {
    this.failures[op] = [...(this.failures[op] ?? []), ...errors];
  }

  private maybeFail(op: Op): void {
    const err = this.failures[op]?.shift();
    if (err) throw err;
  }

  private time(): string {
    return new Date(Date.UTC(2026, 0, 1, 0, 0, ++this.clock)).toISOString();
  }

  private add(name: string, mimeType: string, parent: string, text?: string): Item {
    const id = `id${++this.n}`;
    const t = this.time();
    const item: Item = { id, name, mimeType, parents: [parent], version: 'rev1', modifiedTime: t, createdTime: t, text };
    this.items.set(id, item);
    return item;
  }

  /** The folder `konekton` in My Drive. */
  makeRoot(): string {
    this.rootId = this.add('konekton', FOLDER_MIME, MY_DRIVE_ID).id;
    return this.rootId;
  }

  private folder(path: string): string {
    let parent = this.rootId ?? this.makeRoot();
    if (path === '') return parent;
    for (const part of path.split('/')) {
      const found = [...this.items.values()].find((i) => i.name === part && i.parents?.[0] === parent && i.mimeType === FOLDER_MIME && !i.trashed);
      parent = found ? found.id : this.add(part, FOLDER_MIME, parent).id;
    }
    return parent;
  }

  /** A file made outside the app (another device). */
  putFile(path: string, text: string): string {
    const slash = path.lastIndexOf('/');
    return this.add(path.slice(slash + 1), 'text/plain', this.folder(slash < 0 ? '' : path.slice(0, slash)), text).id;
  }

  find(path: string): Item | undefined {
    const slash = path.lastIndexOf('/');
    const parent = this.rootId === undefined ? undefined : this.folder(slash < 0 ? '' : path.slice(0, slash));
    return [...this.items.values()].filter((i) => i.name === path.slice(slash + 1) && i.parents?.[0] === parent && !i.trashed).at(-1);
  }

  textOf(path: string): string | undefined {
    return this.find(path)?.text;
  }

  /** An outside edit. */
  editFile(path: string, text: string): void {
    const item = this.find(path);
    if (!item) throw new Error(`no ${path}`);
    item.text = text;
    item.version = nextRevision(item.version);
    item.modifiedTime = this.time();
  }

  deleteFile(path: string): void {
    const item = this.find(path);
    if (item) item.trashed = true;
  }

  /** Moved out of `konekton` into My Drive. */
  moveOut(path: string): void {
    const item = this.find(path);
    if (item) item.parents = [MY_DRIVE_ID];
  }

  private nameOf(id: string): string {
    const parts: string[] = [];
    for (let item = this.items.get(id); item && item.id !== this.rootId; item = this.items.get(item.parents?.[0] ?? '')) parts.unshift(item.name);
    return parts.join('/');
  }

  async about() {
    this.log.push('about');
    this.maybeFail('about');
    return { permissionId: 'acct1', emailAddress: 'me@example.com' };
  }

  async listAll(): Promise<DriveFile[]> {
    this.log.push('listAll');
    this.maybeFail('listAll');
    return [...this.items.values()].filter((i) => !i.trashed).map(({ text: _text, trashed: _trashed, ...file }) => ({ ...file }));
  }

  async createFolder(name: string, parentId: string) {
    this.log.push(`createFolder ${name}`);
    this.maybeFail('createFolder');
    this.needParent(parentId);
    const parent = parentId === 'root' ? MY_DRIVE_ID : parentId; // the alias works in requests
    const item = this.add(name, FOLDER_MIME, parent);
    if (name === 'konekton' && parent === MY_DRIVE_ID) this.rootId = item.id;
    return { id: item.id };
  }

  async download(id: string): Promise<string> {
    this.log.push(`download ${this.nameOf(id)}`);
    this.maybeFail('download');
    const item = this.items.get(id);
    if (!item || item.trashed) throw new GoneError();
    return item.text ?? '';
  }

  async version(id: string): Promise<string> {
    this.log.push(`version ${this.nameOf(id)}`);
    this.maybeFail('version');
    const item = this.items.get(id);
    if (!item || item.trashed) throw new GoneError();
    return item.version;
  }

  /** The folder `konekton` and everything in it deleted for good (Drive answers 404 for it). */
  destroyAll(): void {
    this.items.clear();
    this.rootId = undefined;
  }

  private needParent(parentId: string): void {
    if (parentId === 'root' || parentId === MY_DRIVE_ID) return;
    const parent = this.items.get(parentId);
    if (!parent || parent.trashed) throw new GoneError();
  }

  async create(name: string, parentId: string, text: string, _mime: string): Promise<WriteResult> {
    this.needParent(parentId);
    const item = this.add(name, 'text/plain', parentId, text);
    this.log.push(`create ${this.nameOf(item.id)}`);
    this.maybeFail('create');
    await this.hook?.();
    return { id: item.id, version: item.version, modifiedTime: item.modifiedTime };
  }

  async update(id: string, text: string, _mime: string): Promise<WriteResult> {
    this.log.push(`update ${this.nameOf(id)}`);
    this.maybeFail('update');
    const item = this.items.get(id);
    if (!item || item.trashed) throw new GoneError();
    item.text = text;
    item.version = nextRevision(item.version);
    item.modifiedTime = this.time();
    await this.hook?.();
    return { id, version: item.version, modifiedTime: item.modifiedTime };
  }
}

export { AuthError, RetryError };
