import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene } from '../src/scene/validate.ts';

const tetra = [[0,0,0],[2,0,0],[0,3,0],[0,0,4]];
test('a full-rank hull is accepted unchanged', () => {
  const hull = { op: 'add', shape: 'hull', id: 'h', pts: tetra };
  const result = validateScene({ steps: [{ say: 'ok', actions: [hull] }] });
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.scene?.steps[0]?.actions, [hull]);
});

import { resolveHullPoints } from '../src/scene/hull-points.ts';
import { beginLiveStep, createDetailState, createSceneState, createStepStream, sceneGuide, sceneSchema, sceneSchemaLean, startTurn, validateStep } from '../src/scene/index.ts';

const scene = (...actions: unknown[]) => ({ steps: [{ say: 'ok', actions }] });
const hull = (pts: unknown, extra: object = {}) => ({ op: 'add', shape: 'hull', id: 'h', pts, ...extra });

test('strict admission rejects malformed, out of bounds, sparse, overflow and deficient points', () => {
  const invalid: unknown[] = [null, [], tetra.slice(0,3), [...tetra, ...Array.from({length:61}, () => [0,0,0])],
    [[0,0,0],[1,0,0],[0,1,0],[0,0,101]], [[0,0,0],[1,0,0],[0,1,0],[0,0,NaN]],
    [[0,0,0],[1,0,0],[0,1,0],[0,0,Infinity]], [[0,0,0],[1,0,0],[0,1,0],[0,0]],
    [[0,0,0],[0,0,0],[0,0,0],[0,0,0]], [[0,0,0],[1,0,0],[2,0,0],[3,0,0]],
    [[0,0,0],[1,0,0],[0,1,0],[1,1,0]], [[0,0,0],[1,0,0],[0,1,0],[0,0,1e-7]],
    [[100,100,100],[100-1e-8,100,100],[100,100-1e-8,100],[100,100,100-1e-8]],
    [tetra[0], tetra[1], tetra[2], Array(3)], Array(4)];
  for (const pts of invalid) {
    assert.equal(resolveHullPoints(pts).ok, false, JSON.stringify(pts));
    const r = validateScene(scene(hull(pts), {op:'add', shape:'box', id:'b', size:[1,1,1]}));
    assert.equal(r.scene!.steps[0]!.actions.length, 1, JSON.stringify(pts));
    assert.equal(r.issues[0]?.kind, 'dropped');
  }
});

test('canonical points are float32 rounded, sorted, deduplicated and do not mutate authored values', () => {
  const pts = [[0.123456789,0,0], ...tetra, [0,0,0], [0.1,0.1,0.1]];
  const before = structuredClone(pts);
  const a = resolveHullPoints(pts), b = resolveHullPoints([...pts].reverse());
  assert.equal(a.ok, true); assert.deepEqual(a,b); assert.deepEqual(pts,before);
  if (!a.ok) return;
  assert.equal(a.points.length, 6);
  assert.ok(a.points.some(p => p[0] === Math.fround(0.123456789)));
  assert.deepEqual(validateScene(scene(hull(pts))).scene!.steps[0]!.actions[0], hull(before));
  assert.equal(resolveHullPoints([...tetra, ...Array.from({length:60}, () => [0,0,0])]).ok, true);
  assert.equal(resolveHullPoints([[0,0,0],[0.00002,0,0],[0,0.00002,0],[0,0,0.00002]]).ok, true);
});

test('invalid hull replacement consumes neither the existing body nor its replacement slot', () => {
  const state = createSceneState();
  validateScene(scene({op:'add',shape:'box',id:'h',size:[2,2,2]}),state);
  const detail = createDetailState(state); startTurn(detail);
  const body = structuredClone(detail.bodies.get('h'));
  const bad = validateStep({say:'bad',actions:[hull([[0,0,0],[1,0,0],[0,1,0],[1,1,0]])]},detail);
  assert.equal(bad.step!.actions.length, 0); assert.deepEqual(detail.bodies.get('h'),body);
  assert.equal(detail.replaceable!.has('h'),true);
  const good = validateStep({say:'good',actions:[hull(tetra)]},detail);
  assert.equal(good.step!.actions.length,1); assert.equal(detail.bodies.get('h')?.shape,'group');
});

test('whole and streamed validation agree; optional fields and both schemas expose the hull', () => {
  const raw = scene(hull(tetra,{parent:null,pos:null,rot:null,explode:null,color:null,material:null,edges:null,opacity:null,at:null}));
  const whole = validateScene(raw);
  const stream = createStepStream(), steps: unknown[] = [], text = JSON.stringify(raw);
  for (let i=0; i<text.length; i+=3) steps.push(...stream.push(text.slice(i,i+3)));
  stream.end(); const streamed = steps.map((s,i) => validateStep(s,createSceneState(),i).step);
  assert.deepEqual(streamed,whole.scene!.steps); assert.deepEqual(whole.issues,[]);
  for (const schema of [sceneSchema, sceneSchemaLean]) {
    const def = (schema.$defs as Record<string, { properties: Record<string, unknown> }>).addHull!;
    assert.ok(def.properties.pts); assert.ok(def.properties.edges); assert.ok(def.properties.parent);
  }
});

test('sparse points and accessor coordinates are rejected without invoking getters', () => {
  let called = false;
  const point: unknown[] = [0,0,0];
  Object.defineProperty(point, '1', { get() { called = true; return 0; } });
  assert.equal(resolveHullPoints([point, tetra[1], tetra[2], tetra[3]]).ok, false);
  assert.equal(called, false);
});


test('live and whole validation agree for invalid and valid hulls', () => {
  const actions = [hull([[0,0,0],[1,0,0],[0,1,0],[1,1,0]], { id: 'bad' }), hull(tetra),
    { op: 'add', shape: 'box', id: 'child', parent: 'h', size: [1,1,1] }];
  const whole = validateStep({ say: 'x', actions }, createSceneState());
  const accepted: unknown[] = [], state = createSceneState();
  const live = beginLiveStep(state, { open: () => {}, action: (a) => accepted.push(a) });
  live.say('x'); for (const action of actions) live.action(action);
  const streamed = live.finish();
  assert.deepEqual(streamed, whole);
  assert.deepEqual(accepted, whole.step!.actions);
  assert.equal(state.ids.has('bad'), false);
});

test('Float32 rounding rejects a cloud whose authored rank would otherwise exceed tolerance', () => {
  const base = 99.98, top = 99.980002;
  assert.ok(top - base > 1e-6);
  assert.equal(Math.fround(top), Math.fround(base));
  const points = [[base,base,base],[99.99,base,base],[base,99.99,base],[base,base,top]];
  assert.equal(resolveHullPoints(points).ok,false);
  assert.equal(validateScene(scene(hull(points))).scene!.steps[0]!.actions.length,0);
  const thick = [[base,base,base],[99.99,base,base],[base,99.99,base],[base,base,99.98002]];
  assert.equal(resolveHullPoints(thick).ok,true);
  assert.equal(validateScene(scene(hull(thick))).scene!.steps[0]!.actions.length,1);
});


test('the live guide distinguishes size-based placement from hull local points', () => {
  assert.ok(sceneGuide.includes('Size-based solids are centred on their pos; hull points stay in their authored local coordinates.'));
  assert.ok(!sceneGuide.includes('a solid centred on its pos'));
});
