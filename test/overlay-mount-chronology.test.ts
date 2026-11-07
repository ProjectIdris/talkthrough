import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { beginLiveStep, createDetailState, createSceneState, validateStep } from '../src/scene/index.ts';
import type { Action, AddPart, Step, Vec3 } from '../src/scene/index.ts';
import { createSilentVoice, Player } from '../src/overlay/player.ts';
import type { Clock } from '../src/overlay/player.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';

const pipe = (id: string, extra: Partial<AddPart> = {}): AddPart => ({
  op: 'add', shape: 'part', part: 'pipe', id, size: [1, 2, 1], ...extra,
});
const mount = (extra: Partial<AddPart> = {}): AddPart => pipe('child', {
  parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', ...extra,
});
const last = (frame: Frame, id = 'child') => frame.objects.findLast((o) => o.id === id);
const pose = (frame: Frame) => {
  const o = last(frame);
  return o && { pos: o.pos, rot: o.rot, scale: o.scale };
};

/** Actual validator -> Player events, with separately controlled arrival and authored times. */
function session(actions: Action[] = [pipe('base')]) {
  const state = createSceneState();
  const initial = validateStep({ say: '', actions }, state).step!;
  let now = 0;
  const clock: Clock = { now: () => now, after: () => () => {} };
  const player = new Player({ voice: createSilentVoice(clock), clock });
  player.play({ steps: [initial] });
  now = 1000;
  player.update();
  player.beginTurn(true);
  const detail = createDetailState(state);
  const emitted: Action[] = [];
  const live = beginLiveStep(detail, {
    open(say) { player.openStep(say); },
    action(a) { emitted.push(a); player.addAction(a); },
  });
  live.say('');
  const at = (seconds: number) => { now = 1000 + seconds * 1000; return player.update(); };
  return {
    detail,
    at,
    send(action: Action, arrival = 0) { at(arrival); live.action(action); },
    finish() {
      const result = live.finish();
      assert.ok(result.step);
      assert.deepEqual(emitted, result.step.actions, 'saving preserves exactly the accepted authored actions');
      player.closeStep(); player.endTurn();
      return result as typeof result & { step: Step };
    },
    replay(step: Step, seconds: number) { return frameAt([initial, step], 1, seconds); },
  };
}

function gap(frame: Frame, parentPoint: Vec3 = [0, 3, 0]): number {
  const panel = new PanelScene({ tier: 'low' });
  try {
    panel.sync(frame, 1);
    const point = (id: string, local: Vec3) => panel.nodeOf(last(frame, id)!.key)!.localToWorld(new Vector3(...local));
    return point('base', parentPoint).distanceTo(point('child', [0, -1, 0]));
  } finally { panel.destroy(); }
}

for (const kind of ['pipe', 'housing'] as const) {
  test(`a source-first future ${kind} replacement does not erase earlier pipe socket validation`, () => {
    const run = session();
    run.send(pipe('base', { part: kind, size: [1, 6, 1], at: 5 }));
    run.send(mount({ at: 2 }));
    const result = run.finish();
    assert.deepEqual(result.issues, []);
    assert.equal(result.step.actions.length, 2);
    assert.deepEqual(run.detail.bodies.get('child')?.pos, [0, 2, 0]);
    assert.deepEqual(last(run.replay(result.step, 3))?.pos, [0, 2, 0]);
    assert.deepEqual(pose(run.at(7)), pose(run.replay(result.step, 7)));
  });
}

test('a future pipe socket cannot validate a mount against the earlier housing', () => {
  const run = session([pipe('base', { part: 'housing' })]);
  run.send(pipe('base', { at: 5 }));
  run.send(mount({ at: 2 }));
  const result = run.finish();
  assert.equal(result.step.actions.length, 1);
  assert.equal(run.detail.ids.has('child'), false);
  assert.ok(result.issues.some((i) => /unknown anchor "top"/.test(i.message) && /front/.test(i.message)));
});

test('a progressively arriving mount retains its authored placement after a parent replacement', () => {
  const run = session();
  run.send(pipe('base', { size: [1, 6, 1], at: 3 }));
  assert.deepEqual((last(run.at(5), 'base')?.def as AddPart).size, [1, 6, 1]);
  run.send(mount({ at: 1 }), 5);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.step.actions.map((a) => a.at), [3, 1]);
  const actual = run.at(7), replay = run.replay(result.step, 7);
  assert.deepEqual(pose(actual), pose(replay));
  assert.deepEqual(last(actual)?.pos, [0, 2, 0]);
  assert.equal(gap(actual), 2, 'mounting is one-time: the new parent socket is intentionally not refitted');
  assert.equal(gap(replay), 2);
});

test('a replacement parent arriving late still supplies the socket at a later authored child birth', () => {
  const run = session();
  run.send(pipe('base', { size: [1, 6, 1], at: 1 }), 5);
  run.send(mount({ at: 2 }), 6);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(pose(run.at(8)), pose(run.replay(result.step, 8)));
  assert.deepEqual(last(run.at(8))?.pos, [0, 4, 0]);
});

test('mounted replacements inherit base rotation and scale at authored birth, not delayed display time', () => {
  const run = session([pipe('base'), pipe('child', { parent: 'base' })]);
  run.send({ op: 'turn', id: 'child', to: [0, 0, 180], at: 0, dur: 4 });
  run.send({ op: 'scale', id: 'child', to: [1, 3, 1], at: 0, dur: 4 });
  run.send(mount({ at: 1 }), 5);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(pose(run.at(7)), pose(run.replay(result.step, 7)));
});

test('an authored invalid mount cannot become valid just because it is displayed after replacement', () => {
  // Deliberately bypass validation: the planner independently guards absent sockets at logical birth.
  let now = 0;
  const clock: Clock = { now: () => now, after: () => () => {} };
  const player = new Player({ voice: createSilentVoice(clock), clock });
  const initial: Step = { say: '', actions: [pipe('base', { part: 'housing' })] };
  player.play({ steps: [initial] }); now = 1000; player.update(); player.beginTurn(true); player.openStep('');
  player.addAction(pipe('base', { at: 3 })); now = 6000; player.update();
  player.addAction(mount({ at: 1 })); player.closeStep(); player.endTurn(); now = 8000;
  assert.equal(last(player.update()), undefined);
});

test('ordinary explicit positions retain their existing delayed arrival behavior', () => {
  const run = session();
  run.send(pipe('base', { size: [1, 6, 1], at: 3 }));
  run.send(pipe('child', { parent: 'base', pos: [0, 2, 0], at: 1 }), 5);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(pose(run.at(7)), pose(run.replay(result.step, 7)));
});


test('an unchanged future display time still uses authored inherited transforms after other actions arrive late', () => {
  const run = session([pipe('base'), pipe('child', { parent: 'base' })]);
  run.send({ op: 'turn', id: 'child', to: [0, 0, 180], at: 0, dur: 20 }, 5);
  run.send(mount({ at: 10 }), 6);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(pose(run.at(12)), pose(run.replay(result.step, 12)));
});

test('later independent child motion is not folded into the logical mount birth', () => {
  const run = session();
  run.send(pipe('base', { size: [1, 6, 1], at: 3 }));
  run.send(mount({ at: 1 }), 5);
  assert.deepEqual(last(run.at(5.8))?.pos, [0, 2, 0]);
  run.send({ op: 'move', id: 'child', to: [4, 5, 6], at: 2, dur: 1 }, 6);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(last(run.at(6))?.pos, [0, 2, 0], 'the birth pose is not the final moved pose');
  assert.deepEqual(pose(run.at(8)), pose(run.replay(result.step, 8)));
  assert.deepEqual(last(run.at(8))?.pos, [4, 5, 6]);
});

test('later-arriving pre-birth transforms replan the authored mount rather than permanently diverging from replay', () => {
  const run = session([pipe('base'), pipe('child', { parent: 'base' })]);
  run.send(mount({ at: 2 }));
  assert.deepEqual(last(run.at(3))?.pos, [0, 2, 0]);
  run.send({ op: 'turn', id: 'child', to: [0, 0, 90], at: 1, dur: 0 }, 3);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  // A still-open authored timeline is provisional. This is a birth edit, not a live mating joint.
  assert.ok(new Vector3(...last(run.at(3))!.pos).distanceTo(new Vector3(-1, 1, 0)) < 1e-8);
  assert.deepEqual(pose(run.at(5)), pose(run.replay(result.step, 5)));
});

for (const action of [
  { op: 'turn', id: 'child', to: [0, 0, 90], at: 3, dur: 1 },
  { op: 'scale', id: 'child', to: [1, 3, 1], at: 3, dur: 1 },
  { op: 'move', id: 'child', to: [4, 5, 6], at: 3, dur: 1 },
  { op: 'along', id: 'child', pts: [[2, 3, 4], [4, 5, 6]], at: 3, dur: 1 },
] as Action[]) {
  test(`a source-first postbirth ${action.op} follows the delayed mounted lifetime and still animates`, () => {
    const run = session([pipe('base'), pipe('child', { parent: 'base' })]);
    run.send(action);
    run.send(mount({ at: 1 }), 5);
    const result = run.finish();
    assert.deepEqual(result.issues, []);
    assert.deepEqual(pose(run.at(5)), { pos: [0, 2, 0], rot: [0, 0, 0], scale: [1, 1, 1] });
    assert.notDeepEqual(pose(run.at(5.5)), pose(run.at(7)), 'the deferred motion retains its duration');
    assert.deepEqual(pose(run.at(7)), pose(run.replay(result.step, 7)));
  });
}

test('a late prebirth tween cannot keep changing the replacement after its inherited birth pose', () => {
  const run = session([pipe('base'), pipe('child', { parent: 'base' })]);
  run.send(mount({ at: 2 }));
  run.send({ op: 'turn', id: 'child', to: [0, 0, 180], at: 1, dur: 4 }, 3);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(pose(run.at(8)), pose(run.replay(result.step, 8)));
  assert.deepEqual(last(run.at(8))?.rot, [0, 0, 11.25]);
});

test('conflicting postbirth transforms keep authored order when both wait for a delayed mount', () => {
  const run = session([pipe('base'), pipe('child', { parent: 'base' })]);
  run.send({ op: 'turn', id: 'child', to: [0, 0, 180], at: 4, dur: 1 });
  run.send({ op: 'turn', id: 'child', to: [0, 0, 90], at: 3, dur: 1 });
  run.send(mount({ at: 1 }), 5);
  const result = run.finish();
  assert.deepEqual(result.issues, []);
  assert.deepEqual(pose(run.at(8)), pose(run.replay(result.step, 8)));
  assert.deepEqual(last(run.at(8))?.rot, [0, 0, 180]);
});
