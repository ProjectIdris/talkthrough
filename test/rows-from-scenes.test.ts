import test from 'node:test';
import assert from 'node:assert/strict';
import { KIT_PRESETS } from '../src/scene/kit-presets.ts';
import type { KitRow } from '../src/scene/kit-presets.ts';
import { LOOP_ROWS } from '../src/scene/movement-rows.ts';
import type { LoopRow } from '../src/scene/movement-rows.ts';

// A new kit part or a new movement is a row in its table, and a scene may then use it: the names the validator accepts, the schema and the guide are
// read from the tables, not from lists written again. The rows go into the tables first and the scene language is loaded after (a program has its
// rows in the source before it starts), so this file must not import the scene language statically.

const washer: KitRow = {
  fit: ['discAboutZ'],
  settings: { n: { default: 3, min: 1, max: 5 } },
  values: [['ro', 'sx/2'], ['gap', 'ro*0.1']],
  anchors: [{ name: 'axis', at: [0, 0, 'sz/2'] }],
  features: [{ kind: 'slab', surface: 'metal', tint: true, edges: true, outline: { ring: ['ro', 'ro*0.5'] }, depth: 'sz', bevel: 'sz*0.1' }],
};
const wobble: LoopRow = { motion: 'turn', axis: 0, start: 90, amount: [-45, 45], value: 'sin(a)*amount*fade' };

test('a part and a movement added only as rows are accepted from a scene, and are in the schema and the guide', async () => {
  (KIT_PRESETS as Record<string, KitRow>).washer = washer;
  (LOOP_ROWS as Record<string, LoopRow>).wobble = wobble;
  const scene = await import('../src/scene/index.ts');
  const r = scene.validateScene({
    steps: [{ say: 'A washer that rocks.', actions: [
      { op: 'add', shape: 'part', id: 'w', part: 'washer', size: [0.4, 3, 3], pos: [0, 0, 0] },
      { op: 'loop', id: 'w', kind: 'wobble', amount: 20, axis: 'x', period: 2 },
    ] }],
  }, scene.createSceneState());
  assert.deepEqual(r.issues, [], 'neither is refused or noted');
  const kept = (r.scene as { steps: Array<{ actions: Array<Record<string, unknown>> }> }).steps.flatMap((s) => s.actions);
  assert.ok(kept.some((a) => a.op === 'add' && a.part === 'washer'), 'the part is kept');
  assert.ok(kept.some((a) => a.op === 'loop' && a.kind === 'wobble'), 'the loop is kept');
  assert.ok(scene.PARTS.includes('washer' as never));
  assert.ok(JSON.stringify(scene.sceneSchema).includes('"washer"') && JSON.stringify(scene.sceneSchema).includes('"wobble"'), 'the schema names them');
  assert.ok(scene.sceneGuide.includes('washer'), 'the guide lists the part with its points');
});
