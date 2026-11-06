import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Scene } from '../src/scene/types.ts';
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';
import type { Px } from '../src/overlay/diagram-layout.ts';
import { emptyFrame, planStep, settle } from '../src/overlay/timeline.ts';

/** Record the actual rounded rectangles painted by DiagramPainter, not its intended layout. */
function canvasGeometry() {
  const nodes: Px[] = [], labels: Px[] = [];
  const edges: Array<Array<{ x: number; y: number }>> = [];
  let points: Array<{ x: number; y: number }> = [];
  const state: Record<string, unknown> = { font: '10px sans-serif' };
  const stack: Array<Record<string, unknown>> = [];
  let corners: number[][] = [];
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'save') return () => stack.push({ ...t });
      if (k === 'restore') return () => Object.assign(t, stack.pop());
      if (k === 'beginPath') return () => { corners = []; points = []; };
      if (k === 'moveTo' || k === 'lineTo') return (x: number, y: number) => points.push({ x, y });
      if (k === 'stroke') return () => { if (t.lineWidth === 2.3) edges.push([...points]); };
      if (k === 'arcTo') return (...args: number[]) => corners.push(args);
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * Number(/([\d.]+)px/.exec(String(t.font))?.[1] ?? 10) * 0.52 });
      if (k === 'fill') return () => {
        if (corners.length !== 4) return;
        const [a, b, c] = corners as [number[], number[], number[], number[]];
        const box = { x: c[0]!, y: a[1]!, w: a[0]! - c[0]!, h: b[1]! - a[1]! };
        if (t.fillStyle === 'rgba(14,19,31,0.9)') nodes.push(box);
        if (t.fillStyle === 'rgba(19,25,39,0.97)') labels.push(box);
      };
      return k in t ? t[k] : () => undefined;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, nodes, labels, edges, clear() { nodes.length = labels.length = edges.length = 0; } };
}

const overlaps = (a: Px, b: Px): boolean =>
  Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.5 &&
  Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.5;

const sample = JSON.parse(readFileSync(new URL('../samples/scenes/diagram-flow.json', import.meta.url), 'utf8')) as Scene;
const chain = settle(planStep(emptyFrame(), sample.steps[0]!));
const loop = settle(planStep(chain, sample.steps[1]!));

for (const [name, from, to] of [['adding a return edge', chain, loop], ['removing a return edge', loop, chain]] as const) {
  for (const [width, height] of [[800, 600], [960, 640], [1280, 800]] as const) {
    test(`flow reflow keeps labels and arrows clear of nodes when ${name} at ${width}x${height}`, () => {
      const g = canvasGeometry(), painter = new DiagramPainter();
      const view = { width, height, dpr: 1 };
      painter.draw(g.ctx, from.diagrams, view, 0);
      for (let frame = 1; frame <= 45; frame++) {
        g.clear();
        painter.draw(g.ctx, to.diagrams, view, frame * 1000 / 30);
        assert.equal(g.nodes.length, 4, 'all nodes remain visible');
        assert.equal(g.labels.length, to === loop ? 4 : 3, 'all edge labels remain visible');
        assert.equal(g.edges.length, g.labels.length, 'all arrows remain visible');
        for (const edge of g.edges) for (const p of edge) for (const b of g.nodes) assert.ok(!(p.x > b.x + 1 && p.x < b.x + b.w - 1 && p.y > b.y + 1 && p.y < b.y + b.h - 1), `arrow crosses a node at frame ${frame}`);
        for (let i = 0; i < g.labels.length; i++) for (let j = i + 1; j < g.labels.length; j++) assert.ok(!overlaps(g.labels[i]!, g.labels[j]!), `labels overlap at frame ${frame}`);
        for (const label of g.labels) for (const node of g.nodes) assert.ok(!overlaps(label, node), `label covers a node at frame ${frame}`);
        for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) assert.ok(!overlaps(g.nodes[i]!, g.nodes[j]!), `nodes overlap at frame ${frame}`);
      }
    });
  }
}

test('adding a node that changes the wrapped row width does not mix old and new row assignments', () => {
  const make = (count: number) => settle(planStep(emptyFrame(), {
    say: 'A sequence', actions: [
      { op: 'diagram', id: 'sequence', kind: 'flow', x: 100, y: 100, w: 420, h: 450 },
      ...Array.from({ length: count }, (_, i) => ({ op: 'node', id: `n${i}`, of: 'sequence', text: `Step ${i + 1}` })),
      ...Array.from({ length: count - 1 }, (_, i) => ({ op: 'edge', id: `e${i}`, from: `n${i}`, to: `n${i + 1}` })),
    ],
  } as Scene['steps'][number]));
  const g = canvasGeometry(), painter = new DiagramPainter();
  const view = { width: 960, height: 640, dpr: 1 };
  painter.draw(g.ctx, make(6).diagrams, view, 0);
  const next = make(7);
  for (let frame = 1; frame <= 45; frame++) {
    g.clear();
    painter.draw(g.ctx, next.diagrams, view, frame * 1000 / 30);
    assert.equal(g.nodes.length, 7);
    for (let i = 0; i < g.nodes.length; i++) for (let j = i + 1; j < g.nodes.length; j++) assert.ok(!overlaps(g.nodes[i]!, g.nodes[j]!), `nodes ${i}/${j} overlap at frame ${frame}`);
  }
});
