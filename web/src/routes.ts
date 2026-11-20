/** Address of the start page. `/` in dev, `/konekton/` on GitHub Pages. */
export const homeHref = (): string => import.meta.env.BASE_URL;

/** Address of a board page. */
export function boardHref(name: string): string {
  return `${homeHref()}?board=${encodeURIComponent(name)}`;
}

/** Address of the text page of a board ("Open as text"). */
export function rawBoardHref(name: string): string {
  return `${homeHref()}?board=${encodeURIComponent(name)}&view=raw`;
}

/** Address of the full todo editor for a todo file. `from`: the board whose card opens it. */
export function todoHref(path: string, from?: string): string {
  return `${homeHref()}?todo=${encodeURIComponent(path)}${from !== undefined ? `&from=${encodeURIComponent(from)}` : ''}`;
}

/** Address of the text page of a file in the boards folder. */
export function fileHref(path: string): string {
  return `${homeHref()}?file=${encodeURIComponent(path)}`;
}

/** Start page with the note that a board is gone. */
export function goneHref(name: string): string {
  return `${homeHref()}?gone=${encodeURIComponent(name)}`;
}
