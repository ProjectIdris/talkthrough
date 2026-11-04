import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Mesh, Vector3 } from 'three';
import type { Material, Object3D } from 'three';
import type { Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, planStep, settle } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
const near = (a: number | undefined, b: number, eps = 1e-6) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);

const model = [
  { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
  { op: 'add', shape: 'group', id: 'm' },
  { op: 'add', shape: 'box', id: 'slab', parent: 'm', size: [4, 2, 4], pos: [0, 0, 0] },
  { op: 'add', shape: 'part', part: 'cylinder-block', id: 'block', parent: 'm', size: [3, 3, 3], pos: [0, 3, 0] },
  { op: 'add', shape: 'box', id: 'beside', size: [1, 1, 1], pos: [10, 0, 0] },
];
const clipped = (o: Object3D): Material[] => {
  const out: Material[] = [];
  o.traverse((c) => { const m = (c as Mesh).material as Material | undefined; if (m && !Array.isArray(m) && m.clippingPlanes && m.clippingPlanes.length > 0) out.push(m); });
  return out;
};
const caps = (scene: PanelScene) => scene.scene.children.filter((c) => c.visible && (c as Mesh).isMesh && ((c as Mesh).material as { stencilWrite?: boolean }).stencilWrite === true);
/** The meshes of a model that are parts of it (not the stencil helpers), and how many of them are closed surfaces. */
const parts = (o: Object3D) => {
  const out: Mesh[] = [];
  o.traverse((c) => { const m = c as Mesh; if (m.isMesh && !(m.material as { stencilWrite?: boolean }).stencilWrite) out.push(m); });
  return out;
};
const isOpen = (m: Mesh) => (m.geometry as { parameters?: { openEnded?: boolean } }).parameters?.openEnded === true;

test('a cut action sweeps a plane through an object: none until it is given, then the plane moves to where it was sent', () => {
  const plan = planStep(emptyFrame(), step(...model, { op: 'cut', id: 'm', axis: 'z', to: 1, at: 1, dur: 1 }));
  assert.equal(evaluate(plan, 0.5).objects.find((o) => o.id === 'm')?.cut, undefined, 'no cut yet');
  const mid = evaluate(plan, 1.5).objects.find((o) => o.id === 'm')?.cut;
  assert.ok(mid && mid.axis === 2 && mid.at > 1 && mid.at < 100, JSON.stringify(mid));
  near(evaluate(plan, 3).objects.find((o) => o.id === 'm')?.cut?.at, 1);
  // and it can be taken away again by sending the plane past everything
  const off = planStep(settle(plan), step({ op: 'cut', id: 'm', to: 100, dur: 0 }));
  assert.equal(evaluate(off, 1).objects.find((o) => o.id === 'm')?.cut, undefined);
});

test('what is cut is clipped on the removed side of the plane, closed parts get a cap, open ones and what is outside do not', () => {
  const frame = settle(planStep(emptyFrame(), step(...model, { op: 'cut', id: 'm', axis: 'z', to: 0.5, dur: 0 })));
  const scene = new PanelScene();
  scene.sync(frame, 1);
  const slab = scene.nodeOf(frame.objects.find((o) => o.id === 'slab')!.key)!;
  const planes = (clipped(slab)[0] as Material).clippingPlanes!;
  assert.equal(planes.length, 1);
  const plane = planes[0]!;
  // points in front of the plane (z above 0.5) are on its removed (negative) side, behind it are kept
  assert.ok(plane.distanceToPoint(new Vector3(0, 0, 1.5)) < 0 && plane.distanceToPoint(new Vector3(0, 0, -1.5)) > 0);
  const beside = scene.nodeOf(frame.objects.find((o) => o.id === 'beside')!.key)!;
  assert.equal(clipped(beside).length, 0, 'an object outside the cut one is left whole');
  const m = scene.nodeOf(frame.objects.find((o) => o.id === 'm')!.key)!;
  const closedParts = parts(m).filter((p) => !isOpen(p));
  assert.ok(parts(m).some(isOpen), 'the block has an open liner');
  assert.equal(caps(scene).length, closedParts.length, 'one cap for each closed part, none for the open liner');
  // the caps hang from the scene, not from the model, so they never count toward its size
  const content = scene.scene.children.find((c) => c.type === 'Group' && c.children.length > 0)!;
  const size = new Box3().setFromObject(content).getSize(new Vector3());
  assert.ok(size.x < 40 && size.y < 40 && size.z < 40, size.toArray().join());
});

test('taking the cut away unclips the surfaces and puts the caps away', () => {
  const cut = settle(planStep(emptyFrame(), step(...model, { op: 'cut', id: 'm', axis: 'y', to: 0, dur: 0 })));
  const scene = new PanelScene();
  scene.sync(cut, 1);
  assert.ok(caps(scene).length > 0);
  const slab = scene.nodeOf(cut.objects.find((o) => o.id === 'slab')!.key)!;
  const sideWhileCut = ((slab as Mesh).material as Material).side;
  const whole = settle(planStep(cut, step({ op: 'cut', id: 'm', to: 100, dur: 0 })));
  scene.sync(whole, 1);
  assert.equal(clipped(slab).length, 0);
  assert.equal(caps(scene).length, 0);
  assert.notEqual(((slab as Mesh).material as Material).side, sideWhileCut, 'it is single sided again');
});

test("the person's Cut control cuts the whole model from the front, through the middle at full", () => {
  const base: Frame = settle(planStep(emptyFrame(), step(...model)));
  const scene = new PanelScene();
  scene.sync(base, 1);
  scene.sync({ ...base, userCut: 1 }, 1);
  const slab = scene.nodeOf(base.objects.find((o) => o.id === 'slab')!.key)!;
  const plane = (clipped(slab)[0] as Material).clippingPlanes![0]!;
  assert.ok(plane.distanceToPoint(new Vector3(0, 0, 3)) < 0 && plane.distanceToPoint(new Vector3(0, 0, -1)) > 0, 'the front half is gone');
  scene.sync({ ...base, userCut: 0 }, 1);
  assert.equal(clipped(slab).length, 0);
});

test('removing a cut object takes its caps with it', () => {
  const cut = settle(planStep(emptyFrame(), step(...model, { op: 'cut', id: 'm', to: 0, dur: 0 })));
  const scene = new PanelScene();
  scene.sync(cut, 1);
  const gone = settle(planStep(cut, step({ op: 'clear', target: 'm' })));
  scene.sync(gone, 1);
  assert.equal(caps(scene).length, 0);
});

test('the Cut control eases in and out like Explode, and a finished model can be cut', async () => {
  const { Player, createSilentVoice } = await import('../src/overlay/player.ts');
  let now = 0;
  const player = new Player({ voice: createSilentVoice(), clock: { now: () => now, after: () => () => {} } });
  player.play({ steps: [{ say: '', actions: model }] } as never);
  now += 5000;
  player.update();
  assert.equal(player.update().userCut, undefined);
  player.toggleCut();
  now += 300;
  const part = player.update().userCut ?? 0;
  assert.ok(part > 0 && part < 1, String(part));
  assert.equal(player.active, true);
  now += 2000;
  near(player.update().userCut, 1);
  assert.equal(player.cut, true);
  player.toggleCut();
  now += 2000;
  assert.equal(player.update().userCut, undefined);
});
