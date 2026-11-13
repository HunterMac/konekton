// Board names are plain file names in the boards folder. Used by the server (security) and the page (messages).

export const BOARD_EXT = '.canvas';
const MAX_NAME_LENGTH = 200;
/** Control characters, path separators, and characters Windows does not allow in file names. */
const BAD_CHARS = /[\u0000-\u001f\u007f/\\:*?"<>|]/;

/** True for one plain `.canvas` file name: no folders, no hidden files, no `..`. */
export function isBoardName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length <= MAX_NAME_LENGTH &&
    name.endsWith(BOARD_EXT) &&
    name !== BOARD_EXT &&
    !name.startsWith('.') &&
    !name.includes('..') &&
    !BAD_CHARS.test(name)
  );
}

/** Turn what a person typed into a board name: trims and adds `.canvas`. `undefined` when it is not a valid name. */
export function toBoardName(input: string): string | undefined {
  const trimmed = input.trim();
  const name = trimmed.endsWith(BOARD_EXT) ? trimmed : trimmed + BOARD_EXT;
  return isBoardName(name) ? name : undefined;
}

/** Name of the n-th web copy: `sample.canvas`, 1 → `sample_web.canvas`; 2 → `sample_web-2.canvas`. */
export function webCopyName(name: string, n: number): string {
  const base = name.endsWith(BOARD_EXT) ? name.slice(0, -BOARD_EXT.length) : name;
  return n <= 1 ? `${base}_web${BOARD_EXT}` : `${base}_web-${n}${BOARD_EXT}`;
}
