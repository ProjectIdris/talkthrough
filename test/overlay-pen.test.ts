import assert from 'node:assert/strict';
import test from 'node:test';
import { PEN_DECAY_MS, PEN_FADE_MS, PEN_REST, PenLayer, calmLine, penRibbon, rasterRibbon, routePenPointer, undoPlace } from '../src/overlay/pen.ts';

function draw(pen: PenLayer, points: Array<[number, number]>) {
  const [first, ...rest] = points;
  pen.down(...(first as [number, number]));
  for (const p of rest) pen.move(...p);
}

test('a drag is reported in pieces that append to one stroke id, and ends with done', () => {
  const pen = new PenLayer();
  pen.turnOn();
  draw(pen, [[100, 100], [120, 110], [140, 130]]);
  const a = pen.take();
  assert.deepEqual(a, [{ id: 1, points: [[100, 100], [120, 110], [140, 130]], done: false }]);
  pen.move(160, 150);
  pen.up();
  assert.deepEqual(pen.take(), [{ id: 1, points: [[160, 150]], done: true }]);
  draw(pen, [[10, 10], [30, 30]]);
  assert.equal(pen.take()[0]?.id, 2, 'the next press is the next id');
});

test('a click or a twitch draws and reports nothing', () => {
  const pen = new PenLayer();
  pen.turnOn();
  draw(pen, [[500, 500], [501, 500.5]]);
  pen.up();
  assert.deepEqual(pen.take(), []);
  assert.equal(pen.view(0).strokes.length, 0);
});

test('nothing is drawn while the pen is off, and releasing the keys ends a stroke in progress', () => {
  const pen = new PenLayer();
  draw(pen, [[0, 0], [100, 100]]);
  assert.equal(pen.view(0).strokes.length, 0);
  pen.turnOn();
  draw(pen, [[0, 0], [100, 100]]);
  pen.turnOff();
  const pieces = pen.take();
  assert.equal(pieces.at(-1)?.done, true);
  assert.equal(pen.view(0).strokes.length, 1, 'what was drawn stays');
});

test('the stroke stays until the answer begins, then fades over 0.6 s; a new pen removes it at once', () => {
  const pen = new PenLayer();
  pen.turnOn();
  draw(pen, [[0, 0], [100, 100]]);
  pen.turnOff();
  assert.equal(pen.view(5000).alpha, 1, 'it waits for the answer');
  assert.equal(pen.animating(5000), false);
  pen.fade(10_000);
  assert.equal(pen.animating(10_000), true);
  const mid = pen.view(10_000 + PEN_FADE_MS / 2).alpha;
  assert.ok(mid > 0.4 && mid < 0.6, String(mid));
  assert.equal(pen.view(10_000 + PEN_FADE_MS + 1).strokes.length, 0);
  // A second chord removes a stroke that has not yet faded.
  pen.turnOn();
  draw(pen, [[0, 0], [100, 100]]);
  pen.turnOff();
  pen.turnOn();
  assert.equal(pen.view(0).strokes.length, 0);
});

const SIZE = { width: 1000, height: 500 };

/** A loop drawn over one second, a point every 50 ms, pen down at `at`. */
function drawLoop(pen: PenLayer, at = 0): number {
  const loop: Array<[number, number]> = [];
  for (let i = 0; i <= 20; i++) loop.push([500 + 150 * Math.cos((i / 20) * Math.PI * 2), 250 + 100 * Math.sin((i / 20) * Math.PI * 2)]);
  pen.down(...(loop[0] as [number, number]), at);
  loop.slice(1).forEach((p, i) => pen.move(...p, at + (i + 1) * 50));
  pen.up();
  return loop.length;
}

/** The picture of the first stroke at `now`, as the opacity of each pixel (0..1) and the ribbon it was made from. */
function picture(pen: PenLayer, now: number, options: { reduceMotion?: boolean } = {}) {
  const view = pen.view(now, options);
  const ribbon = penRibbon(view.strokes[0] as NonNullable<typeof view.strokes[0]>, SIZE, now, view.decayMs);
  const raster = ribbon && rasterRibbon(ribbon, SIZE);
  assert.ok(ribbon && raster, 'a stroke is drawn');
  const at = (x: number, y: number): number => {
    const px = Math.floor(x) - raster.x, py = Math.floor(y) - raster.y;
    return px < 0 || py < 0 || px >= raster.w || py >= raster.h ? 0 : (raster.data[(py * raster.w + px) * 4 + 3] as number) / 255;
  };
  let peak = 0;
  for (let k = 3; k < raster.data.length; k += 4) peak = Math.max(peak, (raster.data[k] as number) / 255);
  return { ribbon, raster, at, peak };
}

test('the pen is a soft translucent marker in the style\'s red, with no dark outline', () => {
  const pen = new PenLayer();
  pen.turnOn();
  pen.down(100, 100); pen.move(200, 150); pen.move(300, 100); pen.move(400, 160); pen.up(); // no clock: no decay
  const { raster, peak } = picture(pen, 1000);
  assert.ok(peak > 0.5 && peak < 0.75, 'translucent, strongest in the body: ' + peak.toFixed(2));
  for (let k = 0; k < raster.data.length; k += 4) {
    if (raster.data[k + 3] === 0) continue;
    assert.deepEqual([raster.data[k], raster.data[k + 1], raster.data[k + 2]], [226, 84, 90], 'only the style\'s red, nothing dark');
  }
});

test('what is drawn settles about a second behind the pen to a muted trace, about a fifth of full strength, and does not go away', () => {
  const pen = new PenLayer();
  pen.turnOn();
  const points = drawLoop(pen);
  const fresh = picture(pen, 1000); // the pen has just reached the end: the start of the loop is a whole decay old
  const settled = picture(pen, 1000 + PEN_DECAY_MS + 50);
  const later = picture(pen, 120_000);
  assert.ok(fresh.peak > 0.5, 'full at the pen: ' + fresh.peak.toFixed(2));
  const first = fresh.ribbon.pts[Math.round(fresh.ribbon.pts.length * 0.15)] as { x: number; y: number };
  assert.ok(fresh.at(first.x, first.y) < 0.3, 'and muted at the old end of the same stroke: ' + fresh.at(first.x, first.y).toFixed(2));
  assert.ok(settled.peak <= 0.6 * PEN_REST + 0.16 * PEN_REST + 0.02 && settled.peak >= 0.6 * PEN_REST - 0.03, `a settled stroke is about ${PEN_REST * 100} per cent of full: ${(settled.peak / 0.64).toFixed(2)}`);
  assert.ok(Math.abs(later.peak - settled.peak) < 0.005, 'and it stays so until the answer');
  // Whatever it looks like, the main process got every point.
  const sent = pen.take();
  assert.equal(sent.reduce((n, s) => n + s.points.length, 0), points);
  assert.equal(sent.at(-1)?.done, true);
});

test('the marker is one continuous ribbon: along its line the opacity runs smoothly from the old end to the pen, with no steps or lines across it', () => {
  const pen = new PenLayer();
  pen.turnOn();
  drawLoop(pen);
  for (const now of [1000, 1300, 1700]) {
    const { ribbon, at } = picture(pen, now);
    const along = ribbon.pts.slice(2, -2).map((p) => at(p.x, p.y));
    let worst = 0, dip = 0;
    for (let i = 1; i < along.length; i++) {
      worst = Math.max(worst, Math.abs((along[i] as number) - (along[i - 1] as number)));
      dip = Math.max(dip, (along[i - 1] as number) - (along[i] as number)); // it never gets weaker towards the pen
    }
    assert.ok(worst < 0.035, `at ${now} ms no step between neighbouring points on the line: ${worst.toFixed(3)}`);
    assert.ok(dip < 0.012, `at ${now} ms and no weaker patch (a seam) on the way: ${dip.toFixed(3)}`);
  }
});

test('a stroke that crosses itself does not pile up into a dark bead: the stronger of the two is kept', () => {
  const pen = new PenLayer();
  pen.turnOn();
  pen.down(100, 250);
  for (let i = 1; i <= 60; i++) pen.move(100 + 8 * i + 40 * Math.sin(i / 3), 250 + 90 * Math.sin(i / 5));
  pen.up();
  assert.ok(picture(pen, 1000).peak < 0.75, 'no pixel stronger than the marker itself');
});

test('decay is only how it looks: it animates while the tail settles and then is still; with reduced motion the stroke stays at full strength until the answer, then fades as before', () => {
  const pen = new PenLayer();
  pen.turnOn();
  pen.down(100, 100, 0);
  pen.move(300, 200, 100);
  pen.move(500, 100, 200);
  pen.up();
  pen.turnOff();
  assert.equal(pen.animating(500), true);
  assert.equal(pen.animating(200 + PEN_DECAY_MS + 1), false, 'once it has settled the picture is still');
  assert.equal(pen.animating(500, { reduceMotion: true }), false, 'no decay with reduced motion');
  assert.ok(picture(pen, 60_000, { reduceMotion: true }).peak > 0.5, 'a minute later the whole stroke is still at full strength');
  assert.ok(picture(pen, 60_000).peak < 0.2, 'with decay it is muted');
  pen.fade(70_000);
  assert.ok(pen.view(70_000 + PEN_FADE_MS / 2, { reduceMotion: true }).alpha < 0.6);
  assert.equal(pen.view(70_000 + PEN_FADE_MS + 1, { reduceMotion: true }).strokes.length, 0);
});

test('undo takes back the last circle, from the screen and from what is sent: the main process is told to drop it, and its points are not sent', () => {
  const pen = new PenLayer();
  pen.turnOn();
  assert.equal(pen.canUndo, false, 'nothing drawn: nothing to undo');
  assert.equal(pen.undo(), false);
  drawLoop(pen, 0);
  const first = pen.take();
  drawLoop(pen, 2000);
  assert.equal(pen.canUndo, true);
  assert.equal(pen.undo(), true);
  const view = pen.view(5000);
  assert.equal(view.strokes.length, 1, 'one circle is left on the screen');
  const told = pen.take();
  assert.deepEqual(told, [{ id: 2, points: [], done: true, removed: true }], 'only the removal of the second circle is sent, not its points');
  assert.equal(first.length > 0 && first.every((p) => p.id === 1), true);
  assert.equal(pen.undo(), true);
  assert.equal(pen.canUndo, false, 'the button hides when nothing is left');
  assert.equal(pen.view(5000).strokes.length, 0);
  assert.deepEqual(pen.take(), [{ id: 1, points: [], done: true, removed: true }]);
  // A stroke drawn and taken back before anything was sent is never sent.
  drawLoop(pen, 9000);
  assert.equal(pen.undo(), true);
  assert.deepEqual(pen.take(), [{ id: 3, points: [], done: true, removed: true }]);
  // A new circle after an undo has a fresh id (numbering follows the circles that are left).
  drawLoop(pen, 12000);
  assert.equal(pen.take().find((p) => p.points.length > 0)?.id, 4);
});

test('undo while a circle is being drawn takes that circle back; undo does nothing once the answer has begun or the pen is off', () => {
  const pen = new PenLayer();
  pen.turnOn();
  pen.down(100, 100, 0);
  pen.move(300, 200, 50);
  pen.move(500, 100, 100);
  assert.equal(pen.undo(), true, 'the circle in progress goes');
  assert.equal(pen.view(200).strokes.length, 0);
  drawLoop(pen, 1000);
  pen.turnOff();
  pen.fade(5000);
  assert.equal(pen.canUndo, false, 'nothing to undo with the pen off');
  assert.equal(pen.undo(), false);
});

test('cancelling clears everything at once: nothing is drawn, nothing more is sent, and the pen is off', () => {
  const pen = new PenLayer();
  pen.turnOn();
  drawLoop(pen, 0);
  pen.down(10, 10, 3000);
  pen.move(200, 200, 3050);
  pen.cancel();
  assert.equal(pen.view(3100).strokes.length, 0);
  assert.deepEqual(pen.take(), []);
  assert.equal(pen.active, false);
  pen.down(10, 10, 3200);
  pen.move(300, 300, 3250);
  assert.deepEqual(pen.take(), [], 'a pen that is off draws nothing');
  assert.equal(pen.lastBox(), undefined);
});

test('the box of the last circle is where the undo button goes: it follows the last stroke only', () => {
  const pen = new PenLayer();
  pen.turnOn();
  pen.down(100, 100, 0); pen.move(200, 150, 50); pen.move(300, 100, 100); pen.up();
  pen.down(600, 600, 500); pen.move(700, 650, 550); pen.move(800, 600, 600); pen.up();
  assert.deepEqual(pen.lastBox(), { x0: 600, y0: 600, x1: 800, y1: 650 });
  pen.undo();
  assert.deepEqual(pen.lastBox(), { x0: 100, y0: 100, x1: 300, y1: 150 });
});

test('a shaky hand reads as a calm line: the points are set evenly and smoothed, the ends and the times are kept', () => {
  const raw = [];
  for (let i = 0; i <= 60; i++) raw.push({ x: i * 5, y: 100 + (i % 2 === 0 ? 4 : -4), t: i * 10 });
  const line = calmLine(raw, 6);
  assert.equal(line[0]?.x, 0);
  assert.ok(Math.abs((line.at(-1)?.x ?? 0) - 300) < 0.01);
  const wobble = (pts: Array<{ y: number }>): number => pts.reduce((m, p) => Math.max(m, Math.abs(p.y - 100)), 0);
  assert.ok(wobble(line.slice(2, -2)) < 1.5, 'a 4 px zigzag is smoothed to under 1.5: ' + wobble(line.slice(2, -2)).toFixed(2));
  assert.ok(line.every((p, i) => i === 0 || p.t >= (line[i - 1] as { t: number }).t), 'times run forward');
});

test('while the pen is on a right click cancels the question and is taken whole; a press on the Undo button does not draw; no other button does anything, and none reaches the page', () => {
  assert.deepEqual(routePenPointer({ button: 0, onUndo: false }), { act: 'draw', consume: false });
  assert.deepEqual(routePenPointer({ button: 2, onUndo: false }), { act: 'cancel', consume: true });
  assert.deepEqual(routePenPointer({ button: 0, onUndo: true }), { act: 'none', consume: true }, 'a click on the button starts no stroke');
  assert.deepEqual(routePenPointer({ button: 2, onUndo: true }), { act: 'none', consume: true }, 'a right click on the button is not a cancel');
  assert.deepEqual(routePenPointer({ button: 1, onUndo: false }), { act: 'none', consume: true });
});

test('the Undo button sits just right of the last circle, left of it when there is no room, and always on screen', () => {
  const size = { width: 1920, height: 1000 };
  const button = { w: 70, h: 30 };
  const near = undoPlace({ x0: 100, y0: 400, x1: 300, y1: 600 }, size, button);
  assert.ok(near.x > (300 / 1000) * 1920 && near.x < (300 / 1000) * 1920 + 30, 'beside the circle on its right: ' + near.x);
  assert.ok(near.y >= 8 && near.y <= (400 / 1000) * 1000 + 10, 'at the height of its top');
  const edge = undoPlace({ x0: 800, y0: 0, x1: 990, y1: 100 }, size, button);
  assert.ok(edge.x < (800 / 1000) * 1920, 'no room on the right: it goes to the left of the circle: ' + edge.x);
  assert.ok(edge.y >= 8, 'and stays on screen at the top');
  const corner = undoPlace({ x0: 0, y0: 990, x1: 1000, y1: 1000 }, size, button);
  assert.ok(corner.x >= 8 && corner.x + button.w <= size.width - 8 && corner.y + button.h <= size.height - 8, 'and in the corner');
});

test('a stroke being drawn hides the button (the layer says so); a finished one shows it', () => {
  const pen = new PenLayer();
  pen.turnOn();
  pen.down(100, 100, 0);
  assert.equal(pen.drawing, false, 'a press with no move is not a stroke yet');
  pen.move(300, 200, 50);
  assert.equal(pen.drawing, true);
  pen.up();
  assert.equal(pen.drawing, false);
  assert.equal(pen.canUndo, true);
});
