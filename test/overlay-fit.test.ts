import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import type { Sprite } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { TAG_HEIGHT_FACTOR, tagTextPx } from '../src/overlay/theme.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const settled = (...actions: unknown[]): Frame => frameAt([step({ op: 'panel', x: 100, y: 100, w: 600, h: 500 }, ...actions)], 0, 99);
const WIN = { width: 1400, height: 900 };

test('a long model fills a wide stage, and a tall one a tall stage, instead of the all-round sphere leaving them small', () => {
  const wide = { x: 100, y: 100, w: 800, h: 300 };
  const long = settled({ op: 'add', shape: 'box', id: 'a', size: [40, 2, 2] }, { op: 'orbit', az: 0, el: 0, dur: 0 });
  const scene = new PanelScene();
  scene.sync(long, wide.w / wide.h, { rect: wide, ...WIN });
  const b = scene.screenBounds(WIN.width, WIN.height)!.model;
  assert.ok(b.w / wide.w > 0.8, `long model across a wide stage: ${Math.round((b.w / wide.w) * 100)}%`);
  assert.ok(b.x >= wide.x - 4 && b.x + b.w <= wide.x + wide.w + 4, 'and inside it');
  const tall = { x: 100, y: 50, w: 260, h: 700 };
  const mast = settled({ op: 'add', shape: 'box', id: 'a', size: [2, 40, 2] }, { op: 'orbit', az: 0, el: 0, dur: 0 });
  const scene2 = new PanelScene();
  scene2.sync(mast, tall.w / tall.h, { rect: tall, ...WIN });
  const t = scene2.screenBounds(WIN.width, WIN.height)!.model;
  assert.ok(t.h / tall.h > 0.8 && t.y >= tall.y - 4 && t.y + t.h <= tall.y + tall.h + 4, `tall: ${Math.round((t.h / tall.h) * 100)}%`);
});

test('a ball is bounded by the ball, not by the box round it', () => {
  const stage = { x: 100, y: 100, w: 500, h: 500 };
  const frame = settled({ op: 'add', shape: 'sphere', id: 'a', size: [6, 6, 6] }, { op: 'orbit', az: 30, el: 20, dur: 0 });
  const scene = new PanelScene();
  scene.sync(frame, 1, { rect: stage, ...WIN });
  const b = scene.screenBounds(WIN.width, WIN.height)!.model;
  assert.ok(Math.abs(b.w - b.h) < b.w * 0.05, `round on screen: ${Math.round(b.w)} by ${Math.round(b.h)}`);
});

test('the camera stands still while a part is posed or pulses: it frames the model at rest', () => {
  const stage = { x: 100, y: 100, w: 500, h: 400 };
  const rest = settled({ op: 'add', shape: 'box', id: 'body', size: [6, 2, 2] }, { op: 'add', shape: 'box', id: 'rod', size: [1, 1, 1], pos: [0, 2, 0] }, { op: 'orbit', az: 20, el: 10, dur: 0 });
  const scene = new PanelScene();
  scene.sync(rest, 1.25, { rect: stage, ...WIN });
  const at = scene.camera.position.clone();
  const rod = rest.objects.find((o) => o.id === 'rod')!;
  for (const moved of [{ ...rod, pose: { pos: [0, 2, 9] as [number, number, number] } }, { ...rod, pulse: 1 }]) {
    const frame: Frame = { ...rest, objects: rest.objects.map((o) => (o.id === 'rod' ? moved : o)) };
    scene.sync(frame, 1.25, { rect: stage, ...WIN });
    assert.ok(scene.camera.position.distanceTo(at) < 1e-6, 'the camera did not move');
  }
});

// ---- text in the scene ---------------------------------------------------------------------------

const fakeCanvas = (w: number, h: number) => {
  const ctx = new Proxy({ measureText: (t: string) => ({ width: t.length * 50 }), createLinearGradient: () => ({ addColorStop: () => {} }), createRadialGradient: () => ({ addColorStop: () => {} }) } as Record<string, unknown>, {
    get: (t, k: string) => (k in t ? t[k] : () => {}),
    set: () => true,
  });
  return { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement;
};
const textRects = (scene: PanelScene, frame: Frame) => frame.objects.filter((o) => o.shape === 'text').map((o) => {
  const sprite = scene.nodeOf(o.key) as Sprite;
  const at = scene.project(o.key, undefined, WIN.width, WIN.height)!;
  const k = scene.camera.projectionMatrix.elements[5]! * WIN.height / 2;
  const depth = -sprite.getWorldPosition(new Vector3()).applyMatrix4(scene.camera.matrixWorldInverse).z;
  const h = (sprite.scale.y * k) / depth, w = (sprite.scale.x / sprite.scale.y) * h;
  const cy = at.y - (sprite.center.y - 0.5) * h;
  return { x0: at.x - w / 2, x1: at.x + w / 2, y0: cy - h / 2, y1: cy + h / 2, h };
});

test('text in the scene is never drawn tiny, and labels at one spot do not pile on each other', () => {
  const stage = { x: 700, y: 100, w: 300, h: 300 };
  const frame = settled(
    { op: 'add', shape: 'box', id: 'a', size: [30, 4, 4] },
    { op: 'add', shape: 'text', id: 't1', pos: [0, 2, 0], text: 'Q1: 2.1', height: 0.4, color: 'white' },
    { op: 'add', shape: 'text', id: 't2', pos: [0, 2, 0], text: 'Q2: 3.4', height: 0.4, color: 'white' },
    { op: 'add', shape: 'text', id: 't3', pos: [0, 2, 0], text: 'Q3: 3.0', height: 0.4, color: 'white' },
    { op: 'orbit', az: 0, el: 0, dur: 0 },
  );
  const scene = new PanelScene({ makeCanvas: fakeCanvas });
  scene.sync(frame, 1, { rect: stage, ...WIN });
  const rects = textRects(scene, frame);
  assert.equal(rects.length, 3);
  const tag = Math.ceil(tagTextPx(WIN.height, stage) * TAG_HEIGHT_FACTOR);
  for (const r of rects) assert.ok(r.h >= tag - 0.1 && r.h <= tag * 1.3 + 0.1, `as tall as a tag (${tag} px), not more than 1.3 times: ${r.h.toFixed(1)} px`);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i]!, b = rects[j]!;
    assert.ok(a.x1 <= b.x0 || b.x1 <= a.x0 || a.y1 <= b.y0 || b.y1 <= a.y0, `labels ${i} and ${j} do not overlap`);
  }
});

// ---- tubes ---------------------------------------------------------------------------------------

test('a tube that arches over never twists: its rings turn smoothly where the path passes straight up or down', async () => {
  const { tubeGeometry } = await import('../src/overlay/geometry.ts');
  const path: Array<[number, number, number]> = [];
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI;
    path.push([-2 * Math.cos(a), 2 * Math.sin(a), 0]);
  }
  const radial = 8;
  const geo = tubeGeometry(path, 0.3, 1, radial);
  const pos = geo.getAttribute('position');
  const ringVertex = (i: number) => new Vector3(pos.getX(i * (radial + 1)) - path[i]![0], pos.getY(i * (radial + 1)) - path[i]![1], pos.getZ(i * (radial + 1)) - path[i]![2]);
  let worst = 0;
  for (let i = 1; i < path.length; i++) worst = Math.max(worst, ringVertex(i).angleTo(ringVertex(i - 1)));
  assert.ok(worst < 0.5, `the largest turn from one ring to the next is ${((worst * 180) / Math.PI).toFixed(0)} degrees`);
});

// ---- solids that read as objects -----------------------------------------------------------------

test('a plain cylinder has a rounded rim, a blob is lit from above to below, and tissue has a soft edge light', async () => {
  const { roundedCylinderGeometry, shadeByHeight } = await import('../src/overlay/geometry.ts');
  const { makeSurface, TIERS } = await import('../src/overlay/materials.ts');
  const cyl = roundedCylinderGeometry(2, 3, 2, 24);
  cyl.computeBoundingBox();
  const size = cyl.boundingBox!.getSize(new Vector3());
  assert.ok(Math.abs(size.x - 2) < 1e-4 && Math.abs(size.y - 3) < 1e-4 && Math.abs(size.z - 2) < 1e-4, `the size asked for: ${size.toArray().join(', ')}`);
  // Nothing sits on the sharp corner a plain cylinder has: no vertex at the full radius on a cap's plane.
  const pos = cyl.getAttribute('position');
  let corner = false;
  for (let i = 0; i < pos.count; i++) if (Math.abs(Math.abs(pos.getY(i)) - 1.5) < 1e-6 && Math.hypot(pos.getX(i), pos.getZ(i)) > 0.99) corner = true;
  assert.ok(!corner, 'the rim is rounded off');
  const blob = roundedCylinderGeometry(2, 2, 2, 12);
  shadeByHeight(blob);
  const colour = blob.getAttribute('color');
  const normal = blob.getAttribute('normal');
  let top = 0, bottom = 0;
  for (let i = 0; i < normal.count; i++) {
    if (normal.getY(i) > 0.99) top = colour.getX(i);
    if (normal.getY(i) < -0.99) bottom = colour.getX(i);
  }
  assert.ok(top > bottom + 0.2, `lighter facing up (${top.toFixed(2)}) than down (${bottom.toFixed(2)})`);
  assert.ok(makeSurface('tissue', TIERS.high).sheen > 0, 'tissue has a sheen');
  assert.equal(makeSurface('metal', TIERS.high).sheen, 0);
});

test('the floor shadow is lighter under a see-through model, so it does not grey the layers inside', () => {
  const stage = { x: 100, y: 100, w: 400, h: 400 };
  const opacityFor = (material: string): number => {
    const frame = settled({ op: 'add', shape: 'sphere', id: 'a', size: [6, 6, 6], material, opacity: 0.4 }, { op: 'add', shape: 'sphere', id: 'b', size: [2, 2, 2] });
    const scene = new PanelScene({ makeCanvas: fakeCanvas });
    scene.sync(frame, 1, { rect: stage, ...WIN });
    return ((scene as unknown as { floor: { material: { opacity: number } } }).floor.material.opacity);
  };
  const solid = opacityFor('plastic');
  const seeThrough = opacityFor('glass');
  assert.ok(seeThrough < solid * 0.8, `glass ${seeThrough.toFixed(3)} against plastic ${solid.toFixed(3)}`);
});

test('what is drawn includes the text that was moved off its point, so the render scissor does not cut it', () => {
  const stage = { x: 700, y: 100, w: 300, h: 300 };
  const frame = settled(
    { op: 'add', shape: 'box', id: 'a', size: [30, 4, 4] },
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ op: 'add', shape: 'text', id: `t${n}`, pos: [0, 2, 0], text: `Q${n}: 2.1`, height: 0.4, color: 'white' })),
    { op: 'orbit', az: 0, el: 0, dur: 0 },
  );
  const scene = new PanelScene({ makeCanvas: fakeCanvas });
  scene.sync(frame, 1, { rect: stage, ...WIN });
  const { drawn } = scene.screenBounds(WIN.width, WIN.height)!;
  for (const r of textRects(scene, frame)) {
    assert.ok(r.x0 >= drawn.x - 1 && r.x1 <= drawn.x + drawn.w + 1 && r.y0 >= drawn.y - 1 && r.y1 <= drawn.y + drawn.h + 1, `a label at ${JSON.stringify(r)} is inside what is drawn ${JSON.stringify(drawn)}`);
  }
});

test('a flat ribbon that starts flat and bends up faces the viewer along the climb, not edge-on', async () => {
  const { tubeGeometry } = await import('../src/overlay/geometry.ts');
  const path: Array<[number, number, number]> = [];
  for (let i = 0; i <= 10; i++) path.push([3 * (i / 10), 0, 0]);
  for (let i = 1; i <= 10; i++) path.push([3, 3 * (i / 10), 0]);
  const geo = tubeGeometry(path, 0.2, 0.1, 8);
  const pos = geo.getAttribute('position');
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) < 2 || pos.getY(i) > 2.8) continue;
    x0 = Math.min(x0, pos.getX(i)); x1 = Math.max(x1, pos.getX(i)); z0 = Math.min(z0, pos.getZ(i)); z1 = Math.max(z1, pos.getZ(i));
  }
  assert.ok(x1 - x0 > (z1 - z0) * 2, `wider in x (${(x1 - x0).toFixed(2)}) than in z (${(z1 - z0).toFixed(2)})`);
});

test('a flat ribbon on a quarter circle from heading along x to heading up never turns more than a few degrees between two rings', async () => {
  const { tubeGeometry } = await import('../src/overlay/geometry.ts');
  const path: Array<[number, number, number]> = [];
  for (let i = 0; i <= 60; i++) { const a = (i / 60) * (Math.PI / 2); path.push([3 * Math.sin(a), 3 - 3 * Math.cos(a), 0]); }
  const radial = 12, row = radial + 1;
  const geo = tubeGeometry(path, 0.3, 0.2, radial);
  const pos = geo.getAttribute('position');
  let prev: Vector3 | undefined, worst = 0;
  for (let i = 0; i < path.length; i++) {
    let far = 0;
    const wide = new Vector3();
    for (let j = 0; j < radial; j++) {
      const k = i * row + j;
      const d = new Vector3(pos.getX(k) - path[i]![0], pos.getY(k) - path[i]![1], pos.getZ(k) - path[i]![2]);
      if (d.length() > far) { far = d.length(); wide.copy(d).normalize(); }
    }
    if (prev) worst = Math.max(worst, Math.acos(Math.min(1, Math.abs(wide.dot(prev)))) * (180 / Math.PI));
    prev = wide;
  }
  assert.ok(worst < 10, `the widest turn between two rings is ${worst.toFixed(1)} degrees`);
});
