import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Group, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import type { BufferGeometry } from 'three';
import { createSceneState, validateStep } from '../src/scene/index.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { buildForce, buildParticles, updateForces, updateParticles, waveFactor } from '../src/overlay/scene3d-flow.ts';
import type { FlowNode } from '../src/overlay/scene3d-flow.ts';
import { fieldLines } from '../src/scene/field-lines.ts';

// Flows and forces: a wave along a tube, flow in beats, particles that spread, force arrows and field lines.

const near = (a: number | undefined, b: number, eps = 1e-3) => assert.ok(a !== undefined && Math.abs(a - b) <= eps, `${a} vs ${b}`);
const run = (...actions: unknown[]) => {
  const checked = validateStep({ say: 'x', actions }, createSceneState());
  assert.ok(checked.step, JSON.stringify(checked.issues));
  return { plan: planStep(emptyFrame(), checked.step), issues: checked.issues };
};
const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id)!;
const tube = { op: 'add', shape: 'tube', id: 'gut', pts: [[-4, 0, 0], [0, 1, 0], [4, 0, 0]], radius: 0.3 };

test('a wave crest is a swell where the laps put it, a squeeze below one, with count crests apart; it is one far from a crest', () => {
  near(waveFactor(0.3, 0.3, 1, 0.2, 2), 2);
  near(waveFactor(0.3 + 0.1, 0.3, 1, 0.2, 2), 1, 1e-9);
  near(waveFactor(0.9, 0.3, 1, 0.2, 2), 1, 1e-9);
  near(waveFactor(0.3, 0.3, 1, 0.2, 0.4), 0.4);
  near(waveFactor(0.8, 0.3, 2, 0.2, 2), 2);
  near(waveFactor(0.3, -0.7, 1, 0.2, 2), 2);
  near(waveFactor(0.3, 1.3, 1, 0.2, 2), 2);
});

test('a wave on a tube is carried by the frame, its place a lap count a stream of the same period shares', () => {
  const r = run(tube, { op: 'wave', id: 'gut', amount: 1.8, width: 0.25, period: 4 }, { op: 'add', shape: 'stream', id: 'bolus', along: 'gut', count: 1, period: 4 });
  assert.deepEqual(r.issues, []);
  for (const t of [0.5, 1.7, 3]) {
    const f = evaluate(r.plan, t);
    const w = obj(f, 'gut').wave!;
    assert.ok(w, 'the tube has a wave');
    near(w.phase, obj(f, 'bolus').phase!, 1e-9);
    near(w.phase, t / 4, 1e-9);
    assert.equal(w.amount, 1.8);
  }
  const back = run(tube, { op: 'wave', id: 'gut', period: -4 });
  near(obj(evaluate(back.plan, 2), 'gut').wave!.phase, -0.5, 1e-9);
  // a wave written again replaces the one before (as a loop does), and stop leaves the tube still
  const stopped = run(tube, { op: 'wave', id: 'gut' }, { op: 'wave', id: 'gut', stop: true });
  assert.equal(obj(evaluate(stopped.plan, 2), 'gut').wave, undefined);
  const again = run(tube, { op: 'wave', id: 'gut', amount: 1.5 }, { op: 'wave', id: 'gut', amount: 0.5, count: 2 });
  assert.deepEqual([obj(evaluate(again.plan, 1), 'gut').wave!.amount, obj(evaluate(again.plan, 1), 'gut').wave!.count], [0.5, 2]);
});

test('a wave on something that is not an open tube is dropped with a note', () => {
  const line = validateStep({ say: 'x', actions: [{ op: 'add', shape: 'line', id: 'l', pts: [[0, 0, 0], [3, 0, 0]] }, { op: 'wave', id: 'l' }] }, createSceneState());
  assert.ok(line.issues.some((i) => /not one|a tube/.test(i.message)), JSON.stringify(line.issues));
  const loop = validateStep({ say: 'x', actions: [{ ...tube, id: 'ring', closed: true, pts: [[0, 0, 0], [2, 0, 0], [1, 2, 0]] }, { op: 'wave', id: 'ring' }] }, createSceneState());
  assert.ok(loop.issues.some((i) => /closed loop/.test(i.message)), JSON.stringify(loop.issues));
});

test('a stream with surge runs in beats: faster and slower within each, and exactly on time at the end of each beat', () => {
  const r = run(tube, { op: 'add', shape: 'stream', id: 's', along: 'gut', period: 4, surge: 0.8, beat: 1 });
  const plain = run(tube, { op: 'add', shape: 'stream', id: 's', along: 'gut', period: 4 });
  const lap = (rr: typeof r, t: number) => obj(evaluate(rr.plan, t), 's').phase!;
  for (const t of [1, 2, 3, 5]) near(lap(r, t), lap(plain, t), 1e-9);
  assert.ok(Math.abs(lap(r, 0.25) - lap(plain, 0.25)) > 0.005, 'ahead within a beat');
  // never backwards, and the speed swings between 1 - surge and 1 + surge of the plain one
  let slowest = Infinity, fastest = 0;
  for (let t = 0.01; t < 4; t += 0.01) {
    const v = (lap(r, t + 0.001) - lap(r, t)) / (lap(plain, t + 0.001) - lap(plain, t));
    slowest = Math.min(slowest, v);
    fastest = Math.max(fastest, v);
  }
  assert.ok(slowest > 0.15 && slowest < 0.3, `slowest ${slowest}`);
  assert.ok(fastest > 1.7 && fastest < 1.85, `fastest ${fastest}`);
});

// ---- the stage's side, with no WebGL: the meshes are made and placed, and read back ----

const meshOf = () => new Mesh(undefined, new MeshBasicMaterial());
const blankNode = (): FlowNode => ({ obj: new Group(), pieces: [], geometries: [], alpha: 1 });
const addMesh = (geo: BufferGeometry) => {
  const m = meshOf();
  m.geometry = geo;
  return m;
};

test('particles begin in the start box and spread to the end box as the object is revealed, jostling all the while', () => {
  const r = run({ op: 'add', shape: 'particles', id: 'gas', count: 40, from: [1, 1, 1], to: [8, 4, 1], shift: [3, 0, 0], jitter: 0.1 }, { op: 'reveal', id: 'gas', to: 1, at: 1, dur: 4 });
  assert.deepEqual(r.issues, []);
  const f0 = evaluate(r.plan, 0);
  near(obj(f0, 'gas').draw, 0);
  const node = blankNode();
  buildParticles(node, obj(f0, 'gas'), addMesh as never);
  const spreadAt = (t: number) => {
    const f = evaluate(r.plan, t);
    updateParticles(new Map([[obj(f, 'gas').key, node]]), f);
    const box = new Box3();
    for (const b of node.particles!.beads) box.expandByPoint(b.position);
    return box;
  };
  const start = spreadAt(0);
  assert.ok(start.max.x - start.min.x <= 1 + 0.2 + 1e-9 && start.max.y - start.min.y <= 1.2 + 1e-9, 'crowded to begin with');
  const end = spreadAt(6);
  assert.ok(end.max.x - end.min.x > 6 && end.max.y - end.min.y > 2.5, `spread out ${end.max.x - end.min.x}`);
  assert.ok(end.min.x >= 3 - 4 - 0.2 - 1e-9 && end.max.x <= 3 + 4 + 0.2 + 1e-9, 'inside the box it fills');
  // the jostle: the same cloud at the same spread is not still from one moment to the next
  const again = spreadAt(6.4);
  const a = node.particles!.beads[0]!.position.clone();
  spreadAt(6);
  assert.ok(a.distanceTo(node.particles!.beads[0]!.position) > 0.01, 'they jostle');
  void again;
  // and the same time always gives the same places
  const p1 = spreadAt(3.3).max.x, p2 = spreadAt(3.3).max.x;
  near(p1, p2, 1e-12);
});

test('a force arrow starts on its part, points the way the scene says however the part turns, and is as long as its strength', () => {
  const r = run({ op: 'add', shape: 'sphere', id: 'bob', size: [1, 1, 1], pos: [2, -1, 0] }, { op: 'add', shape: 'force', id: 'weight', on: 'bob', dir: [0, -2, 0], strength: 3 });
  assert.deepEqual(r.issues, []);
  const f = evaluate(r.plan, 1);
  const host = new FlowNode0();
  const arrowNode = blankNode();
  buildForce(arrowNode, obj(f, 'weight'), addMesh as never);
  host.group.position.set(2, -1, 0);
  host.group.rotation.set(0, 0, 0.9); // the part is turned: the arrow is not
  host.group.updateMatrixWorld(true);
  const nodes = new Map<number, FlowNode>([[obj(f, 'bob').key, host.node], [obj(f, 'weight').key, arrowNode]]);
  updateForces(nodes, f);
  const arrow = arrowNode.force!;
  const tail = new Vector3().copy(arrow.shaft.position).addScaledVector(new Vector3(0, 1, 0).applyQuaternion(arrow.shaft.quaternion), -arrow.shaft.scale.y / 2);
  near(tail.x, 2, 1e-6);
  near(tail.y, -1, 1e-6);
  const tip = new Vector3().copy(arrow.head.position).addScaledVector(new Vector3(0, 1, 0).applyQuaternion(arrow.head.quaternion), arrow.head.scale.y / 2);
  near(tip.x, 2, 1e-6);
  near(tip.y, -1 - 3, 1e-6);
  // a stronger force is thicker and longer
  const strong = run({ op: 'add', shape: 'sphere', id: 'bob', size: [1, 1, 1], pos: [2, -1, 0] }, { op: 'add', shape: 'force', id: 'weight', on: 'bob', dir: [0, -1, 0], strength: 6 });
  const f2 = evaluate(strong.plan, 1);
  const node2 = blankNode();
  buildForce(node2, obj(f2, 'weight'), addMesh as never);
  updateForces(new Map<number, FlowNode>([[obj(f2, 'bob').key, host.node], [obj(f2, 'weight').key, node2]]), f2);
  assert.ok(node2.force!.shaft.scale.x > arrow.shaft.scale.x, 'thicker');
  near(node2.force!.shaft.scale.y + node2.force!.head.scale.y, 6, 1e-6);
});

class FlowNode0 {
  group = new Group();
  node: FlowNode = { obj: this.group, pieces: [], geometries: [], alpha: 1 };
}

test('a force with no direction, or from a point the part does not have, is dropped with a note', () => {
  const part = { op: 'add', shape: 'box', id: 'crate', size: [1, 1, 1] };
  const none = validateStep({ say: 'x', actions: [part, { op: 'add', shape: 'force', id: 'f', on: 'crate', dir: [0, 0, 0], strength: 2 }] }, createSceneState());
  assert.ok(none.issues.some((i) => /direction/.test(i.message)), JSON.stringify(none.issues));
  const bad = validateStep({ say: 'x', actions: [part, { op: 'add', shape: 'force', id: 'f', on: 'crate', point: 'handle', dir: [1, 0, 0], strength: 2 }] }, createSceneState());
  assert.ok(bad.issues.some((i) => /unknown point "handle"/.test(i.message)), JSON.stringify(bad.issues));
  const good = validateStep({ say: 'x', actions: [part, { op: 'add', shape: 'force', id: 'f', on: 'crate', point: 'right', dir: [1, 0, 0], strength: 2 }] }, createSceneState());
  assert.deepEqual(good.issues, [], JSON.stringify(good.issues));
});

test('a dipole field leaves the positive end, loops round outside the magnet to the other, and mirrors above and below', () => {
  const lines = fieldLines({ kind: 'dipole', size: 5, count: 8, gap: 2 });
  assert.equal(lines.length, 8);
  for (const l of lines) {
    assert.ok(l.length >= 2 && l.length <= 24);
    assert.ok(l[0]![0] > 0.5 && l[l.length - 1]![0] < -0.5, 'from the right end to the left');
    for (const p of l) assert.ok(Math.hypot(p[0], p[1]) <= 5.2 && p[2] === 0);
    // it starts on a ring round the positive pole (at 0.85 for a bar 2 long) and comes to the negative one
    near(Math.hypot(l[0]![0] - 0.85, l[0]![1]), 0.85 * 0.3, 1e-9);
    assert.ok(Math.hypot(l[l.length - 1]![0] + 0.85, l[l.length - 1]![1]) < 0.85 * 0.5, 'ends at the other pole');
    // and a line is a smooth curve: no step of it more than twice the average one
    const steps = l.slice(1).map((p, i) => Math.hypot(p[0] - l[i]![0], p[1] - l[i]![1]));
    assert.ok(Math.max(...steps) < 2 * (steps.reduce((a, b) => a + b, 0) / steps.length) + 1e-9);
  }
  const up = lines.filter((l) => l[Math.floor(l.length / 2)]![1] > 0);
  const down = lines.filter((l) => l[Math.floor(l.length / 2)]![1] < 0);
  assert.equal(up.length, 4);
  assert.equal(down.length, 4);
  near(up[1]![5]![0], down[1]![5]![0], 1e-9);
  near(up[1]![5]![1], -down[1]![5]![1], 1e-9);
  assert.ok(up[3]![7]![1] > up[0]![7]![1] + 0.5, 'the outer lines reach further');
  const widest = Math.max(...up[3]!.map((p) => p[1]));
  assert.ok(widest > 3.5 && widest <= 5.2, `the widest loop reaches the size asked: ${widest}`);
  const tall = fieldLines({ kind: 'dipole', axis: 'y', size: 5, count: 4, gap: 2 });
  assert.ok(tall[0]![0]![1] > 0.5 && tall[0]![tall[0]!.length - 1]![1] < -0.5, 'the same turned to lie along y');
  const flipped = fieldLines({ kind: 'dipole', size: 5, count: 8, gap: 2, flip: true });
  near(flipped[0]![0]![0], lines[0]![lines[0]!.length - 1]![0], 1e-9);
});

test('radial lines spoke out from a point and uniform ones run parallel across the gap', () => {
  const spokes = fieldLines({ kind: 'radial', size: 4, count: 6, gap: 1 });
  assert.equal(spokes.length, 6);
  for (const s of spokes) {
    near(Math.hypot(s[0]![0], s[0]![1]), 0.5, 1e-9);
    near(Math.hypot(s[1]![0], s[1]![1]), 4, 1e-9);
  }
  const inward = fieldLines({ kind: 'radial', size: 4, count: 6, gap: 1, flip: true });
  near(Math.hypot(inward[0]![0]![0], inward[0]![0]![1]), 4, 1e-9);
  const plates = fieldLines({ kind: 'uniform', size: 6, count: 5, gap: 4 });
  assert.equal(plates.length, 5);
  plates.forEach((l, i) => {
    near(l[0]![0], -3, 1e-9);
    near(l[1]![0], 3, 1e-9);
    near(l[0]![1], -2 + i, 1e-9);
    near(l[1]![1], l[0]![1], 1e-9);
  });
});

test('a field is one group of arrows that draw on together, and clearing its id takes them all', () => {
  const r = run({ op: 'add', shape: 'field', id: 'mag', kind: 'dipole', pos: [1, 0, 0], size: 4, count: 6 }, { op: 'clear', target: 'mag', at: 3 });
  assert.deepEqual(r.issues, []);
  const f = evaluate(r.plan, 2);
  const lines = f.objects.filter((o) => o.id.startsWith('mag.'));
  assert.equal(lines.length, 6);
  assert.ok(lines.every((o) => o.shape === 'arrow' && o.parentKey === obj(f, 'mag').key));
  assert.ok(lines.every((o) => o.draw > 0.99), 'drawn on by two seconds');
  assert.ok(evaluate(r.plan, 0.2).objects.filter((o) => o.id.startsWith('mag.')).every((o) => o.draw < 0.9));
  const gone = evaluate(r.plan, 10);
  assert.equal(gone.objects.filter((o) => o.id.startsWith('mag')).length, 0);
});
