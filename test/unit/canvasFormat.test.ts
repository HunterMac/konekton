import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  boardNodes,
  darken,
  drawableEdges,
  emptyDoc,
  isBoardEdge,
  newId,
  parse,
  resolveColor,
  serialize,
  type CanvasDoc,
  type RectangleNode,
} from '../../src/shared/canvasFormat';

const fixture = (name: string) => readFileSync(join(__dirname, '..', 'fixtures', name), 'utf8');

function parseOk(text: string): CanvasDoc {
  const r = parse(text);
  if (!r.ok) throw new Error(r.error);
  return r.doc;
}

describe('canvasFormat', () => {
  it('round-trips our own file to identical text', () => {
    const text = fixture('sample.canvas');
    expect(serialize(parseOk(text))).toBe(text);
  });

  it('parses all four node kinds', () => {
    const doc = parseOk(fixture('sample.canvas'));
    expect(boardNodes(doc).map((n) => n.kind)).toEqual(['sticky', 'rectangle', 'file', 'link', 'file', 'file']);
  });

  it('keeps groups, unknown fields and edges to groups (Obsidian file)', () => {
    const doc = parseOk(fixture('obsidian.canvas'));
    expect(doc.nodes[0].kind).toBe('unsupported');
    expect(boardNodes(doc)).toHaveLength(3);
    // The edge to the group is kept but not drawable.
    expect(doc.edges).toHaveLength(2);
    expect(drawableEdges(doc).map((e) => e.id)).toEqual(['e1']);

    const out = JSON.parse(serialize(doc));
    expect(out.nodes.map((n: { id: string }) => n.id)).toEqual(['g1', 'n1', 'n2', 'n3']);
    expect(out.nodes[0]).toEqual({ id: 'g1', type: 'group', x: -40, y: -40, width: 600, height: 400, label: 'Cluster', color: '4' });
    expect(out.nodes[1].customKey).toEqual({ a: 1 });
    expect(out.nodes[2].subpath).toBe('#heading');
    expect(out.edges[1].color).toBe('2');
    expect(out.metadata).toEqual({ version: '1.0-1.0' });
  });

  it('loads a text node without konekton.kind as a rectangle with empty title', () => {
    const doc = parseOk(fixture('obsidian.canvas'));
    const n1 = doc.nodes[1] as RectangleNode;
    expect(n1.kind).toBe('rectangle');
    expect(n1.title).toBe('');
    expect(n1.fontSize).toBe(14);
    expect(n1.align).toBe('left');
    expect(n1.color).toBe('#FFFFFF');
  });

  it('applies defaults for missing konekton fields on edges', () => {
    const doc = parseOk(fixture('obsidian.canvas'));
    const e1 = doc.edges[0];
    if (!isBoardEdge(e1)) throw new Error('expected board edge');
    expect(e1.fromEnd).toBe('none');
    expect(e1.toEnd).toBe('arrow');
    expect(e1.fromOffset).toBe(0.5);
    expect(e1.toOffset).toBe(0.5);
    const e2 = doc.edges[1];
    if (!isBoardEdge(e2)) throw new Error('expected board edge');
    expect(e2.toEnd).toBe('none');
  });

  it('rounds geometry to integers on save', () => {
    const doc = parseOk(fixture('sample.canvas'));
    const n = doc.nodes[0];
    if (n.kind === 'unsupported') throw new Error();
    n.x = 10.4;
    n.y = -3.5;
    n.width = 199.6;
    const out = JSON.parse(serialize(doc));
    expect(out.nodes[0]).toMatchObject({ x: 10, y: -3, width: 200 });
  });

  it('writes node keys in the documented order', () => {
    const doc = parseOk(fixture('sample.canvas'));
    const out = JSON.parse(serialize(doc));
    expect(Object.keys(out.nodes[0])).toEqual(['id', 'type', 'x', 'y', 'width', 'height', 'color', 'text', 'konekton']);
    expect(Object.keys(out.edges[0])).toEqual(['id', 'fromNode', 'fromSide', 'fromEnd', 'toNode', 'toSide', 'toEnd', 'label', 'konekton']);
  });

  it('omits an empty label', () => {
    const doc = parseOk(fixture('sample.canvas'));
    const e = doc.edges[0];
    if (!isBoardEdge(e)) throw new Error();
    e.label = '';
    expect(JSON.parse(serialize(doc)).edges[0]).not.toHaveProperty('label');
  });

  it('loads an empty or whitespace file as an empty board', () => {
    for (const text of ['', '  \n\t']) {
      const r = parse(text);
      expect(r).toMatchObject({ ok: true, empty: true });
    }
    expect(serialize(emptyDoc())).toBe('{\n  "nodes": [],\n  "edges": []\n}\n');
  });

  it('reports invalid JSON instead of throwing it away', () => {
    const r = parse('{ "nodes": [');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    expect(parse('[1,2]').ok).toBe(false);
  });

  it('keeps malformed edges verbatim', () => {
    const doc = parseOk('{"nodes":[],"edges":[{"id":"x"},42]}');
    expect(doc.edges).toHaveLength(2);
    expect(JSON.parse(serialize(doc)).edges).toEqual([{ id: 'x' }, { value: 42 }]);
  });

  it('generates 16 lowercase hex ids', () => {
    const ids = new Set(Array.from({ length: 50 }, newId));
    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('resolves palette and foreign colors', () => {
    expect(resolveColor('3')).toEqual({ fill: '#FFF9B1', border: '#E6C700' });
    expect(resolveColor('#ffffff')).toEqual({ fill: '#FFFFFF', border: '#C4C4C4' });
    expect(resolveColor('#808080')).toEqual({ fill: '#808080', border: darken('#808080', 0.25) });
    expect(darken('#808080', 0.25)).toBe('#606060');
    expect(resolveColor(undefined)).toBeUndefined();
  });

  describe('plans', () => {
    it('round-trips a file with plans, status and date to identical text', () => {
      const text = fixture('plans.canvas');
      expect(serialize(parseOk(text))).toBe(text);
    });

    it('parses plans, status and date', () => {
      const doc = parseOk(fixture('plans.canvas'));
      expect(doc.plans.map((p) => [p.id, p.type, p.items])).toEqual([
        ['p1', 'board', ['n1', 'n2']],
        ['p2', 'timeline', ['n1']],
      ]);
      expect(doc.plans[0].extra).toEqual({ future: true });
      expect(doc.konektonExtra).toEqual({ version: 1, other: { a: 1 } });
      const [n1, n2] = boardNodes(doc);
      expect(n1).toMatchObject({ status: 'inProgress', date: '2026-11-03' });
      expect(n2).toMatchObject({ status: 'done' });
      expect(n2.date).toBeUndefined();
    });

    it('writes no top-level konekton key for a file without plans', () => {
      const out = JSON.parse(serialize(parseOk(fixture('sample.canvas'))));
      expect(out).not.toHaveProperty('konekton');
      expect(Object.keys(out)).toEqual(['nodes', 'edges']);
    });

    it('writes konekton after edges and before other keys', () => {
      const doc = parseOk(fixture('plans.canvas'));
      doc.extra = { metadata: 1 };
      expect(Object.keys(JSON.parse(serialize(doc)))).toEqual(['nodes', 'edges', 'konekton', 'metadata']);
    });

    it('skips invalid plans and cleans up items', () => {
      const doc = parseOk(
        JSON.stringify({
          nodes: [],
          edges: [],
          konekton: { plans: [{ id: 1, type: 'board' }, { id: 'a', type: 'nope' }, 7, { id: 'ok', type: 'timeline', items: ['x', 'x', 3, 'y'] }] },
        }),
      );
      expect(doc.plans).toHaveLength(1);
      expect(doc.plans[0]).toMatchObject({ id: 'ok', name: 'Timeline', items: ['x', 'y'] });
    });

    it('keeps plan data it does not understand through a save', () => {
      const unknownPlans = [{ id: 'l', type: 'list', items: ['a'] }, 7];
      const mixed = parseOk(JSON.stringify({ nodes: [], edges: [], konekton: { plans: [{ id: 'b', type: 'board' }, ...unknownPlans] } }));
      expect(mixed.plans.map((p) => p.id)).toEqual(['b']);
      expect(JSON.parse(serialize(mixed)).konekton.plans.slice(1)).toEqual(unknownPlans);

      const onlyUnknown = parseOk(JSON.stringify({ nodes: [], edges: [], konekton: { plans: unknownPlans } }));
      expect(JSON.parse(serialize(onlyUnknown)).konekton.plans).toEqual(unknownPlans);

      const notArray = parseOk(JSON.stringify({ nodes: [], edges: [], konekton: { plans: 'later' } }));
      expect(JSON.parse(serialize(notArray)).konekton).toEqual({ plans: 'later' });

      const notObject = parseOk(JSON.stringify({ nodes: [], edges: [], konekton: 'v2' }));
      expect(JSON.parse(serialize(notObject)).konekton).toBe('v2');
      notObject.plans = [{ id: 'b', type: 'board', name: 'Board', items: [], extra: {} }];
      expect(JSON.parse(serialize(notObject)).konekton.plans).toHaveLength(1);
    });

    it('keeps ids of missing nodes in plans', () => {
      const doc = parseOk(JSON.stringify({ nodes: [], edges: [], konekton: { plans: [{ id: 'a', type: 'board', items: ['gone'] }] } }));
      expect(doc.plans[0].items).toEqual(['gone']);
    });

    it('keeps invalid status and date values through a save', () => {
      const text = JSON.stringify({
        nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 200, height: 200, color: '3', text: '', konekton: { kind: 'sticky', fontSize: 18, align: 'center', bold: false, status: 'nope', date: '2026-02-30' } }],
        edges: [],
      });
      const doc = parseOk(text);
      const n = boardNodes(doc)[0];
      expect(n.status).toBeUndefined();
      expect(n.date).toBeUndefined();
      const out = JSON.parse(serialize(doc));
      expect(out.nodes[0].konekton).toMatchObject({ status: 'nope', date: '2026-02-30' });

      n.status = 'done';
      n.date = '2026-03-01';
      const fixed = parseOk(serialize(doc));
      expect(boardNodes(fixed)[0]).toMatchObject({ status: 'done', date: '2026-03-01' });
    });

    it('writes a konekton field for a link with only a status', () => {
      const doc = parseOk(JSON.stringify({ nodes: [{ id: 'l', type: 'link', x: 0, y: 0, width: 280, height: 60, url: 'https://a.b' }], edges: [] }));
      expect(JSON.parse(serialize(doc)).nodes[0]).not.toHaveProperty('konekton');
      const link = boardNodes(doc)[0];
      link.status = 'done';
      expect(JSON.parse(serialize(doc)).nodes[0].konekton).toEqual({ status: 'done' });
    });
  });
});
