import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { beginLiveStep, createDetailState, createSceneState, validateStep } from '../src/scene/index.ts';
import type { Action, AddPart, Step, Vec3 } from '../src/scene/index.ts';
import { createSilentVoice, Player } from '../src/overlay/player.ts';
import type { Clock } from '../src/overlay/player.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const pipe = (id: string, extra: Partial<AddPart> = {}): AddPart => ({
  op: 'add', shape: 'part', part: 'pipe', id, size: [1, 2, 1], ...extra,
});

/** The real streamed route, with only the wall clock controlled by the test. Empty speech needs no timers. */
function session(actions: Action[]) {
  const state = createSceneState();
  const first = validateStep({ say: '', actions }, state);
  assert.deepEqual(first.issues, []);
  assert.ok(first.step);
  const initial = first.step;
  let now = 0;
  const clock: Clock = { now: () => now, after: () => () => {} };
  const player = new Player({ voice: createSilentVoice(clock), clock });
  player.play({ steps: [initial] });
  now = 1000;
  player.update();

  return {
    stream(raw: Action[]) {
      const detail = createDetailState(state);
      const emitted: Action[] = [];
      player.beginTurn(true);
      const live = beginLiveStep(detail, {
        open(say) { player.openStep(say); },
        action(action) { emitted.push(action); player.addAction(action); },
      });
      live.say('Mount the parts.');
      for (const action of raw) live.action(action);
      const result = live.finish();
      assert.ok(result.step);
      assert.deepEqual(emitted, result.step.actions, 'saved accepted actions are exactly what reached the live player');
      player.closeStep();
      player.endTurn();
      return { ...result, step: result.step, detail };
    },
    at(seconds: number) {
      now = 1000 + seconds * 1000;
      return player.update();
    },
    replay(step: Step, seconds: number) { return frameAt([initial, step], 1, seconds); },
  };
}

function socketGap(frame: Frame, parentPoint: Vec3, childPoint: Vec3): number {
  const panel = new PanelScene({ tier: 'low' });
  panel.sync(frame, 1);
  const point = (id: string, local: Vec3): Vector3 => {
    const object = frame.objects.findLast((o) => o.id === id);
    assert.ok(object, `missing ${id}`);
    const node = panel.nodeOf(object.key);
    assert.ok(node, `missing renderer node ${id}`);
    return node.localToWorld(new Vector3(...local));
  };
  return point('base', parentPoint).distanceTo(point('child', childPoint));
}

test('a parent replacement authored after its mount cannot retroactively change live versus replay placement', () => {
  for (const replacementAt of [1, 2]) {
    const run = session([pipe('base')]);
    const result = run.stream([
      pipe('child', { size: [0.5, 2, 0.5], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', at: 2 }),
      pipe('base', { size: [1, 6, 1], at: replacementAt }),
    ]);
    assert.deepEqual(result.step.actions.map((a) => 'id' in a ? a.id : a.op), ['child'], 'the earlier or same-time replacement must be refused');
    assert.ok(result.issues.some((i) => i.kind === 'dropped' && /before/i.test(i.message) && /mount/i.test(i.message)), 'feedback explains that the parent must be defined before mounted children');
    assert.deepEqual(result.detail.bodies.get('base')?.size, [1, 2, 1], 'rejection keeps the old parent geometry');
    const live = run.at(4);
    assert.deepEqual(live.objects, run.replay(result.step, 4).objects);
    assert.deepEqual(live.objects.find((o) => o.id === 'child')?.pos, [0, 2, 0]);
    assert.ok(socketGap(live, [0, 1, 0], [0, -1, 0]) < 1e-8);
  }
});

test('defining the parent replacement before its mounted child joins sockets in both live playback and replay', () => {
  const run = session([pipe('base')]);
  const result = run.stream([
    pipe('base', { size: [1, 6, 1], at: 1 }),
    pipe('child', { size: [0.5, 2, 0.5], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', at: 2 }),
  ]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.step.actions.length, 2);
  const live = run.at(4);
  assert.deepEqual(live.objects, run.replay(result.step, 4).objects);
  assert.deepEqual(live.objects.find((o) => o.id === 'child')?.pos, [0, 4, 0]);
  assert.ok(socketGap(live, [0, 3, 0], [0, -1, 0]) < 1e-8);
});

test('a later scheduled parent replacement remains valid and does not remount its existing child', () => {
  const run = session([pipe('base')]);
  const result = run.stream([
    pipe('child', { size: [0.5, 2, 0.5], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', at: 2 }),
    pipe('base', { size: [1, 6, 1], at: 3 }),
  ]);
  assert.deepEqual(result.issues, []);
  assert.equal(result.step.actions.length, 2);
  const mounted = run.at(2.5);
  assert.deepEqual(mounted.objects, run.replay(result.step, 2.5).objects);
  assert.ok(socketGap(mounted, [0, 1, 0], [0, -1, 0]) < 1e-8);
  const replaced = run.at(4);
  assert.deepEqual(replaced.objects, run.replay(result.step, 4).objects);
  assert.deepEqual(replaced.objects.find((o) => o.id === 'child')?.pos, [0, 2, 0], 'the child keeps its original local placement');
  assert.ok(Math.abs(socketGap(replaced, [0, 3, 0], [0, -1, 0]) - 2) < 1e-8, 'replacement geometry can move the parent socket without a live mating constraint');
});

test('an uncertain replacement preview cannot reject a valid inherited-rotation mount', () => {
  const run = session([
    pipe('base', { size: [1, 100, 1] }),
    pipe('child', { size: [1, 100, 1], parent: 'base', rot: [0, 0, 180] }),
  ]);
  const result = run.stream([
    pipe('child', { size: [1, 100, 1], parent: 'base', parentAnchor: 'top', selfAnchor: 'bottom', pos: [0, 1, 0], at: 0 }),
  ]);
  assert.deepEqual(result.issues, [], 'the zero-rotation preview is y=101, but the inherited 180-degree rotation makes the actual position y=1');
  assert.equal(result.step.actions.length, 1);
  const live = run.at(1);
  assert.deepEqual(live.objects, run.replay(result.step, 1).objects);
  const child = live.objects.findLast((o) => o.id === 'child');
  assert.ok(child);
  assert.deepEqual(child.rot, [0, 0, 180]);
  assert.ok(new Vector3(...child.pos).distanceTo(new Vector3(0, 1, 0)) < 1e-8);
  assert.ok(socketGap(live, [0, 51, 0], [0, -50, 0]) < 1e-8, 'the socket has exactly the requested parent-frame offset');
});
