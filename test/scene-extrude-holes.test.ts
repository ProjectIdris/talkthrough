import test from 'node:test';
import assert from 'node:assert/strict';
import { validateScene } from '../src/scene/index.ts';

const outline = [[-10,-10],[10,-10],[10,10],[-10,10]];
const hole = [[-2,-2],[2,-2],[2,2],[-2,2]];
const extrude = (extra: object = {}) => ({ op: 'add', shape: 'extrude', id: 'plate', outline, depth: 1, ...extra });
const validate = (action: unknown) => validateScene({ steps: [{ say: 'plate', actions: [action] }] });
const actions = (result: ReturnType<typeof validateScene>) => result.scene!.steps.flatMap((step) => step.actions);

test('valid openings survive scene validation instead of being stripped', () => {
  const result = validate(extrude({ holes: [hole] }));
  assert.deepEqual((actions(result)[0] as { holes?: unknown }).holes, [hole]);
});

test('an opening outside the outline rejects the action rather than rendering a solid plate', () => {
  const result = validate(extrude({ holes: [[[20,20],[21,20],[21,21]]] }));
  assert.equal(actions(result).length, 0);
  assert.ok(result.issues.some((issue) => issue.kind === 'dropped'));
});

test('invalid openings and outlines reject the entire action', () => {
  const badProfiles: [string, number[][], number[][][]][] = [
    ['outside', outline, [[[9,9],[12,9],[9,12]]]],
    ['touch outer', outline, [[[8,8],[10,8],[8,9]]]],
    ['cross outer concavity', [[-10,-10],[10,-10],[10,10],[2,10],[2,0],[-2,0],[-2,10],[-10,10]], [[[-4,2],[4,2],[0,-2]]]],
    ['self cross hole', outline, [[[-3,-3],[3,3],[-3,3],[3,-3]]]],
    ['zero area hole', outline, [[[-2,0],[0,0],[2,0]]]],
    ['duplicate hole point', outline, [[[-2,-2],[2,-2],[2,2],[2,-2],[-2,2]]]],
    ['self cross outline', [[-9,-9],[9,9],[-9,9],[9,-9]], [hole]],
    ['overlap', outline, [[[-6,-6],[2,-6],[2,2],[-6,2]], [[0,0],[6,0],[6,6],[0,6]]]],
    ['touch holes', outline, [[[-6,-2],[0,-2],[0,2],[-6,2]], [[0,-2],[6,-2],[6,2],[0,2]]]],
    ['nested holes', outline, [[[-6,-6],[6,-6],[6,6],[-6,6]], hole]],
    ['near touching outer', outline, [[[9.9999999999,0],[9,1],[9,-1]]]],
  ];
  for (const [label, outer, openings] of badProfiles) {
    const result = validate(extrude({ outline: outer, holes: openings }));
    assert.equal(actions(result).length, 0, label);
    assert.ok(result.issues.some((issue) => issue.kind === 'dropped'), label);
  }
});

test('bounds and malformed rings reject instead of truncating, clamping, or dropping holes', () => {
  const bad: unknown[] = [
    'holes', [null], [[]], [[[0,0],[1,0]]], [[[0,0],[1,0],[0,1,2]]],
    [[[0,0],[1,0],[0,NaN]]], [[[0,0],[1,0],[0,Infinity]]],
    [[[0,0],[101,0],[0,1]]], Array.from({length: 9}, () => hole),
    [Array.from({length: 25}, (_, i) => [Math.cos(i), Math.sin(i)])],
  ];
  for (const openings of bad) assert.equal(actions(validate(extrude({ holes: openings }))).length, 0, JSON.stringify(openings));
  const manyOutline = Array.from({length: 41}, (_, i) => [9 * Math.cos(i * 2 * Math.PI / 41), 9 * Math.sin(i * 2 * Math.PI / 41)]);
  assert.equal(actions(validate(extrude({ outline: manyOutline, holes: [hole] }))).length, 0);
  assert.equal(actions(validate(extrude({ outline: [[-101,-10],[10,-10],[10,10],[-10,10]], holes: [hole] }))).length, 0);
  const many = Array.from({length: 6}, (_, n) => Array.from({length: 21}, (_, i) => [(-7 + n * 2.5) + .4 * Math.cos(i * 2 * Math.PI / 21), .4 * Math.sin(i * 2 * Math.PI / 21)]));
  assert.equal(actions(validate(extrude({ holes: many }))).length, 0, '130 total points exceeds 128');
});

test('legacy omitted, null, and empty holes retain legacy validation and bevel behavior', () => {
  const base = extrude({ outline: [[-101,-10],[10,-10],[10,10],[-10,10]], bevel: 2 });
  const plain = validate(base);
  const nil = validate({ ...base, holes: null });
  const empty = validate({ ...base, holes: [] });
  assert.deepEqual(nil, plain);
  assert.deepEqual(actions(empty).map(({ holes: _holes, ...rest }: any) => rest), actions(plain));
  assert.deepEqual(empty.issues, plain.issues);
  assert.equal((actions(plain)[0] as any).outline[0][0], -100);
  assert.equal((actions(plain)[0] as any).bevel, 2);
});

test('perforated profiles use zero bevel and diagnose positive bevel', () => {
  const omitted = validate(extrude({ holes: [hole] }));
  assert.equal((actions(omitted)[0] as any).bevel, 0);
  const explicit = validate(extrude({ holes: [hole], bevel: 3 }));
  assert.equal((actions(explicit)[0] as any).bevel, 0);
  assert.ok(explicit.issues.some((i) => i.path.endsWith('.bevel')));
});

test('rejected replacements leave the original id available for another replacement', async () => {
  const { createSceneState, createDetailState, validateStep } = await import('../src/scene/index.ts');
  const original = createSceneState();
  validateScene({ steps: [{ say: 'one', actions: [extrude()] }] }, original);
  const state = createDetailState(original);
  const result = validateStep({ say: 'replace', actions: [extrude({ holes: [[[20,20],[21,20],[21,21]]] }), extrude({ holes: [hole] })] }, state);
  assert.equal(result.step!.actions.length, 1);
  assert.deepEqual((result.step!.actions[0] as any).holes, [hole]);
});

test('whole and streamed validation agree on accepted and rejected profiles', async () => {
  const { beginLiveStep, createSceneState, validateStep } = await import('../src/scene/index.ts');
  const raw = { say: 'plate', actions: [extrude({ holes: [hole], bevel: 2 }), extrude({ id: 'bad', holes: [[[20,20],[21,20],[21,21]]] })] };
  const whole = validateStep(raw, createSceneState());
  const streamed = beginLiveStep(createSceneState(), { open() {}, action() {} });
  streamed.say(raw.say); raw.actions.forEach((a) => streamed.action(a));
  assert.deepEqual(streamed.finish(), whole);
});

test('schema requires a nullable nested array for holes in strict and lean modes', async () => {
  const { sceneSchema, sceneSchemaLean } = await import('../src/scene/index.ts');
  const { check, strictProblems } = await import('./support/json-schema.ts');
  for (const schema of [sceneSchema, sceneSchemaLean]) {
    assert.deepEqual(strictProblems(schema), []);
    const def = (schema as any).$defs.addExtrude;
    const action: Record<string, unknown> = Object.fromEntries(Object.keys(def.properties).map((k) => [k, null]));
    Object.assign(action, { op: 'add', shape: 'extrude', id: 'x', outline, depth: 1 });
    assert.deepEqual(check(schema, def, action), []);
    action.holes = [hole]; assert.deepEqual(check(schema, def, action), []);
    action.holes = [null]; assert.notDeepEqual(check(schema, def, action), []);
    delete action.holes; assert.notDeepEqual(check(schema, def, action), []);
  }
});

test('normalization copies and closes rings consistently for either winding', async () => {
  const { normalizeExtrudeProfile, extrudeProfileIssue } = await import('../src/scene/extrude-profile.ts');
  const outer: [number,number][] = [[-10,-10],[10,-10],[10,10],[-10,10],[-10,-10]];
  const inner: [number,number][] = [[-2,-2],[-2,2],[2,2],[2,-2],[-2,-2]];
  const before = structuredClone([outer, inner]);
  assert.equal(extrudeProfileIssue(outer, [inner]), undefined);
  const normalized = normalizeExtrudeProfile(outer, [inner]);
  assert.deepEqual([outer, inner], before);
  assert.equal(normalized.outline.length, 4); assert.equal(normalized.holes[0]!.length, 4);
  const area = (p: [number, number][]) => p.reduce((sum, a, i) => { const b = p[(i + 1) % p.length]!; return sum + a[0]*b[1]-b[0]*a[1]; }, 0);
  assert.ok(area(normalized.outline) < 0); assert.ok(area(normalized.holes[0]!) > 0);
  normalized.outline[0]![0] = 99; assert.deepEqual([outer, inner], before);
});


test('sparse coordinate tuples are rejected rather than rendered', () => {
  const sparse = new Array(2); sparse[0] = 0;
  const result = validate(extrude({ holes: [[[0,0],[1,0],sparse]] }));
  assert.equal(actions(result).length, 0);
});

test('maximum permitted hole count and total points are accepted without mutating input', () => {
  const circle = (x: number, y: number, r: number, count: number) => Array.from({ length: count }, (_, i) => [x + r * Math.cos(2 * Math.PI * i / count), y + r * Math.sin(2 * Math.PI * i / count)]);
  const eight = Array.from({ length: 8 }, (_, i) => circle(-7 + i * 2, 0, .5, 3));
  assert.equal(actions(validate(extrude({ holes: eight }))).length, 1);
  const maximal = Array.from({ length: 5 }, (_, i) => circle(-6 + i * 3, 0, .5, 24)).concat([circle(8, 0, .5, 4)]);
  const raw = extrude({ holes: maximal }); const before = structuredClone(raw);
  assert.equal(actions(validate(raw)).length, 1, '4 outer + 5*24 + 4 = 128');
  assert.deepEqual(raw, before);
});

test('profile helper rejects sparse numeric tuples directly', async () => {
  const { extrudeProfileIssue } = await import('../src/scene/extrude-profile.ts');
  const sparse = new Array(2); sparse[0] = 1;
  const issue = extrudeProfileIssue(outline as [number,number][], [[[0,0],[1,0],sparse as [number, number]]]);
  assert.ok(issue);
});

test('rejects an opening whose clearance collapses at renderer float precision', () => {
  const farOutline = [[90,90],[100,90],[100,100],[90,100]];
  const close = [[[95,94],[99.999999,94],[99.999999,96],[95,96]]];
  const raw = extrude({ outline: farOutline, holes: close }); const before = structuredClone(raw);
  const result = validate(raw);
  assert.equal(actions(result).length, 0);
  assert.ok(result.issues.some((i) => i.kind === 'dropped'));
  assert.deepEqual(raw, before);
});

test('short segments with opposite orientation signs cannot cross inside a hole', async () => {
  const { extrudeProfileIssue } = await import('../src/scene/extrude-profile.ts');
  const crossing: [number, number][] = [[-.0001,0],[.0001,0],[3,0],[3,-3],[0,-3],[0,-.0001],[0,.0001],[0,2],[-2,2],[-2,0]];
  assert.ok(extrudeProfileIssue(outline as [number,number][], [crossing]));
  const result = validate(extrude({ holes: [crossing] }));
  assert.equal(actions(result).length, 0);
  assert.ok(result.issues.some((i) => i.kind === 'dropped'));
});

test('float rounding may not turn an unclosed outer or inner ring into a closing marker', async () => {
  const { extrudeProfileIssue } = await import('../src/scene/extrude-profile.ts');
  const outer: [number,number][] = [[90,90],[100,90],[100,100],[90,100],[90,90.000001]];
  const inner: [number,number][] = [[92,92],[94,92],[94,94],[92,94]];
  assert.ok(extrudeProfileIssue(outer, [inner]));
  assert.equal(actions(validate(extrude({ outline: outer, holes: [inner] }))).length, 0);
  const simpleOuter: [number,number][] = [[90,90],[100,90],[100,100],[90,100]];
  const almostClosed: [number,number][] = [[92,92],[94,92],[94,94],[92,94],[92,92.000001]];
  assert.ok(extrudeProfileIssue(simpleOuter, [almostClosed]));
  assert.equal(actions(validate(extrude({ outline: simpleOuter, holes: [almostClosed] }))).length, 0);
  const actuallyClosed: [number,number][] = [...inner, [92,92]];
  assert.equal(extrudeProfileIssue([...simpleOuter, [90,90]], [actuallyClosed]), undefined);
  assert.equal(actions(validate(extrude({ outline: [...simpleOuter, [90,90]], holes: [actuallyClosed] }))).length, 1);
});
