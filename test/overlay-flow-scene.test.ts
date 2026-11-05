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
    near(rope.max.y, 3, 0.02); // it hangs from the rim at the wheel's height
    near(rope.min.y, weight.max.y, 0.04); // and meets the top of the weight wherever that has got to
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
