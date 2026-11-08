import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';
import { drawMarks } from '../src/overlay/marks.ts';
import { emptyFrame, planStep, settle } from '../src/overlay/timeline.ts';
import { Placer, pageGrid, placeAction } from '../src/overlay/placement.ts';
import type { Box } from '../src/overlay/placement.ts';
import type { Action, Step } from '../src/scene/types.ts';
import type { Annotator } from '../src/overlay/annotations.ts';

const overlap = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
function canvas() {
  const texts: string[] = [];
  const state: Record<string, unknown> = { font: '12px sans-serif' };
  const ctx = new Proxy(state, {
    get(t, k: string) {
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      if (k === 'fillText') return (s: string) => texts.push(s);
      return k in t ? t[k] : () => {};
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, texts };
}
const frame = (actions: Action[]) => settle(planStep(emptyFrame(), { say: '', actions } as Step));

test('crowded panel painters honour admission at the actual painted bounds', () => {
  const view = { width: 1920, height: 1080, dpr: 1 };
  const boxes: Box[] = [];
  const admitSurface = (_id: string, box: Box) => {
    if (boxes.some(b => overlap(b, box))) return false;
    boxes.push(box); return true;
  };
  const f = frame([
    { op: 'card', id: 'note', x: 670, y: 520, w: 320, title: 'Read this note', rows: ['The chart must not cover this row.', 'Nor this row.', 'Keep all of this readable.'] },
    { op: 'diagram', kind: 'chart', id: 'chart', x: 590, y: 440, w: 400, h: 380, title: 'Crowded chart' },
  ]);
  const { ctx, texts } = canvas();
  drawMarks(ctx, f.marks, view, { view, project: () => undefined, admitSurface } as Annotator);
  new DiagramPainter({ admitSurface } as ConstructorParameters<typeof DiagramPainter>[0]).draw(ctx, f.diagrams, view, 0);
  assert.ok(texts.includes('Read this note'));
  assert.ok(!texts.includes('Crowded chart'), 'a chart rejected for covering the note must not be painted');
  assert.equal(boxes.length, 1, 'the note reserves its actual painted rectangle');
});

test('card and image painters also refuse a surface that cannot fit', () => {
  const view = { width: 800, height: 600, dpr: 1 };
  const f = frame([
    { op: 'card', id: 'note', x: 100, y: 100, title: 'Omitted note', rows: ['Not drawn'] },
    { op: 'image', id: 'crop', sx: 0, sy: 0, sw: 100, sh: 100, dx: 100, dy: 100, dw: 300, caption: 'Omitted crop' },
  ]);
  const { ctx, texts } = canvas();
  const admitted: string[] = [];
  drawMarks(ctx, f.marks, view, { view, project: () => undefined, source: { image: {} as CanvasImageSource, width: 800, height: 600 }, admitSurface: (id: string) => { admitted.push(id); return false; } } as Annotator);
  assert.deepEqual(texts, [], 'omitted panels draw neither title nor content');
  assert.deepEqual(admitted, ['note', 'crop']);
});

test('a flow cannot regrow across an existing card even when the whole viewport is crowded', () => {
  const p = new Placer(pageGrid(new Uint8Array(192 * 108).fill(240), 192, 108), { aspect: 16 / 9 });
  p.diagram({ x: 12, y: 12, w: 300, h: 976 }, 'flow');
  p.card({ x: 312, y: 12, w: 676, h: 976 }, 'note');
  assert.equal(p.regrow('flow', { x: 12, y: 12, w: 302, h: 976 }), undefined, 'even a narrow overlap hides content');
});

// These are renderer fixtures: the five-panel regression deliberately exceeds
// the author's current three-diagram cap. The renderer also receives retained follow-ups.
import { readFileSync } from 'node:fs';
import { SurfaceAdmission, admittedFrame, surfacesOverlap } from '../src/overlay/surface-admission.ts';
import { followupSpot } from '../src/overlay/followup-placement.ts';
const sheet = JSON.parse(readFileSync(new URL('./support/crowded-panels.json', import.meta.url), 'utf8')).steps[0].actions as Action[];

function drawWithAdmission(actions: Action[], view: { width: number; height: number; dpr: number }, keepOut: Box[] = [], usePlacer = true) {
  const p = new Placer(pageGrid(new Uint8Array(192 * 108).fill(240), 192, 108), { aspect: view.width / view.height, height: view.height });
  const placed = usePlacer ? actions.map(a => placeAction(p, a, view.height)) : actions;
  const f = frame(placed);
  const admission = new SurfaceAdmission(keepOut);
  const { ctx, texts } = canvas();
  const admitSurface = (id: string, b: Box) => admission.admit(id, b);
  drawMarks(ctx, f.marks, view, { view, project: () => undefined, admitSurface });
  new DiagramPainter({ admitSurface }).draw(ctx, f.diagrams, view, 0);
  return { admission, texts, frame: admittedFrame(f, admission, new Map()) };
}
function assertClear(boxes: Box[]) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++)
    assert.ok(!surfacesOverlap(boxes[i]!, boxes[j]!), `panels ${i} and ${j} overlap: ${JSON.stringify(boxes)}`);
}

test('the five-panel sheet preserves the note and never draws another panel over its content', () => {
  const result = drawWithAdmission(sheet, { width: 1920, height: 1080, dpr: 1 });
  assertClear([...result.admission.shown.values()]);
  assert.equal(result.admission.shown.size + result.admission.omitted.size, 5);
  assert.ok(result.admission.shown.has('note'));
  assert.ok(result.admission.omitted.size > 0, 'a crowded sheet needs the explicit fallback');
});

test('viewport and panel-count sweep keeps admitted panels clear and makes room for the cue', () => {
  for (const [width, height] of [[360, 640], [640, 360], [800, 600], [1280, 720], [1920, 1080], [2560, 1080]]) {
    const view = { width: width!, height: height!, dpr: 1 };
    for (let count = 1; count <= 12; count++) {
      const actions: Action[] = Array.from({ length: count }, (_, i) => i % 3 === 0
        ? { op: 'card', id: `p${i}`, x: 100 + i * 33, y: 90 + i * 44, w: 460, title: `Note ${i}`, rows: ['A readable line', 'Another readable line', 'One more line'] }
        : { op: 'diagram', id: `p${i}`, kind: ['flow', 'timeline', 'steps', 'chart'][i % 4] as 'chart', x: 80 + i * 30, y: 100 + i * 35, w: 480, h: 420, title: `Panel ${i}` });
      let result = drawWithAdmission(actions, view);
      assertClear([...result.admission.shown.values()]);
      if (result.admission.omitted.size) {
        const size = { w: Math.min(320, width! - 32), h: 58 };
        const at = followupSpot(view, size, [...result.admission.shown.values()]);
        const cue = { ...at, ...size };
        result = drawWithAdmission(actions, view, [cue]);
        assertClear([cue, ...result.admission.shown.values()]);
        assert.ok(result.admission.omitted.size > 0);
        assert.ok(cue.x >= 0 && cue.y >= 0 && cue.x + cue.w <= width! && cue.y + cue.h <= height!);
      }
      assert.equal(result.admission.shown.size + result.admission.omitted.size, count);
    }
  }
});

test('fitting panels keep their drawing and no omission survives clear or replacement', () => {
  const view = { width: 1920, height: 1080, dpr: 1 };
  const a: Action = { op: 'diagram', kind: 'chart', id: 'a', title: 'First', x: 100, y: 100, w: 350, h: 350 };
  const b: Action = { ...a, id: 'b', title: 'Second', x: 600 };
  const plain = canvas(), fitting = drawWithAdmission([a, b], view, [], false);
  new DiagramPainter().draw(plain.ctx, frame([a, b]).diagrams, view, 0);
  assert.deepEqual(fitting.texts, plain.texts);
  assert.equal(fitting.admission.omitted.size, 0);
  const crowded = drawWithAdmission([a, { ...b, x: 100 }], view, [], false);
  assert.equal(crowded.admission.omitted.size, 1);
  for (let i = 0; i < 3; i++) assert.equal(drawWithAdmission([a, { ...b, x: 100 }], view, [], false).admission.omitted.size, 1);
  assert.equal(drawWithAdmission([b], view, [], false).admission.omitted.size, 0, 'clearing releases room');
  assert.equal(drawWithAdmission([a, b], view, [], false).admission.omitted.size, 0, 'replacement releases room');
});

test('entrance slides and grown flows use actual bounds on every animation frame', () => {
  const view = { width: 1000, height: 800, dpr: 1 }, painter = new DiagramPainter();
  const f = frame([
    { op: 'diagram', kind: 'flow', id: 'flow', x: 300, y: 200, w: 160, h: 200, title: 'Growing flow' },
    ...Array.from({ length: 8 }, (_, i): Action => ({ op: 'node', of: 'flow', id: `n${i}`, text: `Long node ${i}` })),
    { op: 'diagram', kind: 'chart', id: 'chart', x: 450, y: 200, w: 350, h: 400, title: 'Nearby chart' },
  ]);
  for (let i = 1; i <= 45; i++) {
    const admission = new SurfaceAdmission();
    const diagrams = f.diagrams.map(d => ({ ...d, appear: Math.min(1, i / 15) }));
    painter.draw(canvas().ctx, diagrams, view, i * 1000 / 30, (id, b) => admission.admit(id, b));
    assertClear([...admission.shown.values()]);
    assert.equal(admission.shown.size + admission.omitted.size, 2);
  }
});

test('omitted diagrams and their owned marks are absent from the published frame', () => {
  const view = { width: 1000, height: 1000 };
  const f = frame([
    { op: 'diagram', kind: 'chart', id: 'chart', x: 100, y: 100, w: 400, h: 400, title: 'Chart' },
    { op: 'point', id: 'dot', x: 250, y: 250, color: 'blue' },
    { op: 'label', id: 'standalone', x: 700, y: 700, text: 'Keep me', color: 'blue' },
  ]);
  const admission = new SurfaceAdmission([{ x: 100, y: 100, w: 400, h: 400 }]);
  admission.admit('chart', { x: 100, y: 100, w: 400, h: 400 });
  const shown = admittedFrame(f, admission, new Map([['dot', 'chart']]));
  assert.equal(shown.diagrams.length, 0);
  assert.deepEqual(shown.marks.map(m => m.id), ['standalone']);
});

test('an admitted chart keeps its own annotation where an omitted chart overlaps', () => {
  const f = frame([
    { op: 'diagram', kind: 'chart', id: 'a', x: 100, y: 100, w: 400, h: 400 },
    { op: 'point', id: 'annotation-a', x: 250, y: 250, color: 'blue' },
    { op: 'diagram', kind: 'chart', id: 'b', x: 200, y: 200, w: 400, h: 400 },
  ]);
  const admission = new SurfaceAdmission();
  admission.admit('a', { x: 100, y: 100, w: 400, h: 400 });
  admission.admit('b', { x: 200, y: 200, w: 400, h: 400 });
  const shown = admittedFrame(f, admission, new Map([['annotation-a', 'a']]));
  assert.deepEqual(shown.marks.map(m => m.id), ['annotation-a']);
});

import { ownedByDiagram } from '../src/overlay/placement.ts';
test('ownership keeps the authored surface identity through overlaps and placer renewal', () => {
  const actions: Action[] = [
    { op: 'diagram', kind: 'chart', id: 'a', x: 100, y: 100, w: 400, h: 400 },
    { op: 'point', id: 'annotation-a', x: 250, y: 250, color: 'blue' },
    { op: 'diagram', kind: 'chart', id: 'b', x: 200, y: 200, w: 400, h: 400 },
  ];
  const owners = new Map<string, string>();
  assert.deepEqual(ownedByDiagram([{ actions }], 1, 1000, 1, undefined, owners), [[false, true, false]]);
  assert.equal(owners.get('annotation-a'), 'a');
  const grid = pageGrid(new Uint8Array(192 * 108).fill(240), 192, 108);
  const p = new Placer(grid, { aspect: 1 });
  placeAction(p, actions[0]!, 1000);
  const renewed = new Placer(grid, { aspect: 1 }); renewed.restore(p.snapshot());
  assert.equal(renewed.ownerOf(actions[1]!), 'a');
  renewed.release('a');
  assert.equal(renewed.ownerOf(actions[1]!), undefined);
});

import { LabelBoard, Occupancy } from '../src/overlay/labels.ts';
import * as admissionModule from '../src/overlay/surface-admission.ts';
test('omitting the stage for the cue also releases its existing pin-label rectangles', () => {
  const board = new LabelBoard();
  board.beginFrame({ width: 1000, height: 800, model: undefined, dragging: false, now: 0 });
  board.place(1, { anchor: { x: 500, y: 400 }, w: 120, h: 30 }, () => ({ occ: new Occupancy(1000, 800) }));
  assert.equal(board.shownRects().length, 1, 'the first paint has a live label');
  assert.equal(typeof admissionModule.omitStageForCue, 'function', 'stage omission must clear its retained labels');
  const f = frame([{ op: 'panel', x: 0, y: 0, w: 1000, h: 1000 }, { op: 'pin', id: 'label', on: 'part', text: 'Label' }]);
  const shown = admissionModule.omitStageForCue(f, board);
  assert.equal(shown.panel, null);
  assert.deepEqual(shown.marks, []);
  assert.deepEqual(board.shownRects(), [], 'no invisible pin-label region survives the second paint');
});
