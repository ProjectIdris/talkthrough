import { variantDefinitions } from './support/json-schema.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Euler, Matrix4, Vector3 } from 'three';
import { applyClear, beginLiveStep, createDetailState, createSceneState, sceneGuide, sceneSchema, sceneSchemaLean, validateStep } from '../src/scene/index.ts';
import type { Action, AddPart, Vec3 } from '../src/scene/index.ts';
import type { Body } from '../src/scene/attach.ts';

function worldOf(bodies: Map<string, Body>, id: string): Matrix4 {
  const body = bodies.get(id)!;
  const rot = body.rot.map((x) => x * Math.PI / 180) as Vec3;
  const local = new Matrix4().makeRotationFromEuler(new Euler(...rot, 'XYZ'));
  local.setPosition(...body.pos);
  return body.parent ? worldOf(bodies, body.parent).multiply(local) : local;
}
const apply = (m: Matrix4, p: Vec3): Vec3 => new Vector3(...p).applyMatrix4(m).toArray();

const part = (id: string, kind = 'pipe', extra = {}) => ({ op: 'add', shape: 'part', id, part: kind, size: [1, 4, 1], ...extra });
const group = (id: string, extra = {}) => ({ op: 'add', shape: 'group', id, ...extra });
const step = (...actions: unknown[]) => ({ say: 'An assembly.', actions });
const near = (got: Vec3, expected: Vec3) => got.forEach((v, i) => assert.ok(Math.abs(v - expected[i]!) < 1e-8, `${got} != ${expected}`));
const action = (actions: Action[], id: string) => actions.find((a) => 'id' in a && a.id === id) as AddPart;

test('named sockets remain declarative while validation previews one local position', () => {
  const state = createSceneState();
  const raw = step(part('base'), part('extension', 'pipe', { parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom' }));
  const before = JSON.stringify(raw);
  const r = validateStep(raw, state);
  assert.deepEqual(r.issues, []);
  const child = action(r.step!.actions, 'extension');
  assert.equal(child.pos, undefined);
  assert.equal(child.parentAnchor, 'top');
  assert.equal(child.selfAnchor, 'bottom');
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(state.bodies.get('extension')?.pos, [0, 4, 0]);
  const replay = validateStep(r.step, createSceneState());
  assert.deepEqual(replay.issues, []);
  assert.deepEqual(replay.step, r.step);
});

test('child rotation and parent-frame offset align sockets through rotated nested parents', () => {
  const state = createSceneState();
  const r = validateStep(step(
    group('rig', { pos: [7, -2, 4], rot: [21, -33, 47] }),
    part('base', 'pipe', { parent: 'rig', pos: [3, 2, -1], rot: [-12, 31, 18] }),
    part('child', 'pipe', { parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', rot: [23, 41, -73], pos: [0.2, -0.1, 0.3] }),
  ), state);
  assert.deepEqual(r.issues, []);
  const child = action(r.step!.actions, 'child');
  const rotatedBottom = new Vector3(0, -2, 0).applyEuler(new Euler(...[23, 41, -73].map((x) => x * Math.PI / 180) as [number, number, number], 'XYZ'));
  assert.deepEqual(child.pos, [0.2, -0.1, 0.3]);
  near(state.bodies.get('child')!.pos, [0.2 - rotatedBottom.x, 1.9 - rotatedBottom.y, 0.3 - rotatedBottom.z]);
  const fromChild = apply(worldOf(state.bodies, 'child'), [0, -2, 0]);
  const fromParent = apply(worldOf(state.bodies, 'base'), [0.2, 1.9, 0.3]);
  near(fromChild, fromParent);
});

test('a group can mount an entire custom subassembly, with origin defaults', () => {
  const state = createSceneState();
  const r = validateStep(step(part('base'), group('assembly', { parent: 'base', parentAnchor: 'top' }),
    part('inside', 'pipe', { parent: 'assembly', selfAnchor: 'bottom' })), state);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(state.bodies.get('assembly')?.pos, [0, 2, 0]);
  assert.deepEqual(state.bodies.get('inside')?.pos, [0, 2, 0]);
  near(apply(worldOf(state.bodies, 'inside'), [0, -2, 0]), [0, 2, 0]);
});

test('normalized part dimensions drive mounting and validator construction bounds', () => {
  const state = createSceneState();
  const r = validateStep(step(part('gear', 'gear', { size: [5, 1, 5] }),
    group('fixture', { parent: 'gear', parentAnchor: 'axis' })), state);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(state.bodies.get('fixture')?.pos, [0, 0, 0.5]);
  assert.deepEqual(state.bodies.get('gear')?.size, [5, 5, 1]);
});

test('invalid anchors are dropped with available names and never reserve the child id', () => {
  for (const extra of [{ parentAnchor: 'toString' }, { parentAnchor: 'constructor' }, { parentAnchor: 'missing' }, { selfAnchor: 'missing' }]) {
    const state = createSceneState();
    const r = validateStep(step(part('base'), part('bad', 'pipe', { parent: 'base', ...extra })), state);
    assert.deepEqual(r.step?.actions.map((a) => 'id' in a ? a.id : a.op), ['base']);
    assert.ok(r.issues.some((i) => i.kind === 'dropped' && i.message.includes('origin') && i.message.includes('bottom') && i.message.includes('top')));
    assert.equal(state.ids.has('bad'), false);
    assert.equal(state.bodies.has('bad'), false);
  }
});

test('mounting requires a parent and does not silently become ordinary origin placement', () => {
  const r = validateStep(step(part('bad', 'pipe', { selfAnchor: 'bottom' })), createSceneState());
  assert.equal(r.step?.actions.length, 0);
  assert.ok(r.issues.some((i) => i.kind === 'dropped' && i.message.includes('parent')));
});

test('mounted positions outside the scene range are rejected rather than clamped apart', () => {
  const state = createSceneState();
  const r = validateStep(step(part('base', 'pipe', { size: [1, 100, 1] }), part('bad', 'pipe', {
    parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', size: [1, 100, 1], pos: [0, 1, 0],
  })), state);
  assert.equal(state.ids.has('bad'), false);
  assert.ok(r.issues.some((i) => i.kind === 'dropped' && i.message.includes('range')));
});

test('forward parent references and live validation produce the same compiled mounts', () => {
  const actions = [part('child', 'pipe', { parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom' }), part('base')];
  const wholeState = createSceneState();
  const whole = validateStep(step(...actions), wholeState);
  assert.deepEqual(whole.issues, []);
  assert.deepEqual(wholeState.bodies.get('child')?.pos, [0, 4, 0]);
  const emitted: Action[] = [];
  const live = beginLiveStep(createSceneState(), { open() {}, action(a) { emitted.push(a); } });
  live.say('An assembly.');
  for (const a of actions) live.action(a);
  const result = live.finish();
  assert.deepEqual(result, whole);
  assert.deepEqual(emitted, whole.step!.actions);
});

test('detail states retain sockets, replacements update them, and clear removes them', () => {
  const original = createSceneState();
  validateStep(step(part('base')), original);
  const detail = createDetailState(original);
  const r = validateStep(step(part('base', 'pipe', { size: [1, 8, 1] }), group('child', { parent: 'base', parentAnchor: 'top' })), detail);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(detail.bodies.get('child')?.pos, [0, 4, 0]);
  assert.deepEqual(original.bodies.get('base')?.size, [1, 4, 1]);
  applyClear(detail, 'base');
  assert.equal(detail.bodies.has('base'), false);
  assert.equal(detail.bodies.has('child'), false);
  const reuse = validateStep(step(group('base'), group('bad', { parent: 'base', parentAnchor: 'top' })), detail);
  assert.equal(detail.ids.has('bad'), false);
  assert.ok(reuse.issues.some((i) => i.kind === 'dropped' && i.message.includes('origin')));
});

test('mounted action times remain available for chronological definition resolution', () => {
  const state = createSceneState();
  validateStep(step(part('base')), state);
  const detail = createDetailState(state);
  const r = validateStep(step(part('base', 'pipe', { size: [1, 8, 1], at: 2 }),
    group('early', { parent: 'base', parentAnchor: 'top' }),
    group('ready', { parent: 'base', parentAnchor: 'top', at: 2 })), detail);
  assert.equal(detail.ids.has('early'), true);
  assert.equal(action(r.step!.actions, 'ready').at, 2);
  assert.equal(action(r.step!.actions, 'ready').parentAnchor, 'top');
  assert.deepEqual(r.issues, []);
});

test('detail replacements cannot mount a parent to itself or its descendant', () => {
  for (const parent of ['base', 'child']) {
    const state = createSceneState();
    validateStep(step(part('base'), group('child', { parent: 'base' })), state);
    const detail = createDetailState(state);
    const r = validateStep(step(part('base', 'pipe', { parent, parentAnchor: 'origin' })), detail);
    assert.equal(r.step?.actions.length, 0);
    assert.equal(detail.bodies.get('base')?.parent, undefined);
    assert.ok(r.issues.some((i) => i.kind === 'dropped' && i.message.includes('cycle')));
  }
});

test('ordinary authored transforms remain unchanged when no mount fields are used', () => {
  const raw = step(part('base'), part('child', 'pipe', { parent: 'base', pos: [1, 2, 3], rot: [0, 0, 90] }));
  const r = validateStep(raw, createSceneState());
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.step, raw);
});

test('full and lean model schemas and compact guide expose the mounting contract', () => {
  for (const schema of [sceneSchema, sceneSchemaLean]) {
    const defs = variantDefinitions(schema);
    assert.ok(defs.addPart!.properties.parentAnchor);
    assert.ok(defs.addPart!.properties.selfAnchor);
    assert.ok(defs.addGroup!.properties.parentAnchor);
    assert.ok(defs.addGroup!.properties.selfAnchor);
    assert.ok(defs.addSolid!.properties.parentAnchor, 'every 3D shape can be attached');
    assert.ok(defs.addBlob!.properties.selfAnchor);
    for (const v of ['addHull', 'addPatch', 'addSweep', 'addLoft', 'addShell', 'addText']) assert.ok(defs[v]!.properties.parentAnchor, `${v} can be attached too`);
  }
  assert.ok(sceneGuide.includes('parentAnchor'));
  assert.ok(sceneGuide.includes('selfAnchor'));
  assert.ok(sceneGuide.includes('stays attached whatever moves'));
  assert.match(sceneGuide, /\bpipe[^;:]*: top,bottom/, 'the pipe is listed with its points');
  assert.ok(sceneGuide.includes('pin1 to pinN'));
});

test('anchor field values remain bounded plain data and unsupported values do not make a child', () => {
  for (const value of [7, true, [], {}, 'x'.repeat(25)]) {
    const state = createSceneState();
    const r = validateStep(step(part('base'), group('bad', { parent: 'base', parentAnchor: value })), state);
    assert.equal(state.ids.has('bad'), false);
    assert.ok(r.issues.some((i) => i.kind === 'dropped'));
  }
  let accessed = false;
  const input = part('safe');
  Object.defineProperty(input, 'parentAnchor', { enumerable: true, get() { accessed = true; throw new Error('must not execute'); } });
  validateStep(step(input), createSceneState());
  assert.equal(accessed, false);
});

test('mounted children use the actual clamped crank throw anchors without invented fallback', () => {
  const state = createSceneState();
  const r = validateStep(step(part('shaft', 'crankshaft', { n: 20, size: [4, 4, 8] }),
    group('good', { parent: 'shaft', parentAnchor: 'pin8' }),
    group('bad', { parent: 'shaft', parentAnchor: 'pin9' })), state);
  assert.equal(state.ids.has('bad'), false);
  assert.ok(r.issues.some((i) => i.message.includes('pin8') && i.message.includes('pin9')));
  const a = 7 * Math.PI / 4;
  near(state.bodies.get('good')!.pos, [-Math.sin(a) * 1.2, Math.cos(a) * 1.2, 3.5]);
});

test('a parent replacement cannot retroactively change an accepted mount in the same streamed step', () => {
  const state = createSceneState();
  validateStep(step(part('base')), state);
  const detail = createDetailState(state);
  const r = validateStep(step(
    group('mounted', { parent: 'base', parentAnchor: 'top', at: 2 }),
    part('base', 'pipe', { size: [1, 8, 1], at: 1 }),
  ), detail);
  assert.deepEqual(r.step!.actions.map((a) => 'id' in a ? a.id : a.op), ['mounted']);
  assert.ok(r.issues.some((i) => i.kind === 'dropped' && i.message.includes('before') && i.message.includes('mounted')));
  assert.deepEqual(detail.bodies.get('base')!.size, [1, 4, 1]);
});

test('replacement bounds are deferred when inherited transforms can change the result', () => {
  const state = createSceneState();
  validateStep(step(part('base', 'pipe', { size: [1, 100, 1] }),
    part('child', 'pipe', { size: [1, 100, 1], parent: 'base', rot: [0, 0, 180] })), state);
  const result = validateStep(step(part('child', 'pipe', { size: [1, 100, 1], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', pos: [0, 1, 0] })), createDetailState(state));
  assert.deepEqual(result.issues, []);
  assert.equal(result.step!.actions.length, 1);
});

test('the muscle the guide describes is kept with its swell as written there, and dropped with a single number for it', () => {
  const guideSwell = /swell (\[\[[^\]]*\](?:,\[[^\]]*\])*\])/.exec(sceneGuide);
  assert.ok(guideSwell, 'the guide gives the swell as a list of pairs');
  const swell = JSON.parse(guideSwell![1]!) as unknown;
  const connector = (extra: object) => step(
    { op: 'add', shape: 'cylinder', id: 'bone', size: [0.3, 2, 0.3] },
    { op: 'add', shape: 'cylinder', id: 'fore', size: [0.3, 2, 0.3], pos: [0, -2, 0] },
    { op: 'add', shape: 'connector', id: 'muscle', from: 'bone', to: 'fore', fromPoint: [0, -0.5, 0.2], toPoint: [0, 0.5, 0.2], radius: 0.1, ...extra },
  );
  const kept = validateStep(connector({ swell }), createSceneState());
  assert.ok(kept.step!.actions.some((a) => 'id' in a && a.id === 'muscle'), `kept: ${JSON.stringify(kept.issues)}`);
  const dropped = validateStep(connector({ swell: 0.4 }), createSceneState());
  assert.ok(!dropped.step!.actions.some((a) => 'id' in a && a.id === 'muscle'), 'a lone number is not a profile');
});
