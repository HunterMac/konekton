// Local calendar math on `YYYY-MM-DD` strings. `new Date('YYYY-MM-DD')` parses as UTC and can shift
// the day, so dates are only ever built from their numeric parts.

export type Scale = 'days' | 'weeks' | 'months';
export const SCALES: readonly Scale[] = ['days', 'weeks', 'months'];

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function toDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function fromDate(d: Date): string {
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date today. */
export function today(): string {
  return fromDate(new Date());
}

export function addDays(date: string, n: number): string {
  const d = toDate(date);
  d.setDate(d.getDate() + n);
  return fromDate(d);
}

/** Whole days from `a` to `b`. Counts calendar days, so a DST change does not matter. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** Monday of the week that holds `date`. */
export function startOfWeek(date: string): string {
  const day = toDate(date).getDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

/** The 1st of the month that holds `date`. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

function monthNumber(date: string): number {
  const [y, m] = date.split('-').map(Number);
  return y * 12 + (m - 1);
}

function addMonths(date: string, n: number): string {
  const total = monthNumber(date) + n;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}-01`;
}

/** Start of the segment that holds `date`. */
export function segmentFloor(date: string, scale: Scale): string {
  return scale === 'days' ? date : scale === 'weeks' ? startOfWeek(date) : startOfMonth(date);
}

/** The first segment of the arrow: the one with today, minus 3 segments. */
export function originFor(todayDate: string, scale: Scale): string {
  return segmentStart(-3, segmentFloor(todayDate, scale), scale);
}

/** Index of the segment that holds `date`. Negative before `origin`. `origin` must be a segment start. */
export function segmentIndex(date: string, origin: string, scale: Scale): number {
  switch (scale) {
    case 'days':
      return daysBetween(origin, date);
    case 'weeks':
      return Math.floor(daysBetween(origin, date) / 7);
    case 'months':
      return monthNumber(date) - monthNumber(origin);
  }
}

/** First day of segment `index`. */
export function segmentStart(index: number, origin: string, scale: Scale): string {
  switch (scale) {
    case 'days':
      return addDays(origin, index);
    case 'weeks':
      return addDays(origin, index * 7);
    case 'months':
      return addMonths(origin, index);
  }
}

/** Built formatters, by language and options. Building one is slow, and labels are made per segment. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const language = typeof navigator === 'undefined' ? undefined : navigator.language;
  const key = `${language ?? ''}|${JSON.stringify(options)}`;
  let f = formatters.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(language, options);
    formatters.set(key, f);
  }
  return f;
}

function format(date: string, options: Intl.DateTimeFormatOptions): string {
  return formatter(options).format(toDate(date));
}

export function segmentLabel(index: number, origin: string, scale: Scale): string {
  const start = segmentStart(index, origin, scale);
  switch (scale) {
    case 'days':
      return format(start, { weekday: 'short', day: 'numeric', month: 'short' });
    case 'weeks':
      return formatter({ day: 'numeric', month: 'short' }).formatRange(toDate(start), toDate(addDays(start, 6)));
    case 'months':
      return format(start, { month: 'short', year: 'numeric' });
  }
}

/** Date for a card dropped on segment `index`: keep `current` when it is already inside, else the first day. */
export function dropDate(current: string | undefined, index: number, origin: string, scale: Scale): string {
  if (current !== undefined && segmentIndex(current, origin, scale) === index) return current;
  return segmentStart(index, origin, scale);
}

/** Label of a date for cards, for example `3 Nov`. */
export function shortDate(date: string): string {
  return format(date, { day: 'numeric', month: 'short' });
}
