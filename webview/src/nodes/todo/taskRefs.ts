import { getValue, taskById, taskFullText, type TodoDoc } from '../../../../src/shared/todoFormat';

/** A task, found again after edits by its id, else by its text near its old line. */
export interface TaskRef {
  line: number;
  id?: string;
  text: string;
}

export function refAt(doc: TodoDoc, index: number): TaskRef {
  const t = doc.tasks[index];
  const id = getValue(t, 'id');
  // Title and meta together: they stay the same when the meta moves from the line into the comment.
  return { line: t.line, text: taskFullText(t), ...(id !== undefined ? { id } : {}) };
}

/** Index of the task `ref` points to in `doc`, or -1. */
export function resolve(doc: TodoDoc, ref: TaskRef | null): number {
  if (!ref) return -1;
  if (ref.id !== undefined) {
    const i = taskById(doc, ref.id);
    if (i >= 0) return i;
  }
  return doc.tasks.findIndex((t) => t.line === ref.line);
}

/** Find the task of `ref` (made for `from`) in the changed `to`. */
export function remap(from: TodoDoc, to: TodoDoc, ref: TaskRef | null): TaskRef | null {
  if (!ref) return null;
  const old = resolve(from, ref);
  if (old < 0) return null;
  const id = getValue(from.tasks[old], 'id');
  if (id !== undefined) {
    const i = taskById(to, id);
    if (i >= 0) return refAt(to, i);
  }
  const text = taskFullText(from.tasks[old]);
  let best = -1;
  to.tasks.forEach((t, i) => {
    if (taskFullText(t) === text && (best < 0 || Math.abs(t.line - ref.line) < Math.abs(to.tasks[best].line - ref.line))) best = i;
  });
  if (best >= 0) return refAt(to, best);
  // The text itself changed (an edit of this task): same position.
  if (to.tasks.length === from.tasks.length) return refAt(to, old);
  return null;
}
