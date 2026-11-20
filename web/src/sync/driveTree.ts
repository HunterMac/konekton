import { isBoardName } from '../../shared/boardNames';
import { isRefPath } from '../../shared/fileRules';

export const FOLDER_MIME = 'application/vnd.google-apps.folder';
export const ROOT_NAME = 'konekton';

/** The fields of a Drive file this app asks for. */
export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  /** Content version (`contentVersion` in driveApi), not Drive's own `version`. */
  version: string;
  modifiedTime: string;
  createdTime: string;
  size?: string;
}

export interface RemoteFile {
  id: string;
  version: string;
  modifiedTime: string;
}

export interface DriveTree {
  /** Folder path (`docs`, `docs/sub`) → folder id. */
  folders: Map<string, string>;
  /** File path → newest file with that path. */
  files: Map<string, RemoteFile>;
  /** Paths with more than one file; `files` keeps the newest. */
  duplicates: string[];
}

/** What a path is in the local copy; `undefined` for a path the app does not use. */
export function kindOfPath(path: string): 'board' | 'file' | undefined {
  if (isBoardName(path)) return 'board';
  return isRefPath(path) ? 'file' : undefined;
}

const byCreated = (a: DriveFile, b: DriveFile): number => (a.createdTime < b.createdTime ? -1 : a.createdTime > b.createdTime ? 1 : 0);

/**
 * The folder `konekton` in My Drive: the oldest one (new items go there). `all` lists every top-level `konekton`,
 * oldest first; `extra` is true when there is more than one. `undefined` when there is none.
 */
export function pickRoot(files: DriveFile[]): { id: string; all: string[]; extra: boolean } | undefined {
  // With `drive.file` the app cannot read My Drive itself (`files/root` is a 404), and `parents` holds My Drive's real id,
  // not the alias `root`. So the top folder is the one whose parent is not an item the app can see.
  const visible = new Set(files.map((f) => f.id));
  const roots = files.filter((f) => f.mimeType === FOLDER_MIME && f.name === ROOT_NAME && !(f.parents ?? []).some((p) => visible.has(p))).sort(byCreated);
  return roots.length === 0 ? undefined : { id: roots[0].id, all: roots.map((r) => r.id), extra: roots.length > 1 };
}

/**
 * Paths of the items below the root folders (several `konekton` folders read as one; the newest file of a path wins).
 * An item whose parent chain does not reach a root is left out (moved out of the folder counts as removed).
 */
export function buildTree(files: DriveFile[], rootIds: string[]): DriveTree {
  const byId = new Map(files.map((f) => [f.id, f]));
  const roots = new Set(rootIds);
  const folderPaths = new Map<string, string>(); // folder id → path
  for (const id of rootIds) folderPaths.set(id, '');

  const pathOfFolder = (id: string, seen: Set<string>): string | undefined => {
    const known = folderPaths.get(id);
    if (known !== undefined) return known;
    if (seen.has(id)) return undefined;
    seen.add(id);
    const f = byId.get(id);
    if (!f || f.mimeType !== FOLDER_MIME || f.name.includes('/')) return undefined;
    const parent = f.parents?.[0];
    if (parent === undefined) return undefined;
    const parentPath = pathOfFolder(parent, seen);
    if (parentPath === undefined) return undefined;
    const path = parentPath === '' ? f.name : `${parentPath}/${f.name}`;
    folderPaths.set(id, path);
    return path;
  };

  const folders = new Map<string, string>();
  const fileItems = new Map<string, DriveFile[]>();
  for (const f of [...files].sort(byCreated)) {
    if (roots.has(f.id)) continue;
    if (f.mimeType === FOLDER_MIME) {
      const path = pathOfFolder(f.id, new Set());
      // The oldest folder of a path wins.
      if (path !== undefined && !folders.has(path)) folders.set(path, f.id);
      continue;
    }
    if (f.mimeType.startsWith('application/vnd.google-apps.') || f.name.includes('/')) continue;
    const parent = f.parents?.[0];
    const parentPath = parent === undefined ? undefined : pathOfFolder(parent, new Set());
    if (parentPath === undefined) continue;
    const path = parentPath === '' ? f.name : `${parentPath}/${f.name}`;
    const list = fileItems.get(path) ?? [];
    list.push(f);
    fileItems.set(path, list);
  }

  const out = new Map<string, RemoteFile>();
  const duplicates: string[] = [];
  for (const [path, list] of fileItems) {
    if (list.length > 1) duplicates.push(path);
    const newest = list.reduce((a, b) => (b.modifiedTime > a.modifiedTime ? b : a));
    out.set(path, { id: newest.id, version: newest.version, modifiedTime: newest.modifiedTime });
  }
  return { folders, files: out, duplicates: duplicates.sort() };
}
