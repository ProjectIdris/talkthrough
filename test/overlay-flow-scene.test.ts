import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Vector3 } from 'three';
import type { MeshPhysicalMaterial, Object3D } from 'three';
import type { Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// On the stage a connector is rebuilt from where its two objects are on each frame, and a stream's markers sit along their path as its lap count says.

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const near = (a: number | undefined, b: number, eps = 1e-3) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const stage = { op: 'panel', x: 100, y: 100, w: 400, h: 400 };
const box = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], ...extra });
const wheel = (id: string, size: number[], pos: number[], extra: object = {}) => ({ op: 'add', shape: 'cylinder', id, size, pos, rot: [90, 0, 0], ...extra });
const shown = (actions: unknown[], t: number): { frame: Frame; scene: PanelScene; node: (id: string) => Object3D; bounds: (id: string) => Box3 } => {
  const frame = evaluate(planStep(emptyFrame(), step(stage, ...actions)), t);
  const scene = new PanelScene();
  scene.sync(frame, 1);
  const node = (id: string) => scene.nodeOf(frame.objects.find((o) => o.id === id)!.key)!;
  return { frame, scene, node, bounds: (id) => new Box3().setFromObject(node(id)) };
};

const pulley = [
  wheel('rim', [2, 0.4, 2], [0, 3, 0]),
  box('weight', { size: [1, 1, 1], pos: [-1, 0, 0] }),
  { op: 'joint', id: 'weight', kind: 'slide', axis: 'y' },
  { op: 'loop', id: 'weight', kind: 'slide', amount: 2, period: 4 },
  { op: 'add', shape: 'connector', id: 'rope', from: 'rim', to: 'weight', fromSide: 'left', toSide: 'top', radius: 0.05 },
];

test('a rope from the rim of a wheel to a weight runs from the rim to the top of the weight, and shortens as the weight rises', () => {
  const heights: number[] = [];
  for (const t of [0.2, 1, 2]) {
    const { bounds } = shown(pulley, t);
    const rope = bounds('rope'), weight = bounds('weight');
    near(rope.max.y, 3.05, 0.02); // it hangs from the rim at the wheel's height (its rounded end reaches one radius further, into the wheel)
    near(rope.min.y + 0.05, weight.max.y, 0.04); // and meets the top of the weight wherever that has got to (the rounded end is one radius into it)
    near((rope.min.x + rope.max.x) / 2, -1, 0.05); // straight down from the left rim
    heights.push(rope.max.y - rope.min.y);
  }
  assert.ok((heights[1] as number) < (heights[0] as number) - 0.5, `shorter as it rises: ${heights.join()}`);
  assert.ok((heights[2] as number) > (heights[1] as number) + 0.5, 'longer as it comes down');
});

test('a connector hung from a moved group still joins its objects (it is built in its own space)', () => {
  const actions = [
    { op: 'add', shape: 'group', id: 'rig', pos: [4, 1, 0], rot: [0, 0, 90] },
    box('a', { parent: 'rig', pos: [0, 0, 0] }), box('b', { parent: 'rig', pos: [3, 0, 0] }),
    { op: 'add', shape: 'connector', id: 'wire', parent: 'rig', from: 'a', to: 'b', radius: 0.05 },
  ];
  const { bounds } = shown(actions, 1);
  const wire = bounds('wire');
  // in the group the wire runs along x from 0 to 3; the group is turned a quarter about z, so in the scene it runs up from (4,1) to (4,4)
  near(wire.min.y, 1, 0.1); near(wire.max.y, 4, 0.1);
  near((wire.min.x + wire.max.x) / 2, 4, 0.1);
});

test('a slack wire hangs below the line between its ends', () => {
  const { bounds } = shown([box('a', { pos: [-2, 2, 0] }), box('b', { pos: [2, 2, 0] }), { op: 'add', shape: 'connector', id: 'w', from: 'a', to: 'b', kind: 'slack', sag: 0.25 }], 1);
  const w = bounds('w');
  near(w.max.y, 2, 0.06);
  near(w.min.y, 2 - 0.25 * 4, 0.06);
});

test('a belt goes round two wheels: it stands off both rims and spans from the far side of one to the far side of the other', () => {
  const { bounds } = shown([
    wheel('big', [2, 0.4, 2], [-1.5, 0, 0]), wheel('small', [1, 0.4, 1], [1.5, 0, 0]),
    { op: 'add', shape: 'connector', id: 'belt', from: 'big', to: 'small', kind: 'wrapped', radius: 0.04 },
  ], 1);
  const belt = bounds('belt');
  near(belt.min.x, -2.5 - 0.04, 0.12); // the far side of the big wheel
  near(belt.max.x, 2 + 0.04, 0.12); // the far side of the small one
  near(belt.max.y, 1 + 0.04, 0.12); // over the top of the big wheel
  assert.ok(belt.max.z - belt.min.z > 0.2, 'it has a width along the wheels\' axis');
});

test('a belt follows its wheels when one is moved', () => {
  const run = (x: number) => shown([
    wheel('big', [2, 0.4, 2], [-1.5, 0, 0]), wheel('small', [1, 0.4, 1], [x, 0, 0]),
    { op: 'add', shape: 'connector', id: 'belt', from: 'big', to: 'small', kind: 'wrapped', radius: 0.04 },
  ], 1).bounds('belt').max.x;
  near(run(3.5) - run(1.5), 2, 0.12);
});

// ---- streams ---------------------------------------------------------------------------------------------------------------------

const markersOf = (node: Object3D): Mesh[] => node.children.filter((c): c is Mesh => c instanceof Mesh);
const world = (m: Mesh): Vector3 => m.getWorldPosition(new Vector3());

test('markers sit along the path at the places their lap count gives; the one at the very end is shrunk away', () => {
  const pipe = { op: 'add', shape: 'tube', id: 'pipe', pts: [[0, 0, 0], [3, 0, 0]], radius: 0.1 };
  const { node } = shown([pipe, { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 3, period: 3 }], 1);
  const ms = markersOf(node('s'));
  assert.equal(ms.length, 3);
  const xs = ms.map((m) => world(m).x).sort((a, b) => a - b);
  // a third of a lap: the markers are at 1/3, 2/3 and 0 of the way (0 and 3 are the ends, where they have no size)
  near(xs[1], 1, 0.02); near(xs[2], 2, 0.02);
  assert.equal(ms.filter((m) => m.visible).length, 2);
  // the same time gives the same places
  const again = markersOf(shown([pipe, { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 3, period: 3 }], 1).node('s')).map((m) => world(m).x).sort((a, b) => a - b);
  assert.deepEqual(again.map((x) => Math.round(x * 1e4)), xs.map((x) => Math.round(x * 1e4)));
});

test('the colour changes along the way', () => {
  const pipe = { op: 'add', shape: 'tube', id: 'pipe', pts: [[0, 0, 0], [3, 0, 0]], radius: 0.1 };
  const { node } = shown([pipe, { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 4, period: 4, color: 'blue', toColor: 'red' }], 1);
  const ms = markersOf(node('s')).filter((m) => m.visible).sort((a, b) => world(a).x - world(b).x);
  const red = (m: Mesh) => (m.material as MeshPhysicalMaterial).color.r;
  const blue = (m: Mesh) => (m.material as MeshPhysicalMaterial).color.b;
  assert.ok(red(ms[ms.length - 1] as Mesh) > red(ms[0] as Mesh), 'redder toward the end');
  assert.ok(blue(ms[0] as Mesh) > blue(ms[ms.length - 1] as Mesh), 'bluer at the start');
});

test('a stream follows its path as the path moves: along a rope, its markers are on the rope', () => {
  const actions = [
    box('a', { pos: [0, 4, 0] }), box('b', { pos: [0, 0, 0] }),
    { op: 'add', shape: 'connector', id: 'rope', from: 'a', to: 'b' },
    { op: 'add', shape: 'stream', id: 's', along: 'rope', count: 2, period: 2, size: 0.2 },
  ];
  const { node } = shown(actions, 0.5);
  for (const m of markersOf(node('s')).filter((x) => x.visible)) {
    near(world(m).x, 0, 0.02); // on the line between them, wherever the markers are along it
    assert.ok(world(m).y > 0 && world(m).y < 4);
  }
});

test('markers are not part of the model for fitting the camera', () => {
  const pipe = { op: 'add', shape: 'tube', id: 'pipe', pts: [[0, 0, 0], [3, 0, 0]], radius: 0.1 };
  const base = [box('b', { pos: [0, 0, 0] }), pipe];
  const withStream = shown([...base, { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 5, size: 1 }], 1);
  const without = shown(base, 1);
  near(withStream.scene.camera.position.distanceTo(new Vector3()), without.scene.camera.position.distanceTo(new Vector3()), 1e-6);
});

test('a marker is never smaller than a bead standing out of its pipe, whatever size the scene gave (one inside an opaque pipe could not be seen)', () => {
  const pipe = { op: 'add', shape: 'tube', id: 'pipe', pts: [[0, 0, 0], [6, 0, 0]], radius: 0.3 };
  const { node } = shown([pipe, { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 3, period: 3, size: 0.1 }], 1.5);
  const seen = markersOf(node('s')).filter((m) => m.visible);
  assert.ok(seen.length >= 2);
  assert.ok(Math.max(...seen.map((m) => m.scale.x)) > 0.6, `widest marker ${Math.max(...seen.map((m) => m.scale.x))}`);
});

test('a connector whose end is not there yet is not drawn (not drawn to nothing), and comes in with its ends once they are', () => {
  const actions = [
    box('a', { pos: [0, 0, 0], at: 0 }), box('b', { pos: [3, 0, 0], at: 2 }),
    { op: 'add', shape: 'connector', id: 'rope', from: 'a', to: 'b', at: 0 },
  ];
  const before = shown(actions, 1);
  assert.equal(before.node('rope').visible, false, 'one end is not born yet');
  assert.equal(before.frame.objects.some((o) => o.id === 'b'), false);
  const arriving = shown(actions, 2.2);
  const rope = arriving.node('rope');
  const opacity = (rope.children[0] as Mesh).material as MeshPhysicalMaterial;
  assert.equal(rope.visible, true);
  const end = arriving.frame.objects.find((o) => o.id === 'b')!;
  assert.ok(end.appear < 1, 'the end is still coming in');
  assert.ok(opacity.opacity < 0.9 * 1, `the rope is no more there than its end: ${opacity.opacity}`);
  const after = shown(actions, 4);
  assert.ok(((after.node('rope').children[0] as Mesh).material as MeshPhysicalMaterial).opacity > opacity.opacity);
});

test('markers are no part of the model for the buttons and tags either: the model\'s screen rectangle is the same with a stream as without', () => {
  const pipe = { op: 'add', shape: 'tube', id: 'pipe', pts: [[0, 0, 0], [3, 0, 0]], radius: 0.1 };
  const base = [box('b', { pos: [0, 0, 0] }), pipe];
  const a = shown(base, 1).scene.screenBounds(1000, 1000)!.model;
  const b = shown([...base, { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 5, size: 3 }], 1).scene.screenBounds(1000, 1000)!.model;
  assert.deepEqual([b.x, b.y, b.w, b.h].map(Math.round), [a.x, a.y, a.w, a.h].map(Math.round));
});

// ---- a tube with an end on a part goes with the part ---------------------------------------------------------------------------------

import { createSceneState, validateScene } from '../src/scene/index.ts';

const written = (actions: unknown[]): unknown[] => (validateScene({ steps: [{ say: 'x', actions }] }, createSceneState()).scene?.steps[0]?.actions ?? []) as unknown[];

test('a hand-built tube that ends on a weight keeps its end on the weight as the weight rises, and stays as written where nothing moves', () => {
  const actions = [
    box('weight', { size: [1, 1, 1], pos: [0, 0, 0] }),
    { op: 'joint', id: 'weight', kind: 'slide', axis: 'y' },
    { op: 'loop', id: 'weight', kind: 'slide', amount: 2, period: 4 },
    { op: 'add', shape: 'tube', id: 'cord', pts: [[0, 0.56, 0], [0, 2, 0], [0, 5, 0]], radius: 0.05 }, // starts a hair above the top of the weight
  ];
  const kept = written(actions);
  const rest = shown(written([actions[0], { op: 'add', shape: 'tube', id: 'cord', pts: [[0, 0.56, 0], [0, 2, 0], [0, 5, 0]], radius: 0.05 }]), 1);
  near(rest.bounds('cord').min.y + 0.05, 0.5, 0.03); // snapped onto the top face (0.5), its rounded end one radius into the weight
  const heights: number[] = [];
  for (const t of [0.2, 1, 2]) {
    const { bounds } = shown(kept, t);
    near(bounds('cord').min.y + 0.05, bounds('weight').max.y, 0.04); // the end is on the weight wherever the weight has got to
    near(bounds('cord').max.y, 5.05, 0.06); // the far end stays where it was written (and is rounded off)
    heights.push(bounds('cord').min.y);
  }
  assert.ok((heights[1] as number) - (heights[2] as number) > 0.5, `the weight moved, and so did the end: ${heights.join()}`);
});

test('a bead is shaded, not flat, and clearly wider than the pipe it runs in: it reads on a pale or see-through tube', () => {
  const pipe = { op: 'add', shape: 'tube', id: 'pipe', pts: [[0, 0, 0], [3, 0, 0]], radius: 0.1, color: 'purple', opacity: 0.55 };
  const { node } = shown([pipe, { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 3, period: 3, color: 'blue', toColor: 'red' }], 1);
  const ms = markersOf(node('s')).filter((m) => m.visible);
  assert.ok(ms.length > 0);
  const widest = Math.max(...ms.map((m) => m.scale.x));
  assert.ok(widest >= 0.28, `a bead is at least 2.8 pipe radii across (${widest.toFixed(3)} for a pipe of radius 0.1)`);
  for (const m of ms) {
    const glow = (m.material as unknown as { userData: { glow: number } }).userData.glow;
    assert.ok(glow <= 0.5, `a bead keeps its shading, so it reads as a bead and not a flat disc (glow ${glow})`);
  }
});
