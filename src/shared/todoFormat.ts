// Todo lists in `*.todo.md` files (goals/todo/TODO-FORMAT.md, section 5.1).
//
//   - [ ] Title <!--
//     due: 2026-11-14
//     estimate: 2h
//     tags: home, work
//     people: Anna
//     id: k3f9
//     priority: high
//     -->
//     - [x] Subtask <!-- id:p0a2 done:2026-11-12 -->
//
// The task line holds the title only; all meta is in the comment. Older files with `#tag @person !date ~2h`
// on the line are still read, and change to this form when the task changes.
//
// Pure functions on text: every edit returns the new file text and rewrites only the lines of the
// tasks it changes. Must not import `vscode` or DOM APIs.

export const TODO_FILE_SUFFIX = '.todo.md';

/**
 * File name for a new todo list from what the user typed: `home` and `home.todo.md` give `home.todo.md`.
 * Returns an error text for an empty name, a path, or a name starting with a dot.
 */
export function todoFileName(input: string): { name: string } | { error: string } {
  const base = input.trim().replace(/\.todo\.md$/i, '');
  if (base === '') return { error: 'Enter a name.' };
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(base) || base.startsWith('.')) return { error: 'Use a name without / \\ : * ? " < > | and not starting with a dot.' };
  if (base.length > 120) return { error: 'The name is too long.' };
  return { name: `${base}${TODO_FILE_SUFFIX}` };
}

/** `*.todo.md`, and a plain `TODO.md` in any folder. */
export function isTodoPath(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.slice(lower.lastIndexOf('/') + 1);
  return base.endsWith(TODO_FILE_SUFFIX) || base === 'todo.md';
}

/**
 * Where the hidden data of a task is written:
 * - `short`: `<!-- id:k3f9 done:2026-11-12 -->` at the end of the task line.
 * - `block`: `<!--` ends the task line, one `key: value` per line, `-->` on its own line.
 * - `below`: the comment starts on the line under the task (the older form, 5.2).
 */
export type CommentForm = 'short' | 'block' | 'below';

/** One hidden entry. `key` is empty for a block line that is not `key: value`; `value` is then the raw line. */
export interface DataEntry {
  key: string;
  value: string;
}

export interface TodoTask {
  /** Index of the task line. */
  line: number;
  /** Last line of the task's own lines (task line + comment), inclusive. Subtasks are not included. */
  end: number;
  /** Indentation width in columns (a tab counts 4). */
  indent: number;
  indentText: string;
  /** List marker: `-`, `*`, `+`, `1.` or `1)`. */
  marker: string;
  checked: boolean;
  /** Visible text after the checkbox, tokens included, comment excluded. */
  text: string;
  /** Hidden entries in file order. */
  data: DataEntry[];
  /** Undefined when the task has no comment. */
  form?: CommentForm;
  /** Things that break the Markdown preview or the parse. */
  problems: string[];
  /** Index of the parent task in `TodoDoc.tasks`, or null. */
  parent: number | null;
  children: number[];
  depth: number;
}

export interface TodoHeading {
  line: number;
  level: number;
  title: string;
}

export interface TodoDoc {
  lines: string[];
  tasks: TodoTask[];
  headings: TodoHeading[];
}

/** An edit result: the new file text and the line of the task the edit is about. */
export interface TodoEdit {
  text: string;
  focus?: number;
}

const TASK_RE = /^([ \t]*)([-*+]|\d{1,9}[.)])[ \t]+\[([ xX])\](?:[ \t]+(.*?))?[ \t]*$/;
const SHORT_RE = /^(.*?)[ \t]*<!--((?:(?!-->).)*)-->[ \t]*$/;
const OPEN_RE = /^(.*?)[ \t]*<!--[ \t]*$/;
// `https://…` is not a key: `(?!\/\/)` keeps such a line as it is.
const KEY_LINE_RE = /^[ \t]*([A-Za-z][\w-]*):(?!\/\/)(?:[ \t]?)(.*)$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t#]*$/;

function indentWidth(s: string): number {
  let w = 0;
  for (const c of s) {
    if (c === ' ') w += 1;
    else if (c === '\t') w += 4 - (w % 4);
    else break;
  }
  return w;
}

const leading = (s: string): string => /^[ \t]*/.exec(s)![0];

// --- Values ---------------------------------------------------------------------------------

/** `\` → `\\`, newline → `\n`, `-->` → `--\>`, so a value never ends the comment. */
export function encodeValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/-->/g, '--\\>');
}

/**
 * Undo `encodeValue`; `\"` is also read, for quoted short values. Other backslashes are kept as typed,
 * so a hand-written `C:\Users` keeps its backslash.
 */
export function decodeValue(raw: string): string {
  return raw.replace(/\\([\\n>"])/g, (_m, c: string) => (c === 'n' ? '\n' : c));
}

/**
 * `key:value key:"a b"` (also `key: value`). Text that is not an entry is kept as one line without a key
 * (at the end), so a plain comment like `<!-- ask Anna first -->` is not lost when the task is written.
 */
function parseShort(content: string): DataEntry[] {
  const out: DataEntry[] = [];
  const re = /([A-Za-z][\w-]*):(?!\/\/)(?: (?![A-Za-z][\w-]*:))?("(?:[^"\\]|\\.)*"|[^\s"]*)/g;
  let rest = '';
  let at = 0;
  for (const m of content.matchAll(re)) {
    rest += `${content.slice(at, m.index)} `;
    at = m.index + m[0].length;
    const raw = m[2];
    out.push({ key: m[1], value: raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2 ? decodeValue(raw.slice(1, -1)) : decodeValue(raw) });
  }
  const left = (rest + content.slice(at)).replace(/\s+/g, ' ').trim();
  if (left !== '') out.push({ key: '', value: left });
  return out;
}

function parseBlockLine(line: string): DataEntry {
  const m = KEY_LINE_RE.exec(line);
  if (m) return { key: m[1], value: decodeValue(m[2].trimEnd()) };
  return { key: '', value: line.trim() };
}

export function getValue(task: TodoTask, key: string): string | undefined {
  return task.data.find((e) => e.key === key)?.value;
}

/** Ids in a list value like `after:p0a2,x7c1`. */
export function idList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Set (or with `undefined`, remove) `key`, keeping the order of the other entries. */
export function withValue(data: DataEntry[], key: string, value: string | undefined): DataEntry[] {
  const at = data.findIndex((e) => e.key === key);
  if (value === undefined) return at < 0 ? data : data.filter((e) => e.key !== key);
  if (at < 0) return [...data, { key, value }];
  return data.map((e, i) => (i === at ? { key, value } : e));
}

// --- Parse ----------------------------------------------------------------------------------

const BREAKS_PREVIEW = 'breaks the Markdown preview';

/** Parse the text of a todo file. Never throws. */
export function parseTodo(text: string): TodoDoc {
  const lines = text.split(/\r?\n/);
  const tasks: TodoTask[] = [];
  const headings: TodoHeading[] = [];
  const stack: number[] = [];
  let fence: string | null = null;
  let i = 0;

  // Front matter.
  if (lines[0] === '---') {
    for (i = 1; i < lines.length; i++) {
      if (lines[i] === '---' || lines[i] === '...') {
        i++;
        break;
      }
    }
  }

  const popTo = (indent: number) => {
    while (stack.length > 0 && tasks[stack[stack.length - 1]].indent >= indent) stack.pop();
  };

  for (; i < lines.length; i++) {
    const line = lines[i];
    const fenceMark = /^[ \t]*(`{3,}|~{3,})/.exec(line);
    if (fence !== null) {
      if (fenceMark && fenceMark[1][0] === fence[0] && fenceMark[1].length >= fence.length) fence = null;
      continue;
    }
    if (fenceMark) {
      fence = fenceMark[1];
      continue;
    }
    if (line.trim() === '') continue;

    const m = TASK_RE.exec(line);
    if (!m) {
      const h = HEADING_RE.exec(line);
      if (h) {
        headings.push({ line: i, level: h[1].length, title: h[2] });
        stack.length = 0;
      } else {
        popTo(indentWidth(line));
      }
      continue;
    }

    const indentText = m[1];
    const indent = indentWidth(indentText);
    const marker = m[2];
    let rest = m[4] ?? '';
    let data: DataEntry[] = [];
    let form: CommentForm | undefined;
    const problems: string[] = [];
    let end = i;

    const scanBlock = (from: number, requireIndent: boolean): { entries: DataEntry[]; close: number } | null => {
      const entries: DataEntry[] = [];
      for (let j = from; j < lines.length; j++) {
        const l = lines[j];
        const closeAt = l.indexOf('-->');
        const body = closeAt >= 0 ? l.slice(0, closeAt) : l;
        if (body.trim() !== '') {
          const entry = parseBlockLine(body);
          entries.push(entry);
          if (requireIndent && indentWidth(body) <= indent) problems.push(`Line ${j + 1} inside the comment is not indented; it ${BREAKS_PREVIEW}.`);
          else if (!requireIndent && entry.key === '') problems.push(`Line ${j + 1} inside the comment does not start with a key; it can break the Markdown preview.`);
        } else if (closeAt < 0 && !requireIndent) {
          problems.push(`Blank line ${j + 1} inside the comment ${BREAKS_PREVIEW}.`);
        }
        if (closeAt >= 0) return { entries, close: j };
      }
      return null;
    };

    const short = SHORT_RE.exec(rest);
    const open = short ? null : OPEN_RE.exec(rest);
    if (short) {
      rest = short[1];
      data = parseShort(short[2]);
      form = 'short';
    } else if (open) {
      const block = scanBlock(i + 1, false);
      if (block) {
        rest = open[1];
        data = block.entries;
        form = 'block';
        end = block.close;
      } else {
        problems.length = 0;
        problems.push(`The comment is not closed with -->; it ${BREAKS_PREVIEW}.`);
      }
    } else if (i + 1 < lines.length && /^[ \t]*<!--/.test(lines[i + 1]) && indentWidth(lines[i + 1]) > indent) {
      const first = lines[i + 1];
      const afterOpen = first.slice(first.indexOf('<!--') + 4);
      if (afterOpen.includes('-->')) {
        data = parseShort(afterOpen.slice(0, afterOpen.indexOf('-->')));
        form = 'below';
        end = i + 1;
      } else {
        const lead = afterOpen.trim() !== '' ? [parseBlockLine(afterOpen)] : [];
        const block = scanBlock(i + 2, true);
        if (block) {
          data = [...lead, ...block.entries];
          form = 'below';
          end = block.close;
        } else {
          problems.length = 0;
          problems.push(`The comment is not closed with -->; it ${BREAKS_PREVIEW}.`);
          end = i + 1;
        }
      }
    }

    popTo(indent);
    const parent = stack.length > 0 ? stack[stack.length - 1] : null;
    const index = tasks.length;
    tasks.push({
      line: i,
      end,
      indent,
      indentText,
      marker,
      checked: m[3] !== ' ',
      text: rest.trim(),
      data,
      ...(form !== undefined ? { form } : {}),
      problems,
      parent,
      children: [],
      depth: parent === null ? 0 : tasks[parent].depth + 1,
    });
    if (parent !== null) tasks[parent].children.push(index);
    stack.push(index);
    i = end;
  }
  return { lines, tasks, headings };
}

// --- Visible tokens -------------------------------------------------------------------------

export interface Tokens {
  /** Text without the tokens. */
  title: string;
  tags: string[];
  people: string[];
  /** `YYYY-MM-DD` or `YYYY-MM-DDTHH:MM`. */
  due?: string;
  /** For example `2h`, `30m`, `1h30m`, `1d`. */
  estimate?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/;
const ESTIMATE_RE = /^(?:\d+(?:\.\d+)?[mhdw])+$/;

export function isValidDay(v: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function isDueValue(v: string): boolean {
  if (!DATE_RE.test(v) || !isValidDay(v.slice(0, 10))) return false;
  if (v.length === 10) return true;
  const [h, min] = v.slice(11).split(':').map(Number);
  return h < 24 && min < 60;
}

export const isEstimate = (v: string): boolean => ESTIMATE_RE.test(v);

interface TokenHit {
  kind: 'tag' | 'person' | 'due' | 'estimate';
  value: string;
  /** Start of the token including its sigil, and its end. */
  start: number;
  end: number;
}

/** Tokens need a space or the line start before them, and are not read inside inline code. */
function findTokens(text: string): TokenHit[] {
  const masked = text.replace(/`[^`]*`/g, (s) => ' '.repeat(s.length));
  const out: TokenHit[] = [];
  for (const m of masked.matchAll(/(^|\s)([#@!~])([^\s]+)/g)) {
    const start = m.index + m[1].length;
    const sigil = m[2];
    let value = m[3];
    if (sigil === '#' || sigil === '@') value = value.replace(/[.,;:!?)\]]+$/, '');
    const end = start + 1 + value.length;
    if (sigil === '#' && /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(value)) out.push({ kind: 'tag', value, start, end });
    else if (sigil === '@' && /^[\p{L}\p{N}_][\p{L}\p{N}_.-]*$/u.test(value)) out.push({ kind: 'person', value, start, end });
    else if (sigil === '!' && isDueValue(value)) out.push({ kind: 'due', value, start, end });
    else if (sigil === '~' && isEstimate(value)) out.push({ kind: 'estimate', value, start, end });
  }
  return out;
}

export function readTokens(text: string): Tokens {
  const hits = findTokens(text);
  let title = '';
  let at = 0;
  for (const h of hits) {
    title += text.slice(at, h.start);
    at = h.end;
  }
  title = (title + text.slice(at)).replace(/\s+/g, ' ').trim();
  const due = hits.find((h) => h.kind === 'due')?.value;
  const estimate = hits.find((h) => h.kind === 'estimate')?.value;
  return {
    title,
    tags: hits.filter((h) => h.kind === 'tag').map((h) => h.value),
    people: hits.filter((h) => h.kind === 'person').map((h) => h.value),
    ...(due !== undefined ? { due } : {}),
    ...(estimate !== undefined ? { estimate } : {}),
  };
}

export interface TokenInfo {
  kind: 'tag' | 'person' | 'due' | 'estimate';
  /** Without the sigil. */
  value: string;
  /** As written: `#home`, `@Anna`, `!2026-12-23`, `~1h`. */
  raw: string;
}

/** The tokens of a task text, in order. */
export function listTokens(text: string): TokenInfo[] {
  return findTokens(text).map((h) => ({ kind: h.kind, value: h.value, raw: text.slice(h.start, h.end) }));
}

/**
 * Task text from an edited title and the tokens kept from before (`raw` strings). Tokens typed in the title win:
 * a typed `!date` or `~estimate` replaces the kept one, and a kept tag or person that was typed again is dropped.
 */
export function composeTaskText(title: string, kept: readonly string[]): string {
  const typed = listTokens(title);
  const has = (kind: TokenInfo['kind']) => typed.some((t) => t.kind === kind);
  const typedWords = new Set(typed.map((t) => t.raw.toLowerCase()));
  const rest = kept.filter((raw) => {
    const t = listTokens(raw)[0];
    if (!t) return false;
    if ((t.kind === 'due' || t.kind === 'estimate') && has(t.kind)) return false;
    return !typedWords.has(raw.toLowerCase());
  });
  return [title.trim(), ...rest].filter((s) => s !== '').join(' ');
}

/** `composeTaskText`, but returns `original` unchanged when the title and the kept tokens are the same as before. */
export function retitle(original: string, title: string, kept: readonly string[]): string {
  const before = listTokens(original).map((t) => t.raw);
  if (title.trim() === readTokens(original).title && kept.length === before.length && kept.every((k, i) => k === before[i])) return original;
  return composeTaskText(title, kept);
}

// --- Meta: tags, people, due date and estimate are kept in the hidden comment ----------------
//
// The task line holds the title only. What a person types as `#tag @person !date ~2h` is moved into the comment
// (`tags: home, work`, `people: Anna`, `due: 2026-11-14`, `estimate: 2h`) when Konekton writes the task. Older files
// with visible tokens are still read, and change to the comment form when the task changes.

/** The hidden keys of the meta, in the order they are written (first in the comment). */
export const META_KEYS: readonly string[] = ['due', 'estimate', 'tags', 'people'];

/** Words of a list value such as `home, work` (a leading `#` or `@` is ignored). */
function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^[#@]/, ''))
    .filter((s) => s !== '');
}

/** The words once each, in order; `Home` and `home` are the same word. */
function uniqueWords(words: readonly string[]): string[] {
  const seen = new Set<string>();
  return words.filter((w) => {
    const k = w.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Put the meta entries first, in the order of `META_KEYS`; the other entries keep their order. */
function orderMeta(data: DataEntry[]): DataEntry[] {
  const meta = META_KEYS.flatMap((k) => data.filter((e) => e.key === k));
  return [...meta, ...data.filter((e) => !META_KEYS.includes(e.key))];
}

/**
 * Move the tokens of a task text into the data: the text keeps its title only. A token wins over a key of the same
 * name (it is what was typed last). Without tokens nothing changes, so a task is not rewritten for no reason.
 */
export function moveMetaToData(text: string, data: DataEntry[]): { text: string; data: DataEntry[] } {
  if (findTokens(text).length === 0) return { text, data };
  const t = readTokens(text);
  const get = (key: string) => data.find((e) => e.key === key)?.value;
  const meta: DataEntry[] = [];
  const due = t.due ?? get('due');
  const estimate = t.estimate ?? get('estimate');
  const tags = uniqueWords([...splitList(get('tags')), ...t.tags]);
  const people = uniqueWords([...splitList(get('people')), ...t.people]);
  if (due !== undefined) meta.push({ key: 'due', value: due });
  if (estimate !== undefined) meta.push({ key: 'estimate', value: estimate });
  if (tags.length > 0) meta.push({ key: 'tags', value: tags.join(', ') });
  if (people.length > 0) meta.push({ key: 'people', value: people.join(', ') });
  return { text: t.title, data: [...meta, ...data.filter((e) => !META_KEYS.includes(e.key))] };
}

/** Title, tags, people, due date and estimate of a task, from the comment and from tokens still on the line. */
export function taskMeta(task: Pick<TodoTask, 'text' | 'data'>): Tokens {
  const t = readTokens(task.text);
  const get = (key: string) => task.data.find((e) => e.key === key)?.value.trim();
  const dueValue = t.due ?? get('due');
  const estimateValue = t.estimate ?? get('estimate');
  const due = dueValue !== undefined && isDueValue(dueValue) ? dueValue : undefined;
  const estimate = estimateValue !== undefined && isEstimate(estimateValue) ? estimateValue : undefined;
  return {
    title: t.title,
    tags: uniqueWords([...splitList(get('tags')), ...t.tags]),
    people: uniqueWords([...splitList(get('people')), ...t.people]),
    ...(due !== undefined ? { due } : {}),
    ...(estimate !== undefined ? { estimate } : {}),
  };
}

/** The title with its meta as tokens (`Call plumber #home !2026-11-14`): what the title editor shows and edits. */
export function taskFullText(task: Pick<TodoTask, 'text' | 'data'>): string {
  const m = taskMeta(task);
  return composeTaskText(m.title, [...m.tags.map((t) => `#${t}`), ...m.people.map((p) => `@${p}`), ...(m.due !== undefined ? [`!${m.due}`] : []), ...(m.estimate !== undefined ? [`~${m.estimate}`] : [])]);
}

// --- Dates ----------------------------------------------------------------------------------

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function fromParts(y: number, m: number, d: number): string {
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function addToDay(day: string, n: number, unit: 'd' | 'w' | 'm' | 'y'): string {
  const [y, m, d] = day.split('-').map(Number);
  if (unit === 'd') return fromParts(y, m, d + n);
  if (unit === 'w') return fromParts(y, m, d + 7 * n);
  const months = unit === 'm' ? n : 12 * n;
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  // The 31st of a month becomes the last day of a shorter month.
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return fromParts(ny, nm, Math.min(d, last));
}

function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * Turn date shortcuts into real dates: `!today`, `!tomorrow`, `!mon` … `!sun` (also full names;
 * the next such day, today included), `!+3d`, `!+2w`, `!+1m`, `!+1y`. Other text stays as it is.
 */
export function expandDateShortcuts(text: string, today: string): string {
  return text.replace(/(^|\s)!([+\w]+)(?=\s|$)/g, (all, pre: string, word: string) => {
    const w = word.toLowerCase();
    let date: string | undefined;
    if (w === 'today' || w === 'tod') date = today;
    else if (w === 'tomorrow' || w === 'tom') date = addToDay(today, 1, 'd');
    else {
      const rel = /^\+(\d{1,3})([dwmy])$/.exec(w);
      if (rel) date = addToDay(today, Number(rel[1]), rel[2] as 'd' | 'w' | 'm' | 'y');
      else {
        const idx = WEEKDAYS.findIndex((d, n) => w === d || w === WEEKDAY_NAMES[n]);
        if (idx >= 0) date = addToDay(today, (idx - weekday(today) + 7) % 7, 'd');
      }
    }
    return date === undefined ? all : `${pre}!${date}`;
  });
}

// --- Estimates ------------------------------------------------------------------------------

const UNIT_MINUTES: Record<string, number> = { m: 1, h: 60, d: 8 * 60, w: 5 * 8 * 60 };

/** Minutes of an estimate. A day counts 8 hours and a week 5 days, as work time. */
export function estimateMinutes(est: string): number {
  let total = 0;
  for (const m of est.matchAll(/(\d+(?:\.\d+)?)([mhdw])/g)) total += Number(m[1]) * UNIT_MINUTES[m[2]];
  return Math.round(total);
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

// --- Repeat ---------------------------------------------------------------------------------

export interface RepeatRule {
  /** True: every N units on a fixed schedule (`+1m`). False: N units after it is done (`3d`). */
  fixed: boolean;
  n: number;
  unit: 'd' | 'w' | 'm' | 'y';
}

export function parseRepeat(value: string | undefined): RepeatRule | undefined {
  const m = /^(\+)?(\d{1,4})([dwmy])$/.exec((value ?? '').trim());
  if (!m || Number(m[2]) === 0) return undefined;
  return { fixed: m[1] === '+', n: Number(m[2]), unit: m[3] as RepeatRule['unit'] };
}

const UNIT_NAMES: Record<RepeatRule['unit'], [string, string]> = { d: ['day', 'days'], w: ['week', 'weeks'], m: ['month', 'months'], y: ['year', 'years'] };

export function describeRepeat(rule: RepeatRule): string {
  const [one, many] = UNIT_NAMES[rule.unit];
  const every = rule.n === 1 ? `every ${one}` : `every ${rule.n} ${many}`;
  return rule.fixed ? `${every}, fixed dates` : `${rule.n === 1 ? `1 ${one}` : `${rule.n} ${many}`} after done`;
}

// --- Render ---------------------------------------------------------------------------------

export interface TaskPatch {
  checked?: boolean;
  text?: string;
  data?: DataEntry[];
}

function contentIndent(task: Pick<TodoTask, 'indentText' | 'marker'>): string {
  return task.indentText + ' '.repeat(task.marker.length + 1);
}

/**
 * The lines of one task: task line plus comment. Konekton always writes the block form (TODO-FORMAT.md 5.1):
 * `<!--` ends the task line, one `key: value` per line, `-->` on its own line. The short and below forms are
 * read, and turn into the block form when Konekton changes the task.
 */
export function renderTask(input: Pick<TodoTask, 'indentText' | 'marker' | 'checked' | 'text' | 'data'>): string[] {
  // Tokens on the line (`#tag @person !date ~2h`) go into the comment: the line keeps its title only.
  const task = { ...input, ...moveMetaToData(input.text, input.data) };
  const head = `${task.indentText}${task.marker} [${task.checked ? 'x' : ' '}]${task.text !== '' ? ` ${task.text}` : ''}`;
  if (task.data.length === 0) return [head];
  const ind = contentIndent(task);
  const body = task.data.map((e) => (e.key === '' ? `${ind}${e.value}` : `${ind}${e.key}: ${encodeValue(e.value)}`));
  return [`${head} <!--`, ...body, `${ind}-->`];
}

interface LineEdit {
  start: number;
  /** Inclusive. `end = start - 1` inserts before `start`. */
  end: number;
  lines: string[];
}

function applyEdits(lines: string[], edits: LineEdit[]): string[] {
  const out = [...lines];
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out.splice(e.start, e.end - e.start + 1, ...e.lines);
  return out;
}

function taskEdit(task: TodoTask, patch: TaskPatch): LineEdit {
  return { start: task.line, end: task.end, lines: renderTask({ ...task, ...patch }) };
}

/** Change one task. */
export function updateTask(doc: TodoDoc, index: number, patch: TaskPatch): TodoEdit {
  const task = doc.tasks[index];
  return { text: applyEdits(doc.lines, [taskEdit(task, patch)]).join('\n'), focus: task.line };
}

/**
 * Replace the title and the meta of a task by `fullText` (title and tokens, as `taskFullText` gives and the title
 * editor returns). The old meta keys are dropped first, so a token removed in the editor is gone from the comment.
 */
export function retitleTask(doc: TodoDoc, index: number, fullText: string): TodoEdit {
  return updateTask(doc, index, { text: fullText, data: doc.tasks[index].data.filter((e) => !META_KEYS.includes(e.key)) });
}

/** Set (or with `undefined` remove) the due date or the estimate of a task. They live in the comment. */
export function setMeta(doc: TodoDoc, index: number, key: 'due' | 'estimate', value: string | undefined): TodoEdit {
  const task = doc.tasks[index];
  const base = moveMetaToData(task.text, task.data);
  return updateTask(doc, index, { text: base.text, data: orderMeta(withValue(base.data, key, value)) });
}

/** Set (or remove) one hidden key of a task. */
export function setTaskValue(doc: TodoDoc, index: number, key: string, value: string | undefined): TodoEdit {
  return updateTask(doc, index, { data: withValue(doc.tasks[index].data, key, value) });
}

/** Replace the task's own lines (not its subtasks) with `text`, as typed in the per-task text editor. Empty text removes them. */
export function replaceTaskLines(doc: TodoDoc, index: number, text: string): TodoEdit {
  const task = doc.tasks[index];
  const trimmed = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const lines = trimmed.trim() === '' ? [] : trimmed.split('\n');
  return { text: applyEdits(doc.lines, [{ start: task.line, end: task.end, lines }]).join('\n'), focus: task.line };
}

// --- Done -----------------------------------------------------------------------------------

function completePatch(task: TodoTask, today: string): TaskPatch {
  const moved = moveMetaToData(task.text, task.data);
  let data = withValue(moved.data, 'status', undefined);
  const rule = parseRepeat(getValue(task, 'repeat'));
  if (rule) {
    const due = taskMeta(task).due;
    const base = rule.fixed && due !== undefined ? due.slice(0, 10) : today;
    const nextDay = addToDay(base, rule.n, rule.unit);
    const next = due !== undefined && due.length > 10 ? `${nextDay}${due.slice(10)}` : nextDay;
    const until = getValue(task, 'until');
    const timesValue = getValue(task, 'times');
    const times = timesValue !== undefined && /^\d+$/.test(timesValue.trim()) ? Number(timesValue) : undefined;
    const pastUntil = until !== undefined && isValidDay(until) && nextDay > until;
    const lastTime = times !== undefined && times <= 1;
    if (!pastUntil && !lastTime) {
      data = withValue(data, 'last', today);
      data = withValue(data, 'snooze', undefined);
      if (times !== undefined) data = withValue(data, 'times', String(times - 1));
      return { checked: false, text: moved.text, data: orderMeta(withValue(data, 'due', next)) };
    }
    if (lastTime) data = withValue(data, 'times', '0');
  }
  return { checked: true, text: moved.text, data: withValue(data, 'done', today) };
}

/**
 * Mark a task done or not done. Done writes `done:<today>`. A repeating task stays open instead:
 * it gets its next `!date` and `last:<today>` (TODO-FORMAT.md, "Recurring").
 */
export function setDone(doc: TodoDoc, index: number, done: boolean, today: string): TodoEdit {
  const task = doc.tasks[index];
  const patch: TaskPatch = done ? completePatch(task, today) : { checked: false, data: withValue(task.data, 'done', undefined) };
  return updateTask(doc, index, patch);
}

/** All subtasks (any depth), in file order. */
export function descendants(doc: TodoDoc, index: number): number[] {
  const out: number[] = [];
  const walk = (i: number) => {
    for (const c of doc.tasks[i].children) {
      out.push(c);
      walk(c);
    }
  };
  walk(index);
  return out;
}

/** Mark a task and all its open subtasks done, in one edit. */
export function setDoneWithSubtasks(doc: TodoDoc, index: number, today: string): TodoEdit {
  const all = [index, ...descendants(doc, index).filter((i) => !doc.tasks[i].checked)];
  const edits = all.map((i) => taskEdit(doc.tasks[i], completePatch(doc.tasks[i], today)));
  return { text: applyEdits(doc.lines, edits).join('\n'), focus: doc.tasks[index].line };
}

// --- Board lanes ----------------------------------------------------------------------------

/** Lanes of a todo list in board mode, the same three as Konekton's Board view. */
export type Lane = 'todo' | 'inProgress' | 'done';
export const LANES: readonly Lane[] = ['todo', 'inProgress', 'done'];

/** Done and cancelled tasks are in Done, `status: inProgress` in In progress, the rest (also `waiting`) in Todo. */
export function laneOf(task: TodoTask): Lane {
  if (task.checked || isCancelled(task)) return 'done';
  return getValue(task, 'status') === 'inProgress' ? 'inProgress' : 'todo';
}

/** The three main statuses of a task. */
export type MainStatus = 'todo' | 'inProgress' | 'done';

/**
 * The status of a task as the details window shows it. Done is the checkbox `[x]`; `inProgress` is the hidden key
 * `status: inProgress`; no key is Todo. `waiting` and `cancelled` (older keys) show as they are.
 */
export function statusOf(task: TodoTask): MainStatus | 'waiting' | 'cancelled' {
  const status = getValue(task, 'status');
  if (status === 'cancelled') return 'cancelled';
  if (task.checked) return 'done';
  if (status === 'inProgress' || status === 'waiting') return status;
  return 'todo';
}

/** Set the status of a task. Done and back go through the checkbox, so repeats and done dates work as for a click on it. */
export function setStatus(doc: TodoDoc, index: number, status: MainStatus, today: string): TodoEdit {
  const task = doc.tasks[index];
  if (statusOf(task) === status) return { text: doc.lines.join('\n'), focus: task.line };
  if (status === 'done') return setDone(doc, index, true, today);
  let data = withValue(task.data, 'done', undefined);
  data = withValue(data, 'status', status === 'inProgress' ? 'inProgress' : undefined);
  return updateTask(doc, index, { checked: false, data });
}

/**
 * Move a task to a lane. Done marks it done (a repeating task moves to its next date instead, see `setDone`);
 * In progress sets `status: inProgress`; Todo clears `inProgress` and `cancelled`. Leaving Done reopens it.
 */
export function setLane(doc: TodoDoc, index: number, lane: Lane, today: string): TodoEdit {
  const task = doc.tasks[index];
  if (laneOf(task) === lane) return { text: doc.lines.join('\n'), focus: task.line };
  if (lane === 'done') return setDone(doc, index, true, today);
  let data = withValue(task.data, 'done', undefined);
  const status = getValue(task, 'status');
  if (lane === 'inProgress') data = withValue(data, 'status', 'inProgress');
  else if (status === 'inProgress' || status === 'cancelled') data = withValue(data, 'status', undefined);
  return updateTask(doc, index, { checked: false, data });
}

// --- Structure ------------------------------------------------------------------------------

/** Last line of the task with all its subtasks and indented notes. Trailing blank lines are not included. */
export function subtreeEnd(doc: TodoDoc, index: number): number {
  const task = doc.tasks[index];
  const owned = new Map<number, number>();
  for (const d of descendants(doc, index)) owned.set(doc.tasks[d].line, doc.tasks[d].end);
  let last = task.end;
  for (let j = task.end + 1; j < doc.lines.length; j++) {
    const ownedEnd = owned.get(j);
    if (ownedEnd !== undefined) {
      last = ownedEnd;
      j = ownedEnd;
      continue;
    }
    const l = doc.lines[j];
    if (l.trim() === '') continue;
    if (indentWidth(l) > task.indent) last = j;
    else break;
  }
  return last;
}

function nextMarker(marker: string): string {
  const m = /^(\d+)([.)])$/.exec(marker);
  return m ? `${Number(m[1]) + 1}${m[2]}` : marker;
}

/**
 * Insert a new task. With `after`, it goes after that task and its subtasks, at the same level.
 * Without, it goes after the last task, or at the end of the file.
 */
export function insertTask(doc: TodoDoc, after: number | null, text = ''): TodoEdit {
  const ref = after !== null ? doc.tasks[after] : [...doc.tasks].reverse().find((t) => t.parent === null);
  if (!ref) {
    const lines = [...doc.lines];
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
    const at = lines.length;
    lines.push(renderTask({ indentText: '', marker: '-', checked: false, text, data: [] })[0], '');
    return { text: lines.join('\n'), focus: at };
  }
  const idx = doc.tasks.indexOf(ref);
  const at = subtreeEnd(doc, idx) + 1;
  const line = renderTask({ indentText: ref.indentText, marker: nextMarker(ref.marker), checked: false, text, data: [] })[0];
  return { text: applyEdits(doc.lines, [{ start: at, end: at - 1, lines: [line] }]).join('\n'), focus: at };
}

/** Insert a new task as the last subtask of `index`, with the indent and marker of its other subtasks. */
export function insertSubtask(doc: TodoDoc, index: number, text = ''): TodoEdit {
  const parent = doc.tasks[index];
  const last = parent.children[parent.children.length - 1];
  const sibling = last !== undefined ? doc.tasks[last] : undefined;
  const indentText = sibling ? sibling.indentText : contentIndent(parent);
  const marker = sibling ? nextMarker(sibling.marker) : '-';
  const at = subtreeEnd(doc, index) + 1;
  const line = renderTask({ indentText, marker, checked: false, text, data: [] })[0];
  return { text: applyEdits(doc.lines, [{ start: at, end: at - 1, lines: [line] }]).join('\n'), focus: at };
}

export function deleteTask(doc: TodoDoc, index: number): TodoEdit {
  const task = doc.tasks[index];
  return { text: applyEdits(doc.lines, [{ start: task.line, end: subtreeEnd(doc, index), lines: [] }]).join('\n') };
}

function siblings(doc: TodoDoc, index: number): number[] {
  const parent = doc.tasks[index].parent;
  return parent === null ? doc.tasks.map((_t, i) => i).filter((i) => doc.tasks[i].parent === null) : doc.tasks[parent].children;
}

/** Shift non-blank lines by `delta` columns (spaces). Negative removes leading whitespace. */
function reindent(lines: string[], delta: number): string[] {
  if (delta === 0) return lines;
  return lines.map((l) => {
    if (l.trim() === '') return l;
    if (delta > 0) return ' '.repeat(delta) + l;
    const lead = leading(l);
    const width = indentWidth(lead);
    return ' '.repeat(Math.max(0, width + delta)) + l.slice(lead.length);
  });
}

/** Move a task with its subtasks above the previous (-1) or below the next (+1) task of the same level. */
export function moveTask(doc: TodoDoc, index: number, dir: -1 | 1): TodoEdit {
  const sib = siblings(doc, index);
  const pos = sib.indexOf(index);
  const other = sib[pos + dir];
  if (other === undefined) return { text: doc.lines.join('\n'), focus: doc.tasks[index].line };
  const [first, second] = dir === -1 ? [other, index] : [index, other];
  const aStart = doc.tasks[first].line;
  const aEnd = subtreeEnd(doc, first);
  const bStart = doc.tasks[second].line;
  const bEnd = subtreeEnd(doc, second);
  const a = doc.lines.slice(aStart, aEnd + 1);
  const gap = doc.lines.slice(aEnd + 1, bStart);
  const b = doc.lines.slice(bStart, bEnd + 1);
  const lines = [...doc.lines.slice(0, aStart), ...b, ...gap, ...a, ...doc.lines.slice(bEnd + 1)];
  const focus = dir === -1 ? aStart : aStart + b.length + gap.length;
  return { text: lines.join('\n'), focus };
}

/** Make a task the last subtask of the task above it (same level). */
export function indentTask(doc: TodoDoc, index: number): TodoEdit {
  const sib = siblings(doc, index);
  const prev = sib[sib.indexOf(index) - 1];
  const task = doc.tasks[index];
  const unchanged = { text: doc.lines.join('\n'), focus: task.line };
  if (prev === undefined) return unchanged;
  const between = doc.lines.slice(subtreeEnd(doc, prev) + 1, task.line);
  if (between.some((l) => l.trim() !== '')) return unchanged;
  const p = doc.tasks[prev];
  const delta = p.indent + p.marker.length + 1 - task.indent;
  const end = subtreeEnd(doc, index);
  return { text: applyEdits(doc.lines, [{ start: task.line, end, lines: reindent(doc.lines.slice(task.line, end + 1), delta) }]).join('\n'), focus: task.line };
}

/** Move a subtask one level up: it goes right after its parent and the parent's other subtasks. */
export function outdentTask(doc: TodoDoc, index: number): TodoEdit {
  const task = doc.tasks[index];
  if (task.parent === null) return { text: doc.lines.join('\n'), focus: task.line };
  const parent = doc.tasks[task.parent];
  const end = subtreeEnd(doc, index);
  const block = reindent(doc.lines.slice(task.line, end + 1), parent.indent - task.indent);
  const parentEnd = subtreeEnd(doc, task.parent);
  const rest = [...doc.lines.slice(0, task.line), ...doc.lines.slice(end + 1)];
  const at = parentEnd - block.length + 1;
  rest.splice(at, 0, ...block);
  return { text: rest.join('\n'), focus: at };
}

export type DropPlace = 'before' | 'after' | 'child';

/** Drag and drop: move a task with its subtasks before or after another task, or into it as the last subtask. */
export function moveTaskTo(doc: TodoDoc, index: number, target: number, place: DropPlace): TodoEdit {
  const task = doc.tasks[index];
  const unchanged = { text: doc.lines.join('\n'), focus: task.line };
  if (index === target || descendants(doc, index).includes(target)) return unchanged;
  const t = doc.tasks[target];
  const start = task.line;
  const end = subtreeEnd(doc, index);
  const newIndent = place === 'child' ? t.indent + t.marker.length + 1 : t.indent;
  const block = reindent(doc.lines.slice(start, end + 1), newIndent - task.indent);
  let at = place === 'before' ? t.line : subtreeEnd(doc, target) + 1;
  const rest = [...doc.lines.slice(0, start), ...doc.lines.slice(end + 1)];
  if (at > end) at -= end - start + 1;
  rest.splice(at, 0, ...block);
  return { text: rest.join('\n'), focus: at };
}

// --- Ids and links --------------------------------------------------------------------------

export function newTaskId(used: ReadonlySet<string>, random: () => number = Math.random): string {
  for (let len = 4; ; len++) {
    for (let tries = 0; tries < 20; tries++) {
      let id = '';
      for (let i = 0; i < len; i++) id += 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(random() * 36)];
      if (/^[a-z]/.test(id) && !used.has(id)) return id;
    }
  }
}

export function usedIds(doc: TodoDoc): Set<string> {
  const out = new Set<string>();
  for (const t of doc.tasks) {
    const id = getValue(t, 'id');
    if (id !== undefined) out.add(id);
  }
  return out;
}

/** The task with this id, or -1. */
export function taskById(doc: TodoDoc, id: string): number {
  return doc.tasks.findIndex((t) => getValue(t, 'id') === id);
}

/** The task at `index` with an `id:` in its comment: the id it has, or a new one (then `text` is the changed file). */
export function ensureTaskId(doc: TodoDoc, index: number, random?: () => number): { text: string; id: string } {
  const task = doc.tasks[index];
  const have = getValue(task, 'id');
  if (have !== undefined) return { text: doc.lines.join('\n'), id: have };
  const id = newTaskId(usedIds(doc), random);
  return { text: applyEdits(doc.lines, [taskEdit(task, { data: [{ key: 'id', value: id }, ...task.data] })]).join('\n'), id };
}

/** Add `target` to the `after` (waits for) or `rel` (related) list of a task. Gives `target` an id when it has none. */
export function linkTask(doc: TodoDoc, index: number, key: 'after' | 'rel', target: number, random?: () => number): TodoEdit {
  const task = doc.tasks[index];
  if (index === target) return { text: doc.lines.join('\n'), focus: task.line };
  const t = doc.tasks[target];
  const edits: LineEdit[] = [];
  let id = getValue(t, 'id');
  if (id === undefined) {
    id = newTaskId(usedIds(doc), random);
    edits.push(taskEdit(t, { data: [{ key: 'id', value: id }, ...t.data] }));
  }
  const list = idList(getValue(task, key));
  if (!list.includes(id)) edits.push(taskEdit(task, { data: withValue(task.data, key, [...list, id].join(',')) }));
  const text = applyEdits(doc.lines, edits).join('\n');
  // The target's lines may have grown above the task.
  const shift = target < index && edits.length === 2 ? edits[0].lines.length - (t.end - t.line + 1) : 0;
  return { text, focus: task.line + shift };
}

export function unlinkTask(doc: TodoDoc, index: number, key: 'after' | 'rel', id: string): TodoEdit {
  const list = idList(getValue(doc.tasks[index], key)).filter((x) => x !== id);
  return setTaskValue(doc, index, key, list.length > 0 ? list.join(',') : undefined);
}

// --- Summary --------------------------------------------------------------------------------

export function isCancelled(task: TodoTask): boolean {
  return getValue(task, 'status') === 'cancelled';
}

export function isOverdue(task: TodoTask, today: string): boolean {
  if (task.checked || isCancelled(task)) return false;
  const due = taskMeta(task).due;
  return due !== undefined && due.slice(0, 10) < today;
}

export function summary(doc: TodoDoc, today: string): { done: number; total: number; overdue: number } {
  const counted = doc.tasks.filter((t) => !isCancelled(t));
  return {
    done: counted.filter((t) => t.checked).length,
    total: counted.length,
    overdue: counted.filter((t) => isOverdue(t, today)).length,
  };
}
