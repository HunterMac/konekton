/** Name of the n-th web copy of a text file: `docs/a.md`, 1 → `docs/a_web.md`; 2 → `docs/a_web-2.md`; `x.todo.md` → `x_web.todo.md`. */
export function fileCopyName(path: string, n: number): string {
  const slash = path.lastIndexOf('/');
  const dir = path.slice(0, slash + 1);
  const file = path.slice(slash + 1);
  const todo = /\.todo\.md$/i.exec(file);
  const dot = file.lastIndexOf('.');
  const split = todo ? todo.index : dot > 0 ? dot : file.length;
  const base = file.slice(0, split);
  const ext = file.slice(split);
  return `${dir}${base}_web${n <= 1 ? '' : `-${n}`}${ext}`;
}
