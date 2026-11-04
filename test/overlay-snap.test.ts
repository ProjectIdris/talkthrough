import test from 'node:test';
import assert from 'node:assert/strict';
import { Snapper, snapActions, MAX_MOVE } from '../src/overlay/snap.ts';
import type { Action, Mark } from '../src/scene/index.ts';

// Synthetic pages: gray pictures drawn the way a screenshot is shrunk (a little soft), 480 x 270 cells for 1000 x 1000 units.
const COLS = 480, ROWS = 270;
const kx = COLS / 1000, ky = ROWS / 1000;

class Page {
  g = new Float32Array(COLS * ROWS).fill(250);
  set(x: number, y: number, v: number) {
    const i = Math.round(y) * COLS + Math.round(x);
    if (x >= 0 && y >= 0 && x < COLS && y < ROWS) this.g[i] = Math.min(this.g[i] as number, v);
  }
  /** A line two cells thick. */
  line(x0: number, y0: number, x1: number, y1: number, v = 20) {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * i) / n;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) this.set(x + dx, y + dy, v);
    }
  }
  rect(x0: number, y0: number, x1: number, y1: number, v = 20) {
    this.line(x0, y0, x1, y0, v); this.line(x1, y0, x1, y1, v); this.line(x1, y1, x0, y1, v); this.line(x0, y1, x0, y0, v);
  }
  fill(x0: number, y0: number, x1: number, y1: number, v: number) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) this.set(x, y, v);
  }
  /** Lines of text: short dark runs with word gaps, rows of letters. */
  text(x0: number, y0: number, x1: number, lines: number) {
    for (let l = 0; l < lines; l++) {
      const y = y0 + l * 13;
      for (let x = x0; x < x1; x += 1) {
        const wordGap = (Math.floor((x - x0) / 5) * 7 + l * 3) % 5 === 0;
        if (wordGap) continue;
        const stem = (x * 3 + l) % 4 < 2;
        if (stem) this.fill(x, y, x + 1, y + 7, 30);
        else if (x % 3 === 0) this.set(x, y + 3 + (x % 2), 60); // a short bar here and there, as letters have
      }
    }
  }
  snapper(): Snapper {
    // Soften by a 3 x 3 mean, as a shrunk screenshot is.
    const out = new Float32Array(this.g.length);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      let s = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < COLS && yy < ROWS) { s += this.g[yy * COLS + xx] as number; n++; }
      }
      out[y * COLS + x] = s / n;
    }
    return new Snapper(out, COLS, ROWS);
  }
}

const U = (cx: number, cy: number): [number, number] => [cx / kx, cy / ky]; // cells to units
const cellsOf = (x: number, y: number): [number, number] => [x * kx, y * ky];
const arrow = (x1: number, y1: number, x2: number, y2: number): Mark => ({ op: 'arrow', id: 'a', x1, y1, x2, y2, color: 'red' });

test('an arrow that stops short of a line has its tip put on the line', () => {
  const page = new Page();
  page.line(60, 200, 300, 60); // a rising curve, drawn as a line
  const s = page.snapper();
  // Aimed from the lower right at the line, stopping about 9 cells before it.
  const [tx, ty] = U(190 + 7, 128 + 5);
  const [fx, fy] = U(330, 230);
  const out = s.snapMark(arrow(fx, fy, tx, ty)) as Extract<Mark, { op: 'arrow' }>;
  const [cx, cy] = cellsOf(out.x2, out.y2);
  // distance from the tip to the line through (60,200)-(300,60)
  const d = Math.abs((300 - 60) * (200 - cy) - (60 - cx) * (60 - 200)) / Math.hypot(240, 140);
  assert.ok(d < 2, `tip is on the line, off by ${d.toFixed(1)} cells`);
  assert.notEqual(out.x2, tx);
  assert.equal(out.x1, fx, 'the tail stays');
});

test('an arrow aimed at blank page, or at a block of text, or between two equal lines, is left alone', () => {
  const blank = new Page().snapper();
  const a = arrow(...U(100, 50), ...U(200, 120));
  assert.equal(blank.snapMark(a), a, 'blank page');
  const text = new Page();
  text.text(60, 40, 400, 14);
  const t = arrow(...U(440, 240), ...U(230, 100));
  assert.equal(text.snapper().snapMark(t), t, 'text');
  const twin = new Page();
  twin.line(40, 100, 440, 100);
  twin.line(40, 140, 440, 140);
  const between = arrow(...U(240, 220), ...U(240, 120));
  assert.equal(twin.snapper().snapMark(between), between, 'two lines equally near: which was meant cannot be told');
});

test('nothing moves further than a few percent of the screen', () => {
  const page = new Page();
  page.line(60, 40, 420, 40);
  const s = page.snapper();
  const far = arrow(...U(240, 250), ...U(240, 40 + MAX_MOVE * ROWS * 1.5));
  assert.equal(s.snapMark(far), far, 'a line further off than the reach is not chased');
  const near = s.snapMark(arrow(...U(240, 200), ...U(240, 40 + 12))) as Extract<Mark, { op: 'arrow' }>;
  assert.ok(Math.abs(near.y2 * ky - 41) < 2, 'a line within reach is found');
});

test('a point lands on the crossing next to it, and onto a plain line when there is no crossing', () => {
  const page = new Page();
  page.line(80, 60, 360, 220); // two curves crossing at (220,140)
  page.line(80, 220, 360, 60);
  const s = page.snapper();
  const [x, y] = U(228, 133);
  const out = s.snapMark({ op: 'point', id: 'p', x, y, color: 'green' }) as Extract<Mark, { op: 'point' }>;
  assert.ok(Math.hypot(out.x * kx - 220, out.y * ky - 140) < 3, `on the crossing: ${out.x * kx},${out.y * ky}`);
  const lone = new Page();
  lone.line(40, 60, 440, 60);
  const [lx, ly] = U(240, 70);
  const onLine = lone.snapper().snapMark({ op: 'point', id: 'p', x: lx, y: ly, color: 'green' }) as Extract<Mark, { op: 'point' }>;
  assert.ok(Math.abs(onLine.y * ky - 60) < 2.5, 'onto the line');
  assert.ok(Math.abs(onLine.x - lx) < 5, 'and not along it');
});

test('a small ring is centred on the crossing; a ring round a figure is left alone', () => {
  const page = new Page();
  page.line(80, 60, 360, 220);
  page.line(80, 220, 360, 60);
  const s = page.snapper();
  const [cx, cy] = U(227, 144);
  const placed: Extract<Mark, { op: 'circle' }> = { op: 'circle', id: 'c', x: cx - 30, y: cy - 60, w: 60, h: 120, color: 'green' };
  const out = s.snapMark(placed) as Extract<Mark, { op: 'circle' }>;
  assert.ok(Math.hypot((out.x + out.w / 2) * kx - 220, (out.y + out.h / 2) * ky - 140) < 3, 'centred on the crossing');
  assert.equal(out.w, placed.w, 'same size');
  const big: Mark = { op: 'circle', id: 'c', x: 150, y: 150, w: 600, h: 600, color: 'green' };
  assert.equal(s.snapMark(big), big);
});

test('a box is tightened onto the border of the figure it surrounds, and left alone when tight, on a border, or over nothing', () => {
  const page = new Page();
  page.fill(180, 90, 300, 170, 120); // a figure: a gray panel with a drawn border
  page.rect(180, 90, 300, 170);
  const s = page.snapper();
  const [lx, ly] = U(167, 77), [rx, ry] = U(313, 183);
  const loose: Extract<Mark, { op: 'box' }> = { op: 'box', id: 'b', x: lx, y: ly, w: rx - lx, h: ry - ly, color: 'blue' };
  const out = s.snapMark(loose) as Extract<Mark, { op: 'box' }>;
  assert.ok(out.w < loose.w && out.h < loose.h, 'tighter');
  // The figure is x 180..300, y 90..170; the box keeps a little air round it (1 to 7 cells), where it had 13.
  const air = (v: number, edge: number) => Math.abs(v - edge);
  const ok = (v: number, edge: number) => air(v, edge) >= 1 && air(v, edge) <= 8;
  assert.ok(ok(out.x * kx, 180) && ok((out.x + out.w) * kx, 300), `both sides hug the figure: ${out.x * kx} ${(out.x + out.w) * kx}`);
  assert.ok(ok(out.y * ky, 90) && ok((out.y + out.h) * ky, 170), `top and bottom too: ${out.y * ky} ${(out.y + out.h) * ky}`);
  // Tight already: unchanged (and returns the same object).
  const [tx0, ty0] = U(176, 86), [tx1, ty1] = U(304, 174);
  const tight: Mark = { op: 'box', id: 'b', x: tx0, y: ty0, w: tx1 - tx0, h: ty1 - ty0, color: 'blue' };
  assert.equal(s.snapMark(tight), tight);
  // On the border itself: unchanged.
  const [bx0, by0] = U(180, 90), [bx1, by1] = U(301, 171);
  const onBorder: Mark = { op: 'box', id: 'b', x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, color: 'blue' };
  assert.equal(s.snapMark(onBorder), onBorder);
  // Over nothing: unchanged.
  const empty: Mark = { op: 'box', id: 'b', x: 700, y: 600, w: 200, h: 200, color: 'blue' };
  assert.equal(s.snapMark(empty), empty);
});

test('a box with a loose margin round a picture that has no border is not shrunk into it', () => {
  const page = new Page();
  // A photo: dark patches and bright ones, no frame. The bright corner is the same gray as the page.
  page.fill(180, 90, 300, 170, 60);
  page.fill(180, 90, 230, 120, 250);
  for (let i = 0; i < 40; i++) page.set(200 + (i * 7) % 90, 95 + (i * 13) % 70, 250);
  const s = page.snapper();
  const [lx, ly] = U(166, 76), [rx, ry] = U(314, 184);
  const loose: Mark = { op: 'box', id: 'b', x: lx, y: ly, w: rx - lx, h: ry - ly, color: 'blue' };
  const out = s.snapMark(loose) as Extract<Mark, { op: 'box' }>;
  // It may come in to the picture's edge at most, never into the picture (x 180, y 90).
  assert.ok(out.x * kx <= 181 && out.y * ky <= 91, `not cut into the bright corner: ${out.x * kx}, ${out.y * ky}`);
});

test('a box does not chase a figure that is far from it, or shrink to a speck', () => {
  const page = new Page();
  page.fill(300, 200, 330, 230, 40);
  const s = page.snapper();
  const wide: Mark = { op: 'box', id: 'b', x: 100, y: 100, w: 600, h: 600, color: 'blue' };
  assert.equal(s.snapMark(wide), wide, 'a big box with a speck in it keeps its size');
});

test('a box whose top edge cuts a line of text grows to the gap above it; one cutting a picture, or round loose text, stays', () => {
  const page = new Page();
  page.text(60, 60, 300, 6);
  const s = page.snapper();
  // The box's top edge runs through the first line (rows 60..67).
  const [cx0, cy0] = U(50, 63), [cx1, cy1] = U(310, 148);
  const cut: Mark = { op: 'box', id: 'b', x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0, color: 'blue' };
  const grown = s.snapMark(cut) as Extract<Mark, { op: 'box' }>;
  assert.ok(grown.y * ky < 60, `the top edge no longer cuts the first line: ${grown.y * ky}`);
  assert.ok(grown.y * ky > 50, 'and went no further than the line');
  // A loose margin round text is not taken in to the letters: the box stays as written.
  const [x0, y0] = U(50, 52), [x1, y1] = U(312, 148);
  const loose: Mark = { op: 'box', id: 'b', x: x0, y: y0, w: x1 - x0, h: y1 - y0, color: 'blue' };
  const looseOut = s.snapMark(loose) as Extract<Mark, { op: 'box' }>;
  assert.equal(looseOut, loose, `loose text box: ${looseOut.x * kx} ${looseOut.y * ky} ${(looseOut.x + looseOut.w) * kx} ${(looseOut.y + looseOut.h) * ky}`);
  // A picture cut through by an edge is not grown over: which gap ends it cannot be told.
  const photo = new Page();
  photo.fill(180, 90, 300, 170, 60);
  const [px0, py0] = U(170, 120), [px1, py1] = U(310, 190);
  const cutPhoto: Mark = { op: 'box', id: 'b', x: px0, y: py0, w: px1 - px0, h: py1 - py0, color: 'blue' };
  const after = photo.snapper().snapMark(cutPhoto) as Extract<Mark, { op: 'box' }>;
  assert.equal(after.y, (cutPhoto as { y: number }).y, 'top edge stays');
  assert.equal(after.h, (cutPhoto as { h: number }).h, 'bottom edge stays');
});

test('a tilted box is left as written', () => {
  const page = new Page();
  page.fill(180, 90, 300, 170, 120);
  const t: Mark = { op: 'box', id: 'b', x: 300, y: 300, w: 300, h: 300, rot: 30, color: 'blue' };
  assert.equal(page.snapper().snapMark(t), t);
});

test("the corners of a polygon go to the page's corners; a corner with none near stays", () => {
  const page = new Page();
  // A tilted square with corners at (240,50) (330,130) (250,215) (160,135)
  page.line(240, 50, 330, 130);
  page.line(330, 130, 250, 215);
  page.line(250, 215, 160, 135);
  page.line(160, 135, 240, 50);
  const s = page.snapper();
  const rough: [number, number][] = [U(246, 44), U(324, 138), U(256, 208), U(156, 129)];
  const out = s.snapMark({ op: 'poly', id: 'p', pts: rough, color: 'purple' }) as Extract<Mark, { op: 'poly' }>;
  const want: [number, number][] = [[240, 50], [330, 130], [250, 215], [160, 135]];
  out.pts.forEach((p, i) => assert.ok(Math.hypot(p[0] * kx - want[i]![0], p[1] * ky - want[i]![1]) < 4, `corner ${i}: ${p[0] * kx},${p[1] * ky}`));
  const away: [number, number][] = [U(20, 20), U(60, 20), U(40, 40)];
  const same: Mark = { op: 'poly', id: 'p', pts: away, color: 'purple' };
  assert.equal(s.snapMark(same), same);
});

test('a traced curve lies on the curve it follows; one over blank page stays', () => {
  const page = new Page();
  let prev: [number, number] | undefined;
  for (let x = 60; x <= 420; x += 4) {
    const y = 210 - 150 * ((x - 60) / 360) ** 2; // a rising curve
    if (prev) page.line(prev[0], prev[1], x, y);
    prev = [x, y];
  }
  const s = page.snapper();
  const onCurve = (x: number) => 210 - 150 * ((x - 60) / 360) ** 2;
  const pts = [100, 160, 220, 280, 340, 400].map((x) => U(x, onCurve(x) + 8)); // written 8 cells below it
  const out = s.snapMark({ op: 'trace', id: 't', pts, color: 'red' }) as Extract<Mark, { op: 'trace' }>;
  const err = (list: [number, number][]) => Math.max(...list.map((p) => Math.abs(p[1] * ky - onCurve(p[0] * kx))));
  assert.ok(err(pts) > 6, 'written off the curve');
  assert.ok(err(out.pts) < 4, `laid on the curve (worst ${err(out.pts).toFixed(1)} cells off)`);
  const blank: Mark = { op: 'trace', id: 't', pts: [U(100, 20), U(200, 30), U(300, 20)], color: 'red' };
  assert.equal(s.snapMark(blank), blank);
});

test('an underline drops to the bottom of its line of text, and does nothing over a blank page', () => {
  const page = new Page();
  page.text(60, 60, 300, 5);
  const s = page.snapper();
  // The second line of text spans rows 73..80; an underline written inside it goes to just under it.
  const [x, y] = U(60, 77);
  const u: Mark = { op: 'underline', id: 'u', x, y, w: 240 / kx, color: 'red' };
  const out = s.snapMark(u) as Extract<Mark, { op: 'underline' }>;
  assert.ok(out.y * ky >= 81 && out.y * ky <= 84.5, `just under the letters: ${out.y * ky}`);
  const blank = new Page().snapper();
  assert.equal(blank.snapMark(u), u);
});

test("snapActions returns the scene's actions with marks moved and says what moved", () => {
  const page = new Page();
  page.line(60, 40, 420, 40);
  const s = page.snapper();
  const moves: string[] = [];
  const panel: Action = { op: 'panel', x: 0, y: 0, w: 100, h: 100 };
  const actions: Action[] = [arrow(...U(240, 200), ...U(240, 40 + 9)) as Action, panel];
  const out = snapActions(s, actions, (r) => moves.push(`${r.op}:${r.id}`));
  assert.equal(out[1], panel, 'other actions pass through as they were');
  assert.deepEqual(moves, ['arrow:a']);
});
