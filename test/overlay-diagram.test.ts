import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Step } from '../src/scene/index.ts';
import { DIAGRAM_APPEAR_SECONDS, TICK_SECONDS, diagramTimes } from '../src/overlay/diagram-plan.ts';
import { chartLayout, chartRanges, flowLayers, flowLayout, niceTicks, stepsLayout, timelineFractions, timelineLayout } from '../src/overlay/diagram-layout.ts';
import type { Px } from '../src/overlay/diagram-layout.ts';
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';
import { fadeFrame } from '../src/overlay/fade.ts';
import { Placer, followDiagram, insideAny, pageGrid, placeAction } from '../src/overlay/placement.ts';
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

test('with no blank place the size asked for, a diagram becomes taller and narrower to sit in a margin rather than over the text', () => {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  // Text fills the middle of the page (columns 25% to 75%); the margins either side are blank.
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = c > COLS * 0.25 && c < COLS * 0.75 && r > 6 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0 ? 40 : 238;
  const placer = new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 });
  const placed = placeAction(placer, { op: 'diagram', id: 'p', kind: 'steps', x: 300, y: 500, w: 420, h: 300 } as Action, 1080) as { x: number; y: number; w: number; h: number };
  const text = { x: 250, y: 60, w: 500, h: 940 };
  assert.ok(!overlap(placed, text), `off the text: ${JSON.stringify(placed)}`);
  assert.ok(placed.w < 420 && placed.w >= 150, `narrower: ${placed.w}`);
  assert.ok(placed.h > 300, `and taller: ${placed.h}`);
  assert.ok(placed.w * placed.h >= 420 * 300 * 0.7, 'with most of the area it asked for');
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
