import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSectorRings } from '../src/scene/sector-sweep.ts';
import type { Vec2 } from '../src/scene/types.ts';
import { createDetailState, createSceneState, validateScene, sceneGuide, sceneSchema } from '../src/scene/index.ts';

const rectangle = [[0, 0], [2, 0], [2, 3], [0, 3]];
const action = (profile: unknown = rectangle, sweep: unknown = 240) => ({ op: 'add', shape: 'lathe', id: 'body', profile, sweep });
function run(a: unknown, state = createSceneState()) {
  const result = validateScene({ steps: [{ say: '', actions: [a] }] }, state);
  return { ...result, actions: result.scene?.steps.flatMap(s => s.actions) ?? [] };
}

test('sector sweep survives validation and appears in schema and guide', () => {
  assert.equal((run(action()).actions[0] as any)?.sweep, 240);
  const definition = (sceneSchema as any).$defs.addLathe;
  assert.deepEqual(definition.properties.sweep.type, ['number', 'null']);
  assert.match(definition.description, /simple closed polygon/);
  assert.match(definition.description, /1\.\.359/);
  assert.match(sceneGuide, /sweep\?/);
});

test('sector sweep rejects rather than clamps', () => {
  for (const value of [0, -1, 360, 400, NaN, Infinity, '90', true]) {
    assert.equal(run(action(rectangle, value)).actions.length, 0, String(value));
  }
  for (const value of [1, 359, 90.5]) {
    assert.equal(run(action(rectangle, value)).actions.length, 1);
  }
});

test('sectors normalize either winding, closing duplicates and collinear boundary points', () => {
  for (const p of [rectangle, [...rectangle].reverse(), [...rectangle, rectangle[0]], [[0, 0], [1, 0], [2, 0], [2, 3], [0, 3]]]) {
    const got = (run(action(p)).actions[0] as any)?.profile;
    assert.equal(got?.length, 4);
    assert.ok(got.reduce((sum: number, v: number[], i: number) => {
      const q = got[(i + 1) % got.length];
      return sum + v[0]! * q[1] - q[0] * v[1]!;
    }, 0) > 0);
  }
});

test('unsafe sector profiles are dropped without repair', () => {
  const bad = [
    [],
    [[1, 0], [2, 1]],
    [[0, 0], [2, 2], [0, 2], [2, 0]],
    [[0, 0], [1, 0], [2, 0]],
    [[-1, 0], [2, 0], [2, 3]],
    [[0, 0], [101, 0], [2, 3]],
    [[0, -101], [2, 0], [2, 3]],
    [[0, 0], [2, 0], [2, Infinity]],
    [[0, 0], [2, 0], [2, 2], [0, 0], [0, 2]],
    [[0, 0], [2, 0], [1, 0], [2, 2], [0, 2]],
    [[1, 0], [1 + 1e-9, 0], [1 + 1e-9, 2], [1, 2]],
    [[0, 0], [2, 0], [2, 1e-14], [0, 1e-14]],
    Array.from({ length: 41 }, (_, i) => [1 + Math.cos(i / 41 * 2 * Math.PI), Math.sin(i / 41 * 2 * Math.PI)]),
  ];
  for (const p of bad) {
    assert.equal(run(action(p)).actions.length, 0, JSON.stringify(p));
  }
});

test('profile accessors and sparse data are rejected without execution', () => {
  let reads = 0;
  const p = rectangle.map(x => [...x]);
  Object.defineProperty(p[1], '0', {
    get() {
      reads++;
      return 2;
    },
  });
  const q = rectangle.map(x => [...x]);
  delete q[1];
  assert.equal(run(action(p)).actions.length, 0);
  assert.equal(run(action(q)).actions.length, 0);
  assert.equal(reads, 0);
});

test('invalid sectors neither consume ids nor consume replacement permission', () => {
  const state = createSceneState();
  assert.equal(run(action(rectangle, 400), state).actions.length, 0);
  assert.equal(state.ids.has('body'), false);
  const initial = validateScene({ steps: [{ say: '', actions: [
    { op: 'add', shape: 'group', id: 'holder' },
    { op: 'add', shape: 'box', id: 'body', parent: 'holder', size: [2, 3, 4] },
    { op: 'add', shape: 'box', id: 'child', parent: 'body', size: [1, 1, 1] },
  ] }] }, state);
  assert.equal(initial.scene?.steps[0]?.actions.length, 3);
  assert.equal(state.ids.get('body'), 'solid');
  assert.equal(state.ids.get('child'), 'solid');
  assert.ok(state.bodies.has('body'));
  assert.ok(state.bodies.has('child'));
  assert.equal(state.parents.get('body'), 'holder');
  assert.equal(state.parents.get('child'), 'body');
  assert.equal(state.depth.get('body'), 2);
  assert.equal(state.depth.get('child'), 3);

  const detail = createDetailState(state);
  const oldBody = detail.bodies.get('body');
  const oldParents = new Map(detail.parents);
  const oldDepth = new Map(detail.depth);
  const oldIds = new Map(detail.ids);
  const oldBodies = new Map(detail.bodies);
  const oldReplaceable = new Set(detail.replaceable);
  for (const invalid of [action(rectangle, 400), action([[0, 0], [2, 2], [0, 2], [2, 0]])]) {
    assert.equal(run(invalid, detail).actions.length, 0);
    assert.equal(detail.bodies.get('body'), oldBody);
    assert.deepEqual(detail.parents, oldParents);
    assert.deepEqual(detail.depth, oldDepth);
    assert.deepEqual(detail.ids, oldIds);
    assert.deepEqual(detail.bodies, oldBodies);
    assert.deepEqual(detail.replaceable, oldReplaceable);
    assert.equal(detail.replaceable?.has('body'), true);
  }

  const accepted = run({ ...action(), parent: 'holder' }, detail);
  assert.equal(accepted.actions.length, 1);
  assert.equal((accepted.actions[0] as any)?.sweep, 240);
  assert.equal(detail.replaceable?.has('body'), false);
  assert.equal(detail.parents.get('body'), 'holder');
  assert.equal(detail.parents.get('child'), 'body');
  assert.equal(detail.ids.get('child'), 'solid');
});

test('omitted and null sweep retain old two-point full-lathe behavior', () => {
  for (const sweep of [undefined, null]) {
    const result = run({ ...action([[-1, 0], [200, 200]]), sweep });
    assert.equal(result.actions.length, 1);
    assert.deepEqual((result.actions[0] as any).profile, [[-1, 0], [100, 100]]);
    assert.equal('sweep' in result.actions[0]!, false);
  }
});

test('non-adjacent boundary contact and Float32-collapsed corners reject sectors', () => {
  for (const profile of [
    [[0, 0], [4, 0], [4, 4], [2, 0], [0, 4]],
    [[1, 1], [2, 1], [2, 2], [1.00000001, 2], [1, 1.5]],
    [[0, 0], [2, 0], [2, 2], [1, 2], [1, 0], [0, 2]],
  ]) {
    assert.equal(run(action(profile)).actions.length, 0);
  }
});

test('profile and sweep getters are rejected without invocation', () => {
  let reads = 0;
  for (const key of ['profile', 'sweep']) {
    const a = action();
    Object.defineProperty(a, key, {
      get() {
        reads++;
        return key === 'profile' ? rectangle : 90;
      },
    });
    assert.equal(run(a).actions.length, 0);
  }
  const p = rectangle.map(x => [...x]);
  Object.defineProperty(p, '1', {
    get() {
      reads++;
      return [2, 0];
    },
  });
  assert.equal(run(action(p)).actions.length, 0);
  assert.equal(reads, 0);
});

test('rotation-unsafe annuli are rejected before replacement state changes', () => {
  const state = createSceneState();
  run({ op: 'add', shape: 'box', id: 'body', size: [2, 3, 4] }, state);
  const detail = createDetailState(state);
  const body = detail.bodies.get('body');
  assert.ok(body);
  const thin = [[24.499153, 0], [24.499155, 0], [24.499155, 20], [24.499153, 20]];
  for (const sides of [64, undefined, null, 100]) {
    assert.equal(run({ ...action(thin, 359), sides }, detail).actions.length, 0);
    assert.equal(detail.bodies.get('body'), body);
    assert.equal(detail.replaceable?.has('body'), true);
  }
  const safe = [[24, 0], [24.01, 0], [24.01, 20], [24, 20]];
  for (const sides of [3, 8, 20, 36, 64, undefined, null, 100, 3.4]) {
    assert.equal(run({ ...action(safe, 359), sides }).actions.length, 1);
  }
});

test('shared ring preparation preserves Float32 seams, axis endpoints and proportional resolution', () => {
  const profile: Vec2[] = [[0, 0], [2, 0], [2, 3], [0, 3]];
  for (const sides of [3, 20, 36, 64]) {
    for (const sweep of [1, 45, 90, 240, 359]) {
      const rings = prepareSectorRings(profile, sides, sweep);
      assert.ok(rings);
      assert.equal(rings.length, Math.max(Math.ceil(sweep / 90), Math.ceil(sides * sweep / 360)) + 1);
      for (const ring of rings) {
        assert.ok(ring[0]!.every(coordinate => coordinate === 0));
        assert.ok(ring[3]![0] === 0 && ring[3]![1] === 3 && ring[3]![2] === 0);
        for (const point of ring) {
          for (const coordinate of point) assert.equal(coordinate, Math.fround(coordinate));
        }
      }
    }
  }
  assert.equal(prepareSectorRings([[1, 0], [1 + 6e-8, 0], [1 + 6e-8, 1], [1, 1]], 64, 359), null);
  assert.equal(prepareSectorRings(profile, 64, 360), null);
  assert.equal(prepareSectorRings(profile, NaN, 90), null);
});
