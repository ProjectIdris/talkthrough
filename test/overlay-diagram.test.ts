import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Step } from '../src/scene/index.ts';
import { validateScene } from '../src/scene/index.ts';
import { DIAGRAM_APPEAR_SECONDS, TICK_SECONDS, diagramTimes } from '../src/overlay/diagram-plan.ts';
import { bezierPoints, chartLayout, chartRanges, flowGrowth, flowLayers, flowLayout, flowReadable, formatTick, niceTicks, stepsLayout, timelineFractions, timelineLayout } from '../src/overlay/diagram-layout.ts';
import type { Px } from '../src/overlay/diagram-layout.ts';
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';
import { fadeFrame } from '../src/overlay/fade.ts';
import { Placer, followDiagram, imageCardHeight, insideAny, labelUnits, ownedByDiagram, ownedMarkIds, pageGrid, placeAction, reserveMarks, splitOwned } from '../src/overlay/placement.ts';
import { emptyFrame, evaluate, planStep, settle } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const flow = (extra: object = {}) => ({ op: 'diagram', id: 'f', kind: 'flow', x: 500, y: 100, w: 400, h: 400, ...extra });
const node = (id: string, extra: object = {}) => ({ op: 'node', id, of: 'f', text: id.toUpperCase(), ...extra });
const edge = (id: string, from: string, to: string, extra: object = {}) => ({ op: 'edge', id, from, to, ...extra });
const items = (f: Frame, diagram = 'f') => f.diagrams.find((d) => d.id === diagram)?.items ?? [];
const item = (f: Frame, id: string, diagram = 'f') => items(f, diagram).find((i) => i.id === id);
const overlap = (a: Px, b: Px) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.5 && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.5;

// ---- Layout ----------------------------------------------------------------------------------------

test('flow layers: the longest way from what nothing points at; a loop back is left out instead of looping for ever', () => {
  const chain = flowLayers(['a', 'b', 'c'], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'c' }]);
  assert.deepEqual([...chain.values()], [0, 1, 2]);
  const diamond = flowLayers(['a', 'b', 'c', 'd'], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'a', to: 'c' }, { id: '3', from: 'b', to: 'd' }, { id: '4', from: 'c', to: 'd' }, { id: '5', from: 'a', to: 'd' }]);
  assert.deepEqual([...diamond.values()], [0, 1, 1, 2], 'a long edge does not pull d back');
  const loop = flowLayers(['a', 'b', 'c'], [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'c' }, { id: '3', from: 'c', to: 'a' }]);
  assert.deepEqual([...loop.values()], [0, 1, 2]);
  assert.deepEqual([...flowLayers(['a'], [{ id: '1', from: 'a', to: 'a' }, { id: '2', from: 'a', to: 'zzz' }]).values()], [0]);
});

const opts = { maxBox: { w: 220, h: 64 }, pad: 12 };
test('a flow lays out inside its area with no node on another, runs along the longer side, and leaves room for an edge label', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const edges = [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'a', to: 'c' }, { id: '3', from: 'b', to: 'd' }, { id: '4', from: 'c', to: 'd' }, { id: '5', from: 'd', to: 'e' }];
  const wide: Px = { x: 100, y: 50, w: 900, h: 300 };
  const lay = flowLayout(ids, edges, wide, opts);
  assert.equal(lay.dir, 'right');
  assert.equal(lay.layers, 4);
  const boxes = [...lay.nodes.values()];
  assert.equal(boxes.length, 5);
  for (const b of boxes) assert.ok(b.x >= wide.x && b.y >= wide.y && b.x + b.w <= wide.x + wide.w && b.y + b.h <= wide.y + wide.h, JSON.stringify(b));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i]!, boxes[j]!), `${i} ${j}`);
  assert.ok(lay.nodes.get('a')!.x < lay.nodes.get('b')!.x && lay.nodes.get('b')!.x < lay.nodes.get('d')!.x, 'the arrows run left to right');
  assert.equal(lay.edges.size, 5);
  const tall = flowLayout(ids, edges, { x: 0, y: 0, w: 260, h: 700 }, opts);
  assert.equal(tall.dir, 'down');
  assert.ok(tall.nodes.get('a')!.y < tall.nodes.get('d')!.y);
  // With a label on the arrows the gap between layers is at least as wide as the label.
  const chain = [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'b', to: 'c' }];
  const labelled = flowLayout(['a', 'b', 'c'], chain, { x: 0, y: 0, w: 420, h: 150 }, { ...opts, labelW: 90, labelH: 24 });
  assert.equal(labelled.dir, 'right');
  const gap = labelled.nodes.get('b')!.x - (labelled.nodes.get('a')!.x + labelled.nodes.get('a')!.w);
  assert.ok(gap >= 90, `gap ${gap}`);
  // Deterministic: the same pieces give the same layout.
  assert.deepEqual([...flowLayout(ids, edges, wide, opts).nodes], [...lay.nodes]);
});

test('nodes nothing joins yet stand in a row, so a flow that is still arriving grows along it', () => {
  const lay = flowLayout(['a', 'b', 'c'], [], { x: 0, y: 0, w: 600, h: 200 }, opts);
  assert.equal(lay.layers, 3);
  assert.ok(lay.nodes.get('a')!.x < lay.nodes.get('b')!.x && lay.nodes.get('b')!.x < lay.nodes.get('c')!.x);
  assert.equal(flowLayout([], [], { x: 0, y: 0, w: 10, h: 10 }, opts).nodes.size, 0);
});

test('timeline: events fall to scale when all have a pos, else evenly in the order written; labels never overlap and stay inside', () => {
  near(timelineFractions([{ id: 'a', pos: 0 }, { id: 'b', pos: 10 }, { id: 'c', pos: 100 }])[1], 0.07 + 0.86 * 0.1);
  assert.deepEqual(timelineFractions([{ id: 'a' }, { id: 'b', pos: 5 }, { id: 'c' }]).map((v) => Math.round(v * 100)), [7, 50, 93]);
  assert.deepEqual(timelineFractions([{ id: 'a' }]), [0.5]);
  const ev = ['a', 'b', 'c', 'd', 'e'].map((id, i) => ({ id, pos: [263, 268, 269, 271, 287][i]! }));
  const area: Px = { x: 0, y: 0, w: 800, h: 300 };
  const lay = timelineLayout(ev, area, 12, () => ({ w: 110, h: 40 }));
  assert.equal(lay.horizontal, true);
  const rects = ev.map((e) => lay.events.get(e.id)!.rect);
  for (let i = 0; i < rects.length; i++) {
    assert.ok(rects[i]!.x >= 0 && rects[i]!.x + rects[i]!.w <= 800 && rects[i]!.y >= 0 && rects[i]!.y + rects[i]!.h <= 300, JSON.stringify(rects[i]));
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlap(rects[i]!, rects[j]!), `labels ${i} and ${j} overlap`);
  }
  assert.equal(lay.overflow, false);
  // Too much for the room: it says so (the drawing then makes the text smaller).
  assert.equal(timelineLayout(ev, { x: 0, y: 0, w: 800, h: 90 }, 12, () => ({ w: 150, h: 46 })).overflow, true);
  assert.equal(timelineLayout(ev, { x: 0, y: 0, w: 800, h: 160 }, 12, () => ({ w: 150, h: 46 })).overflow, true, 'five labels that cannot all clear each other say so');
  // A tall area puts the events down a vertical axis with their labels to the right, none over another.
  const tall = timelineLayout(ev, { x: 0, y: 0, w: 260, h: 520 }, 12, () => ({ w: 150, h: 60 }));
  assert.equal(tall.horizontal, false);
  const rows = ev.map((e) => tall.events.get(e.id)!.rect);
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i]!.y >= rows[i - 1]!.y + rows[i - 1]!.h, `row ${i}`);
});

test('steps are rows down the area, as tall as the room allows up to a limit', () => {
  const s = stepsLayout(4, { x: 10, y: 20, w: 300, h: 400 }, 10, 60);
  assert.equal(s.rows.length, 4);
  assert.equal(s.rowH, 60);
  assert.equal(stepsLayout(10, { x: 0, y: 0, w: 300, h: 400 }, 10, 60).rowH, 38);
  assert.equal(stepsLayout(0, { x: 0, y: 0, w: 1, h: 1 }, 0, 60).rows.length, 0);
});

test('a chart: round tick values, ranges from the data or as given, and a map from chart units that keeps the ends of the axes on the plot', () => {
  assert.deepEqual(niceTicks(0, 10, 5).ticks, [0, 2, 4, 6, 8, 10]);
  assert.deepEqual(niceTicks(0, 1, 5).ticks, [0, 0.2, 0.4, 0.6, 0.8, 1]);
  assert.ok(niceTicks(3, 3).ticks.length >= 2, 'no range is widened, not divided by zero');
  const r = chartRanges({ series: [{ pts: [[1, 20], [9, 90]] }], dots: [] });
  assert.ok(r.y[0] === 0 && r.y[1] > 90 && r.x[0] < 1 && r.x[1] > 9, JSON.stringify(r));
  assert.deepEqual(chartRanges({ series: [], dots: [], xrange: [0, 10], yrange: [0, 5] }), { x: [0, 10], y: [0, 5] });
  const area: Px = { x: 100, y: 50, w: 400, h: 300 };
  const lay = chartLayout({ series: [], dots: [], xrange: [0, 10], yrange: [0, 10] }, area, { left: 40, bottom: 30, top: 8, right: 20 });
  assert.deepEqual(lay.plot, { x: 140, y: 58, w: 340, h: 262 });
  assert.deepEqual(lay.toPx(0, 0), { x: 140, y: 320 });
  assert.deepEqual(lay.toPx(10, 10), { x: 480, y: 58 });
  assert.deepEqual(lay.xTicks.map((t) => t.v), [0, 5, 10], 'about one tick to every 90 pixels');
});

test('tick labels preserve familiar scales, signs and large values while rounding floating step noise', () => {
  assert.deepEqual([0, 2, 4, 6, 8, 10].map((v) => formatTick(v, 2)), ['0', '2', '4', '6', '8', '10']);
  assert.deepEqual([0, 0.2, 0.4, 0.6, 0.8, 1].map((v) => formatTick(v, 0.2)), ['0', '0.2', '0.4', '0.6', '0.8', '1']);
  assert.deepEqual([-1, -0.5, 0, 0.5, 1].map((v) => formatTick(v, 0.5)), ['-1', '-0.5', '0', '0.5', '1']);
  assert.equal(formatTick(-0, 0.2), '0', 'negative zero is written once as zero');
  assert.equal(formatTick(-1e-16, 0.1), '0', 'rounding noise near zero does not leave a minus sign');
  assert.equal(formatTick(0.6, 0.2), '0.6', 'a decimal tick is rounded without exposing binary float noise');
  assert.equal(formatTick(10_050, 50), '10.05k', 'large values keep enough precision for their actual step');
  assert.equal(formatTick(-15_000, 1_000), '-15k', 'large negative values retain their sign');
  assert.equal(formatTick(1e-12, 1e-13), '1e-12', 'very small labels use compact exponent form when it is shorter');
});

test('chart ticks stay distinct and numeric through the painter at tiny and offset scales', () => {
  const render = (range: readonly [number, number], w: number, h: number) => {
    const chart = { op: 'diagram', id: 'scale', kind: 'chart', x: 80, y: 80, w, h, xrange: range, yrange: range };
    const series = { op: 'series', id: 'samples', of: 'scale', pts: [[range[0], range[0]], [range[1], range[1]]] };
    const validated = validateScene({ steps: [{ say: 'Scale', actions: [chart, series] }] });
    assert.equal(validated.ok, true, `${JSON.stringify(range)} is within the accepted chart domain: ${JSON.stringify(validated.issues)}`);
    assert.deepEqual(validated.issues, [], 'the test data is accepted without clamping or repair');
    assert.deepEqual(validated.scene?.steps[0]?.actions[0], chart, 'the validator preserves the requested axis values');
    assert.deepEqual(validated.scene?.steps[0]?.actions[1], series, 'the validator preserves the chart samples');

    const frame = settle(planStep(emptyFrame(), validated.scene!.steps[0]!));
    const drawn: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];
    type Segment = { from: { x: number; y: number }; to: { x: number; y: number } };
    const strokes: Segment[][] = [];
    let path: Segment[] = [];
    let last: { x: number; y: number } | undefined;
    const state: Record<string, unknown> = { font: '10px x' };
    const ctx = new Proxy(state, {
      get(t, k: string) {
        if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
        if (k === 'measureText') return (text: string) => ({ width: text.length * 7 });
        if (k === 'beginPath') return () => { path = []; last = undefined; };
        if (k === 'moveTo') return (x: number, y: number) => { last = { x, y }; };
        if (k === 'lineTo') return (x: number, y: number) => {
          const next = { x, y };
          if (last) path.push({ from: last, to: next });
          last = next;
        };
        if (k === 'stroke') return () => strokes.push(path);
        if (k === 'fillText') return (text: string, x: number, y: number) => {
          const fontPx = Number(/([\d.]+)px/.exec(String(t.font))?.[1] ?? 10);
          drawn.push({ text, x, y, width: text.length * 7, height: fontPx * 1.2 });
        };
        if (k in t) return t[k];
        return () => undefined;
      },
      set(t, k: string, v) { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    new DiagramPainter().draw(ctx, frame.diagrams, { width: 1000, height: 800, dpr: 1 }, 0);

    // The painter emits y ticks first, then x ticks. The latter share one baseline;
    // no title, series labels, or axis captions are present in this fixture.
    const rows = new Map<number, typeof drawn>();
    for (const label of drawn) rows.set(label.y, [...(rows.get(label.y) ?? []), label]);
    const xTicks = [...rows.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const yTicks = drawn.filter((label) => !xTicks.includes(label));
    const numberValue = (text: string) => text.endsWith('k') ? Number(text.slice(0, -1)) * 1000 : Number(text);
    const grid = strokes.find((segments) => segments.length >= 4 && segments.some(({ from, to }) => from.x === to.x) && segments.some(({ from, to }) => from.y === to.y)) ?? [];
    const axis = strokes.find((segments) => segments.length === 2 && segments.some(({ from, to }) => from.x === to.x) && segments.some(({ from, to }) => from.y === to.y));
    assert.ok(axis, 'the painter drew the chart axes');
    const verticalAxis = axis!.find(({ from, to }) => from.x === to.x)!;
    const horizontalAxis = axis!.find(({ from, to }) => from.y === to.y)!;
    const plotLeft = verticalAxis.from.x;
    const plotTop = Math.min(verticalAxis.from.y, verticalAxis.to.y);
    const plotBottom = Math.max(verticalAxis.from.y, verticalAxis.to.y);
    const plotRight = Math.max(horizontalAxis.from.x, horizontalAxis.to.x);
    const verticalGrid = grid.filter(({ from, to }) => from.x === to.x).map(({ from }) => from.x);
    const horizontalGrid = grid.filter(({ from, to }) => from.y === to.y).map(({ from }) => from.y);
    for (const [axis, labels] of [['x', xTicks], ['y', yTicks]] as const) {
      assert.ok(labels.length >= 2, `${axis} axis has multiple drawn tick labels`);
      assert.equal(new Set(labels.map(({ text }) => text)).size, labels.length, `${axis} ticks remain distinguishable: ${labels.map(({ text }) => text).join(', ')}`);
      const values = labels.map(({ text }) => numberValue(text));
      assert.ok(values.every((value) => Number.isFinite(value) && value >= range[0] && value <= range[1]), `${axis} labels still report values in ${range[0]}..${range[1]}: ${values.join(', ')}`);
      const ordered = [...values].sort((a, b) => a - b);
      for (let i = 1; i < ordered.length; i++) assert.ok(ordered[i]! > ordered[i - 1]!, `${axis} values remain ordered and distinct`);
    }
    for (const label of xTicks) {
      const center = label.x + label.width / 2;
      const gridX = verticalGrid.reduce((best, current) => Math.abs(current - center) < Math.abs(best - center) ? current : best, verticalGrid[0]!);
      assert.ok(Math.abs(gridX - center) < 1e-6, `x label ${label.text} is centered at its drawn tick`);
      const expected = range[0] + ((gridX - plotLeft) / (plotRight - plotLeft)) * (range[1] - range[0]);
      assert.ok(Math.abs(numberValue(label.text) - expected) <= Math.max(1e-12, Math.abs(range[1] - range[0]) * 1e-8), `x label ${label.text} matches its plotted data value ${expected}`);
    }
    for (const label of yTicks) {
      const gridY = horizontalGrid.reduce((best, current) => Math.abs(current - label.y) < Math.abs(best - label.y) ? current : best, horizontalGrid[0]!);
      assert.ok(Math.abs(gridY - label.y) < 1e-6, `y label ${label.text} aligns with its drawn tick`);
      const expected = range[1] - ((gridY - plotTop) / (plotBottom - plotTop)) * (range[1] - range[0]);
      assert.ok(Math.abs(numberValue(label.text) - expected) <= Math.max(1e-12, Math.abs(range[1] - range[0]) * 1e-8), `y label ${label.text} matches its plotted data value ${expected}`);
    }
    const card = { x: 80, y: 64, w, h: h * 0.8 };
    assert.ok(drawn.every(({ x, width }) => x >= card.x && x + width <= card.x + card.w), `tick labels fit the ${w}x${h} chart card`);
    const horizontal = [...xTicks].sort((a, b) => a.x - b.x);
    for (let i = 1; i < horizontal.length; i++) assert.ok(horizontal[i - 1]!.x + horizontal[i - 1]!.width <= horizontal[i]!.x + 0.5, `x tick labels do not overlap: ${horizontal[i - 1]!.text}, ${horizontal[i]!.text}`);
    const vertical = [...yTicks].sort((a, b) => a.y - b.y);
    for (let i = 1; i < vertical.length; i++) assert.ok(vertical[i]!.y - vertical[i - 1]!.y >= (vertical[i]!.height + vertical[i - 1]!.height) / 2 - 0.5, `y tick labels do not overlap: ${vertical[i - 1]!.text}, ${vertical[i]!.text}`);
    return { xTicks: xTicks.map(({ text }) => text), yTicks: yTicks.map(({ text }) => text) };
  };

  for (const size of [{ w: 420, h: 350 }, { w: 520, h: 425 }]) {
    for (const range of [[0, 0.001], [100.1, 100.4], [-1, 1], [10_000, 10_500]] as const) {
      const ticks = render(range, size.w, size.h);
      assert.ok(ticks.xTicks.length >= 2 && ticks.yTicks.length >= 2);
    }
  }
});

test('supply and demand curves keep their values and equilibrium fixed as pieces arrive at two sizes', () => {
  const demand = { pts: [[0, 100], [25, 75], [50, 50], [75, 25], [100, 0]] as Array<[number, number]> };
  const supply = { pts: [[0, 0], [25, 25], [50, 50], [75, 75], [100, 100]] as Array<[number, number]> };
  const stages = [
    { series: [demand], dots: [] },
    { series: [demand, supply], dots: [] },
    { series: [demand, supply], dots: [{ x: 50, y: 50 }] },
  ];
  for (const area of [{ x: 0, y: 0, w: 420, h: 280 }, { x: 0, y: 0, w: 520, h: 340 }]) {
    const layouts = stages.map((stage) => chartLayout({ ...stage, xrange: [0, 100], yrange: [0, 100] }, area, { left: 66, bottom: 60, top: 18, right: 96 }));
    for (const next of layouts.slice(1)) {
      assert.deepEqual(next.plot, layouts[0]!.plot);
      assert.deepEqual(next.xTicks, layouts[0]!.xTicks);
      assert.deepEqual(next.yTicks, layouts[0]!.yTicks);
      assert.deepEqual(next.toPx(50, 50), layouts[0]!.toPx(50, 50), 'the equilibrium coordinate does not jump');
    }
    const demandCross = layouts[2]!.toPx(...demand.pts[2]!);
    const supplyCross = layouts[2]!.toPx(...supply.pts[2]!);
    const equilibriumDot = layouts[2]!.toPx(stages[2]!.dots[0]!.x, stages[2]!.dots[0]!.y);
    assert.deepEqual(demandCross, supplyCross);
    assert.deepEqual(equilibriumDot, demandCross, 'the equilibrium dot is at the two-curve intersection');
    const points = [...demand.pts, ...supply.pts].map(([x, y]) => layouts[2]!.toPx(x, y));
    assert.ok(points.every((p) => p.x >= layouts[2]!.plot.x && p.x <= layouts[2]!.plot.x + layouts[2]!.plot.w && p.y >= layouts[2]!.plot.y && p.y <= layouts[2]!.plot.y + layouts[2]!.plot.h));
  }
});

test('a dot outside fixed chart axes is not drawn in the chart margins', () => {
  const frame = settle(planStep(emptyFrame(), step(
    { op: 'diagram', id: 'market', kind: 'chart', x: 180, y: 140, w: 350, h: 320, title: 'Supply and demand', xlabel: 'Quantity', ylabel: 'Price', xrange: [0, 100], yrange: [0, 100] },
    { op: 'dot', id: 'outside', of: 'market', x: 105, y: 50, text: 'Outside' },
    { op: 'dot', id: 'edge', of: 'market', x: 100, y: 50, text: 'At boundary' },
  )));
  const arcs: Array<{ x: number; y: number }> = [];
  const texts: string[] = [];
  const state: Record<string, unknown> = { font: '10px x' };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      if (k === 'arc') return (x: number, y: number) => { arcs.push({ x, y }); };
      if (k === 'fillText') return (s: string) => { texts.push(s); };
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  new DiagramPainter().draw(ctx, frame.diagrams, view, 0);
  assert.equal(arcs.length, 2, 'only the in-range boundary marker draws its two circles');
  assert.ok(arcs.every((p) => p.x === arcs[0]!.x && p.y === arcs[0]!.y), 'the two circles belong to the boundary marker');
  assert.ok(!texts.includes('Outside'), 'a label must not float in the axis margin without its data point');
  assert.ok(texts.includes('At boundary'), 'a marker on the axis boundary remains visible');
});

test('measured chart dot labels stay separate and inside the card at compact and wide sizes, with stable labels as dots arrive', () => {
  const render = (w: number, h: number, includeBoundary: boolean) => {
    const chart = { op: 'diagram', id: 'market', kind: 'chart', x: 70, y: 80, w, h, title: 'Supply and demand', xlabel: 'Quantity', ylabel: 'Price', xrange: [0, 100], yrange: [0, 100] };
    const demand = { op: 'series', id: 'demand', of: 'market', pts: [[0, 100], [25, 75], [50, 50], [75, 25], [100, 0]], label: 'Demand', color: 'red' };
    const supply = { op: 'series', id: 'supply', of: 'market', pts: [[0, 0], [25, 25], [50, 50], [75, 75], [100, 100]], label: 'Supply', color: 'blue' };
    const labels = ['Equilibrium 50/50', ...(includeBoundary ? ['At boundary'] : [])];
    const frame = settle(planStep(emptyFrame(), step(
      chart, demand, supply,
      { op: 'dot', id: 'equil', of: 'market', x: 50, y: 50, text: labels[0] },
      ...(includeBoundary ? [{ op: 'dot', id: 'edge', of: 'market', x: 100, y: 50, text: 'At boundary' }] : []),
    )));
    const drawn: Array<{ text: string; box: Px }> = [];
    const arcs: Array<{ x: number; y: number }> = [];
    const state: Record<string, unknown> = { font: '10px x' };
    const ctx = new Proxy(state, {
      get(t, k: string) {
        if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
        if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
        if (k === 'arc') return (x: number, y: number) => { arcs.push({ x, y }); };
        if (k === 'fillText') return (text: string, x: number, y: number) => {
          if (!labels.includes(text)) return;
          const px = Number(/([\d.]+)px/.exec(String(t.font))?.[1]);
          const width = text.length * 7;
          drawn.push({ text, box: { x: x - 6, y: y - px * 0.78, w: width + 12, h: px * 1.5 } });
        };
        if (k in t) return t[k];
        return () => undefined;
      },
      set(t, k: string, v) { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const screen = { width: 1000, height: 800, dpr: 1 };
    new DiagramPainter().draw(ctx, frame.diagrams, screen, 0);
    return { drawn, arcs, card: { x: 70, y: 64, w, h: h * 0.8 } };
  };

  for (const size of [{ w: 420, h: 350 }, { w: 520, h: 425 }]) {
    const single = render(size.w, size.h, false);
    const together = render(size.w, size.h, true);
    assert.deepEqual(together.drawn.map((d) => d.text), ['Equilibrium 50/50', 'At boundary'], 'both labels retain their data association');
    assert.equal(together.arcs.length, 4, 'the two in-range markers remain on the chart');
    assert.deepEqual(together.arcs[0], together.arcs[1]);
    assert.deepEqual(together.arcs[2], together.arcs[3]);
    assert.notDeepEqual(together.arcs[0], together.arcs[2], 'each label still belongs to its own data point');
    assert.deepEqual(together.arcs.slice(0, 2), single.arcs, 'adding a boundary dot leaves the equilibrium point fixed');
    for (const { box } of together.drawn) {
      assert.ok(box.x >= together.card.x && box.y >= together.card.y && box.x + box.w <= together.card.x + together.card.w && box.y + box.h <= together.card.y + together.card.h, `label remains inside its card: ${JSON.stringify(box)}`);
    }
    assert.ok(!overlap(together.drawn[0]!.box, together.drawn[1]!.box), `dot labels do not cover each other: ${JSON.stringify(together.drawn.map((d) => d.box))}`);
    assert.deepEqual(together.drawn[0]!.box, single.drawn[0]!.box, 'an added dot does not move the existing equilibrium label');
  }
});

// ---- Plan and frame --------------------------------------------------------------------------------

test('a diagram comes in at its time, its pieces at theirs; a piece not there yet counts toward the layout at appear 0', () => {
  const plan = planStep(emptyFrame(), step(flow({ at: 0.5 }), node('a', { at: 1 }), node('b', { at: 3 }), edge('ab', 'a', 'b', { at: 3.2 })));
  assert.equal(evaluate(plan, 0.2).diagrams.length, 0, 'not yet');
  const early = evaluate(plan, 1.2);
  assert.equal(early.diagrams.length, 1);
  assert.equal(items(early).length, 3, 'all three are known');
  assert.ok(item(early, 'a')!.appear > 0 && item(early, 'b')!.appear === 0 && item(early, 'ab')!.appear === 0);
  near(item(evaluate(plan, 1 + DIAGRAM_APPEAR_SECONDS + 0.01), 'a')!.appear, 1);
  assert.ok(plan.duration >= 3.2 + DIAGRAM_APPEAR_SECONDS - 1e-9);
  assert.deepEqual(items(settle(plan)).map((i) => i.id), ['a', 'b', 'ab']);
});

test('pieces with no time of their own come one after another, and no piece comes before its diagram or the nodes it joins', () => {
  const t = diagramTimes([flow(), node('a'), node('b'), edge('ab', 'a', 'b'), { op: 'box' }, node('c', { at: 0.1 }), edge('bc', 'b', 'c', { at: 0 })] as Array<{ op: string; at?: number }>);
  assert.deepEqual([...t.entries()].map(([i, v]) => [i, Math.round(v * 10) / 10]), [[0, 0], [1, 0.3], [2, 0.8], [3, 1.3], [5, 0.1], [6, 0.8]]);
  const plan = planStep(emptyFrame(), step(flow({ at: 0 }), node('a', { at: 2 }), node('b', { at: 2.5 }), edge('ab', 'a', 'b', { at: 0 })));
  assert.equal(item(evaluate(plan, 2.2), 'ab')!.appear, 0, 'the edge waits for its nodes');
  assert.ok(item(evaluate(plan, 3.1), 'ab')!.appear > 0);
});

test('a piece or a diagram written again under its id takes the old one\'s place and key; the pieces stay', () => {
  const base = settle(planStep(emptyFrame(), step(flow(), node('a'), node('b'))));
  const key = item(base, 'a')!.key;
  const dkey = base.diagrams[0]!.key;
  const next = settle(planStep(base, step(node('a', { text: 'Fresh' }), flow({ title: 'T', kind: 'flow' }))));
  assert.equal(next.diagrams.length, 1);
  assert.equal(next.diagrams[0]!.key, dkey);
  assert.equal(next.diagrams[0]!.def.title, 'T');
  assert.equal(items(next).length, 2);
  assert.equal(item(next, 'a')!.key, key);
  assert.equal((item(next, 'a')!.def as { text: string }).text, 'Fresh');
});

test('style and highlight work on a diagram and its pieces; a tick is drawn over its time and is carried to the next step', () => {
  const steps = step(
    { op: 'diagram', id: 's', kind: 'steps', x: 0, y: 0, w: 300, h: 300 }, { op: 'node', id: 'one', of: 's', text: 'One' },
    { op: 'style', id: 'one', color: 'red', opacity: 0.5, at: 1 }, { op: 'highlight', id: 'one', at: 2, dur: 1 }, { op: 'tick', id: 'one', at: 3 },
  );
  const plan = planStep(emptyFrame(), steps);
  const one = (t: number) => item(evaluate(plan, t), 'one', 's')!;
  assert.equal(one(0.9).color, undefined);
  assert.equal(one(1.1).color, 'red');
  assert.equal(one(1.1).opacity, 0.5);
  assert.ok(one(2.5).pulse > 0.9 && one(3.6).pulse === 0);
  assert.equal(one(2.9).done, 0);
  assert.ok(one(3 + TICK_SECONDS / 2).done > 0 && one(3 + TICK_SECONDS / 2).done < 1);
  assert.equal(one(4).done, 1);
  const base = settle(plan);
  assert.equal(item(base, 'one', 's')!.done, 1, 'ticked stays ticked');
  assert.equal(item(base, 'one', 's')!.color, 'red');
  const undone = settle(planStep(base, step({ op: 'tick', id: 'one', done: false })));
  assert.equal(item(undone, 'one', 's')!.done, 0);
  // A step written again richer (a detail pass) stays ticked.
  const richer = settle(planStep(base, step({ op: 'node', id: 'one', of: 's', text: 'One, in more words' })));
  assert.equal(item(richer, 'one', 's')!.done, 1);
});

test('clear: an id takes a diagram with its pieces (they fade first), marks and all take every diagram, the 3D panel leaves them', () => {
  const base = settle(planStep(emptyFrame(), step(flow(), node('a'), node('b'), edge('ab', 'a', 'b'), { op: 'diagram', id: 'g', kind: 'chart', x: 0, y: 0, w: 200, h: 200 })));
  assert.equal(base.diagrams.length, 2);
  const one = planStep(base, step({ op: 'clear', target: 'f', at: 1 }));
  assert.equal(evaluate(one, 0.5).diagrams.length, 2);
  const fading = evaluate(one, 1.15);
  assert.equal(fading.diagrams.length, 2);
  assert.ok(fading.diagrams.find((d) => d.id === 'f')!.fade < 1 && fading.diagrams.find((d) => d.id === 'f')!.items.every((i) => i.fade < 1));
  assert.deepEqual(settle(one).diagrams.map((d) => d.id), ['g']);
  assert.equal(settle(planStep(base, step({ op: 'clear', target: 'panel' }))).diagrams.length, 2);
  assert.equal(settle(planStep(base, step({ op: 'clear', target: 'marks' }))).diagrams.length, 0);
  assert.equal(settle(planStep(base, step({ op: 'clear', target: 'all' }))).diagrams.length, 0);
  const piece = settle(planStep(base, step({ op: 'clear', target: 'b' })));
  assert.deepEqual(items(piece).map((i) => i.id), ['a', 'ab']);
  // An edge goes with the node it leaves: written again, the node does not bring its old edge back (the validator dropped it too).
  const more = settle(planStep(emptyFrame(), step(flow(), node('a'), node('b'), node('c'), edge('ab', 'a', 'b'), edge('bc', 'b', 'c'))));
  const gone = settle(planStep(more, step({ op: 'clear', target: 'b' })));
  assert.deepEqual(items(gone).map((i) => i.id), ['a', 'c', 'ab'], 'bc left b and went with it; ab enters b and stays (it is not drawn while b is away)');
  const back = settle(planStep(gone, step(node('b', { text: 'Again' }))));
  assert.deepEqual(items(back).map((i) => i.id).sort(), ['a', 'ab', 'b', 'c']);
});

test('a finished answer fades its diagrams with the rest', () => {
  const frame = settle(planStep(emptyFrame(), step(flow(), node('a'))));
  const dim = fadeFrame(frame, 0.25);
  near(dim.diagrams[0]!.fade, 0.25);
  assert.equal(fadeFrame(frame, 1), frame);
});

// ---- Placement and drawing -------------------------------------------------------------------------

test('a diagram written over the page\'s text goes to the blank part of the page, and a little smaller if it must', () => {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = c > 4 && c < COLS * 0.6 && r > 8 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0 ? 40 : 238;
  const placer = new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 });
  const want = { op: 'diagram', id: 'f', kind: 'flow', x: 100, y: 200, w: 300, h: 400 } as Action;
  const placed = placeAction(placer, want, 1080) as typeof want & { x: number; y: number; w: number; h: number };
  assert.ok(placed.x >= 590, `moved to the blank side: ${placed.x}`);
  assert.ok(placed.w >= 300 * 0.66);
  assert.equal(placeAction(new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 }), { ...want, x: 700, y: 200 } as Action, 1080).op, 'diagram');
  // A second diagram keeps off the first.
  const second = placeAction(placer, { op: 'diagram', id: 'g', kind: 'steps', x: placed.x, y: placed.y, w: 300, h: 400 } as Action, 1080) as typeof want & { x: number; y: number; w: number; h: number };
  assert.ok(!overlap(placed, second), `${JSON.stringify(placed)} ${JSON.stringify(second)}`);
});

test('a diagram keeps off what the answer points at (the figure the answer boxes), not only off the text', () => {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = c > 4 && c < COLS * 0.55 && r > 8 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0 ? 40 : 238;
  const placer = new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 });
  const figure = { x: 640, y: 200, w: 260, h: 400 };
  placer.reserve(figure);
  const placed = placeAction(placer, { op: 'diagram', id: 'f', kind: 'chart', x: 620, y: 260, w: 300, h: 400 } as Action, 1080) as { x: number; y: number; w: number; h: number };
  assert.ok(!overlap(placed, figure), `clear of the figure: ${JSON.stringify(placed)}`);
  assert.ok(placed.x >= 0 && placed.y >= 0 && placed.x + placed.w <= 1000 && placed.y + placed.h <= 1000);
});

test('a flow shrunk into a small rectangle still writes its node texts (the text size has a floor)', () => {
  const frame = settle(planStep(emptyFrame(), step(flow({ w: 80, h: 60 }), node('a', { text: 'Alpha' }), node('b', { text: 'Beta' }), node('c', { text: 'Gamma' }), edge('ab', 'a', 'b'), edge('bc', 'b', 'c'))));
  const { ctx, texts } = fakeCtx();
  new DiagramPainter().draw(ctx, frame.diagrams, view, 0);
  for (const want of ['Alpha', 'Beta', 'Gamma']) assert.ok(texts.includes(want), `${want} in ${texts.join('|')}`);
});

/** A canvas context that remembers the text drawn on it and does nothing else. */
function fakeCtx() {
  const texts: string[] = [];
  const state: Record<string, unknown> = { font: '10px x' };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      if (k === 'fillText') return (s: string) => { texts.push(s); };
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}
const view = { width: 1920, height: 804, dpr: 1 };

test('every kind of diagram draws its text, an unborn piece is not drawn, and a piece moved by a later arrival glides until it is there', () => {
  const frame = settle(planStep(emptyFrame(), step(
    flow({ title: 'Flow title' }), node('a', { text: 'Alpha' }), node('b', { text: 'Beta', note: 'beta note' }), edge('ab', 'a', 'b', { text: 'goes' }),
    { op: 'diagram', id: 't', kind: 'timeline', x: 0, y: 600, w: 900, h: 300 }, { op: 'node', id: 'e1', of: 't', text: 'Event one', when: '1066' },
    { op: 'diagram', id: 's', kind: 'steps', x: 0, y: 0, w: 300, h: 300 }, { op: 'node', id: 'st', of: 's', text: 'Step text' }, { op: 'tick', id: 'st' },
    { op: 'diagram', id: 'c', kind: 'chart', x: 0, y: 0, w: 300, h: 300, xlabel: 'Qty' }, { op: 'series', id: 'l', of: 'c', pts: [[0, 0], [1, 2], [2, 3]], label: 'Line', curve: true }, { op: 'dot', id: 'p', of: 'c', x: 1, y: 2, text: 'Here' },
  )));
  const { ctx, texts } = fakeCtx();
  const painter = new DiagramPainter();
  painter.draw(ctx, frame.diagrams, view, 0);
  for (const want of ['Flow title', 'Alpha', 'Beta', 'beta note', 'goes', 'Event one', '1066', 'Step text', 'Qty', 'Line', 'Here']) assert.ok(texts.includes(want), `${want} in ${texts.join('|')}`);
  // A piece that has not come in yet is laid out but not drawn.
  const half = planStep(emptyFrame(), step(flow(), node('a', { at: 0 }), node('b', { at: 5 })));
  const f1 = evaluate(half, 1);
  const again = fakeCtx();
  new DiagramPainter().draw(again.ctx, f1.diagrams, view, 0);
  assert.ok(again.texts.includes('A') && !again.texts.includes('B'), again.texts.join('|'));
  // A node that arrives (the step is planned again with it in) moves the others: the painter glides them, and says so until they are there.
  const p2 = new DiagramPainter();
  const sink = fakeCtx().ctx;
  const before = settle(planStep(emptyFrame(), step(flow(), node('a')))).diagrams;
  const after = settle(planStep(emptyFrame(), step(flow(), node('a'), node('b')))).diagrams;
  assert.equal(p2.draw(sink, before, view, 0), false, 'the first time everything is simply there');
  assert.equal(p2.draw(sink, before, view, 16), false, 'and it stays there');
  assert.equal(p2.draw(sink, after, view, 32), true, 'a second node: the first has to move over');
  let settled = false;
  for (let t = 48; t < 3000 && !settled; t += 16) settled = !p2.draw(sink, after, view, t);
  assert.ok(settled, 'it gets there');
  assert.equal(p2.draw(sink, [], view, 5000), false);
});

test('a long chain in a small card wraps into rows (each runs back the way the last came) so its boxes stay large; short or branching flows are left in one row', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const chain = ids.slice(1).map((to, i) => ({ id: `e${i}`, from: ids[i]!, to }));
  const card: Px = { x: 0, y: 0, w: 540, h: 260 };
  const lay = flowLayout(ids, chain, card, opts);
  assert.equal(lay.dir, 'right');
  assert.ok(lay.rows >= 2, `rows ${lay.rows}`);
  const boxes = [...lay.nodes.values()];
  for (const b of boxes) assert.ok(b.x >= card.x && b.y >= card.y && b.x + b.w <= card.x + card.w && b.y + b.h <= card.y + card.h, JSON.stringify(b));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i]!, boxes[j]!), `${i} ${j}`);
  const flat = flowLayout(ids, chain, { x: 0, y: 0, w: 5000, h: 260 }, opts);
  assert.equal(flat.rows, 1, 'a wide card keeps one row');
  const minWide = Math.min(...boxes.map((b) => b.w));
  assert.ok(minWide >= 70, `wrapped boxes are at least 70 wide, got ${minWide}`);
  // The second row runs the other way, and the arrow between rows is a short drop.
  const perRow = Math.ceil(ids.length / lay.rows);
  const last = lay.nodes.get(ids[perRow - 1]!)!, first = lay.nodes.get(ids[perRow]!)!;
  assert.equal(last.row, 0);
  assert.equal(first.row, 1);
  assert.ok(Math.abs((last.x + last.w / 2) - (first.x + first.w / 2)) < 1, 'the row turns round under its last box');
  const drop = lay.edges.get(`e${perRow - 1}`)!;
  assert.ok(drop.d.y > drop.a.y && Math.abs(drop.d.x - drop.a.x) < 1, 'straight down');
  const back = lay.edges.get(`e${perRow}`)!;
  assert.ok(back.d.x < back.a.x, 'along the second row the arrow runs leftwards');
  assert.ok(lay.nodes.get(ids[perRow]!)!.x > lay.nodes.get(ids[perRow + 1]!)!.x, 'the second row is written right to left');
  // Not wrapped: three nodes, or a graph that branches.
  assert.equal(flowLayout(['a', 'b', 'c'], chain.slice(0, 2), card, opts).rows, 1);
  const fork = [{ id: '1', from: 'a', to: 'b' }, { id: '2', from: 'a', to: 'c' }, { id: '3', from: 'b', to: 'd' }, { id: '4', from: 'c', to: 'd' }, { id: '5', from: 'd', to: 'e' }, { id: '6', from: 'e', to: 'f' }, { id: '7', from: 'f', to: 'g' }];
  assert.equal(flowLayout(ids, fork, card, opts).rows, 1);
});

test('a mark written inside the rectangle a diagram was asked for goes with the diagram to where it was placed; a mark on the page does not', () => {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = c > 4 && c < COLS * 0.6 && r > 8 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0 ? 40 : 238;
  const placer = new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 });
  const asked = { x: 100, y: 200, w: 300, h: 400 };
  const diagram = placeAction(placer, { op: 'diagram', id: 'f', kind: 'chart', ...asked } as Action, 1080) as { x: number; y: number; w: number; h: number };
  assert.ok(diagram.x >= 590, 'the diagram left the text');
  const ring = { op: 'circle', id: 'eq', x: 200, y: 300, w: 50, h: 60, color: 'green' } as Action;
  const moved = followDiagram(placer, ring, 16 / 9) as { x: number; y: number; w: number; h: number };
  assert.ok(moved, 'the ring is inside the asked-for rectangle');
  const sx = diagram.w / asked.w, sy = diagram.h / asked.h;
  near(moved.x, diagram.x + (200 - asked.x) * sx);
  near(moved.y, diagram.y + (300 - asked.y) * sy);
  near(moved.w, 50 * sx);
  assert.ok(moved.x >= diagram.x && moved.x + moved.w <= diagram.x + diagram.w && moved.y >= diagram.y && moved.y + moved.h <= diagram.y + diagram.h, 'it sits inside the placed diagram');
  const arrow = followDiagram(placer, { op: 'arrow', id: 'a', x1: 150, y1: 250, x2: 250, y2: 350, color: 'red' } as Action, 16 / 9) as { x1: number; x2: number };
  assert.ok(arrow.x1 >= diagram.x && arrow.x2 <= diagram.x + diagram.w);
  // Marks on the page, a card, and a mark with no diagram behind it are left alone.
  assert.equal(followDiagram(placer, { op: 'box', id: 'p', x: 600, y: 600, w: 50, h: 50, color: 'red' } as Action, 16 / 9), undefined);
  assert.equal(followDiagram(placer, { op: 'card', id: 'c', x: 200, y: 300, w: 100, color: 'blue', rows: ['x'] } as unknown as Action, 16 / 9), undefined);
  assert.equal(followDiagram(new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 }), ring, 16 / 9), undefined);
  assert.ok(insideAny(ring, [asked], 16 / 9) && !insideAny(ring, [{ x: 700, y: 700, w: 100, h: 100 }], 16 / 9));
  // Cleared with the diagram, the mark is the page's again.
  placeAction(placer, { op: 'clear', target: 'f' } as Action, 1080);
  assert.equal(followDiagram(placer, ring, 16 / 9), undefined);
});

test('explanation first: with no blank place the size asked for, a diagram keeps its size and shape and sits over the text, rather than shrinking or narrowing into a margin', () => {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  // Text fills the middle of the page (columns 25% to 75%); the margins either side are blank.
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = c > COLS * 0.25 && c < COLS * 0.75 && r > 6 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0 ? 40 : 238;
  const placer = new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 });
  const placed = placeAction(placer, { op: 'diagram', id: 'p', kind: 'steps', x: 300, y: 500, w: 420, h: 300 } as Action, 1080) as { x: number; y: number; w: number; h: number };
  const text = { x: 250, y: 60, w: 500, h: 940 };
  void text;
  assert.equal(placed.w, 420, `not narrowed: ${JSON.stringify(placed)}`);
  assert.equal(placed.h, 300, 'and not shrunk');
  // A blank place the size asked for is still taken as asked.
  const roomy = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(238), COLS, ROWS), { aspect: 16 / 9 });
  const asked = placeAction(roomy, { op: 'diagram', id: 'q', kind: 'steps', x: 300, y: 500, w: 420, h: 300 } as Action, 1080);
  assert.equal((asked as { w: number }).w, 420);
});

test('a list of steps asked for more width than it can use is placed at the width it can, so it fits a margin; a mark inside what was asked still goes with it', () => {
  const COLS = 192, ROWS = 108;
  const roomy = new Placer(pageGrid(new Uint8Array(COLS * ROWS).fill(238), COLS, ROWS), { aspect: 16 / 9 });
  const placed = placeAction(roomy, { op: 'diagram', id: 's', kind: 'steps', x: 100, y: 600, w: 800, h: 320 } as Action, 1080) as { w: number; h: number };
  assert.equal(placed.w, 440);
  assert.equal(placed.h, 320);
  const ring = followDiagram(roomy, { op: 'circle', id: 'r', x: 700, y: 700, w: 40, h: 40, color: 'red' } as Action, 16 / 9);
  assert.ok(ring, 'a mark in the rectangle that was asked for (800 wide) belongs to it');
});

test('a chain with a loop back to its start is not wrapped into rows (the loop runs round the outside of one row)', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const chain = ids.slice(1).map((to, i) => ({ id: `e${i}`, from: ids[i]!, to }));
  const card: Px = { x: 0, y: 0, w: 540, h: 260 };
  assert.ok(flowLayout(ids, chain, card, opts).rows >= 2, 'the same chain without the loop wraps');
  const looped = flowLayout(ids, [...chain, { id: 'back', from: 'g', to: 'a' }], card, opts);
  assert.equal(looped.rows, 1);
  assert.ok([...looped.nodes.values()].every((b) => b.row === undefined));
});

test('in a tall timeline card the labels use most of the width, so a long event is not broken into narrow lines', () => {
  const text = 'Harold beats Hardrada and Tostig at Stamford Bridge';
  const frame = settle(planStep(emptyFrame(), step({ op: 'diagram', id: 't', kind: 'timeline', x: 0, y: 0, w: 110, h: 560 }, { op: 'node', id: 'e1', of: 't', text, when: '25 Sep' }, { op: 'node', id: 'e2', of: 't', text: 'William lands', when: '28 Sep' })));
  const { ctx, texts } = fakeCtx();
  new DiagramPainter().draw(ctx, frame.diagrams, view, 0);
  const longest = Math.max(...texts.filter((s) => text.startsWith(s.replace(/...$/, '').trim()) || text.includes(s)).map((s) => s.length));
  assert.ok(longest >= 12, `the lines of a long event are wider than a word or two: ${JSON.stringify(texts)}`);
});

test('a mark belongs to a diagram only when it is written after it: an earlier one on the page stays where it points', () => {
  const diagram = { op: 'diagram', id: 'd', kind: 'chart', x: 200, y: 200, w: 600, h: 600 } as unknown as Action;
  const early = { op: 'point', id: 'on-page', x: 500, y: 500, color: 'red' } as Action;
  const late = { op: 'point', id: 'on-chart', x: 500, y: 500, color: 'red' } as Action;
  const outside = { op: 'point', id: 'outside', x: 900, y: 900, color: 'red' } as Action;
  const owned = ownedByDiagram([{ actions: [early] }, { actions: [diagram, late, outside] }], 16 / 9);
  assert.deepEqual(owned, [[false], [false, true, false]]);
});

test('a loop back and its label stay inside the flow area, in a column that runs down and a row that runs right', () => {
  const ids = ['call', 'base', 'done', 'again'];
  const edges = [
    { id: '1', from: 'call', to: 'base' }, { id: '2', from: 'base', to: 'done', labelW: 30 }, { id: '3', from: 'base', to: 'again', labelW: 24 },
    { id: '4', from: 'again', to: 'call', labelW: 70 },
  ];
  const inside = (area: Px, o: typeof opts & { labelW?: number; labelH?: number }): void => {
    const lay = flowLayout(ids, edges, area, o);
    const back = lay.edges.get('4')!;
    const pts = bezierPoints(back.a, back.b, back.c, back.d);
    for (const p of pts) assert.ok(p.x <= area.x + area.w && p.y <= area.y + area.h, `${JSON.stringify(p)} past ${JSON.stringify(area)}`);
    // the label (70 wide, centred on the curve's middle) is inside too
    assert.ok(back.mid.x + 35 <= area.x + area.w && back.mid.y + o.labelH! / 2 <= area.y + area.h, `label ${JSON.stringify(back.mid)}`);
    for (const b of lay.nodes.values()) assert.ok(b.x >= area.x && b.y >= area.y && b.x + b.w <= area.x + area.w && b.y + b.h <= area.y + area.h);
  };
  inside({ x: 100, y: 100, w: 240, h: 315 }, { ...opts, labelW: 70, labelH: 24 });
  inside({ x: 100, y: 100, w: 700, h: 220 }, { ...opts, labelW: 70, labelH: 24 });
  // Nothing swings out when there is no loop back: the nodes keep all the room.
  const plain = flowLayout(['a', 'b'], [{ id: '1', from: 'a', to: 'b', labelW: 40 }], { x: 0, y: 0, w: 200, h: 300 }, { ...opts, labelW: 40, labelH: 24 });
  assert.ok(plain.nodes.get('a')!.x + plain.nodes.get('a')!.w > 200 * 0.8);
});

// ---- The frame check's four regressions -------------------------------------------------------------

test('a stacked flow keeps every note: boxes in a tall narrow card are taller, and in a very short one the text and the notes both go small, never dropped', () => {
  const notes = ['oxygen-poor blood', 'pick up oxygen', 'oxygen-rich blood'];
  const ids = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6', 'n7'];
  const nodes = ids.map((id, i) => node(id, { text: `Part ${i + 1}`, note: i % 2 === 0 ? notes[i % 3] : undefined }));
  const chain = ids.slice(1).map((id, i) => edge(`e${i}`, ids[i]!, id));
  for (const h of [610, 380, 260]) {
    const frame = settle(planStep(emptyFrame(), step(flow({ x: 700, y: 100, w: 170, h }), ...nodes, ...chain)));
    const { ctx, texts } = fakeCtx();
    new DiagramPainter().draw(ctx, frame.diagrams, view, 0);
    for (const want of nodes.map((n) => (n as { note?: string }).note).filter(Boolean) as string[]) assert.ok(texts.join(' ').includes(want), `note "${want}" (it may wrap) with a card ${h} units tall: ${texts.join('|')}`);
  }
  // With notes the column's boxes take more of their cell than without.
  const links = ids.slice(1).map((id, i) => ({ id: `e${i}`, from: ids[i]!, to: id }));
  const area: Px = { x: 0, y: 0, w: 320, h: 490 };
  const plain = flowLayout(ids, links, area, { maxBox: { w: 300, h: 80 }, pad: 12 });
  const noted = flowLayout(ids, links, area, { maxBox: { w: 300, h: 80 }, pad: 12, notes: true });
  assert.equal(plain.dir, 'down');
  assert.ok(noted.nodes.get('n1')!.h > plain.nodes.get('n1')!.h * 1.2, `${noted.nodes.get('n1')!.h} vs ${plain.nodes.get('n1')!.h}`);
});

test('only the marks that belong to a diagram are drawn over its card: of two identical circles inside its rectangle, the one written after it, not the one written before', () => {
  const aspect = 16 / 9;
  const ring = (id: string) => ({ op: 'circle', id, x: 540, y: 540, w: 60, h: 60 });
  const diagram = { op: 'diagram', id: 'd', kind: 'chart', x: 500, y: 500, w: 300, h: 300 };
  // A ring on the page's own figure, then a chart that ends up covering it, then a ring on the chart.
  const steps = [{ actions: [ring('page-ring'), diagram, ring('chart-ring')] }] as unknown as { actions: Action[] }[];
  const owned = ownedMarkIds(steps, aspect);
  assert.deepEqual([...owned], ['chart-ring']);
  const frames = steps[0]!.actions.filter((a) => a.op === 'circle').map((mark) => ({ mark: mark as { id?: string } }));
  const split = splitOwned(frames, owned);
  assert.deepEqual(split.over.map((m) => m.mark.id), ['chart-ring']);
  assert.deepEqual(split.under.map((m) => m.mark.id), ['page-ring'], 'a mark pointing at the page stays under the card that covers it');
  assert.deepEqual(splitOwned(frames, new Set()).over, []);
});

test('a chart that is moved keeps the shape and size it was asked for: never squeezed into a strip or shrunk to keep off the page text', () => {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  // Text over the left 82% of the page: the only blank part is a strip on the right that is too narrow for a chart of its asked shape.
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = c > 4 && c < COLS * 0.82 && r > 8 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0 ? 40 : 238;
  const aspect = 16 / 9;
  const placer = new Placer(pageGrid(gray, COLS, ROWS), { aspect });
  const want = { op: 'diagram', id: 'c', kind: 'chart', x: 100, y: 200, w: 340, h: 380 } as Action;
  const placed = placeAction(placer, want, 1080) as typeof want & { x: number; y: number; w: number; h: number };
  assert.ok(placed.w === 340 && placed.h === 380, `as asked: ${JSON.stringify(placed)}`);
  const steps = placeAction(new Placer(pageGrid(gray, COLS, ROWS), { aspect }), { op: 'diagram', id: 's', kind: 'steps', x: 100, y: 200, w: 340, h: 380 } as Action, 1080) as typeof want & { w: number; h: number };
  assert.ok(steps.w === 340 && steps.h === 380, `a list of steps too: ${JSON.stringify(steps)}`);
});

test('a flow refuses nodes below a readable size: its card grows to the least size at which they read, and is left alone when they already do or never would', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const edges = [{ id: '1', from: 'a', to: 'b', labelW: 70 }, { id: '2', from: 'b', to: 'c', labelW: 70 }, { id: '3', from: 'c', to: 'd' }];
  const least = { w: 100, h: 44 };
  const options = { maxBox: { w: 165, h: 51 }, pad: 12, labelW: 70, labelH: 20 };
  const at = (f: number) => flowLayout(ids, edges, { x: 0, y: 0, w: 360 * f, h: 130 * f }, options);
  const readable = (f: number) => flowReadable(at(f), least);
  assert.ok(!readable(1), 'a small card gives nodes below the least');
  const f = flowGrowth(readable, 2.2);
  assert.ok(f !== undefined && f > 1 && f <= 2.2 && readable(f), `it grows until they read: ${f}`);
  assert.ok(!readable(f / 1.05), 'and no more than it needs');
  assert.equal(flowGrowth(() => true, 2.2), 1, 'a card whose nodes already read does not grow');
  assert.equal(flowGrowth(() => false, 2.2), undefined, 'a flow that would still not read at the largest card is left as it was, not blown up over the page');
  assert.equal(flowGrowth((k) => k >= 2.2, 2.2), 2.2, 'the largest card is used when it is just enough');
});

test('one long edge label widens only its own gap: a seven-node chain with a single labelled edge reads in a small card, and keeps no node on another', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const chain = (label: (i: number) => number) => ids.slice(1).map((_, i) => ({ id: `e${i}`, from: ids[i]!, to: ids[i + 1]!, labelW: label(i) }));
  const options = { maxBox: { w: 165, h: 51 }, pad: 12, labelW: 130, labelH: 20 };
  const area: Px = { x: 0, y: 0, w: 633, h: 209 };
  const least = { w: 100, h: 38 };
  const one = flowLayout(ids, chain((i) => (i === 1 ? 130 : 0)), area, options);
  const all = flowLayout(ids, chain(() => 130), area, options);
  assert.ok(flowReadable(one, least), 'with one label the nodes are readable');
  assert.ok(!flowReadable(all, least), 'with a label on every edge the same card is too small: the room for labels is spent only where there are labels');
  const boxes = [...one.nodes.values()];
  assert.equal(boxes.length, 7);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!overlap(boxes[i]!, boxes[j]!), `${i} ${j}`);
  for (const b of boxes) assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= area.w + 0.5 && b.y + b.h <= area.h + 0.5, JSON.stringify(b));
  // The gap that holds the label is as wide as the label; the others are not.
  const sameRow = (p: string, q: string): boolean => one.nodes.get(p)!.row === one.nodes.get(q)!.row;
  const gap = (p: string, q: string): number => { const m = one.nodes.get(p)!, n = one.nodes.get(q)!; return Math.max(n.x - (m.x + m.w), m.x - (n.x + n.w)); };
  if (sameRow('b', 'c') && sameRow('c', 'd')) assert.ok(gap('b', 'c') >= 130 && gap('c', 'd') < 130, 'only the labelled gap is wide');
});

test('a flow card that has to grow asks the page where to go, and is drawn where it is told (or stays as it was when told nothing)', () => {
  const frame = settle(planStep(emptyFrame(), step(flow({ x: 600, y: 700, w: 160, h: 140, title: 'Calls' }), node('a', { text: 'Big problem' }), node('b', { text: 'Smaller problem' }), node('c', { text: 'Base case: answer directly' }), node('d', { text: 'Results combine back up' }), edge('ab', 'a', 'b', { text: 'calls itself' }), edge('bc', 'b', 'c', { text: 'until simple' }), edge('cd', 'c', 'd'))));
  const asked: Array<{ id: string; want: Px }> = [];
  const moves: Array<[number, number]> = [];
  const recorder = () => {
    const state: Record<string, unknown> = { font: '10px x' };
    return new Proxy(state, {
      get(t, k: string) {
        if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
        if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
        if (k === 'moveTo') return (x: number, y: number) => { moves.push([x, y]); };
        if (k in t) return t[k];
        return () => undefined;
      },
      set(t, k: string, v) { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  };
  const told: Px = { x: 700, y: 120, w: 900, h: 420 };
  new DiagramPainter({ regrow: (id, want) => { asked.push({ id, want }); return told; } }).draw(recorder(), frame.diagrams, view, 0);
  assert.equal(asked.length, 1);
  assert.equal(asked[0]!.id, 'f');
  assert.ok(asked[0]!.want.w > (160 / 1000) * view.width && asked[0]!.want.h > (140 / 1000) * view.height, `it asked for a larger card: ${JSON.stringify(asked[0]!.want)}`);
  assert.ok(moves.some(([x, y]) => Math.abs(y - told.y) < 1 && x >= told.x && x < told.x + 30), `the card is drawn where it was told: ${JSON.stringify(moves.slice(0, 3))}`);
  // Told nothing (no place is as good as where it was): the card stays at the size and place it was given.
  moves.length = 0;
  new DiagramPainter({ regrow: () => undefined }).draw(recorder(), frame.diagrams, view, 0);
  const home = { x: (600 / 1000) * view.width, y: (700 / 1000) * view.height };
  assert.ok(moves.some(([x, y]) => Math.abs(y - home.y) < 1 && x >= home.x && x < home.x + 30), `the card stays at its own place: ${JSON.stringify(moves.slice(0, 3))}`);
  // Asked once for a size, not again every frame.
  let calls = 0;
  const painter = new DiagramPainter({ regrow: () => { calls++; return told; } });
  for (let t = 0; t < 5; t++) painter.draw(recorder(), frame.diagrams, view, t * 16);
  assert.equal(calls, 1);
});

test('the size a flow card grows to is worked out once for its layout, not on every frame; it is worked out again when a node arrives', () => {
  const small = { x: 600, y: 700, w: 160, h: 140, title: 'Calls' };
  const names = ['Big problem', 'Smaller problem', 'Base case: answer directly', 'Results combine back up', 'Return to the caller', 'Final answer', 'Done'];
  const chain = (n: number) => settle(planStep(emptyFrame(), step(flow(small), ...names.slice(0, n).map((text, i) => node('n' + i, { text })), ...names.slice(1, n).map((_, i) => edge('e' + i, 'n' + i, 'n' + (i + 1), { text: 'label number ' + i })))));
  const four = chain(6), five = chain(7);
  let measured = 0;
  const counting = () => {
    const state: Record<string, unknown> = { font: '10px x' };
    return new Proxy(state, {
      get(t, k: string) {
        if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
        if (k === 'measureText') return (s: string) => { measured++; return { width: s.length * 7 }; };
        if (k in t) return t[k];
        return () => undefined;
      },
      set(t, k: string, v) { t[k] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
  };
  const painter = new DiagramPainter();
  const cost = (frame: typeof four, now: number): number => { measured = 0; painter.draw(counting(), frame.diagrams, view, now); return measured; };
  const first = cost(four, 0);
  const second = cost(four, 16);
  const third = cost(four, 32);
  assert.ok(second < first / 2, `the second frame does not search again: ${first} then ${second}`);
  assert.equal(third, second, 'and neither does the third');
  assert.ok(cost(five, 48) > second * 2, 'a new node makes the search happen again');
});

// ---- Names on a picture: an enlarged crop is a card the names are written on --------------------------------

function textPlacer() {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = c > 4 && c < COLS * 0.6 && r > 8 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0 ? 40 : 238;
  return new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 });
}

test('an enlarged crop is a card the names of its parts are written on: the marks go with it to where it was placed, and are drawn over it', () => {
  const placer = textPlacer();
  const crop = { op: 'image', id: 'big', sx: 600, sy: 300, sw: 100, sh: 200, dx: 100, dy: 200, dw: 300 } as Action;
  const placed = placeAction(placer, crop, 1080) as { dx: number; dy: number };
  assert.ok(placed.dx >= 590, 'the crop left the text it was written over');
  const spot = { op: 'point', id: 'p1', x: 200, y: 300, color: 'red' } as Action;
  const moved = followDiagram(placer, spot, 16 / 9) as { x: number; y: number };
  assert.ok(moved, 'a point written on the enlargement is inside the rectangle it was asked for');
  near(moved.x, placed.dx + (200 - 100));
  near(moved.y, placed.dy + (300 - 200));
  assert.equal(followDiagram(placer, { op: 'point', id: 'p2', x: 650, y: 400, color: 'red' } as Action, 16 / 9), undefined, 'a point on the original figure is the page\'s');
  const owned = ownedByDiagram([{ actions: [crop, spot, { op: 'point', id: 'p2', x: 650, y: 700, color: 'red' } as Action] }], 16 / 9);
  assert.deepEqual(owned, [[false, true, false]], 'a mark written on the enlargement is owned by it (drawn over it); one elsewhere is not');
  assert.ok(imageCardHeight({ dw: 300, sw: 100, sh: 200 }) > 600, 'the card is as tall as the crop at its true shape');
});

test('a label written on an enlargement is kept inside the card, and a name on a boxed picture is kept inside the box (never over the caption below it)', () => {
  const placer = textPlacer();
  const crop = { op: 'image', id: 'big', sx: 600, sy: 300, sw: 100, sh: 100, dx: 100, dy: 200, dw: 200 } as Action;
  const placed = placeAction(placer, crop, 1080) as { dx: number; dy: number };
  const low = { op: 'label', id: 'l1', x: 100 + 150, y: 200 + 190, text: 'Right ventricle', color: 'red' } as Action;
  const kept = followDiagram(placer, low, 16 / 9) as { x: number; y: number };
  const { w, h } = labelUnits({ text: 'Right ventricle' }, 16 / 9);
  assert.ok(kept.x + w <= placed.dx + 200 + 0.2 && kept.x >= placed.dx - 0.2, `inside the card across: ${JSON.stringify(kept)}`);
  assert.ok(kept.y + h <= placed.dy + imageCardHeight({ dw: 200, sw: 100, sh: 100 }) + 0.2, 'and down');
  // A picture the answer boxed, with its caption just under the box.
  const p2 = textPlacer();
  const box = { op: 'box', id: 'pic', x: 560, y: 316, w: 300, h: 478, color: 'blue' } as Action;
  reserveMarks(p2, [box], 16 / 9);
  const name = { op: 'label', id: 'n1', x: 780, y: 783, text: 'Stewart Island', color: 'purple', size: 22 } as { op: 'label'; x: number; y: number; text: string; size: number };
  const got = placeAction(p2, name as unknown as Action, 1080) as { x: number; y: number };
  const size = labelUnits(name, 16 / 9);
  assert.ok(got.y + size.h <= 794 + 0.2 && got.x + size.w <= 860 + 0.2, `inside the boxed picture: ${JSON.stringify(got)}`);
  assert.ok(got.x < 780 && got.y < 783, 'pulled back toward the picture, not pushed out');
  // A name that is already inside, and one written beside the picture rather than on it, stay where they are.
  const inside = { op: 'label', id: 'n2', x: 600, y: 400, text: 'Cook Strait', color: 'orange', size: 22 } as Action;
  assert.equal(placeAction(p2, inside, 1080), inside);
  const beside = { op: 'label', id: 'n3', x: 880, y: 400, text: 'Beside', color: 'orange', size: 22 } as Action;
  assert.equal(placeAction(p2, beside, 1080), beside);
});
