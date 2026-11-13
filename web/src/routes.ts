/** Address of a board page. */
export function boardHref(name: string): string {
  return `/?board=${encodeURIComponent(name)}`;
}
