import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, sceneGuide, sceneSchemaLean, validateStep } from '../src/scene/index.ts';
import { MODELS } from '../src/scene/model-catalogue.ts';
import { findModel, findPart, modelBounds, modelScale, partId, SCENE_UNITS_PER_METRE } from '../src/scene/models.ts';

type Act = { op: string; id?: string; model?: string; size?: number; shape?: string; rot?: number[]; target?: string };
const panel = { op: 'panel', x: 400, y: 80, w: 500, h: 700 };
const run = (state = createSceneState(), ...actions: unknown[]) => {
  const r = validateStep({ say: 'x', actions: [panel, ...actions] }, state);
  return { r, state, ops: (r.step?.actions ?? []).filter((a) => a.op !== 'panel').map((a) => `${a.op}${(a as Act).id ? ':' + (a as Act).id : ''}`).join(' '), issues: r.issues.map((i) => i.message) };
};
const heart = MODELS.find((m) => m.id === 'heart')!;

test('the catalogue has the heart and the brain with their licence, credit and named parts', () => {
  assert.deepEqual(MODELS.map((m) => m.id).sort(), ['brain', 'heart']);
  assert.equal(heart.licence.id, 'CC-BY-4.0');
  assert.match(heart.credit ?? '', /BodyParts3D/);
  for (const m of MODELS) for (const p of m.parts) assert.ok(p.size.every((v) => v > 0) && p.center.every(Number.isFinite), `${m.id}.${p.key} has a size and a centre`);
  assert.ok(heart.parts.some((p) => p.key === 'left-ventricle' && p.closed));
});

test('a model is found by its id, name or alias, and a part by key, name or alias', () => {
  assert.equal(findModel('heart')?.id, 'heart');
  assert.equal(findModel('Human Heart')?.id, 'heart');
  assert.equal(findModel(' cerebellum ')?.id, 'brain');
  assert.equal(findModel('engine'), undefined);
  assert.equal(findModel(5), undefined);
  assert.equal(findPart(heart, 'Left ventricle')?.key, 'left-ventricle');
  assert.equal(findPart(heart, 'bicuspid valve')?.key, 'mitral-valve');
  assert.equal(findPart(heart, 'left_ventricle')?.key, 'left-ventricle');
  assert.equal(findPart(heart, 'spleen'), undefined);
  assert.equal(partId('h', 'left-ventricle'), 'h.left-ventricle');
});

test('its size in scene units: its real size at the default scale, or its longest side as written', () => {
  const real = modelBounds(heart);
  assert.ok(Math.abs(real[1] - heart.size[1] * SCENE_UNITS_PER_METRE) < 1e-9);
  const fitted = modelBounds(heart, 6);
  assert.ok(Math.abs(Math.max(...fitted) - 6) < 1e-9);
  assert.ok(Math.abs(modelScale(heart, 6) * Math.max(...heart.size) - 6) < 1e-9);
});

test('add shape model places it and registers its named parts as objects of their own', () => {
  const { ops, issues, state } = run(createSceneState(), { op: 'add', shape: 'model', id: 'h', model: 'heart', size: 6 });
  assert.deepEqual(issues, []);
  assert.match(ops, /add:h/);
  for (const p of heart.parts) assert.ok(state.ids.has(`h.${p.key}`), `h.${p.key} is an id`);
  // pin, highlight, style, explode and cut work on a part and on the whole
  const next = run(state, { op: 'pin', id: 'pl', on: 'h.left-ventricle', text: 'Left ventricle' }, { op: 'highlight', id: 'h.mitral-valve' }, { op: 'style', id: 'h.left-atrium', opacity: 0.4 },
    { op: 'explode', id: 'h', to: 1 }, { op: 'cut', id: 'h', axis: 'x', to: 0 });
  assert.deepEqual(next.issues, []);
  assert.equal(next.ops, 'pin:pl highlight:h.mitral-valve style:h.left-atrium explode:h cut:h');
});

test('a part written by its name or alias is read as the part, with a note; one the model has not is refused with the parts it has', () => {
  const s = run(createSceneState(), { op: 'add', shape: 'model', id: 'h', model: 'heart' }).state;
  const named = run(s, { op: 'highlight', id: 'h.Left ventricle' }, { op: 'highlight', id: 'h.bicuspid valve' });
  assert.equal(named.ops, 'highlight:h.left-ventricle highlight:h.mitral-valve');
  assert.ok(named.issues.some((m) => /h\.Left ventricle.*h\.left-ventricle/.test(m)), JSON.stringify(named.issues));
  const wrong = run(s, { op: 'highlight', id: 'h.spleen' });
  assert.equal(wrong.ops, '');
  assert.ok(wrong.issues.some((m) => /unknown id/.test(m) && /left-ventricle/.test(m)), JSON.stringify(wrong.issues));
});

test('a name that is not a model is dropped with the models there are and the way back to shapes', () => {
  const r = run(createSceneState(), { op: 'add', shape: 'model', id: 'e', model: 'v8 engine' });
  assert.equal(r.ops, '');
  assert.ok(r.issues.some((m) => /no model "v8 engine"/.test(m) && /brain, heart/.test(m) && /shapes/.test(m)), JSON.stringify(r.issues));
});

test('a model written by an alias is the model; clear takes its parts with it; writing it again replaces it and its parts', () => {
  const a = run(createSceneState(), { op: 'add', shape: 'model', id: 'h', model: 'human heart' });
  assert.equal(a.ops, 'add:h');
  assert.ok(a.issues.some((m) => /"human heart".*heart/.test(m)));
  const cleared = run(a.state, { op: 'clear', target: 'h' });
  assert.ok(!cleared.state.ids.has('h') && !cleared.state.ids.has('h.left-ventricle'));
  const b = run(createSceneState(), { op: 'add', shape: 'model', id: 'x', model: 'brain' });
  startOver(b.state);
  const again = run(b.state, { op: 'add', shape: 'model', id: 'x', model: 'heart' });
  assert.equal(again.ops, 'add:x');
  assert.ok(b.state.ids.has('x.left-ventricle') && !b.state.ids.has('x.cerebellum'), 'the parts are the new model\'s');
});

function startOver(state: ReturnType<typeof createSceneState>): void {
  // a follow-up answer: what is on screen may be written again
  (state as { replaceable?: Set<string> }).replaceable = new Set(state.ids.keys());
  (state as { replaceNote?: boolean }).replaceNote = true;
}

test('the guide lists the models, their parts and how to use them, and the lean schema names them', () => {
  assert.match(sceneGuide, /add \{shape:model/);
  assert.match(sceneGuide, /heart \(.*left-ventricle.*\)/);
  assert.match(sceneGuide, /brain \(.*cerebellum.*\)/);
  assert.match(sceneGuide, /id\.part/);
  assert.ok(JSON.stringify(sceneSchemaLean).includes('"heart"'));
});
