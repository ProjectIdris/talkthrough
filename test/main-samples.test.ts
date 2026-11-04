import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSamplePlayer } from '../src/main/samples.ts';

test('samples play in turn, a follow-up continues the scene before it, and escalation samples are skipped', () => {
  const player = createSamplePlayer('samples/scenes');
  assert.ok(!player.files.includes('escalate.json'));
  const idx = player.files.indexOf('earth-layers-followup.json');
  assert.equal(player.files[idx - 1], 'earth-layers.json');
  const plays = player.files.map(() => player.next()!);
  const base = plays[idx - 1]!;
  const follow = plays[idx]!;
  assert.equal(base.turn, 1);
  assert.equal(follow.turn, 2);
  assert.ok(plays.every((p) => p.scene.steps.length > 0));
  // The follow-up only validates against the earlier scene's ids: it kept its actions.
  assert.ok(follow.scene.steps.some((s) => s.actions.length > 0));
  // The sequence wraps around with a fresh scene.
  assert.equal(player.next()!.turn, 1);
});
