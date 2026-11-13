// JSON Canvas 1.0 (https://jsoncanvas.org/spec/1.0/) with our own data in the `konekton` field.
// Must not import `vscode`: used by both the extension host and the webview.

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type EndShape = 'none' | 'arrow';
export type Align = 'left' | 'center' | 'right';

export const SIDES: readonly Side[] = ['top', 'right', 'bottom', 'left'];
export const FONT_SIZES = [10, 12, 14, 18, 24, 36, 48, 64] as const;
export const MIN_SIZE = 50;

export interface PaletteEntry {
  value: string;
  name: string;
  fill: string;
  border: string;
}

export const PALETTE: readonly PaletteEntry[] = [
  { value: '1', name: 'red', fill: '#FFB3B3', border: '#E06666' },
  { value: '2', name: 'orange', fill: '#FFD199', border: '#E69138' },
  { value: '3', name: 'yellow', fill: '#FFF9B1', border: '#E6C700' },
  { value: '4', name: 'green', fill: '#D5F692', border: '#8FBF3F' },
  { value: '5', name: 'cyan', fill: '#A6E3F5', border: '#45A6C9' },
  { value: '6', name: 'purple', fill: '#DCC6FF', border: '#9467D9' },
  { value: '#FFFFFF', name: 'white', fill: '#FFFFFF', border: '#C4C4C4' },
];

export const STICKY_DEFAULTS = { width: 200, height: 200, color: '3', fontSize: 18, align: 'center' as Align, bold: false };
export const RECTANGLE_DEFAULTS = { width: 240, height: 160, color: '#FFFFFF', fontSize: 14, align: 'left' as Align, bold: false };
export const FILE_DEFAULTS = { width: 320, height: 240, fontSize: 14, align: 'left' as Align, bold: false };
export const LINK_DEFAULTS = { width: 280, height: 60 };

export type Json = unknown;
export type Extra = Record<string, Json>;

export type Status = 'todo' | 'inProgress' | 'done';
export const STATUSES: readonly Status[] = ['todo', 'inProgress', 'done'];
export type PlanType = 'board' | 'timeline';

export interface Plan {
  id: string;
  type: PlanType;
  name: string;
  /** Node ids, in card order. For Board this is also the order inside each lane. */
  items: string[];
  /** Unknown keys of this plan, written back unchanged. */
  extra: Extra;
}

interface NodeBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
  status?: Status;
  /** Local calendar date, `YYYY-MM-DD`. */
  date?: string;
  /** Unknown top-level keys, written back after the known ones. */
  extra: Extra;
  /** Unknown keys inside `konekton`. */
  elExtra: Extra;
}

export interface TextStyle {
  fontSize: number;
  align: Align;
  bold: boolean;
}

export interface StickyNode extends NodeBase, TextStyle {
  kind: 'sticky';
  color: string;
  text: string;
}

export interface RectangleNode extends NodeBase, TextStyle {
  kind: 'rectangle';
  color: string;
  title: string;
  text: string;
}

export interface FileNode extends NodeBase, TextStyle {
  kind: 'file';
  file: string;
  subpath?: string;
}

export interface LinkNode extends NodeBase {
  kind: 'link';
  url: string;
}

/** Nodes we do not show (e.g. `group`). Kept verbatim so they survive a save. */
export interface UnsupportedNode {
  kind: 'unsupported';
  id: string;
  raw: Record<string, Json>;
}

export type BoardNode = StickyNode | RectangleNode | FileNode | LinkNode;
export type AnyNode = BoardNode | UnsupportedNode;

export interface BoardEdge {
  id: string;
  fromNode: string;
  fromSide: Side;
  fromEnd: EndShape;
  fromOffset: number;
  toNode: string;
  toSide: Side;
  toEnd: EndShape;
  toOffset: number;
  color?: string;
  label: string;
  extra: Extra;
  elExtra: Extra;
}

export interface UnsupportedEdge {
  kind: 'unsupported';
  id: string;
  raw: Record<string, Json>;
}

export interface CanvasDoc {
  nodes: AnyNode[];
  /** Edge entries in file order; `kind: 'unsupported'` ones are malformed and kept verbatim. */
  edges: (BoardEdge | UnsupportedEdge)[];
  /** Plans from the top-level `konekton` key. Empty when the file has none. */
  plans: Plan[];
  /** Entries of `konekton.plans` that are not valid plans, kept verbatim and written after the valid ones. */
  otherPlans: Json[];
  /** Unknown keys inside the top-level `konekton` key. */
  konektonExtra: Extra;
  /** Unknown top-level keys. */
  extra: Extra;
}

export type ParseResult = { ok: true; doc: CanvasDoc; empty: boolean } | { ok: false; error: string };

export function isBoardNode(n: AnyNode): n is BoardNode {
  return n.kind !== 'unsupported';
}

export function isBoardEdge(e: BoardEdge | UnsupportedEdge): e is BoardEdge {
  return !('kind' in e);
}

export function emptyDoc(): CanvasDoc {
  return { nodes: [], edges: [], plans: [], otherPlans: [], konektonExtra: {}, extra: {} };
}

export function newId(): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function findPaletteEntry(color: string | undefined): PaletteEntry | undefined {
  if (!color) return undefined;
  const upper = color.toUpperCase();
  return PALETTE.find((p) => p.value === color || p.value.toUpperCase() === upper);
}

/** Darken a `#RRGGBB` color by `amount` (0–1). Returns the input when it is not a 6-digit hex color. */
export function darken(hex: string, amount: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = (shift: number) =>
    Math.round(((n >> shift) & 0xff) * (1 - amount))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(16)}${ch(8)}${ch(0)}`.toUpperCase();
}

export function resolveColor(color: string | undefined): { fill: string; border: string } | undefined {
  if (!color) return undefined;
  const entry = findPaletteEntry(color);
  if (entry) return { fill: entry.fill, border: entry.border };
  if (/^#[0-9a-f]{6}$/i.test(color)) return { fill: color, border: darken(color, 0.25) };
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Parsing

const isObject = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asNumber = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const asString = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);
const asSide = (v: unknown, fallback: Side): Side => (SIDES as readonly unknown[]).includes(v) ? (v as Side) : fallback;
const asEnd = (v: unknown, fallback: EndShape): EndShape => (v === 'none' || v === 'arrow' ? v : fallback);
const asAlign = (v: unknown, fallback: Align): Align => (v === 'left' || v === 'center' || v === 'right' ? v : fallback);
const isStatus = (v: unknown): v is Status => (STATUSES as readonly unknown[]).includes(v);
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** True for a real calendar date written as `YYYY-MM-DD`. */
export function isValidDate(v: unknown): v is string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

function splitKeys(obj: Record<string, Json>, known: readonly string[]): Extra {
  const out: Extra = {};
  for (const key of Object.keys(obj)) if (!known.includes(key)) out[key] = obj[key];
  return out;
}

const NODE_KEYS = ['id', 'type', 'x', 'y', 'width', 'height', 'color', 'text', 'file', 'subpath', 'url', 'label', 'konekton'];
const EDGE_KEYS = ['id', 'fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'color', 'label', 'konekton'];

function parseNode(raw: unknown): AnyNode {
  if (!isObject(raw) || typeof raw.id !== 'string') {
    return { kind: 'unsupported', id: '', raw: isObject(raw) ? raw : { value: raw } };
  }
  const el = isObject(raw.konekton) ? raw.konekton : {};
  const geometry = (d: { width: number; height: number }) => ({
    id: raw.id as string,
    x: asNumber(raw.x, 0),
    y: asNumber(raw.y, 0),
    width: Math.max(MIN_SIZE, asNumber(raw.width, d.width)),
    height: Math.max(MIN_SIZE, asNumber(raw.height, d.height)),
    ...(typeof raw.color === 'string' ? { color: raw.color } : {}),
    extra: splitKeys(raw, NODE_KEYS),
  });
  const status = isStatus(el.status) ? el.status : undefined;
  const date = isValidDate(el.date) ? el.date : undefined;
  const plan = {
    ...(status !== undefined ? { status } : {}),
    ...(date !== undefined ? { date } : {}),
  };
  // Invalid values stay in `elExtra`, so a save does not lose them.
  const elKeys = (known: string[]): string[] => [...known, ...(status !== undefined ? ['status'] : []), ...(date !== undefined ? ['date'] : [])];
  const style = (d: TextStyle): TextStyle => ({
    fontSize: asNumber(el.fontSize, d.fontSize),
    align: asAlign(el.align, d.align),
    bold: typeof el.bold === 'boolean' ? el.bold : d.bold,
  });

  switch (raw.type) {
    case 'text': {
      if (el.kind === 'sticky') {
        return {
          kind: 'sticky',
          ...geometry(STICKY_DEFAULTS),
          color: typeof raw.color === 'string' ? raw.color : STICKY_DEFAULTS.color,
          text: asString(raw.text, ''),
          ...style(STICKY_DEFAULTS),
          ...plan,
          elExtra: splitKeys(el, elKeys(['kind', 'fontSize', 'align', 'bold'])),
        };
      }
      return {
        kind: 'rectangle',
        ...geometry(RECTANGLE_DEFAULTS),
        color: typeof raw.color === 'string' ? raw.color : RECTANGLE_DEFAULTS.color,
        title: el.kind === 'rectangle' ? asString(el.title, '') : '',
        text: asString(raw.text, ''),
        ...style(RECTANGLE_DEFAULTS),
        ...plan,
        elExtra: splitKeys(el, elKeys(['kind', 'title', 'fontSize', 'align', 'bold'])),
      };
    }
    case 'file': {
      if (typeof raw.file !== 'string') return { kind: 'unsupported', id: raw.id, raw };
      return {
        kind: 'file',
        ...geometry(FILE_DEFAULTS),
        file: raw.file,
        ...(typeof raw.subpath === 'string' ? { subpath: raw.subpath } : {}),
        ...style(FILE_DEFAULTS),
        ...plan,
        elExtra: splitKeys(el, elKeys(['fontSize', 'align', 'bold'])),
      };
    }
    case 'link': {
      if (typeof raw.url !== 'string') return { kind: 'unsupported', id: raw.id, raw };
      return { kind: 'link', ...geometry(LINK_DEFAULTS), url: raw.url, ...plan, elExtra: splitKeys(el, elKeys([])) };
    }
    default:
      return { kind: 'unsupported', id: raw.id, raw };
  }
}

function parseEdge(raw: unknown): BoardEdge | UnsupportedEdge {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.fromNode !== 'string' || typeof raw.toNode !== 'string') {
    return { kind: 'unsupported', id: isObject(raw) && typeof raw.id === 'string' ? raw.id : '', raw: isObject(raw) ? raw : { value: raw } };
  }
  const el = isObject(raw.konekton) ? raw.konekton : {};
  return {
    id: raw.id,
    fromNode: raw.fromNode,
    fromSide: asSide(raw.fromSide, 'right'),
    fromEnd: asEnd(raw.fromEnd, 'none'),
    fromOffset: clamp01(asNumber(el.fromOffset, 0.5)),
    toNode: raw.toNode,
    toSide: asSide(raw.toSide, 'left'),
    toEnd: asEnd(raw.toEnd, 'arrow'),
    toOffset: clamp01(asNumber(el.toOffset, 0.5)),
    ...(typeof raw.color === 'string' ? { color: raw.color } : {}),
    label: asString(raw.label, ''),
    extra: splitKeys(raw, EDGE_KEYS),
    elExtra: splitKeys(el, ['fromOffset', 'toOffset']),
  };
}

/** Display names of the plan types, also the name of a plan that has none. */
export const PLAN_NAMES: Record<PlanType, string> = { board: 'Board', timeline: 'Timeline' };

function parsePlan(raw: unknown): Plan | undefined {
  if (!isObject(raw) || typeof raw.id !== 'string' || (raw.type !== 'board' && raw.type !== 'timeline')) return undefined;
  const items = Array.isArray(raw.items) ? [...new Set(raw.items.filter((i): i is string => typeof i === 'string'))] : [];
  return {
    id: raw.id,
    type: raw.type,
    name: asString(raw.name, PLAN_NAMES[raw.type]),
    items,
    extra: splitKeys(raw, ['id', 'type', 'name', 'items']),
  };
}

/** Parse the text of a `.canvas` file. Never throws. */
export function parse(text: string): ParseResult {
  if (text.trim() === '') return { ok: true, doc: emptyDoc(), empty: true };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!isObject(value)) return { ok: false, error: 'The top-level value must be a JSON object.' };
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(parseNode) : [];
  const edges = Array.isArray(value.edges) ? value.edges.map(parseEdge) : [];
  // A `konekton` or `konekton.plans` of the wrong shape stays in the extra keys, so a save does not lose it.
  const own = isObject(value.konekton) ? value.konekton : {};
  const rawPlans: Json[] = Array.isArray(own.plans) ? own.plans : [];
  const plans: Plan[] = [];
  const otherPlans: Json[] = [];
  for (const raw of rawPlans) {
    const plan = parsePlan(raw);
    if (plan) plans.push(plan);
    else otherPlans.push(raw);
  }
  const konektonExtra = splitKeys(own, Array.isArray(own.plans) ? ['plans'] : []);
  const extra = splitKeys(value, ['nodes', 'edges', ...(isObject(value.konekton) ? ['konekton'] : [])]);
  return { ok: true, doc: { nodes, edges, plans, otherPlans, konektonExtra, extra }, empty: false };
}

// ---------------------------------------------------------------------------------------------
// Serialization

const round = (n: number): number => Math.round(n);

function without(extra: Extra, key: string): Extra {
  const out: Extra = { ...extra };
  delete out[key];
  return out;
}

function withExtra(known: Record<string, Json>, extra: Extra): Record<string, Json> {
  return { ...known, ...extra };
}

function planFields(n: NodeBase): Record<string, Json> {
  return { ...(n.status !== undefined ? { status: n.status } : {}), ...(n.date !== undefined ? { date: n.date } : {}) };
}

/** `elExtra` without an invalid `status` or `date` that a value set since the parse replaces. */
function nodeElExtra(n: NodeBase): Extra {
  const out: Extra = { ...n.elExtra };
  if (n.status !== undefined) delete out.status;
  if (n.date !== undefined) delete out.date;
  return out;
}

function styleFields(n: TextStyle): Record<string, Json> {
  return { fontSize: n.fontSize, align: n.align, bold: n.bold };
}

function geometryFields(n: NodeBase & { kind: BoardNode['kind'] }, type: string): Record<string, Json> {
  return {
    id: n.id,
    type,
    x: round(n.x),
    y: round(n.y),
    width: round(n.width),
    height: round(n.height),
    ...(n.color !== undefined ? { color: n.color } : {}),
  };
}

function nodeToJson(n: AnyNode): Record<string, Json> {
  switch (n.kind) {
    case 'unsupported':
      return n.raw;
    case 'sticky':
      return withExtra(
        { ...geometryFields(n, 'text'), text: n.text, konekton: withExtra({ kind: 'sticky', ...styleFields(n), ...planFields(n) }, nodeElExtra(n)) },
        n.extra,
      );
    case 'rectangle':
      return withExtra(
        {
          ...geometryFields(n, 'text'),
          text: n.text,
          konekton: withExtra({ kind: 'rectangle', title: n.title, ...styleFields(n), ...planFields(n) }, nodeElExtra(n)),
        },
        n.extra,
      );
    case 'file':
      return withExtra(
        {
          ...geometryFields(n, 'file'),
          file: n.file,
          ...(n.subpath !== undefined ? { subpath: n.subpath } : {}),
          konekton: withExtra({ ...styleFields(n), ...planFields(n) }, nodeElExtra(n)),
        },
        n.extra,
      );
    case 'link': {
      const base = { ...geometryFields(n, 'link'), url: n.url };
      const own = withExtra(planFields(n), nodeElExtra(n));
      const el = Object.keys(own).length > 0 ? { konekton: own } : {};
      return withExtra({ ...base, ...el }, n.extra);
    }
  }
}

function edgeToJson(e: BoardEdge | UnsupportedEdge): Record<string, Json> {
  if (!isBoardEdge(e)) return e.raw;
  return withExtra(
    {
      id: e.id,
      fromNode: e.fromNode,
      fromSide: e.fromSide,
      fromEnd: e.fromEnd,
      toNode: e.toNode,
      toSide: e.toSide,
      toEnd: e.toEnd,
      ...(e.color !== undefined ? { color: e.color } : {}),
      ...(e.label !== '' ? { label: e.label } : {}),
      konekton: withExtra({ fromOffset: e.fromOffset, toOffset: e.toOffset }, e.elExtra),
    },
    e.extra,
  );
}

function planToJson(p: Plan): Record<string, Json> {
  return withExtra({ id: p.id, type: p.type, name: p.name, items: p.items }, p.extra);
}

export function serialize(doc: CanvasDoc): string {
  const plans = [...doc.plans.map(planToJson), ...doc.otherPlans];
  const hasOwn = plans.length > 0 || Object.keys(doc.konektonExtra).length > 0;
  // Real plans replace a `plans` value of the wrong shape, and our `konekton` object replaces one in `extra`.
  const konektonExtra = plans.length > 0 ? without(doc.konektonExtra, 'plans') : doc.konektonExtra;
  const own = hasOwn ? { konekton: withExtra(plans.length > 0 ? { version: 1, plans } : {}, konektonExtra) } : {};
  const extra = hasOwn ? without(doc.extra, 'konekton') : doc.extra;
  const json = { nodes: doc.nodes.map(nodeToJson), edges: doc.edges.map(edgeToJson), ...own, ...extra };
  return JSON.stringify(json, null, 2) + '\n';
}

// ---------------------------------------------------------------------------------------------
// Small helpers shared by the webview store and tests

/** Visible nodes (everything except unsupported ones). */
export function boardNodes(doc: CanvasDoc): BoardNode[] {
  return doc.nodes.filter(isBoardNode);
}

/** Edges that can be drawn: both ends are visible nodes. */
export function drawableEdges(doc: CanvasDoc): BoardEdge[] {
  const ids = new Set(boardNodes(doc).map((n) => n.id));
  return doc.edges.filter(isBoardEdge).filter((e) => ids.has(e.fromNode) && ids.has(e.toNode));
}

export const TEXT_FILE_EXTENSIONS = ['.md', '.txt', '.json'] as const;

export function isTextFilePath(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
