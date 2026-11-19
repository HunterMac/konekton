/** Smallest and largest text size of the full todo editor, in px. */
export const MIN_FONT_SIZE = 13;
export const MAX_FONT_SIZE = 20;
/** One px of text for each this many px of width: a 1280 px wide editor gets 16 px. */
const WIDTH_PER_PX = 80;

/** The text size of the full todo editor for an editor `width` px wide. Fixed: it follows the width, not a zoom. */
export function todoFontSize(width: number): number {
  return Math.round(Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, width / WIDTH_PER_PX)));
}
