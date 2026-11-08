import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Step } from '../src/scene/types.ts';
import { drawCard } from '../src/overlay/annotations.ts';
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';
import { emptyFrame, evaluate, planStep, settle } from '../src/overlay/timeline.ts';
import type { MarkFrame } from '../src/overlay/timeline.ts';
import { FACE_DARK_BELOW, FACE_LIGHT_ABOVE, FROST, FROST_ACCENTS, FaceBook, faceFor, frostAccent, onAccent } from '../src/overlay/theme.ts';
import type { Face } from '../src/overlay/theme.ts';

// ---- The face follows the page ---------------------------------------------------------------------------------------------------

test('a panel is light over a light page and dark over a dark one, and a mid-tone page keeps the face it had (it never flickers)', () => {
  assert.equal(faceFor(250), 'light');
  assert.equal(faceFor(20), 'dark');
  assert.equal(faceFor(undefined), 'dark', 'no page known: dark, as the tags are');
  assert.equal(faceFor(Number.NaN, 'light'), 'light');
  const mid = (FACE_LIGHT_ABOVE + FACE_DARK_BELOW) / 2;
  assert.equal(faceFor(mid, 'light'), 'light');
  assert.equal(faceFor(mid, 'dark'), 'dark');
  assert.equal(faceFor(mid), 'dark');
  const book = new FaceBook(() => 200);
  const rect = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(book.of('a', rect), 'light');
  let luma: number | undefined = 140;
  const wandering = new FaceBook(() => luma);
  luma = 200;
  assert.equal(wandering.of('p', rect), 'light');
  for (const l of [140, 130, 148, 126]) { luma = l; assert.equal(wandering.of('p', rect), 'light', `light page drifting to ${l} stays light`); }
  luma = FACE_DARK_BELOW - 1;
  assert.equal(wandering.of('p', rect), 'dark');
  for (const l of [130, 148, FACE_LIGHT_ABOVE]) { luma = l; assert.equal(wandering.of('p', rect), 'dark', `dark page drifting to ${l} stays dark`); }
  luma = FACE_LIGHT_ABOVE + 1;
  assert.equal(wandering.of('p', rect), 'light');
  assert.equal(wandering.of('other', rect), 'light', 'a panel is judged by its own page, and a new one starts from the page');
});

// ---- Words stay readable on either face ------------------------------------------------------------------------------------------

function rgba(css: string): [number, number, number, number] {
  const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(css.replace(/\s/g, ''));
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  const h = /^#([0-9a-f]{6})$/i.exec(css);
  assert.ok(h, `a colour this test can read: ${css}`);
  const n = parseInt(h![1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
}
const over = (top: [number, number, number, number], under: [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3])) as [number, number, number];
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
const contrast = (a: [number, number, number], b: [number, number, number]): number => { const [p, q] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (p! + 0.05) / (q! + 0.05); };

test('ink and muted text read (4.5 to 1) on the panel of each face over the lightest and darkest page it can sit on', () => {
  for (const [face, pages] of [['light', [150, 255]], ['dark', [0, 125]]] as Array<[Face, number[]]>) {
    const tone = FROST[face];
    for (const page of pages) for (const stop of [tone.panelTop, tone.panelFoot]) {
      const panel = over(rgba(stop), [page, page, page]);
      for (const [name, ink] of [['ink', tone.ink], ['muted', tone.muted]] as const) {
        const c = contrast(over(rgba(ink), panel), panel);
        assert.ok(c >= 4.5, `${face} face, ${name} text on ${stop} over a page of ${page}: ${c.toFixed(2)}`);
      }
      const chip = over(rgba(tone.chip), panel);
      assert.ok(contrast(rgba(tone.muted).slice(0, 3) as [number, number, number], chip) >= 4.5, `${face} face: the muted text on a label chip`);
    }
  }
  // Writing on an accent (a number in its disc, a date in its pill) is white, or near black on a light accent.
  for (let i = 0; i < FROST_ACCENTS.length; i++) {
    const accent = frostAccent(i);
    assert.ok(contrast(rgba(onAccent(accent)).slice(0, 3) as [number, number, number], accent) >= 2.5, `accent ${i} carries its writing`);
  }
});

// ---- The painter wears the face it is given ---------------------------------------------------------------------------------------

type Drawn = { text: string; fill: string; x: number; y: number; font: string };
function fakeCtx() {
  const drawn: Drawn[] = [];
  const arcs: Array<{ x: number; y: number; r: number; fill: string }> = [];
  const state: Record<string, unknown> = { font: '10px x', fillStyle: '' };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'createLinearGradient') return () => ({ addColorStop: () => {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * Number(/([\d.]+)px/.exec(String(t.font))?.[1] ?? 10) * 0.52 });
      if (k === 'fillText') return (text: string, x: number, y: number) => { drawn.push({ text, fill: String(t.fillStyle), x, y, font: String(t.font) }); };
      if (k === 'arc') return (x: number, y: number, r: number) => { arcs.push({ x, y, r, fill: String(t.fillStyle) }); };
      if (k in t) return t[k];
      return () => undefined;
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, drawn, arcs };
}
const view = { width: 1920, height: 1080, dpr: 1 };
const project = () => undefined;
const plan = (actions: Action[]) => settle(planStep(emptyFrame(), { say: 'x', actions } as Step));

const flow = (nodes: number): Action[] => [
  { op: 'diagram', id: 'd', kind: 'flow', x: 100, y: 100, w: 500, h: 400, title: 'A flow' },
  ...Array.from({ length: nodes }, (_, i) => ({ op: 'node', id: 'n' + i, of: 'd', text: 'Step ' + (i + 1), note: 'note ' + (i + 1) }) as Action),
  ...Array.from({ length: nodes - 1 }, (_, i) => ({ op: 'edge', id: 'e' + i, from: 'n' + i, to: 'n' + (i + 1), text: 'then' }) as Action),
];

test('a flow wears the face it is given: dark ink on the light face, light ink on the dark one, and dark when nothing says', () => {
  const frame = plan(flow(3));
  for (const [face, painter] of [['light', new DiagramPainter({ faceOf: () => 'light' })], ['dark', new DiagramPainter({ faceOf: () => 'dark' })], ['dark', new DiagramPainter()]] as Array<[Face, DiagramPainter]>) {
    const g = fakeCtx();
    painter.draw(g.ctx, frame.diagrams, view, 0);
    const title = g.drawn.find((d) => d.text === 'A flow');
    assert.equal(title?.fill, FROST[face].ink, `the title on the ${face} face`);
    const step = g.drawn.find((d) => d.text === 'Step 1');
    assert.equal(step?.fill, FROST[face].ink, `a node's words on the ${face} face`);
    assert.equal(g.drawn.find((d) => d.text === 'note 1')?.fill, FROST[face].muted, `its note on the ${face} face`);
  }
});

test('each node takes its own accent in turn, so the order reads at a glance, and the scene can still choose', () => {
  const g = fakeCtx();
  new DiagramPainter().draw(g.ctx, plan(flow(4)).diagrams, view, 0);
  const discs = g.arcs.filter((a) => /^rgb\(/.test(a.fill) && a.r >= 7 && a.r <= 14);
  const fills = new Set(discs.map((d) => d.fill));
  assert.ok(fills.size >= 4, `four numbered discs of four accents: ${[...fills].join(' ')}`);
  const numbers = g.drawn.filter((d) => /^[1-4]$/.test(d.text)).map((d) => d.text);
  assert.deepEqual(numbers, ['1', '2', '3', '4'], 'numbered in the order written');
  const named = fakeCtx();
  const actions = flow(2);
  (actions[1] as { color?: string }).color = 'red';
  new DiagramPainter().draw(named.ctx, plan(actions).diagrams, view, 0);
  const first = named.arcs.find((a) => /^rgb\(/.test(a.fill) && a.r >= 7 && a.r <= 14);
  assert.notEqual(first?.fill, `rgb(${frostAccent(0).join(',')})`, 'a colour the scene named is not replaced by the next accent');
});

test('an arrow still being drawn has no dot at its end yet, and ends in one when it is there; eight nodes and their labels are all drawn', () => {
  const edgeAt = (t: number): number => {
    const actions = flow(3).map((a) => (a.op === 'edge' ? { ...a, at: 1 } : a.op === 'node' ? { ...a, at: 0 } : a)) as Action[];
    const p = planStep(emptyFrame(), { say: 'x', actions } as Step);
    const g = fakeCtx();
    new DiagramPainter().draw(g.ctx, evaluate(p, t).diagrams, view, 0);
    return g.arcs.length;
  };
  // The discs of the three nodes are there at both times; the dots at the ends of the two arrows only once those are drawn.
  const early = edgeAt(1.12), later = edgeAt(4);
  assert.equal(later - early, 2, `the end dots of two arrows come once they are drawn: ${early} then ${later}`);
  const g = fakeCtx();
  new DiagramPainter().draw(g.ctx, plan(flow(8)).diagrams, { width: 1920, height: 1080, dpr: 1 }, 0);
  for (let i = 1; i <= 8; i++) assert.ok(g.drawn.some((d) => d.text === 'Step ' + i), `node ${i} is written`);
});

test('a short timeline panel still writes every date, event and note inside itself, and a chart of six series writes six names none over another', () => {
  const events = [['20 Sep', 'Fulford', 'Norse army beats the northern earls'], ['25 Sep', 'Stamford Bridge', 'Harold destroys the Norse army'], ['28 Sep', 'Normans land', 'William at Pevensey'], ['14 Oct', 'Hastings', 'Harold killed; Norman victory']] as const;
  const tl = (h: number): Action[] => [
    { op: 'diagram', id: 't', kind: 'timeline', x: 30, y: 600, w: 760, h, title: 'Autumn 1066' },
    ...events.map(([when, text, note], i) => ({ op: 'node', id: 'e' + i, of: 't', when, text, note, pos: [263, 268, 271, 287][i] }) as Action),
  ];
  // In a short panel the date goes beside the event instead of in a row of its own, so the words stay a readable size (measured with the date in its own row: 10.6, 8.9 px at 220 and 190 units).
  const leastPx: Record<number, number> = { 320: 20, 240: 14, 190: 11.5 };
  for (const h of [320, 240, 190]) {
    const g = fakeCtx();
    const frame = plan(tl(h));
    new DiagramPainter().draw(g.ctx, frame.diagrams, view, 0);
    const card = { x: 0.03 * 1920, y: 0.6 * 1080, w: 0.76 * 1920, h: (h / 1000) * 1080 };
    for (const [when, text] of events) for (const word of [when, text]) {
      const d = g.drawn.find((x) => x.text === word || x.text.includes(word));
      assert.ok(d, `"${word}" is written at ${h} units high`);
      assert.ok(d!.y <= card.y + card.h + 2 && d!.y >= card.y - 2, `"${word}" is inside the panel at ${h} high (y ${d!.y.toFixed(0)}, panel ${card.y.toFixed(0)} to ${(card.y + card.h).toFixed(0)})`);
    }
    const px = Number(/([\d.]+)px/.exec(g.drawn.find((x) => x.text === 'Fulford')!.font)?.[1]);
    assert.ok(px >= leastPx[h]!, `the words are ${px.toFixed(1)} px at ${h} units high, at least ${leastPx[h]} wanted`);
  }
  const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot'];
  const chart: Action[] = [
    { op: 'diagram', id: 'c', kind: 'chart', x: 600, y: 100, w: 360, h: 380, xrange: [0, 20], yrange: [0, 100] },
    ...names.map((n, i) => ({ op: 'series', id: 's' + i, of: 'c', pts: [[0, 10 + i * 2], [20, 60 + i * 2]], label: n, curve: true }) as Action),
  ];
  const g = fakeCtx();
  new DiagramPainter().draw(g.ctx, plan(chart).diagrams, view, 0);
  const ys = names.map((n) => g.drawn.find((d) => d.text === n)?.y).filter((y): y is number => y !== undefined).sort((a, b) => a - b);
  assert.equal(ys.length, 6, 'six names are written');
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i]! - ys[i - 1]! >= 12, `names ${i} and ${i + 1} are a line apart: ${ys.map((y) => y.toFixed(0)).join(' ')}`);
});

// ---- Note cards wear it too --------------------------------------------------------------------------------------------------

test('a note card wears the face it is given, numbers its rows in accents in turn, and keeps the scene\'s tint when there is one', () => {
  const mark = (extra: object = {}): MarkFrame => ({ mark: { op: 'card', id: 'c', x: 100, y: 100, w: 300, title: 'Why', rows: ['One', 'Two', 'Three'], ...extra } as Action, key: 7, appear: 1, opacity: 1, fade: 1, pulse: 0, pulseColor: undefined, tinted: false, color: [226, 84, 90] } as unknown as MarkFrame);
  for (const face of ['light', 'dark'] as Face[]) {
    const g = fakeCtx();
    drawCard(g.ctx, mark(), { view, project, faceOf: () => face }, 0);
    assert.equal(g.drawn.find((d) => d.text === 'Why')?.fill, FROST[face].ink, `title on the ${face} face`);
    assert.equal(g.drawn.find((d) => d.text === 'One')?.fill, FROST[face].ink, `a row on the ${face} face`);
    assert.deepEqual(g.drawn.filter((d) => /^[1-3]$/.test(d.text)).map((d) => d.text), ['1', '2', '3'], 'rows numbered');
  }
  const none = fakeCtx();
  drawCard(none.ctx, mark(), { view, project }, 0);
  assert.equal(none.drawn.find((d) => d.text === 'Why')?.fill, FROST.dark.ink, 'no page known: dark');
  const tinted = fakeCtx();
  drawCard(tinted.ctx, { ...mark(), tinted: true } as MarkFrame, { view, project, faceOf: () => 'light' }, 0);
  const discs = tinted.arcs.filter((a) => a.r > 7);
  assert.equal(new Set(discs.map((d) => d.fill)).size, 1, 'a card the scene tinted has discs of that one colour');
});
