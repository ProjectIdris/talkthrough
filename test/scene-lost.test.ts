import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';
import { validatorNotes } from '../src/main/session.ts';

// Nothing the model draws may vanish, or draw into nothing, without a line that says why: a stage written with no size is given one, a loop, move or pulse
// that names an id the model never made is bound to the part it meant (or refused with a note), and the log line tells the dropped ones first.
// The answers are two from a live check (see the fixture) where the whole proof drew into a speck and the heartbeat was lost.

type Raw = Record<string, unknown>;
type Step = { say: string; actions: Raw[] };
const answers = JSON.parse(readFileSync(new URL('./fixtures/sweep-answers.json', import.meta.url), 'utf8')) as Record<string, Step[]>;

const play = (steps: readonly Step[]) => {
  const r = validateScene({ steps: steps as unknown as Scene['steps'] }, createSceneState());
  const kept = r.scene ? (r.scene as Scene).steps.flatMap((s) => s.actions) : [];
  return { kept: kept as unknown as Raw[], issues: r.issues, ofOp: (op: string) => kept.filter((a) => a.op === op) as unknown as Raw[] };
};
const one = (...actions: Raw[]) => play([{ say: 'x', actions }]);
const blob = (id: string): Raw => ({ op: 'add', shape: 'blob', id, pos: [0, 0, 0], pts: [[0, 0, 0]], sizes: [[1, 1, 1]], soft: 0.5 });
const loop = (id: string): Raw => ({ op: 'loop', id, kind: 'pulse', amount: 1.1, period: 1 });

// ---- a stage written with no size ------------------------------------------------------------------------------------------------

test('a stage written 0 by 0, as in the Pythagorean answer, is given a size a model can be seen in, and the note says so', () => {
  const { ofOp, issues } = play(answers.pythagorean!);
  const [panel] = ofOp('panel');
  assert.ok(panel, 'the stage is kept');
  assert.ok((panel!.w as number) >= 200 && (panel!.h as number) >= 200, `a stage of ${panel!.w} x ${panel!.h} is a speck`);
  assert.ok((panel!.y as number) + (panel!.h as number) <= 1000, 'and it lies on the screen');
  assert.ok(issues.some((i) => /a stage 0 wide is too small/.test(i.message)), JSON.stringify(issues));
});

test('a stage written with no size takes the size of the stage before it', () => {
  const { ofOp } = one({ op: 'panel', x: 100, y: 100, w: 420, h: 300 }, { op: 'panel', x: 500, y: 200, w: 0, h: 0 });
  const [, second] = ofOp('panel');
  assert.deepEqual([second!.x, second!.y, second!.w, second!.h], [500, 200, 420, 300]);
});

test('a stage that is a real size, however small, is left as written', () => {
  const { ofOp, issues } = one({ op: 'panel', x: 100, y: 100, w: 120, h: 90 });
  assert.deepEqual([ofOp('panel')[0]!.w, ofOp('panel')[0]!.h], [120, 90]);
  assert.equal(issues.length, 0);
});

// ---- ids the model never made ----------------------------------------------------------------------------------------------------

test('the heart answer: four pulse loops named for the chambers (lpra, lpla, lprv, lplv) are bound to ra, la, rv and lv, each with a note', () => {
  const { ofOp, issues } = play(answers.heart!);
  assert.deepEqual(ofOp('loop').map((l) => l.id), ['ra', 'la', 'rv', 'lv']);
  for (const id of ['lpra', 'lpla', 'lprv', 'lplv']) assert.ok(issues.some((i) => i.kind === 'trimmed' && i.message.includes(`"${id}"`) && /bound to/.test(i.message)), id);
  assert.ok(!issues.some((i) => /unknown id "lp/.test(i.message)), 'none is dropped');
});

test('a move, a style and a pin that name the part with a short prefix or suffix are bound the same way', () => {
  const { kept, issues } = one(blob('ra'), blob('rv'), { op: 'move', id: 'move-ra', to: [1, 0, 0] }, { op: 'style', id: 'rvcolor', color: 'red' }, { op: 'pin', id: 'p1', on: 'rv-pin', text: 'x' });
  assert.deepEqual([kept[2]!.id, kept[3]!.id, kept[4]!.on], ['ra', 'rv', 'rv']);
  assert.equal(issues.filter((i) => i.kind === 'trimmed').length, 3, JSON.stringify(issues));
});

test('a name that two parts could equally be (one at each end) is refused with a note, not guessed', () => {
  const { kept, issues } = one(blob('ab'), blob('cd'), loop('abcd'));
  assert.equal(kept.filter((a) => a.op === 'loop').length, 0);
  assert.ok(issues.some((i) => i.kind === 'dropped' && i.message.includes('unknown id "abcd"')), JSON.stringify(issues));
});

test('a name that is nothing like any part is refused with the note that says which id', () => {
  const { kept, issues } = one(blob('ra'), loop('zzzz'));
  assert.equal(kept.filter((a) => a.op === 'loop').length, 0);
  assert.ok(issues.some((i) => i.kind === 'dropped' && i.message.includes('unknown id "zzzz"')));
});

test('an id the answer makes later in the same step is that id, not a part it resembles', () => {
  const { ofOp, issues } = one(blob('ra'), loop('lpra'), blob('lpra'));
  assert.equal(ofOp('loop')[0]!.id, 'lpra');
  assert.equal(issues.length, 0, JSON.stringify(issues));
});

test('clear is never bound to a part it resembles: a wrong name must not remove another part', () => {
  const { ofOp, issues } = one(blob('ra'), { op: 'clear', target: 'lpra' });
  assert.equal(ofOp('clear').length, 0);
  assert.ok(issues.some((i) => i.kind === 'dropped' && i.message.includes('unknown id "lpra"')));
});

test('the Pythagorean answer: clearing pins that went with their group is refused with a note, and the step still draws', () => {
  const { ofOp, issues } = play(answers.pythagorean!);
  assert.ok(ofOp('add').some((a) => a.id === 'big'));
  assert.ok(issues.some((i) => i.kind === 'dropped' && i.message.includes('unknown id "pa"')));
});

// ---- the log line ----------------------------------------------------------------------------------------------------------------

test('the log line names every dropped action first, so nothing is lost without its reason', () => {
  const issues = [
    { kind: 'trimmed' as const, path: 'steps[0].actions[0].x', message: 'repaired a' },
    { kind: 'clamped' as const, path: 'steps[0].actions[1].x', message: '5 clamped to 4' },
    { kind: 'trimmed' as const, path: 'steps[0].actions[2].x', message: 'repaired c' },
    { kind: 'trimmed' as const, path: 'steps[0].actions[3].x', message: 'repaired d' },
    { kind: 'dropped' as const, path: 'steps[0].actions[4]', message: 'id: unknown id "zzzz"' },
  ];
  assert.match(validatorNotes(issues, 1), /^validator: 5 notes on step 1: steps\[0\]\.actions\[4\] id: unknown id "zzzz"/);
});
