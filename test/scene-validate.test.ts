import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createDetailState, createSceneState, LIMITS, startTurn, validateEscalate, validateScene, validateStep } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';

const samplesDir = new URL('../samples/scenes/', import.meta.url);
const load = (name: string): unknown => JSON.parse(readFileSync(new URL(name, samplesDir), 'utf8'));

/** A scene with one step holding the given actions. */
const scene = (...actions: unknown[]) => ({ steps: [{ say: 'ok', actions }] });
const box = (id: string, extra: object = {}) => ({ op: 'box', id, x: 10, y: 10, w: 100, h: 50, color: 'red', ...extra });
const cube = (id: string, extra: object = {}) => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], color: 'blue', ...extra });
const group = (id: string, extra: object = {}) => ({ op: 'add', shape: 'group', id, ...extra });
const actionsOf = (r: ReturnType<typeof validateScene>) => (r.scene as Scene).steps.flatMap((s) => s.actions);

/** The same data, except that a point of a tube or line may have been moved onto a part's surface (a short way). */
function sameButEnds(a: unknown, b: unknown, where: string): void {
  if (Array.isArray(a) && Array.isArray(b)) {
    assert.equal(a.length, b.length, where);
    a.forEach((x, k) => sameButEnds(x, b[k], `${where}[${k}]`));
  } else if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    assert.deepEqual(Object.keys(a as object).sort(), Object.keys(b as object).sort(), where);
    for (const k of Object.keys(a as object)) {
      const x: unknown = (a as Record<string, unknown>)[k];
      const y: unknown = (b as Record<string, unknown>)[k];
      if (k === 'pts' && Array.isArray(x) && Array.isArray(y) && Array.isArray(x[0]) && x[0].length === 3) {
        assert.equal(x.length, y.length, where);
        x.forEach((p, n) => assert.ok(Math.hypot(...(p as number[]).map((c, d) => c - ((y[n] as number[])[d] as number))) <= 0.5, `${where}.pts[${n}]`));
      } else sameButEnds(x, y, `${where}.${k}`);
    }
  } else assert.deepEqual(a, b, where);
}

test('every sample scene passes unchanged', () => {
  const samples = readdirSync(samplesDir).filter((f) => f.endsWith('.json') && !f.includes('followup'));
  assert.ok(samples.length >= 3);
  for (const name of samples) {
    const raw = load(name);
    const r = validateScene(raw);
    // A tube whose end lies on a part is joined to it (see scene-flow.test.ts): the notes say so, the end is moved a little onto the surface and carries its attachment. Nothing else is touched.
    assert.deepEqual(r.issues.filter((i) => !/^repaired: /.test(i.message)), [], name);
    assert.equal(r.ok, true);
    const plain = JSON.parse(JSON.stringify(r.scene), (k, v) => (k === 'attach' ? undefined : v));
    sameButEnds(plain, raw, name);
  }
});

test('a point of a path written with two numbers takes the depth of the point beside it, and the path is kept', () => {
  const tube = (pts: unknown[]) => ({ op: 'add', shape: 'tube', id: 't', pts, radius: 0.2 });
  const last = validateScene(scene(tube([[0, 1.2, 0.4], [-0.8, 0.7, 0.4], [-1.4, 0]])));
  assert.deepEqual((actionsOf(last).find((a) => a.op === 'add') as { pts?: unknown } | undefined)?.pts, [[0, 1.2, 0.4], [-0.8, 0.7, 0.4], [-1.4, 0, 0.4]]);
  assert.ok(last.issues.some((i) => i.kind === 'trimmed' && /two numbers/.test(i.message)), 'and it is noted');
  const first = validateScene(scene(tube([[0, 1], [1, 1, 0.3], [2, 1, 0.3]])));
  assert.deepEqual((actionsOf(first).find((a) => a.op === 'add') as { pts?: unknown } | undefined)?.pts, [[0, 1, 0.3], [1, 1, 0.3], [2, 1, 0.3]], 'the first point looks ahead');
  // Anything else that is not three numbers still loses the path: one number, four, or a word.
  for (const bad of [[1], [1, 2, 3, 4], ['a', 2]]) assert.equal(actionsOf(validateScene(scene(tube([[0, 0, 0], bad, [1, 1, 1]])))).length, 0, JSON.stringify(bad));
});

test('a follow-up reaches ids from the earlier turn through the same state', () => {
  const state = createSceneState();
  assert.deepEqual(validateScene(load('earth-layers.json'), state).issues, []);
  const raw = load('earth-layers-followup.json');
  const r = validateScene(raw, state);
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.scene, raw);
  // The same follow-up on a fresh state has nothing to reach: its tweens are dropped.
  const alone = validateScene(raw, createSceneState());
  assert.ok(alone.issues.some((i) => i.message.includes('unknown id')));
});

test('null for an optional field is the same as leaving it out', () => {
  const r = validateScene({ steps: [{ say: 'hi', actions: [
    { op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4, color: 'red', at: null },
    { op: 'add', shape: 'sphere', id: 's', parent: null, pos: null, size: [1, 1, 1], rot: null, color: 'blue', opacity: null, at: null },
  ] }] });
  assert.deepEqual(r.issues, []);
  assert.deepEqual(actionsOf(r), [
    { op: 'box', id: 'a', x: 1, y: 2, w: 3, h: 4, color: 'red' },
    { op: 'add', shape: 'sphere', id: 's', size: [1, 1, 1], color: 'blue' },
  ]);
});

test('escalate: a short reason, alone or with steps, cleaned and capped', () => {
  const alone = validateScene({ steps: [], escalate: 'needs a deeper look' });
  assert.equal(alone.ok, true);
  assert.deepEqual(alone.scene, { steps: [], escalate: 'needs a deeper look' });
  const withSteps = validateScene({ steps: [{ say: 'partly', actions: [] }], escalate: 'rest needs research' });
  assert.deepEqual(withSteps.scene, { steps: [{ say: 'partly', actions: [] }], escalate: 'rest needs research' });
  const long = validateScene({ steps: [], escalate: 'x'.repeat(5000) });
  assert.equal((long.scene as Scene).escalate?.length, LIMITS.maxEscalate);
  assert.ok(long.issues.some((i) => i.kind === 'trimmed' && i.path === 'escalate'));
  const messy = validateScene({ steps: [], escalate: '  too \n deep\u0000  ' });
  assert.equal((messy.scene as Scene).escalate, 'too deep');
  assert.equal('escalate' in (validateScene({ steps: [], escalate: null }).scene as Scene), false);
});

test('a bad escalate is dropped without losing the scene', () => {
  for (const bad of [5, true, {}, ['x'], '', '   ', '\u200b']) {
    const r = validateScene({ steps: [{ say: 'kept', actions: [] }], escalate: bad });
    assert.equal(r.ok, true, JSON.stringify(bad));
    assert.deepEqual(r.scene, { steps: [{ say: 'kept', actions: [] }] });
    assert.ok(r.issues.some((i) => i.path === 'escalate' && i.kind === 'dropped'));
  }
  assert.deepEqual(validateEscalate(undefined), { escalate: undefined, issues: [] });
});

test('anything that is not a scene is refused', () => {
  for (const raw of [null, undefined, 42, 'steps', [], { steps: 'x' }, { steps: {} }, { v: 2, steps: [] }, {}]) {
    const r = validateScene(raw);
    assert.equal(r.ok, false, JSON.stringify(raw));
    assert.equal(r.scene, null);
  }
});

test('unknown, missing and non-text actions are dropped and the rest kept', () => {
  const hostile = [
    { op: 'eval', code: 'alert(1)' },
    { op: 'script', src: 'https://evil.example/x.js' },
    { op: 'html', html: '<img src=x onerror=alert(1)>' },
    { op: 'constructor' },
    { op: 'add', shape: 'mesh' },
    { op: 'add' },
    { op: 7 },
    { id: 'x' },
    'box',
    null,
    [],
    42,
  ];
  const r = validateScene(scene(...hostile, box('keep')));
  assert.deepEqual(actionsOf(r), [box('keep')]);
  assert.equal(r.issues.filter((i) => i.kind === 'dropped').length, hostile.length);
});

test('unknown fields are stripped, and __proto__ cannot reach Object.prototype', () => {
  const polluted = JSON.parse('{"op":"box","id":"p","x":1,"y":1,"w":5,"h":5,"color":"red","__proto__":{"polluted":true},"onclick":"alert(1)","html":"<b>"}');
  const r = validateScene(scene(polluted));
  assert.deepEqual(actionsOf(r), [{ op: 'box', id: 'p', x: 1, y: 1, w: 5, h: 5, color: 'red' }]);
  assert.equal(r.issues.filter((i) => i.kind === 'trimmed').length >= 2, true);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  assert.equal(Object.getPrototypeOf(actionsOf(r)[0]), Object.prototype);
});

test('getters are never run', () => {
  let ran = false;
  const sneaky = { id: 'g', x: 1, y: 1, w: 5, h: 5, color: 'red' } as Record<string, unknown>;
  Object.defineProperty(sneaky, 'op', { enumerable: true, get() { ran = true; return 'box'; } });
  const r = validateScene(scene(sneaky));
  assert.equal(ran, false);
  assert.deepEqual(actionsOf(r), []);
});

test('numbers are clamped; things that are not finite numbers drop the action', () => {
  const r = validateScene(scene(
    box('big', { x: 99999, y: -50, w: 0, h: 5000 }),
    { op: 'add', shape: 'sphere', id: 's', pos: [1000, -1000, 0], size: [0, 1e9, 1], color: 'red', opacity: 7 },
    { op: 'orbit', az: 1e6, el: 120 },
  ));
  assert.deepEqual(actionsOf(r), [
    { op: 'box', id: 'big', x: 1000, y: 0, w: 1, h: 1000, color: 'red' },
    { op: 'add', shape: 'sphere', id: 's', pos: [100, -100, 0], size: [0.01, 100, 1], color: 'red', opacity: 1 },
    { op: 'orbit', az: 360, el: 89 },
  ]);
  assert.ok(r.issues.every((i) => i.kind === 'clamped'));

  const dropped = validateScene(scene(
    box('a', { x: NaN }), box('b', { y: Infinity }), box('c', { w: '100' }), box('d', { h: [1] }),
    box('e', { x: 10n }), box('f', { x: () => 1 }), box('g', { color: 'javascript:alert(1)' }),
    box('h', { color: 'rgb(0,0,0)' }), box('i', { at: 'soon' }),
    { op: 'add', shape: 'box', id: 'v', size: [1, 1], color: 'red' },
    { op: 'add', shape: 'box', id: 'w', size: [1, 1, '1'], color: 'red' },
    { op: 'add', shape: 'box', id: 'x', size: [[1], 1, 1], color: 'red' },
  ));
  assert.deepEqual(actionsOf(dropped), []);
});

test('hex colours and palette names pass; a bad hex is dropped', () => {
  const r = validateScene(scene(box('a', { color: '#fa0' }), box('b', { color: '#FFAA00' }), box('c', { color: 'Red' }), box('d', { color: '#ggg' })));
  assert.deepEqual(actionsOf(r).map((a) => (a as { id: string }).id), ['a', 'b', 'c']);
});

test('step, action and object counts are capped', () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ say: `s${i}`, actions: [] }));
  const r = validateScene({ steps: many });
  assert.equal((r.scene as Scene).steps.length, LIMITS.maxSteps);

  const wide = validateScene(scene(...Array.from({ length: 1000 }, (_, i) => box(`b${i}`))));
  assert.equal(actionsOf(wide).length, LIMITS.maxActionsPerStep);

  // Many steps of valid actions: stops at the per-turn action cap, then at the object cap.
  const steps = Array.from({ length: LIMITS.maxSteps }, (_, s) => ({
    say: 's', actions: Array.from({ length: LIMITS.maxActionsPerStep }, (_, a) => box(`b${s}-${a}`)),
  }));
  const state = createSceneState();
  const big = validateScene({ steps }, state);
  assert.ok(actionsOf(big).length <= LIMITS.maxActionsPerTurn);
  assert.ok(state.ids.size <= LIMITS.maxObjects);
});

test('step counts run across questions until startTurn, and the issue says so', () => {
  const state = createSceneState();
  const one = { say: 'x', actions: [] };
  for (let i = 0; i < LIMITS.maxSteps; i++) assert.ok(validateStep(one, state).step);
  const refused = validateStep(one, state);
  assert.equal(refused.step, null);
  assert.ok(refused.issues[0]?.message.includes('startTurn'));
  startTurn(state);
  assert.ok(validateStep(one, state).step);
});

test('the object cap holds across turns until something is cleared', () => {
  const state = createSceneState();
  let n = 0;
  while (state.ids.size < LIMITS.maxObjects) {
    validateScene({ steps: [{ say: 'x', actions: Array.from({ length: 20 }, () => box(`m${n++}`)) }] }, state);
  }
  const r = validateScene(scene(box('one-more')), state);
  assert.deepEqual(actionsOf(r), []);
  assert.deepEqual(actionsOf(validateScene(scene({ op: 'clear', target: 'all' }, box('after')), state)).map((a) => a.op), ['clear', 'box']);
});

test('tweens and references only reach known ids of the right kind', () => {
  const r = validateScene(scene(
    { op: 'move', id: 'ghost', to: [0, 0, 0] },
    box('m'),
    { op: 'move', id: 'm', to: [0, 0, 0] }, // a screen mark is not a 3D object
    { op: 'focus', id: 'm' },
    cube('c', { parent: 'ghost' }),
    cube('d', { parent: 'm' }),
    cube('e'),
    cube('f', { parent: 'e' }), // any 3D object can hold parts
    { op: 'move', id: 'e', to: [1, 2, 3] },
    { op: 'highlight', id: 'm' },
    { op: 'style', id: 'e' }, // nothing to change
    { op: 'style', id: 'e', opacity: 0.5 },
  ));
  assert.deepEqual(actionsOf(r).map((a) => a.op), ['box', 'add', 'add', 'move', 'highlight', 'style']);
});

test('a part can be a parent, but a mark, a pin or a text cannot; a parent made later in the step is waited for', () => {
  const r = validateScene(scene(
    cube('plug'),
    cube('pin1', { parent: 'plug' }),
    box('m'),
    cube('x', { parent: 'm' }),
    { op: 'pin', id: 'tag', on: 'plug', text: 'Plug' },
    cube('y', { parent: 'tag' }),
    cube('late', { parent: 'holder' }),
    cube('holder'),
  ));
  assert.deepEqual(actionsOf(r).map((a) => (a as { id: string }).id), ['plug', 'pin1', 'm', 'tag', 'holder', 'late']);
  assert.equal(r.issues.filter((i) => i.message.includes('cannot hold parts')).length, 2);
});

test('ids: malformed, reserved and duplicate ones are refused; odd-looking names are safe', () => {
  const bad = ['', 'a b', '1abc', '<img>', 'a'.repeat(33), '__proto__', 'all', 'marks', 'panel', 7, null, {}];
  const r = validateScene(scene(...bad.map((id) => box(id as string)), box('dup'), box('dup')));
  assert.deepEqual(actionsOf(r).map((a) => (a as { id: string }).id), ['dup']);
  // Names that exist on every object are ordinary ids here.
  const names = ['constructor', 'toString', 'hasOwnProperty', 'valueOf'];
  const ok = validateScene(scene(...names.map((n) => cube(n)), { op: 'move', id: 'constructor', to: [1, 1, 1] }));
  assert.equal(actionsOf(ok).length, names.length + 1);
  const unknown = validateScene(scene({ op: 'move', id: 'toString', to: [0, 0, 0] }));
  assert.deepEqual(actionsOf(unknown), []);
});

test('clear removes an object with what hangs from it, and its id can be used again', () => {
  const r = validateScene(scene(
    group('g'), cube('a', { parent: 'g' }), group('h', { parent: 'g' }), cube('b', { parent: 'h' }), cube('free'),
    { op: 'clear', target: 'g' },
    { op: 'move', id: 'a', to: [0, 0, 0] },
    { op: 'move', id: 'b', to: [0, 0, 0] },
    { op: 'move', id: 'free', to: [0, 0, 0] },
    group('g'),
  ));
  assert.deepEqual(actionsOf(r).map((a) => a.op), ['add', 'add', 'add', 'add', 'add', 'clear', 'move', 'add']);
});

test('clear marks, panel and all clear the right things', () => {
  const state = createSceneState();
  validateScene(scene(box('m1'), cube('c1'), { op: 'clear', target: 'marks' }), state);
  assert.deepEqual([...state.ids.keys()], ['c1']);
  validateScene(scene(box('m2'), { op: 'clear', target: 'panel' }), state);
  assert.deepEqual([...state.ids.keys()], ['m2']);
  validateScene(scene(cube('c2'), { op: 'clear', target: 'all' }), state);
  assert.equal(state.ids.size, 0);
  assert.deepEqual(actionsOf(validateScene(scene({ op: 'clear', target: 'nothing-here' }))), []);
});

test('group nesting depth is capped', () => {
  const chain = Array.from({ length: LIMITS.maxDepth + 3 }, (_, i) => group(`g${i}`, i ? { parent: `g${i - 1}` } : {}));
  const r = validateScene(scene(...chain));
  assert.equal(actionsOf(r).length, LIMITS.maxDepth);
});

test('text: control characters go, long text is cut, empty labels are dropped, markup stays plain text', () => {
  const r = validateScene({ steps: [{
    say: `He\u0000llo\u202e\nworld ${'x'.repeat(10_000)}`,
    actions: [
      { op: 'label', id: 'l1', x: 1, y: 1, text: '  \u200b\n ', color: 'red' },
      { op: 'label', id: 'l2', x: 1, y: 1, text: `<img src=x onerror=alert(1)> ${'y'.repeat(500)}`, color: 'red' },
    ],
  }] });
  const step = (r.scene as Scene).steps[0]!;
  assert.equal(step.say.length, LIMITS.maxSay);
  assert.ok(step.say.startsWith('Hello world xxx'));
  assert.deepEqual(step.actions.map((a) => a.op), ['label']);
  const text = (step.actions[0] as { text: string }).text;
  assert.ok(text.startsWith('<img src=x onerror=alert(1)> yyy'));
  assert.equal(text.length, LIMITS.maxText);
});

test('lists are trimmed to their caps and short ones refused', () => {
  const pts = (n: number) => Array.from({ length: n }, (_, i) => [i, 0, 0]);
  const r = validateScene(scene(
    { op: 'add', shape: 'line', id: 'long', pts: pts(500), color: 'red' },
    { op: 'add', shape: 'line', id: 'short', pts: pts(1), color: 'red' },
    { op: 'add', shape: 'arrow', id: 'arr', pts: pts(2), color: 'red' },
  ));
  assert.deepEqual(actionsOf(r).map((a) => (a as { id: string }).id), ['long', 'arr']);
  assert.equal((actionsOf(r)[0] as { pts: unknown[] }).pts.length, LIMITS.maxPts);
});

test('a step with nothing to say or show is dropped; a step that is not a step likewise', () => {
  const state = createSceneState();
  assert.equal(validateStep({ say: '', actions: [] }, state).step, null);
  assert.equal(validateStep({ say: 'x' }, state).step, null);
  assert.equal(validateStep({ actions: [] }, state).step, null);
  assert.equal(validateStep('step', state).step, null);
  assert.deepEqual(validateStep({ say: 'only words', actions: [{ op: 'nope' }] }, state).step, { say: 'only words', actions: [] });
});

test('time fields are clamped, and bad ones drop the action', () => {
  const r = validateScene(scene(box('a', { at: -3 }), box('b', { at: 9999 }), { op: 'zoom', to: 99, dur: 500 }));
  assert.deepEqual(actionsOf(r), [box('a', { at: 0 }), box('b', { at: 60 }), { op: 'zoom', to: 5, dur: 30 }]);
});

test('a ten-megabyte string and a very deep value are handled without trouble', () => {
  let deep: unknown = 1;
  for (let i = 0; i < 100_000; i++) deep = [deep];
  const start = Date.now();
  const r = validateScene({ steps: [{ say: 'z'.repeat(10_000_000), actions: [box('d', { x: deep }), box('e', { pos: deep })] }] });
  assert.ok(Date.now() - start < 1000);
  assert.equal((r.scene as Scene).steps[0]?.say.length, LIMITS.maxSay);
  assert.deepEqual(actionsOf(r).map((a) => (a as { id: string }).id), ['e']);
});

test('a colour name outside the palette is read as the nearest palette colour, not dropped', () => {
  const r = validateScene(scene(box('a', { color: 'gold' }), box('b', { color: 'Royal Blue' }), box('c', { color: 'light-green' }), box('d', { color: 'not a colour' })));
  const colours = actionsOf(r).map((a) => (a as { color?: string }).color);
  assert.deepEqual(colours, ['yellow', 'blue', 'green']);
  assert.equal(r.issues.filter((i) => i.kind === 'trimmed' && i.message.includes('read as')).length, 3);
  assert.equal(r.issues.filter((i) => i.kind === 'dropped').length, 1);
  // Names that exist on every object are not colours, and asking for one must not throw.
  const odd = validateScene(scene(...['constructor', 'toString', '__proto__', 'hasOwnProperty'].map((c, i) => box(`o${i}`, { color: c }))));
  assert.equal(actionsOf(odd).length, 0);
  assert.equal(odd.issues.filter((i) => i.kind === 'dropped').length, 4);
  // A colour the palette has is left alone, and a hex colour stays exact.
  const same = validateScene(scene(box('e', { color: 'teal' }), box('f', { color: '#e3b341' })));
  assert.deepEqual(same.issues, []);
});

test('a part may name where it moves when the model is exploded; a bad offset is not kept', () => {
  const find = (r: ReturnType<typeof validateScene>) => actionsOf(r).find((a) => (a as { id?: string }).id === 'a') as { explode?: unknown } | undefined;
  const ok = validateScene(scene(group('g'), cube('a', { parent: 'g', pos: [1, 0, 0], explode: [0, 3, 0] })));
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(find(ok)?.explode, [0, 3, 0]);
  const big = validateScene(scene(group('g'), cube('a', { parent: 'g', explode: [0, 9999, 0] })));
  assert.deepEqual(find(big)?.explode, [0, 100, 0], 'capped at the world limit');
  for (const wrong of [[1, 2], 'up', [1, 'x', 3]]) {
    const a = find(validateScene(scene(group('g'), cube('a', { parent: 'g', explode: wrong }))));
    assert.ok(!a || a.explode === undefined, `a bad offset (${JSON.stringify(wrong)}) is not kept`);
  }
});

test('a detail state knows the ids on screen: they can be named without being written, written once more (same kind), but not twice', () => {
  const onScreen = createSceneState();
  validateScene(scene(group('g'), cube('a', { parent: 'g' }), { op: 'pin', id: 'p', on: 'a', text: 'A' }), onScreen);
  const detail = createDetailState(onScreen);
  startTurn(detail);
  const r = validateScene(scene(
    { op: 'pin', id: 'q', on: 'a', text: 'B' }, // `a` named, not written again
    cube('b', { parent: 'g', pos: [5, 0, 0] }), // a new part under an unwritten holder (clear of the others)
    cube('a', { parent: 'g', size: [2, 2, 2] }), // written again: replaces
    cube('a', { parent: 'g' }), // a second time: refused
    box('p'), // `p` is a pin on screen; a screen box with its id is a different kind: refused
  ), detail);
  assert.deepEqual(actionsOf(r).map((a) => (a as { id?: string }).id), ['q', 'b', 'a']);
  assert.equal(onScreen.replaceable, undefined, 'the scene on screen is left as it was');
  assert.ok(onScreen.ids.has('a') && !onScreen.ids.has('b'));
});

test('a detail pass may swap any 3D object for another kind of 3D object, but a mark, pin or text only for its own kind', () => {
  const onScreen = createSceneState();
  validateScene(scene(
    cube('plain'), // a solid
    { op: 'add', shape: 'cylinder', id: 'pipe', size: [1, 1, 1] },
    group('holder'),
    { op: 'add', shape: 'text', id: 'words', text: 'Hi', height: 1, color: 'blue' },
    { op: 'pin', id: 'p', on: 'plain', text: 'A' },
  ), onScreen);
  const detail = createDetailState(onScreen);
  startTurn(detail);
  const r = validateScene(scene(
    { op: 'add', shape: 'part', part: 'gear', id: 'plain', size: [1, 1, 1] }, // solid -> kit part (a group)
    { op: 'add', shape: 'tube', id: 'pipe', pts: [[0, 0, 0], [0, 1, 0]], radius: 0.1 }, // solid -> tube (a path)
    cube('holder'), // group -> solid
    cube('words'), // text -> solid: refused
    { op: 'add', shape: 'text', id: 'p', text: 'Pin', height: 1, color: 'blue' }, // pin -> text: refused
  ), detail);
  assert.deepEqual(actionsOf(r).map((a) => (a as { id?: string }).id), ['plain', 'pipe', 'holder']);
  assert.equal(detail.ids.get('plain'), 'group');
  assert.equal(detail.ids.get('pipe'), 'path');
  assert.equal(detail.ids.get('words'), 'text');
});

test('a wait for a click keeps its box, or none, and drops a kind of wait it does not know', () => {
  const ok = validateScene(scene(box('t'), { op: 'wait', for: 'click', x: 400, y: 100, w: 100, h: 40 }));
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(actionsOf(ok)[1], { op: 'wait', for: 'click', x: 400, y: 100, w: 100, h: 40 });
  const anywhere = validateScene(scene({ op: 'wait', for: 'click' }));
  assert.deepEqual(anywhere.issues, []);
  assert.deepEqual(actionsOf(anywhere), [{ op: 'wait', for: 'click' }]);
  const unknown = validateScene(scene(box('t'), { op: 'wait', for: 'key' }));
  assert.equal(actionsOf(unknown).length, 1, 'a wait for something else is dropped');
  const outside = validateScene(scene({ op: 'wait', for: 'click', x: 5000, y: 0, w: 10, h: 10 }));
  const wait = actionsOf(outside)[0] as { x: number };
  assert.ok(wait.x <= 1000, 'a box off the screen is pulled back onto it');
});

test('a go asks the app to open a tab, open a menu or scroll; a kind it does not know (a click, a link) is dropped', () => {
  const ok = validateScene(scene(box('t'), { op: 'go', kind: 'tab', x: 450, y: 120 }, { op: 'go', kind: 'scroll', x: 500, y: 500, dir: 'down' }));
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(actionsOf(ok).slice(1), [{ op: 'go', kind: 'tab', x: 450, y: 120 }, { op: 'go', kind: 'scroll', x: 500, y: 500, dir: 'down' }]);
  for (const kind of ['click', 'button', 'link', 'invoke', 'type']) {
    const bad = validateScene(scene(box('t'), { op: 'go', kind, x: 450, y: 120 }));
    assert.equal(actionsOf(bad).length, 1, `${kind} is not a move the app makes`);
  }
});
