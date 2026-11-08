import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, LineSegments, Vector3 } from 'three';
import type { Mesh, Object3D } from 'three';
import { createSceneState, sceneGuide, validateStep } from '../src/scene/index.ts';
import type { Step, Vec3 } from '../src/scene/index.ts';
import { anchorsOf } from '../src/scene/anchors.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame, ObjectFrame } from '../src/overlay/timeline.ts';

// An attached part stays at its point through every movement: the point of it that was put at the parent's point is still there while it is moved,
// turned, spun, swung or swelled, by an offset it keeps, and until it is let go. Explode pulls it away and draws a faint line back.

const DEG = Math.PI / 180;
const panel = { op: 'panel', x: 100, y: 100, w: 600, h: 500 };
const box = (id: string, size: Vec3, extra: object = {}) => ({ op: 'add', shape: 'box', id, size, ...extra });
const frameOf = (actions: unknown[], t: number): Frame => evaluate(planStep(emptyFrame(), { say: 'x', actions: [panel, ...actions] } as Step), t);
const obj = (frame: Frame, id: string): ObjectFrame => frame.objects.find((o) => o.id === id)!;
/** A point of an object, in its parent's space, as the frame has it placed. */
function placed(o: ObjectFrame, local: Vec3): Vec3 {
  const pos = o.pose?.pos ?? o.pos;
  const rot = o.pose?.rot ?? o.rot;
  const s = o.pose?.scale ?? [1, 1, 1];
  const v = new Vector3(local[0] * o.scale[0] * s[0], local[1] * o.scale[1] * s[1], local[2] * o.scale[2] * s[2]).applyEuler(new Euler(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ'));
  return [v.x + pos[0], v.y + pos[1], v.z + pos[2]];
}
const near = (a: Vec3, b: Vec3, why: string): void => assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 1e-6, `${why}: ${a.map((x) => x.toFixed(4))} is not ${b.map((x) => x.toFixed(4))}`);

const base = box('base', [2, 2, 2]);
const arm = (extra: object = {}) => box('arm', [1, 3, 1], { parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', ...extra });

test('every shape has its built-in points, in its own space, and the model\'s named points win', () => {
  const a = anchorsOf({ shape: 'box', size: [2, 4, 6] });
  assert.deepEqual([a.top, a.bottom, a.right, a.left, a.front, a.back, a.center], [[0, 2, 0], [0, -2, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 3], [0, 0, -3], [0, 0, 0]]);
  assert.deepEqual(anchorsOf({ shape: 'tube', pts: [[0, 0, 0], [1, 2, 3]], radius: 0.1 }).end, [1, 2, 3]);
  assert.equal(anchorsOf({ shape: 'tube', pts: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], radius: 0.1, closed: true }).start, undefined, 'a loop has no ends');
  assert.deepEqual(anchorsOf({ shape: 'lathe', profile: [[1, 0], [2, 3]] }).top, [0, 3, 0]);
  assert.deepEqual(anchorsOf({ shape: 'extrude', outline: [[-1, -1], [1, -1], [0, 2]], depth: 4 }).front, [0, 0.5, 2]);
  assert.deepEqual(anchorsOf({ shape: 'box', size: [2, 4, 6], points: { top: [9, 9, 9], hinge: [1, 0, 0] } }).hinge, [1, 0, 0]);
  assert.deepEqual(anchorsOf({ shape: 'box', size: [2, 4, 6], points: { top: [9, 9, 9] } }).top, [9, 9, 9], 'a name the model gave beats the built-in');
  assert.notDeepEqual(anchorsOf({ shape: 'part', part: 'piston', size: [2, 3, 2] }).crown, undefined, 'a kit part keeps its own names');
});

test('an attached part sits at its point, and a point of it follows the parent wherever the parent goes', () => {
  const still = frameOf([base, arm()], 1);
  near(placed(obj(still, 'arm'), [0, -1.5, 0]), [0, 1, 0], 'arm bottom on base top');
  const moved = frameOf([base, arm(), { op: 'move', id: 'base', to: [3, 0, 0], dur: 0 }, { op: 'turn', id: 'base', to: [0, 45, 0], dur: 0 }], 1);
  assert.equal(obj(moved, 'arm').parentKey, obj(moved, 'base').key, 'it rides in its parent, which carries it');
  near(placed(obj(moved, 'arm'), [0, -1.5, 0]), [0, 1, 0], 'still at the same point in the parent\'s space');
});

test('a turn swings an attached part about its point, and a move is an offset from it', () => {
  const turned = frameOf([base, arm(), { op: 'turn', id: 'arm', to: [0, 0, 90], dur: 0 }], 1);
  near(placed(obj(turned, 'arm'), [0, -1.5, 0]), [0, 1, 0], 'turned about its bottom');
  assert.deepEqual(obj(turned, 'arm').rot, [0, 0, 90]);
  const slid = frameOf([base, arm(), { op: 'move', id: 'arm', to: [0.5, 0.25, 0], dur: 0 }], 1);
  near(placed(obj(slid, 'arm'), [0, -1.5, 0]), [0.5, 1.25, 0], 'its point is the parent\'s point plus the offset');
  const born = frameOf([base, arm({ pos: [0.5, 0, 0] })], 1);
  near(placed(obj(born, 'arm'), [0, -1.5, 0]), [0.5, 1, 0], 'pos written with it is the same offset');
});

test('a spinning, swinging or swelling attached part stays on its point', () => {
  const door = (extra: object = {}) => box('door', [2, 3, 0.2], { parent: 'frame', parentAnchor: 'left', selfAnchor: 'left', ...extra });
  const frame = box('frame', [4, 4, 0.4]);
  let restRight: Vec3 | undefined;
  for (const t of [0, 0.4, 0.9, 1.3]) {
    const f = frameOf([frame, door(), { op: 'loop', id: 'door', kind: 'swing', axis: 'y', amount: 60, period: 2 }], t);
    near(placed(obj(f, 'door'), [-1, 0, 0]), [-2, 0, 0], `door hinge edge at ${t}`);
    const right = placed(obj(f, 'door'), [1, 0, 0]);
    if (!restRight) restRight = right;
    else if (t === 0.4) assert.ok(Math.hypot(right[0] - restRight[0], right[2] - restRight[2]) > 0.2, 'the free edge does swing');
  }
  for (const t of [0, 0.15, 0.4]) {
    const f = frameOf([base, arm(), { op: 'spin', id: 'arm', rpm: 60, axis: 'z' }], t);
    near(placed(obj(f, 'arm'), [0, -1.5, 0]), [0, 1, 0], `spun about its point at ${t}`);
  }
  for (const t of [0, 0.5, 1]) {
    const f = frameOf([base, arm(), { op: 'loop', id: 'arm', kind: 'pulse', amount: 2, period: 2 }], t);
    near(placed(obj(f, 'arm'), [0, -1.5, 0]), [0, 1, 0], `swelling from its point at ${t}`);
  }
});

test('a hinge joint with its own pivot turns about that pivot (measured from the origin of the part, as before): the attachment does not hold the point against it', () => {
  const door = box('door', [2, 3, 0.2], { parent: 'frame', parentAnchor: 'left', selfAnchor: 'left' });
  const f0 = frameOf([box('frame', [4, 4, 0.4]), door, { op: 'joint', id: 'door', kind: 'hinge', axis: 'y', pivot: [1, 0, 0] }, { op: 'loop', id: 'door', kind: 'swing', axis: 'y', amount: 60, period: 2 }], 0.5);
  // The turn is about the point one unit along x from the door's origin: its right edge, which does not move, though the door is attached by its left edge.
  const rest = frameOf([box('frame', [4, 4, 0.4]), door, { op: 'joint', id: 'door', kind: 'hinge', axis: 'y', pivot: [1, 0, 0] }], 0);
  near(placed(obj(f0, 'door'), [1, 0, 0]), placed(obj(rest, 'door'), [1, 0, 0]), 'a pivot the model gave is where it turns');
  assert.ok(Math.hypot(...placed(obj(f0, 'door'), [-1, 0, 0]).map((v, i) => v - placed(obj(rest, 'door'), [-1, 0, 0])[i]!) as Vec3) > 0.5, 'and the attached edge moves with the turn');
});

test('detach lets a part go where it is: nothing jumps, a move is then absolute, and it is not attached', () => {
  const actions = [base, arm({ pos: [0.5, 0, 0] }), { op: 'detach', id: 'arm', at: 1 }, { op: 'move', id: 'arm', to: [5, 0, 0], at: 2, dur: 0 }];
  const before = obj(frameOf(actions, 0.99), 'arm'), after = obj(frameOf(actions, 1.01), 'arm');
  assert.ok(before.mount, 'attached before');
  assert.equal(after.mount, undefined, 'not after');
  near(after.pos, before.pos, 'it stays where the attachment had put it');
  assert.deepEqual(obj(frameOf(actions, 3), 'arm').pos, [5, 0, 0], 'a move after the detach is where it says');
});

test('an attached part carries its attachment into the next step, and a detached one stays detached', () => {
  const step = (actions: unknown[]) => ({ say: 'x', actions: [panel, ...actions] } as Step);
  const first = planStep(emptyFrame(), step([base, arm({ pos: [0.5, 0, 0] })]));
  const settled = evaluate(first, Infinity);
  const second = evaluate(planStep(settled, step([{ op: 'move', id: 'arm', to: [1, 0, 0], dur: 0 }])), 1);
  near(placed(obj(second, 'arm'), [0, -1.5, 0]), [1, 1, 0], 'the move in the next step is still an offset');
  const letGo = planStep(settled, step([{ op: 'detach', id: 'arm' }]));
  const settledGo = evaluate(letGo, Infinity);
  assert.equal(obj(settledGo, 'arm').mount, undefined);
  const third = evaluate(planStep(settledGo, step([{ op: 'move', id: 'arm', to: [7, 0, 0], dur: 0 }])), 1);
  assert.deepEqual(obj(third, 'arm').pos, [7, 0, 0], 'detached, so absolute');
});

test('pulled apart by the model\'s explode, an attached part shows a faint line to its point; assembled or detached there is none', () => {
  const joinsOf = (scene: PanelScene, frame: Frame): LineSegments[] => {
    const parent = scene.nodeOf(obj(frame, 'base').key) as Object3D;
    return parent.children.filter((c): c is LineSegments => c instanceof LineSegments && c.renderOrder === 998 && c.visible);
  };
  const scene = new PanelScene({ tier: 'low' });
  try {
    const assembled = frameOf([base, arm()], 1);
    scene.sync(assembled, 1);
    assert.equal(joinsOf(scene, assembled).length, 0, 'assembled: no line');
    const apart = frameOf([base, arm(), { op: 'explode', id: 'base', to: 1, dur: 0 }], 1);
    scene.sync(apart, 1);
    const lines = joinsOf(scene, apart);
    assert.equal(lines.length, 1, 'pulled apart: one line');
    const p = lines[0]!.geometry.getAttribute('position');
    assert.ok(Math.hypot(p.getX(0) - p.getX(1), p.getY(0) - p.getY(1), p.getZ(0) - p.getZ(1)) > 0.5, 'the line runs from the point to where the part is pulled');
    const letGo = frameOf([base, arm(), { op: 'detach', id: 'arm' }, { op: 'explode', id: 'base', to: 1, dur: 0 }], 1);
    scene.sync(letGo, 1);
    assert.equal(joinsOf(scene, letGo).length, 0, 'let go: no line');
  } finally { scene.destroy(); }
});

test('a connector can end at a built-in point of a shape, and the model can name its own point on an object', () => {
  const scene = new PanelScene({ tier: 'low' });
  try {
    const frame = frameOf([box('a', [1, 1, 1], { pos: [0, 0, 0] }), box('b', [1, 1, 1], { pos: [0, 5, 0] }),
      { op: 'add', shape: 'connector', id: 'link', from: 'a', to: 'b', fromAnchor: 'top', toAnchor: 'bottom', radius: 0.05 }], 1);
    scene.sync(frame, 1);
    const geo = ((scene.nodeOf(obj(frame, 'link').key) as Object3D).children[0] as Mesh).geometry;
    geo.computeBoundingBox();
    assert.ok(Math.abs(geo.boundingBox!.min.y - 0.5) < 0.1 && Math.abs(geo.boundingBox!.max.y - 4.5) < 0.1, `cord runs from the top of a to the bottom of b: ${geo.boundingBox!.min.y}..${geo.boundingBox!.max.y}`);
  } finally { scene.destroy(); }
  const named = frameOf([base, { op: 'anchor', id: 'base', name: 'hinge', pos: [0, -1, 1] }, arm({ parentAnchor: 'hinge' })], 1);
  near(placed(obj(named, 'arm'), [0, -1.5, 0]), [0, -1, 1], 'attached at the point the model named');
});

test('the validator takes attachment on solids, names a point with anchor, refuses what is not there and keeps the guide honest', () => {
  const ok = validateStep({ say: 'x', actions: [panel, base, { op: 'anchor', id: 'base', name: 'hinge', pos: [0, -1, 1] }, arm({ parentAnchor: 'hinge', selfAnchor: 'top' }), { op: 'detach', id: 'arm', at: 2 }] } as Step, createSceneState());
  assert.deepEqual(ok.issues, []);
  assert.equal(ok.step!.actions.length, 5);
  assert.equal((ok.step!.actions[2] as { at?: number }).at, 0, 'a name exists from when its object does');
  const bad = validateStep({ say: 'x', actions: [panel, base, arm({ parentAnchor: 'nowhere' }), { op: 'anchor', id: 'base', name: 'origin', pos: [0, 0, 0] }, { op: 'anchor', id: 'ghost', name: 'p', pos: [0, 0, 0] }] } as Step, createSceneState());
  assert.ok(bad.issues.some((i) => /unknown anchor "nowhere"/.test(i.message) && /top/.test(i.message)), 'refused with the names there are');
  assert.ok(bad.issues.some((i) => /origin/.test(i.message)), 'origin is not a name to give');
  assert.ok(bad.issues.some((i) => /ghost/.test(i.message)), 'an object that is not there cannot take a name');
  assert.equal(bad.step!.actions.length, 2, 'only the panel and the base stand');
  for (const words of ['top (+y', 'bottom (-y', 'front (+z, toward the viewer', 'start and end of a tube', 'detach', 'anchor']) assert.ok(sceneGuide.includes(words), `the guide says ${words}`);
});
