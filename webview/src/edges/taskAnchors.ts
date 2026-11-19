import { useSyncExternalStore } from 'react';

/**
 * Where the row of a task is on its todo file object, for lines that start at a task (`BoardEdge.fromTask`).
 * The value is a fraction of the object's height, so it does not depend on the zoom. The todo list publishes it
 * after every render; a line without a value (task folded away, zoomed far out) uses the offset saved in the file.
 */
const anchors = new Map<string, number>();
const listeners = new Set<() => void>();
const keyOf = (nodeId: string, taskId: string) => `${nodeId}\n${taskId}`;

/** Replace what is known about the tasks of one object. */
export function setTaskAnchors(nodeId: string, next: ReadonlyMap<string, number>): void {
  let changed = false;
  const prefix = `${nodeId}\n`;
  for (const key of [...anchors.keys()]) {
    if (key.startsWith(prefix) && !next.has(key.slice(prefix.length))) {
      anchors.delete(key);
      changed = true;
    }
  }
  for (const [taskId, y] of next) {
    const key = keyOf(nodeId, taskId);
    if (anchors.get(key) !== y) {
      anchors.set(key, y);
      changed = true;
    }
  }
  if (changed) for (const l of listeners) l();
}

export function useTaskAnchor(nodeId: string, taskId: string | undefined): number | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => (taskId === undefined ? undefined : anchors.get(keyOf(nodeId, taskId))),
  );
}
