import { boardNodes, parse } from './canvasFormat';
import { normalizePath, resolveRelative } from './paths';

/**
 * Ids of the file reference cards in a canvas that point at `targetPath`.
 * `canvasDir` and `targetPath` are absolute POSIX paths (`Uri.path`); card paths are relative to `canvasDir`.
 * An unreadable canvas has no cards.
 */
export function fileNodeIds(canvasText: string, canvasDir: string, targetPath: string): string[] {
  const r = parse(canvasText);
  if (!r.ok) return [];
  const target = normalizePath(targetPath);
  const ids: string[] = [];
  for (const n of boardNodes(r.doc)) {
    if (n.kind === 'file' && n.file !== '' && resolveRelative(canvasDir, n.file) === target) ids.push(n.id);
  }
  return ids;
}
