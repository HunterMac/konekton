// Rules for the text files the boards reference in the web version. The dev server loads this, so it must not
// import from `src/` (Vite's config loader treats those files as CommonJS). `test/unit/refFiles.test.ts` checks
// that the copies below stay equal to `src/shared`.

/** Same as `TEXT_FILE_EXTENSIONS` in src/shared/canvasFormat.ts. */
export const REF_FILE_EXTENSIONS = ['.md', '.txt', '.json'] as const;
/** Same as `MAX_PREVIEW_BYTES` in src/shared/protocol.ts. */
export const MAX_REF_FILE_BYTES = 1024 * 1024;

const MAX_PATH = 512;

/**
 * A file a board may reference in the web version: a relative `/` path inside the boards folder, to a
 * `.md`, `.txt` or `.json` file. No `..`, no absolute paths, no backslashes, no hidden folders or files.
 */
export function isRefPath(path: string): boolean {
  if (path.length === 0 || path.length > MAX_PATH) return false;
  if (path.includes('\\') || path.startsWith('/') || /[\u0000-\u001f]/.test(path)) return false;
  const parts = path.split('/');
  if (parts.some((p) => p === '' || p.startsWith('.'))) return false;
  const lower = path.toLowerCase();
  return REF_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** Same as `todoFileName` in src/shared/todoFormat.ts. */
export function todoFileName(input: string): { name: string } | { error: string } {
  const base = input.trim().replace(/\.todo\.md$/i, '');
  if (base === '') return { error: 'Enter a name.' };
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(base) || base.startsWith('.')) return { error: 'Use a name without / \\ : * ? " < > | and not starting with a dot.' };
  if (base.length > 120) return { error: 'The name is too long.' };
  return { name: `${base}.todo.md` };
}
