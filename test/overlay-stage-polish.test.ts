import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Scene } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { drawPin } from '../src/overlay/annotations.ts';
import { Placer, pageGrid } from '../src/overlay/placement.ts';
import { frameAt } from '../src/overlay/timeline.ts';

const sample = (name: string): Scene => JSON.parse(readFileSync(new URL(`../samples/scenes/${name}`, import.meta.url), 'utf8')) as Scene;
const VIEW = { rect: { x: 0, y: 0, w: 600, h: 600 }, width: 1000, height: 800 };
const distance = (p: PanelScene) => p.camera.position.length();

test('the camera glides to a new framing when parts are added, and takes the model as it is without a clock', () => {
  const turbine = sample('wind-turbine.json');
  const few = frameAt(turbine.steps, 0, 0.5);
  const all = frameAt(turbine.steps, turbine.steps.length - 1, 999);
  // Where the camera stands for the whole model, with no clock: the framing is taken as it is.
  const target = new PanelScene();
  target.sync(all, 1, VIEW);
  const wanted = distance(target);
  const small = new PanelScene();
  small.sync(few, 1, VIEW);
  assert.ok(Math.abs(distance(small) - wanted) > wanted * 0.05, 'a few parts and the whole model are framed differently');

  const glide = new PanelScene();
  glide.sync(few, 1, { ...VIEW, now: 0 });
  const start = distance(glide);
  glide.sync(all, 1, { ...VIEW, now: 60 });
  const soon = distance(glide);
  assert.ok(glide.fitting, 'still on its way');
  const lo = Math.min(start, wanted), hi = Math.max(start, wanted);
  assert.ok(soon > lo && soon < hi, `part of the way: ${start.toFixed(2)} ${soon.toFixed(2)} ${wanted.toFixed(2)}`);
  assert.ok(Math.abs(soon - start) < Math.abs(wanted - start) * 0.5, 'less than half the way after a fraction of a second');
  for (let t = 160; t <= 6000; t += 100) glide.sync(all, 1, { ...VIEW, now: t }); // a long pause is taken a quarter second at a time
  assert.ok(Math.abs(distance(glide) - wanted) < wanted * 0.01, 'and there in the end');
  assert.ok(!glide.fitting, 'settled: no more frames are wanted');
});

test('a stage is never shrunk below three quarters to find room, and what is drawn has room round the model', () => {
  const COLS = 192, ROWS = 108;
  const gray = new Uint8Array(COLS * ROWS);
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) gray[r * COLS + c] = (c * 7 + r * 13) % 5 < 2 ? 40 : 238; // text all over
  const placed = new Placer(pageGrid(gray, COLS, ROWS), { aspect: 16 / 9 }).panel({ x: 300, y: 200, w: 400, h: 500 });
  assert.ok(placed.w >= 400 * 0.76 - 1 && placed.h >= 500 * 0.76 - 1, `${JSON.stringify(placed)}`);

  const panel = new PanelScene();
  const frame = frameAt(sample('wind-turbine.json').steps, 7, 999);
  panel.sync(frame, 1, VIEW);
  const b = panel.screenBounds(1000, 800)!;
  assert.ok(b.drawn.x < b.model.x - 5 && b.drawn.y < b.model.y - 5, 'padded on the top and left');
  assert.ok(b.drawn.x + b.drawn.w > b.model.x + b.model.w + 5 && b.drawn.y + b.drawn.h > b.model.y + b.model.h + 5, 'and the bottom and right');
});

test('tags are drawn smaller beside a small stage, down to 70%, and not at all smaller beside a usual one', () => {
  const scene: Scene = { steps: [{ say: 'x', actions: [
    { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1], color: 'blue' },
    { op: 'pin', id: 'p', on: 'b', text: 'Part', color: 'red' },
  ] }] };
  const frame = frameAt(scene.steps, 0, 99);
  const mark = frame.marks[0]!;
  const sizeFor = (stage?: { w: number; h: number }): number => {
    const fonts: string[] = [];
    const ctx = new Proxy({ measureText: () => ({ width: 60 }) } as Record<string, unknown>, {
      get(t, key: string) { return key in t ? t[key] : () => undefined; },
      set(t, key: string, v) { if (key === 'font') fonts.push(String(v)); t[key] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    drawPin(ctx, { ...mark, appear: 1 }, {
      view: { width: 1920, height: 1080, dpr: 1 }, ...(stage ? { stage } : {}),
      project: () => ({ x: 900, y: 500, visible: true }),
    }, 0);
    return Number(/(\d+(?:\.\d+)?)px/.exec(fonts[0] as string)?.[1]);
  };
  const usual = sizeFor({ w: 700, h: 700 });
  assert.equal(sizeFor(), usual, 'no stage: as before');
  const tiny = sizeFor({ w: 200, h: 220 });
  assert.ok(tiny < usual && tiny >= usual * 0.69, `${tiny} against ${usual}`);
  assert.ok(sizeFor({ w: 600, h: 480 }) > tiny);
});
