/** Address of a board page. */
export function boardHref(name: string): string {
  return `/?board=${encodeURIComponent(name)}`;
}

/** Address of the full todo editor for a todo file. `from`: the board whose card opens it. */
export function todoHref(path: string, from?: string): string {
  return `/?todo=${encodeURIComponent(path)}${from !== undefined ? `&from=${encodeURIComponent(from)}` : ''}`;
}

/** Address of the text page of a file in the boards folder. */
export function fileHref(path: string): string {
  return `/?file=${encodeURIComponent(path)}`;
}
