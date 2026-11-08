import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagramPainter } from '../src/overlay/diagram-draw.ts';
import { drawMarks } from '../src/overlay/marks.ts';
import { evaluate, emptyFrame, planStep, settle } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { Placer, pageGrid, placeAction } from '../src/overlay/placement.ts';
import type { Box } from '../src/overlay/placement.ts';
import { panelRect } from '../src/overlay/layout.ts';
import { SurfaceAdmission, admittedFrame, stageKeepOut, withoutReplacedSurfaces } from '../src/overlay/surface-admission.ts';
import type { Action, Step } from '../src/scene/types.ts';

const COLS = 192, ROWS = 108;
/** A page: text lines across the left `textEnd` of the screen, nothing on the right. */
function page(textEnd = 0.45, from = 0) {
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const text = c > COLS * from + 4 && c < COLS * textEnd && r > 8 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0;
    gray[r * COLS + c] = text ? 40 : 238;
  }
  return pageGrid(gray, COLS, ROWS);
}
const placer = (grid = page(), aspect = 16 / 9) => new Placer(grid, { aspect, height: 1080 });
const overlaps = (a: Box, b: Box) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
const FAIR = 620;

test('a short stage on a quiet page grows taller to about 62 percent of the screen, keeping its width and what it already covered', () => {
  const asked = { x: 600, y: 150, w: 330, h: 400 };
  const got = placer().panel(asked);
  assert.equal(got.w, asked.w, 'width is kept');
  assert.equal(got.x, asked.x, 'and so is its left edge');
  assert.ok(got.h >= FAIR - 40 && got.h <= FAIR + 1, `grew to about 62 percent: ${JSON.stringify(got)}`);
  assert.ok(got.y <= asked.y && got.y + got.h >= asked.y + asked.h, 'the stage still covers everything it asked for');
  assert.ok(got.y >= 12 && got.y + got.h <= 1000 - 12, 'inside the screen margin');
});

test('a stage already about 62 percent tall or more is left alone, and nothing is ever made smaller', () => {
  for (const h of [600, 640, 800]) assert.deepEqual(placer().panel({ x: 600, y: 100, w: 330, h }), { x: 600, y: 100, w: 330, h });
});

test('it grows only into a page with little on it: text under the added height stops it', () => {
  const asked = { x: 300, y: 150, w: 300, h: 400 };
  const quiet = placer(page(0.2)).panel(asked);
  assert.ok(quiet.h >= FAIR - 40, `quiet page: ${JSON.stringify(quiet)}`);
  // Body text on both sides and across the whole screen under the stage's reach: no growth, and the stage stays where the model put it.
  const busy = placer(page(1)).panel(asked);
  assert.equal(busy.h, asked.h, `a full page of text is not covered further: ${JSON.stringify(busy)}`);
});

test('cards and page controls are hard keep-outs: it grows only as far as the gap they leave', () => {
  const asked = { x: 600, y: 150, w: 330, h: 400 };
  const p = placer();
  const below: Box = { x: 560, y: 600, w: 420, h: 120 };
  p.card(below, 'note');
  const withCard = p.panel(asked);
  assert.ok(!overlaps(withCard, below), `not over the card: ${JSON.stringify(withCard)}`);
  assert.ok(withCard.h > asked.h, 'it still grows upward into the room there is');
  const q = placer();
  const control: Box = { x: 640, y: 570, w: 200, h: 40 };
  q.setControls([control]);
  const withControl = q.panel(asked);
  assert.ok(!overlaps(withControl, control), `not over the control: ${JSON.stringify(withControl)}`);
  // Boxed in above and below: no growth at all.
  const r = placer();
  r.card({ x: 560, y: 12, w: 420, h: 120 }, 'a');
  r.card({ x: 560, y: 560, w: 420, h: 120 }, 'b');
  const boxed = r.panel(asked);
  assert.equal(boxed.h, asked.h, JSON.stringify(boxed));
});

test('what the answer points at is a preference: growth goes the other way, or not at all, rather than cover it; a spot the stage already covers is left out of the reckoning', () => {
  const asked = { x: 600, y: 150, w: 330, h: 400 };
  const pointedBelow: Box = { x: 650, y: 560, w: 200, h: 50 };
  const p = placer(); p.reserve(pointedBelow);
  const got = p.panel(asked);
  assert.ok(!overlaps(got, pointedBelow), `not over the pointed-at spot: ${JSON.stringify(got)}`);
  assert.ok(got.h > asked.h, 'it grows upward instead');
  const both = placer(); both.reserve(pointedBelow); both.reserve({ x: 650, y: 60, w: 200, h: 50 });
  const none = both.panel(asked);
  assert.ok(!overlaps(none, pointedBelow) && !overlaps(none, { x: 650, y: 60, w: 200, h: 50 }), `neither is covered: ${JSON.stringify(none)}`);
  // Pointed-at ground the stage cannot avoid (the whole screen is boxed): it is already under the stage, so it does not stop the growth.
  const everywhere = placer(); everywhere.reserve({ x: 0, y: 0, w: 1000, h: 1000 });
  const covered = everywhere.panel(asked);
  assert.ok(covered.h >= FAIR - 40, `a spot already under the stage does not stop it growing: ${JSON.stringify(covered)}`);
});

test('later cards keep off the grown stage, and a card written before the stage is not grown over', () => {
  const p = placer();
  const first = placeAction(p, { op: 'card', id: 'n1', x: 600, y: 600, w: 300, title: 'Before', rows: ['a', 'b'] } as Action, 1080) as Extract<Action, { op: 'card' }>;
  const stage = placeAction(p, { op: 'panel', x: 600, y: 150, w: 330, h: 400 } as Action, 1080) as Extract<Action, { op: 'panel' }>;
  const later = placeAction(p, { op: 'card', id: 'n2', x: 600, y: 300, w: 300, title: 'After', rows: ['c', 'd'] } as Action, 1080) as Extract<Action, { op: 'card' }>;
  const box = (a: { x: number; y: number; w: number; h?: number }): Box => ({ x: a.x, y: a.y, w: a.w, h: a.h ?? 100 });
  assert.ok(!overlaps(box(stage as never), box({ x: first.x, y: first.y, w: first.w ?? 300, h: 90 })), 'the stage does not cover the earlier card');
  assert.ok(stage.h >= 400 && !overlaps(box(later as never), box(stage as never)), 'the later card is clear of the grown stage');
});

// ---- Growth leaves the next note its room ------------------------------------------------------------------------------------------------------

/** Text across the whole page except one blank rectangle (units): the only quiet ground there is. */
function pageBlankOnlyIn(blank: Box) {
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const x = ((c + 0.5) / COLS) * 1000, y = ((r + 0.5) / ROWS) * 1000;
    const inside = x >= blank.x && x <= blank.x + blank.w && y >= blank.y && y <= blank.y + blank.h;
    const text = !inside && r > 2 && r % 4 < 2 && (c * 7 + r * 13) % 11 !== 0;
    gray[r * COLS + c] = text ? 40 : 238;
  }
  return pageGrid(gray, COLS, ROWS);
}
const NOTE_W = 380, NOTE_H = 150;

test('growth stops short of taking the last quiet place a note-sized card could have: the card written after still lands on blank page, not on the text', () => {
  // The blank column ends at 780: a stage grown to 620 from 100 (and its buttons' strip) would leave no room for a note beside it in the column.
  const p = new Placer(pageBlankOnlyIn({ x: 560, y: 40, w: 420, h: 820 }), { aspect: 1920 / 804, height: 804 });
  const stage = p.panel({ x: 600, y: 100, w: 330, h: 400 });
  assert.ok(stage.h > 400, `it still grows where the room allows: ${JSON.stringify(stage)}`);
  // The column is blank to 860: the note (150 tall) and the strip of the stage's buttons (90) have to fit under the stage, so it grows to about 510 and no further.
  assert.ok(stage.h <= 520, `but not to the full share, which would take the note's room: ${JSON.stringify(stage)}`);
  const note = p.card({ x: 560, y: 600, w: NOTE_W, h: NOTE_H }, 'note');
  assert.ok(!overlaps(note, stage), 'the note is clear of the stage');
  assert.ok(p.busy(note) < 0.05, `and it sits on blank page, not on the text: ${JSON.stringify(note)} busy ${p.busy(note)}`);
});

test('where the blank page has room for the stage and a note both, the stage still grows to the full share', () => {
  const p = new Placer(pageBlankOnlyIn({ x: 560, y: 40, w: 420, h: 940 }), { aspect: 1920 / 804, height: 804 });
  const stage = p.panel({ x: 600, y: 100, w: 330, h: 400 });
  assert.ok(stage.h >= FAIR - 40, JSON.stringify(stage));
  const note = p.card({ x: 560, y: 740, w: NOTE_W, h: NOTE_H }, 'note');
  assert.ok(!overlaps(note, stage) && p.busy(note) < 0.05, `the note has its place under the grown stage: ${JSON.stringify(note)}`);
});

// ---- Admission holds steady while the stage comes in and eases ------------------------------------------------------------------------------------

function canvas() {
  const state: Record<string, unknown> = { font: '12px sans-serif' };
  return new Proxy(state, {
    get(t, k: string) {
      if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
      if (k === 'measureText') return (s: string) => ({ width: s.length * 7 });
      return k in t ? t[k] : () => {};
    },
    set(t, k: string, v) { t[k] = v; return true; },
  }) as unknown as CanvasRenderingContext2D;
}
const VIEW = { width: 1920, height: 804, dpr: 1 };
const stageRect = (f: Frame): Box | undefined => { const r = panelRect(f.panel, VIEW); return r ? { x: r.x, y: r.y, w: r.w, h: r.h } : undefined; };
function admit(f0: Frame, keepOut: Box[], painter: DiagramPainter, now: number) {
  const f = withoutReplacedSurfaces(f0);
  const ctx = canvas();
  let a = new SurfaceAdmission(keepOut);
  drawMarks(ctx, f.marks, VIEW, { view: VIEW, project: () => undefined, admitSurface: (id: string, b: Box) => { a.admit(id, b); return false; } } as never);
  painter.prepare(ctx, f.diagrams, VIEW, now, (id, b) => { a.admit(id, b); });
  a = a.prioritize(f, keepOut);
  return { a, shown: admittedFrame(f, a, new Map()) };
}

test('a normal answer (stage, a note, a chart) omits nothing at any moment while the grown stage appears', () => {
  const p = placer(page(0.4), VIEW.width / VIEW.height);
  const written: Action[] = [
    { op: 'panel', x: 640, y: 150, w: 320, h: 380 },
    { op: 'card', id: 'note', x: 60, y: 560, w: 300, title: 'Note', rows: ['one line', 'two lines'] },
    { op: 'diagram', kind: 'chart', id: 'chart', x: 400, y: 560, w: 340, h: 300, title: 'Chart' },
  ] as Action[];
  const placed = written.map((a) => placeAction(p, a, VIEW.height));
  const stage = placed[0] as Extract<Action, { op: 'panel' }>;
  assert.ok(stage.h >= FAIR - 40, `the stage grew: ${JSON.stringify(stage)}`);
  const plan = planStep(emptyFrame(), { say: '', actions: placed } as Step);
  const painter = new DiagramPainter();
  for (let i = 0; i <= 90; i++) {
    const f = evaluate(plan, i / 30);
    const keep = stageKeepOut(f.panel, stageRect(f));
    const { a } = admit(f, keep, painter, (i * 1000) / 30);
    assert.equal(a.omitted.size, 0, `nothing omitted at ${(i / 30).toFixed(2)} s: ${[...a.omitted.keys()]}`);
  }
});

test('a stage re-asked in a later step eases over ground the earlier one held, clear of the cards in between, so no card is clipped on the way', () => {
  const p = placer(page(0.4), VIEW.width / VIEW.height);
  const ask = { op: 'panel', x: 640, y: 300, w: 320, h: 250 } as Action;
  const first = placeAction(p, ask, VIEW.height) as Extract<Action, { op: 'panel' }>;
  const card = placeAction(p, { op: 'card', id: 'note', x: 60, y: 560, w: 300, title: 'Note', rows: ['a', 'b'] } as Action, VIEW.height) as Extract<Action, { op: 'card' }>;
  const second = placeAction(p, ask, VIEW.height) as Extract<Action, { op: 'panel' }>;
  assert.ok(second.x === first.x && second.w === first.w, 'same column');
  const noteBox = { x: card.x, y: card.y, w: card.w ?? 300, h: 90 };
  for (const [name, stage] of [['earlier', first], ['later', second]] as const) assert.ok(!overlaps(stage as never, noteBox), `the card is clear of the ${name} rectangle`);
  const base = settle(planStep(emptyFrame(), { say: '', actions: [first, card] } as Step));
  const plan = planStep(base, { say: '', actions: [second] } as Step);
  const painter = new DiagramPainter();
  for (let i = 0; i <= 60; i++) {
    const f = evaluate(plan, i / 30);
    const keep = stageKeepOut(f.panel, stageRect(f));
    const { a } = admit(f, keep, painter, (i * 1000) / 30);
    assert.equal(a.omitted.size, 0, `no card clipped at ${(i / 30).toFixed(2)} s`);
  }
});

// ---- A stage that leaves with a clear does not hold space against what arrives -----------------------------------------------------------------

test('a stage that is leaving is not a keep-out: a chart arriving where it stood is admitted from its first frame, with no omission cue', () => {
  const stageUnits = { x: 640, y: 150, w: 320, h: 600 };
  const base = settle(planStep(emptyFrame(), { say: '', actions: [{ op: 'panel', ...stageUnits }, { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] }] } as unknown as Step));
  const plan = planStep(base, { say: '', actions: [{ op: 'clear', target: 'all', at: 0 } as Action, { op: 'diagram', kind: 'chart', id: 'new', x: 660, y: 200, w: 300, h: 300, title: 'New' } as Action] } as Step);
  const painter = new DiagramPainter();
  for (const t of [0.02, 0.05, 0.1, 0.15]) {
    const f = evaluate(plan, t);
    assert.ok(f.panel && f.panel.fade > 0.3, `the stage is still fading at ${t}`);
    const keep = stageKeepOut(f.panel, stageRect(f));
    const { a } = admit(f, keep, painter, t * 1000);
    assert.equal(a.omitted.size, 0, `no cue at ${t}`);
    assert.ok(a.shown.has('new'), `the chart is admitted at ${t}`);
  }
  const live = evaluate(planStep(base, { say: '', actions: [{ op: 'diagram', kind: 'chart', id: 'on', x: 660, y: 200, w: 300, h: 300, title: 'On' } as Action] } as Step), 1);
  assert.deepEqual(stageKeepOut(live.panel, stageRect(live)), [stageRect(live)], 'a stage that stays is still a keep-out');
  assert.deepEqual(stageKeepOut(null, undefined), []);
});
