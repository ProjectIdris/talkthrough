import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDetailState, createSceneState, validateScene } from '../src/scene/index.ts';
import type { Action, Scene } from '../src/scene/index.ts';
import { validatorNotes } from '../src/main/session.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

// Machine ops (crank, cam, flash, spin by) act on parts already in the scene. Whatever name the model gives, the validator binds them to the
// right part or drops them, and the renderer never moves a cylinder block or a group with them (the whole cylinder once rode up and down with the piston).

type Raw = Record<string, unknown>;
const answers = JSON.parse(readFileSync(new URL('./fixtures/engine-answers.json', import.meta.url), 'utf8')) as Record<string, Raw[]>;

const part = (id: string, p: string, extra: Raw = {}): Raw => ({ op: 'add', shape: 'part', part: p, id, size: [1, 1, 1], ...extra });
const group = (id: string): Raw => ({ op: 'add', shape: 'group', id });
const run = (...actions: Raw[]) => {
  const r = validateScene({ steps: [{ say: 'x', actions }] }, createSceneState());
  const kept = r.scene ? (r.scene as Scene).steps.flatMap((s) => s.actions) : [];
  return { kept, issues: r.issues, ofOp: (op: string) => kept.filter((a) => a.op === op) as unknown as Raw[] };
};

// ---- the answers that went wrong -------------------------------------------------------------------------------------------------

test('a camshaft answer from a real take: both cams bind to their valves', () => {
  const { ofOp, issues } = run(...(answers.D1 as Raw[]));
  const cams = ofOp('cam');
  assert.deepEqual(cams.map((c) => [c.id, c.by]), [['intake-valve', 'camshaft'], ['exhaust-valve', 'camshaft']]);
  assert.ok(issues.some((i) => /repaired: "intake-cam" is not a valve part; bound to "intake-valve"/.test(i.message)), JSON.stringify(issues));
});

test('a crank answer from a real take: the made-up name binds to the piston, the rod stays', () => {
  const { ofOp } = run(...(answers.X3 as Raw[]));
  const [crank] = ofOp('crank');
  assert.deepEqual([crank?.id, crank?.shaft, crank?.rod], ['pis', 'cs', 'rod']);
});

const L1 = [
  group('engine'),
  part('block', 'cylinder-block', { parent: 'engine', variant: 'cutaway', size: [3, 3, 3] }),
  part('piston', 'piston', { parent: 'engine', size: [1.8, 1, 1.8], pos: [0, 1, 0] }),
  part('crank', 'crankshaft', { parent: 'engine', size: [2.4, 2.4, 2.8], pos: [0, -2.2, 0], n: 1 }),
  { op: 'spin', id: 'crank', rpm: 30 },
  { op: 'spin', id: 'cam-shaft', by: 'crank', ratio: 0.5 },
  { op: 'crank', id: 'drive shaft', shaft: 'crank', rod: 'rod', pin: 1 },
];
const V1 = [
  group('engine'),
  part('block', 'cylinder-block', { parent: 'engine', variant: 'cutaway', size: [2.4, 3.2, 2.4], pos: [0, 0.4, 0] }),
  part('piston', 'piston', { parent: 'engine', size: [1.6, 0.9, 1.6], pos: [0, 1.2, 0] }),
  part('crank', 'crankshaft', { parent: 'engine', size: [2.6, 0.6, 1], n: 1, pos: [0, -1.7, 0] }),
  { op: 'spin', id: 'crank', rpm: 60 },
  { op: 'crank', id: 'piston-drive', shaft: 'crank', rod: 'rod', pin: 1 },
];
const S1 = [part('block', 'cylinder-block', { variant: 'cutaway', size: [3, 4, 3] }), part('piston1', 'piston', { pos: [0, 0.6, 0] }), { op: 'along', id: 'piston1', pts: [[0, 0.6, 0], [0, 2, 0]] }];

test('the lost takes, as written: an unknown piston name binds to the one piston, a rod that was never added is left out, nothing else is hurt', () => {
  for (const [name, tape] of [['L1', L1], ['V1', V1]] as const) {
    const { ofOp, issues } = run(...tape);
    const [crank] = ofOp('crank');
    assert.equal(crank?.id, 'piston', name);
    assert.equal(crank?.shaft, 'crank', name);
    assert.equal(crank?.rod, undefined, `${name}: no rod part, so no rod`);
    assert.ok(issues.some((i) => i.path.endsWith('.rod') && /left out/.test(i.message)), name);
  }
  // spin of a part that was never added still drops (it names nothing to turn)
  assert.ok(!run(...L1).ofOp('spin').some((s) => s.id === 'cam-shaft'));
  const s1 = run(...S1);
  assert.equal(s1.issues.length, 0);
  assert.equal(s1.ofOp('along').length, 1);
});

test('a crank named on the cylinder block, a group or an unknown name binds to the one piston beside the shaft (rod likewise)', () => {
  for (const wrong of ['block', 'engine', 'linkage']) {
    const { ofOp, issues } = run(group('engine'), part('block', 'cylinder-block', { parent: 'engine' }), part('piston', 'piston', { parent: 'engine' }),
      part('rod', 'connecting-rod', { parent: 'engine' }), part('shaft', 'crankshaft', { parent: 'engine' }),
      { op: 'crank', id: wrong, shaft: 'shaft', rod: wrong === 'linkage' ? 'rod' : 'block' });
    const [crank] = ofOp('crank');
    assert.deepEqual([crank?.id, crank?.shaft, crank?.rod], ['piston', 'shaft', 'rod'], wrong);
    assert.ok(issues.some((i) => /repaired:/.test(i.message) && i.path.endsWith('.id')), `${wrong}: the repair is logged`);
  }
});

test('a cam named on the cylinder block or a group binds to the one valve', () => {
  for (const wrong of ['block', 'engine']) {
    const { ofOp } = run(group('engine'), part('block', 'cylinder-block', { parent: 'engine' }), part('v', 'valve', { parent: 'engine' }), part('cs', 'camshaft', { parent: 'engine' }), { op: 'cam', id: wrong, by: 'cs' });
    assert.equal(ofOp('cam')[0]?.id, 'v', wrong);
  }
});

test('the piston alias is read first and is what the schema asks for; id still works', () => {
  const base = [part('piston', 'piston'), part('p2', 'piston'), part('shaft', 'crankshaft')];
  assert.equal(run(...base, { op: 'crank', piston: 'p2', shaft: 'shaft' }).ofOp('crank')[0]?.id, 'p2');
  assert.equal(run(...base, { op: 'crank', id: 'p2', shaft: 'shaft' }).ofOp('crank')[0]?.id, 'p2');
  assert.equal(run(...base, { op: 'cam', valve: 'v', by: 'shaft' }).ofOp('cam').length, 0, 'an unknown valve with no valve part is dropped');
  const withValve = run(part('v1', 'valve'), part('cams', 'camshaft'), { op: 'cam', valve: 'v1', by: 'cams' });
  assert.equal(withValve.ofOp('cam')[0]?.id, 'v1');
  assert.equal(withValve.issues.length, 0);
});

test('two pistons and no way to tell which: the crank is dropped, with a line saying why', () => {
  const { ofOp, issues } = run(part('a', 'piston'), part('b', 'piston'), part('shaft', 'crankshaft'), { op: 'crank', id: 'block', shaft: 'shaft' });
  assert.equal(ofOp('crank').length, 0);
  assert.ok(issues.some((i) => i.kind === 'dropped' && /no single piston part/.test(i.message)), JSON.stringify(issues));
  // two valves, a name that matches neither
  const cams = run(part('v1', 'valve'), part('v2', 'valve'), part('cs', 'camshaft'), { op: 'cam', id: 'the lifter', by: 'cs' });
  assert.equal(cams.ofOp('cam').length, 0);
  // and one that matches one: "intake" picks the intake valve
  const named = run(part('intake-valve', 'valve'), part('exhaust-valve', 'valve'), part('cs', 'camshaft'), { op: 'cam', id: 'intake lobe', by: 'cs' });
  assert.equal(named.ofOp('cam')[0]?.id, 'intake-valve');
});

test('of several pistons the one that sits beside the shaft is the one', () => {
  const { ofOp } = run(group('a'), group('b'), part('pa', 'piston', { parent: 'a' }), part('pb', 'piston', { parent: 'b' }), part('sb', 'crankshaft', { parent: 'b' }), { op: 'crank', id: 'x', shaft: 'sb' });
  assert.equal(ofOp('crank')[0]?.id, 'pb');
});

test('a piston, rod or shaft built from plain shapes is taken as it is', () => {
  const box = (id: string): Raw => ({ op: 'add', shape: 'box', id, size: [1, 1, 1] });
  const { ofOp, issues } = run(box('p'), box('r'), box('s'), { op: 'crank', id: 'p', shaft: 's', rod: 'r' });
  assert.deepEqual([ofOp('crank')[0]?.id, ofOp('crank')[0]?.rod], ['p', 'r']);
  assert.deepEqual(issues, []);
});

test('flash and spin by are bound too: an unknown driver binds to the one crankshaft; a group or block is never a driver', () => {
  const eng = [group('engine'), part('block', 'cylinder-block', { parent: 'engine' }), part('cs', 'crankshaft', { parent: 'engine' }), { op: 'add', shape: 'sphere', id: 'burn', size: [1, 1, 1], opacity: 0.5 }];
  const flash = run(...eng, { op: 'flash', id: 'burn', by: 'engine', angle: 360, span: 90 });
  assert.equal(flash.ofOp('flash')[0]?.by, 'cs');
  const spin = run(...eng, part('cam', 'camshaft'), { op: 'spin', id: 'cam', by: 'the crank', ratio: 0.5 });
  assert.equal(spin.ofOp('spin')[0]?.by, 'cs');
  const plain = run(...eng, { op: 'spin', id: 'cs', rpm: 30 });
  assert.equal(plain.ofOp('spin')[0]?.by, undefined, 'a plain spin is left alone');
  assert.deepEqual(plain.issues, []);
});

test('a rod the model added but did not name is found; ids stay valid across a detail pass', () => {
  const r = run(part('piston', 'piston'), part('rod', 'connecting-rod'), part('cs', 'crankshaft'), { op: 'crank', id: 'piston', shaft: 'cs' });
  assert.equal(r.ofOp('crank')[0]?.rod, 'rod');
  const on = createSceneState();
  validateScene({ steps: [{ say: 'x', actions: [part('piston', 'piston'), part('cs', 'crankshaft')] }] }, on);
  const detail = validateScene({ steps: [{ say: 'x', actions: [{ op: 'crank', id: 'nope', shaft: 'cs' }] }] }, createDetailState(on));
  assert.equal(((detail.scene as Scene).steps[0]?.actions[0] as Action & { id: string }).id, 'piston');
});

test('a part cleared is no longer a part to bind to', () => {
  const r = run(part('p1', 'piston'), part('cs', 'crankshaft'), { op: 'clear', target: 'p1' }, { op: 'crank', id: 'p1', shaft: 'cs' });
  assert.equal(r.ofOp('crank').length, 0);
});

// ---- the renderer: the block never moves, with or without a rod ---------------------------------------------------------------

const obj = (f: Frame, id: string) => f.objects.find((o) => o.id === id);
const posOf = (f: Frame, id: string) => (obj(f, id)?.pose?.pos ?? obj(f, id)?.pos) as [number, number, number];
const play = (...actions: Raw[]) => planStep(emptyFrame(), { say: 'x', actions } as never);

test('even a crank that reached the renderer on a cylinder block or a group does not move it', () => {
  const engine = [group('all'), part('block', 'cylinder-block', { parent: 'all', size: [3, 4, 3], pos: [0, 0, 0] }), part('piston', 'piston', { parent: 'all', size: [2, 2, 2], pos: [0, 3, 0] }),
    part('rod', 'connecting-rod', { parent: 'all', size: [0.8, 4, 0.5], pos: [0, 0.5, 0] }), part('crank', 'crankshaft', { parent: 'all', size: [4, 4, 2], pos: [0, -2, 0] }), { op: 'spin', id: 'crank', rpm: 10, dur: 0 }];
  for (const target of ['block', 'all']) {
    const plan = play(...engine, { op: 'crank', id: target, shaft: 'crank', rod: 'rod' });
    const at = (deg: number) => evaluate(plan, deg / 60);
    for (const deg of [0, 90, 180, 270]) {
      assert.deepEqual(posOf(at(deg), target), posOf(at(0), target), `${target} at ${deg}`);
    }
  }
  // the right crank on the same engine still moves the piston and not the block
  const ok = play(...engine, { op: 'crank', id: 'piston', shaft: 'crank', rod: 'rod' });
  assert.notDeepEqual(posOf(evaluate(ok, 3), 'piston'), posOf(evaluate(ok, 0), 'piston'));
  assert.deepEqual(posOf(evaluate(ok, 3), 'block'), posOf(evaluate(ok, 0), 'block'));
});

test('a crank with no rod part still moves the piston, and only the piston', () => {
  const plan = play(part('block', 'cylinder-block', { size: [3, 4, 3] }), part('piston', 'piston', { size: [2, 2, 2], pos: [0, 3, 0] }), part('crank', 'crankshaft', { size: [4, 4, 2], pos: [0, -2, 0] }),
    { op: 'spin', id: 'crank', rpm: 10, dur: 0 }, { op: 'crank', id: 'piston', shaft: 'crank' });
  const y = (deg: number) => posOf(evaluate(plan, deg / 60), 'piston')[1];
  assert.ok(y(0) - y(180) > 1, `the piston travels (${y(0)} to ${y(180)})`);
  assert.deepEqual(posOf(evaluate(plan, 3), 'block'), posOf(evaluate(plan, 0), 'block'));
});

test('what the validator repaired or dropped is told in the log, not only counted', () => {
  const r = run(part('a', 'piston'), part('b', 'piston'), part('shaft', 'crankshaft'), { op: 'crank', id: 'block', shaft: 'shaft' });
  assert.match(validatorNotes(r.issues, 2), /^validator: \d+ notes on step 2: .*no single piston part/);
  const fixed = run(part('v', 'valve'), part('cs', 'camshaft'), { op: 'cam', id: 'lifter', by: 'cs' });
  assert.match(validatorNotes(fixed.issues, 1), /"lifter" is not a valve part; bound to "v"/);
});
