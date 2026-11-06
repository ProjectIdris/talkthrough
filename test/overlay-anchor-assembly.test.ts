import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { createDetailState, createSceneState, sceneSchema, sceneSchemaLean, validateScene } from '../src/scene/index.ts';
import type { Scene, Vec3 } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, frameAt, planStep, settle } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { check } from './support/json-schema.ts';

function validated(raw: unknown, state = createSceneState()): Scene {
  const result = validateScene(raw, state);
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
  assert.ok(result.scene);
  return result.scene;
}

function node(scene: PanelScene, frame: Frame, id: string) {
  const object = frame.objects.findLast((o) => o.id === id);
  assert.ok(object, `missing frame object ${id}`);
  const result = scene.nodeOf(object.key);
  assert.ok(result, `missing renderer node ${id}`);
  return result;
}

function worldPoint(scene: PanelScene, frame: Frame, id: string, point: Vec3): Vector3 {
  return node(scene, frame, id).localToWorld(new Vector3(...point));
}

function coincident(a: Vector3, b: Vector3, where: string): void {
  assert.ok(a.distanceTo(b) < 1e-8, `${where}: ${a.toArray()} != ${b.toArray()}`);
}

test('mounted sockets stay coincident in the CPU renderer through parent translation, XYZ rotation and nonuniform scale', () => {
  // Literal sockets make this independent of the shared anchor resolver: a 3-unit pipe's top
  // is y=1.5; this elbow has a 1-unit bend, with socket a at [0.5,-0.5,0].
  const clean = validated({ steps: [{ say: 'Move the assembled parts.', actions: [
    { op: 'add', shape: 'group', id: 'rig', pos: [-3, 2, 1], rot: [19, 31, -27] },
    { op: 'add', shape: 'part', id: 'pipe', part: 'pipe', size: [3, 0.8, 1.2], parent: 'rig', pos: [2, -1, 0.5], rot: [17, -28, 13] },
    { op: 'add', shape: 'part', id: 'bend', part: 'elbow', size: [1.6, 1.6, 0.6], parent: 'pipe', parentAnchor: 'top', selfAnchor: 'a', rot: [25, 35, 40] },
    { op: 'add', shape: 'part', id: 'offset', part: 'elbow', size: [1.6, 1.6, 0.6], parent: 'pipe', parentAnchor: 'top', selfAnchor: 'a', rot: [-13, 41, 22], pos: [0.2, -0.3, 0.4] },
    { op: 'move', id: 'pipe', to: [4, 2, -3], at: 1, dur: 2 },
    { op: 'turn', id: 'pipe', to: [-20, 70, 95], at: 1, dur: 2 },
    { op: 'scale', id: 'pipe', to: [1.5, 0.75, 2], at: 1, dur: 2 },
  ] }] });
  const panel = new PanelScene({ tier: 'low' });
  let first: Vector3 | undefined;
  for (const time of [0, 0.5, 1, 1.75, 2.5, 3, 8, 0.5]) {
    const frame = frameAt(clean.steps, 0, time);
    panel.sync(frame, 1);
    const socket = worldPoint(panel, frame, 'pipe', [0, 1.5, 0]);
    coincident(worldPoint(panel, frame, 'bend', [0.5, -0.5, 0]), socket, `mounted elbow at ${time}`);
    coincident(worldPoint(panel, frame, 'offset', [0.5, -0.5, 0]), worldPoint(panel, frame, 'pipe', [0.2, 1.2, 0.4]), `parent-frame offset at ${time}`);
    assert.equal(node(panel, frame, 'bend').parent, node(panel, frame, 'pipe'));
    if (time === 0) first = socket.clone();
    if (time === 3) {
      assert.ok(first && first.distanceTo(socket) > 1, 'the parent actually moved the socket');
      assert.deepEqual(node(panel, frame, 'pipe').scale.toArray(), [1.5, 0.75, 2]);
    }
  }
});

test('a later child turn can separate mounted sockets because placement is not a live constraint', () => {
  const clean = validated({ steps: [{ say: 'Turn the child independently.', actions: [
    { op: 'add', shape: 'part', id: 'base', part: 'pipe', size: [1, 2, 1] },
    { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [0.5, 2, 0.5], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom' },
    { op: 'turn', id: 'child', to: [0, 0, 90], at: 1, dur: 1 },
  ] }] });
  const panel = new PanelScene({ tier: 'low' });
  const before = frameAt(clean.steps, 0, 0.5);
  panel.sync(before, 1);
  coincident(worldPoint(panel, before, 'child', [0, -1, 0]), worldPoint(panel, before, 'base', [0, 1, 0]), 'before child motion');
  const after = frameAt(clean.steps, 0, 2);
  panel.sync(after, 1);
  const gap = worldPoint(panel, after, 'child', [0, -1, 0]).distanceTo(worldPoint(panel, after, 'base', [0, 1, 0]));
  assert.ok(Math.abs(gap - Math.SQRT2) < 1e-8, `expected an unconstrained gap, got ${gap}`);
});

test('a mounted detail replacement uses its inherited rotation and nonuniform scale at creation', () => {
  for (const rotation of [undefined, [20, 30, 40] as Vec3]) {
    const state = createSceneState();
    const initial = validated({ steps: [{ say: 'Before replacement.', actions: [
      { op: 'add', shape: 'part', id: 'base', part: 'pipe', size: [1, 2, 1], pos: [2, -1, 3], rot: [12, 25, -18] },
      { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [0.5, 2, 0.5], parent: 'base', rot: [0, 0, 90] },
      { op: 'scale', id: 'child', to: [2, 0.5, 1.5], dur: 0 },
    ] }] }, state);
    const base = frameAt(initial.steps, 0, 1);
    const detail = validated({ steps: [{ say: 'Mount the replacement.', actions: [
      { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [0.5, 2, 0.5], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', ...(rotation ? { rot: rotation } : {}) },
      { op: 'move', id: 'base', to: [-2, 1, 4], at: 1, dur: 2 },
      { op: 'turn', id: 'base', to: [30, -40, 60], at: 1, dur: 2 },
      { op: 'scale', id: 'base', to: [1.2, 0.7, 1.5], at: 1, dur: 2 },
    ] }] }, createDetailState(state));
    const panel = new PanelScene({ tier: 'low' });
    const plan = planStep(base, detail.steps[0]!);
    for (const time of [0, 0.1, 0.5, 1.5, 3]) {
      const frame = evaluate(plan, time);
      panel.sync(frame, 1);
      const child = frame.objects.findLast((o) => o.id === 'child')!;
      assert.deepEqual(child.rot, rotation ?? [0, 0, 90], 'an explicit rotation overrides inheritance; an omitted one is retained');
      assert.deepEqual(child.scale, [2, 0.5, 1.5], 'replacement preserves the existing scale');
      coincident(worldPoint(panel, frame, 'base', [0, 1, 0]), worldPoint(panel, frame, 'child', [0, -1, 0]), `replacement at ${time}`);
    }
  }
});

test('a mounted child uses the parent replacement already defined before it', () => {
  const state = createSceneState();
  const initial = validated({ steps: [{ say: 'An existing pipe.', actions: [
    { op: 'add', shape: 'part', id: 'base', part: 'pipe', size: [1, 2, 1] },
  ] }] }, state);
  const base = frameAt(initial.steps, 0, 1);
  const detail = validated({ steps: [{ say: 'Replace the base before mounting.', actions: [
    { op: 'add', shape: 'part', id: 'base', part: 'pipe', size: [1, 6, 1], at: 1 },
    { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [0.5, 2, 0.5], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', at: 2 },
  ] }] }, createDetailState(state));
  const panel = new PanelScene({ tier: 'low' });
  const plan = planStep(base, detail.steps[0]!);
  assert.equal(evaluate(plan, 1.5).objects.some((o) => o.id === 'child'), false);
  for (const time of [2, 2.1, 3]) {
    const frame = evaluate(plan, time);
    panel.sync(frame, 1);
    assert.deepEqual(frame.objects.find((o) => o.id === 'child')!.pos, [0, 4, 0]);
    coincident(worldPoint(panel, frame, 'base', [0, 3, 0]), worldPoint(panel, frame, 'child', [0, -1, 0]), `chronological replacement at ${time}`);
  }
});

test('raw playback skips a mount when a scheduled parent replacement removes its socket', () => {
  const state = createSceneState();
  const initial = validated({ steps: [{ say: 'An existing pipe.', actions: [
    { op: 'add', shape: 'part', id: 'base', part: 'pipe', size: [1, 2, 1] },
  ] }] }, state);
  const base = frameAt(initial.steps, 0, 1);
  // Defense in depth for raw/internal callers that bypass the validator's source-order guard.
  const detail: Scene = { v: 1, steps: [{ say: 'The later parent has no top socket.', actions: [
    { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [0.5, 2, 0.5], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', at: 2 },
    { op: 'add', shape: 'part', id: 'base', part: 'housing', size: [2, 2, 2], at: 1 },
  ] }] };
  const panel = new PanelScene({ tier: 'low' });
  const plan = planStep(base, detail.steps[0]!);
  for (const time of [2, 2.1, 3]) {
    const frame = evaluate(plan, time);
    panel.sync(frame, 1);
    assert.deepEqual(frame.objects.map((o) => o.id), ['base'], 'the missing socket never becomes origin placement');
    assert.equal(frame.objects[0]!.def.shape, 'part');
    assert.ok('part' in frame.objects[0]!.def && frame.objects[0]!.def.part === 'housing');
    assert.equal(panel.count(), 1);
  }
});

test('an out-of-range mount caused by inherited scale leaves the prior object and its children untouched', () => {
  const state = createSceneState();
  const initial = validated({ steps: [{ say: 'Keep the existing assembly if mounting fails.', actions: [
    { op: 'add', shape: 'part', id: 'base', part: 'pipe', size: [1, 2, 1] },
    { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [0.2, 1, 0.2], parent: 'base', pos: [3, 4, 5] },
    { op: 'add', shape: 'box', id: 'marker', size: [0.2, 0.2, 0.2], parent: 'child', pos: [1, 0, 0] },
    { op: 'scale', id: 'child', to: [1, 100, 1], dur: 0 },
  ] }] }, state);
  const base = frameAt(initial.steps, 0, 1);
  const detail = validated({ steps: [{ say: 'This replacement would require y=201.', actions: [
    { op: 'add', shape: 'part', id: 'child', part: 'pipe', size: [1, 4, 1], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom' },
  ] }] }, createDetailState(state));
  assert.equal(detail.steps[0]!.actions.length, 1, 'the unscaled preview is in range');
  const panel = new PanelScene({ tier: 'low' });
  panel.sync(base, 1);
  const oldChild = node(panel, base, 'child'), oldMarker = node(panel, base, 'marker');
  const plan = planStep(base, detail.steps[0]!);
  for (const time of [0, 0.1, 1]) {
    const frame = evaluate(plan, time);
    panel.sync(frame, 1);
    assert.deepEqual(frame.objects, base.objects, 'no fading, replacement, reparenting or pose changes');
    assert.equal(node(panel, frame, 'child'), oldChild);
    assert.equal(node(panel, frame, 'marker'), oldMarker);
    assert.equal(oldMarker.parent, oldChild);
  }
});

test('the pump assembly sample validates unchanged and replays every step with connected sockets and a custom mounted group', () => {
  const raw = JSON.parse(readFileSync(new URL('../samples/scenes/anchor-assembly.json', import.meta.url), 'utf8')) as Scene;
  const before = JSON.stringify(raw);
  const { v: _version, ...body } = raw;
  for (const schema of [sceneSchema, sceneSchemaLean]) {
    assert.deepEqual(check(schema, schema, body, '$', true), []);
  }
  const clean = validated(raw);
  assert.equal(JSON.stringify(raw), before, 'authoring data is not mutated');
  assert.deepEqual(clean, raw, 'socket names and authored offsets survive validation for replay');
  assert.deepEqual(validated(clean), clean, 'stored authoring data is stable on revalidation');
  const solved: Record<string, Vec3> = {
    piston: [0, -0.4, 0], intake: [0, -1.6, 0], riser: [0, 1.8, 0],
    bend: [0, 1.2, 0.4], outlet: [-1.3, 0.4, 0], gauge: [0, 0, 1],
  };

  // Each pair is hand-derived from the written dimensions, rather than the production resolver.
  const joints: Array<[string, Vec3, string, Vec3]> = [
    ['chamber', [0, -1, 0], 'intake', [0, 0.6, 0]],
    ['chamber', [0, 1, 0], 'riser', [0, -0.8, 0]],
    ['riser', [0, 0.8, 0], 'bend', [0.4, -0.4, 0]],
    ['bend', [-0.4, 0.4, 0], 'outlet', [0, -0.9, 0]],
    ['chamber', [0, 0, 1], 'gauge', [0, 0, 0]],
    ['gauge', [0, 0, 0], 'gauge-plate', [0, 0, 0]],
  ];
  const panel = new PanelScene({ tier: 'low' });
  let base = emptyFrame();
  for (const [index, step] of clean.steps.entries()) {
    const plan = planStep(base, step);
    for (const time of [0, 0.1, plan.duration / 2, plan.duration, Infinity]) {
      const frame = evaluate(plan, time);
      panel.sync(frame, 1);
      for (const object of frame.objects) {
        assert.ok(node(panel, frame, object.id).matrixWorld.elements.every(Number.isFinite), `${object.id} has a finite world transform`);
        if (solved[object.id]) coincident(new Vector3(...object.pos), new Vector3(...solved[object.id]!), `${object.id}: resolved local position`);
      }
      for (const [parent, parentPoint, child, childPoint] of joints) {
        if (frame.objects.some((o) => o.id === child)) {
          coincident(worldPoint(panel, frame, parent, parentPoint), worldPoint(panel, frame, child, childPoint), `step ${index}, time ${time}: ${parent} to ${child}`);
        }
      }
    }
    base = settle(plan);
  }
  assert.equal(base.objects.length, 9, 'all authored objects survive whole replay');
  assert.equal(node(panel, base, 'gauge-plate').parent, node(panel, base, 'gauge'));
  assert.deepEqual(node(panel, base, 'assembly').scale.toArray(), [1.25, 0.9, 1.1]);
});
