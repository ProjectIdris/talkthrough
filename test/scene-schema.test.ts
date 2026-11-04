import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createSceneState, sceneGuide, sceneGuideExample, sceneSchema, sceneSchemaLean, validateScene, VARIANTS } from '../src/scene/index.ts';
import { check, strictProblems } from './support/json-schema.ts';

const samplesDir = new URL('../samples/scenes/', import.meta.url);
const schema = sceneSchema as Record<string, unknown>;

test('the schema keeps to what strict structured-output modes accept', () => {
  assert.deepEqual(strictProblems(schema), []);
});

test('the lean schema is the same structure without descriptions, and just as strict', () => {
  assert.deepEqual(strictProblems(sceneSchemaLean as Record<string, unknown>), []);
  const text = JSON.stringify(sceneSchemaLean);
  assert.ok(!text.includes('"description"'));
  assert.ok(text.length < JSON.stringify(sceneSchema).length * 0.7);
  // The lean schema also leaves out `explode` (see LEAN_OMITS in schema.ts): it is in the full schema and the validator only.
  const omitted = new Set(['explode']);
  const strip = (v: unknown): unknown => Array.isArray(v) ? v.map(strip)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'description').map(([k, x]) => {
      if (k === 'properties' && x && typeof x === 'object') return [k, strip(Object.fromEntries(Object.entries(x).filter(([name]) => !omitted.has(name))))];
      if (k === 'required' && Array.isArray(x)) return [k, x.filter((name) => !omitted.has(String(name)))];
      return [k, strip(x)];
    })) : v;
  assert.deepEqual(sceneSchemaLean, strip(sceneSchema));
  assert.ok(!text.includes('"explode":{"type":["array","null"]'), 'the lean schema does not ask for an explode offset on every part');
  assert.ok(JSON.stringify(sceneSchema).includes('"explode":{"type":["array","null"]'));
});

test('the guide names every action and its example is a valid scene', () => {
  for (const v of VARIANTS) assert.ok(sceneGuide.includes(`- ${v.op} {`), v.op);
  const r = validateScene(sceneGuideExample, createSceneState());
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.scene, sceneGuideExample);
});

test('the strict-mode linter catches what it is meant to catch', () => {
  const open = { type: 'object', properties: { a: { type: 'number', minimum: 1 } }, required: [] };
  const problems = strictProblems(open);
  assert.ok(problems.some((p) => p.includes('not closed')));
  assert.ok(problems.some((p) => p.includes('not required')));
  assert.ok(problems.some((p) => p.includes('minimum')));
});

test('every action variant is offered to the model', () => {
  const defs = schema.$defs as Record<string, unknown>;
  const offered = ((defs.action as { anyOf: { $ref: string }[] }).anyOf).map((b) => b.$ref.replace('#/$defs/', ''));
  assert.deepEqual(offered, VARIANTS.map((v) => v.name));
  for (const name of offered) assert.ok(defs[name], name);
});

test('every sample scene conforms to the schema (nullable fields may be left out)', () => {
  for (const name of readdirSync(samplesDir).filter((f) => f.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(new URL(name, samplesDir), 'utf8')) as Record<string, unknown>;
    const { v: _version, ...body } = raw; // the schema asks the model for steps only
    assert.deepEqual(check(schema, schema, body, '$', true), [], name);
  }
});

test('the schema refuses what the validator would also drop', () => {
  const step = (action: unknown) => ({ steps: [{ say: 'x', actions: [action] }], escalate: null });
  const ok = { op: 'box', id: 'a', x: 1, y: 1, w: 1, h: 1, rot: null, color: 'red', at: null };
  assert.deepEqual(check(schema, schema, step(ok)), []);
  assert.notDeepEqual(check(schema, schema, step({ ...ok, op: 'eval' })), []);
  assert.notDeepEqual(check(schema, schema, step({ ...ok, color: 5 })), [], 'a colour is text; which text is for the validator to judge');
  assert.notDeepEqual(check(schema, schema, step({ ...ok, onclick: 'x' })), []);
  assert.notDeepEqual(check(schema, schema, step({ ...ok, x: '1' })), []);
  const { at: _at, ...withoutNull } = ok;
  assert.notDeepEqual(check(schema, schema, step(withoutNull)), []);
});

test('escalate is a nullable text at the root, and the model may leave steps empty', () => {
  assert.deepEqual(check(schema, schema, { steps: [], escalate: 'too deep for a quick look' }), []);
  assert.deepEqual(check(schema, schema, { steps: [], escalate: null }), []);
  assert.notDeepEqual(check(schema, schema, { steps: [], escalate: 5 }), []);
  assert.notDeepEqual(check(schema, schema, { steps: [] }), []);
});

test('the schema files in docs are what this code builds', () => {
  for (const [file, built] of [['scene.schema.json', sceneSchema], ['scene.schema.lean.json', sceneSchemaLean]] as const) {
    const onDisk = JSON.parse(readFileSync(new URL(`../docs/${file}`, import.meta.url), 'utf8'));
    assert.deepEqual(onDisk, JSON.parse(JSON.stringify(built)), `run: node scripts/build-schema.ts (${file})`);
  }
});

test('the guide asks for a short first step and its example keeps to it', () => {
  // The first step is what the person waits for: a long one (a whole 3D model) held the first mark back for 17 s.
  assert.ok(sceneGuide.includes('Step 1 is short'));
  assert.ok(sceneGuide.includes('the model is the answer') && sceneGuide.includes('set it running'), 'a machine is built and started, not only pointed at');
  const steps = (sceneGuideExample as { steps: { say: string; actions: unknown[] }[] }).steps;
  assert.ok((steps[0]?.actions.length ?? 99) <= 2, 'the first step of the example has one or two marks');
  assert.ok((steps[0]?.say.length ?? 999) <= 90, 'and one short sentence');
  assert.ok(JSON.stringify(sceneGuideExample).length < 1200, 'the example stays lean');
});

test('the guide says a figure adds what the page lacks and follows what the page shows, and that a label starts beside its point', () => {
  const rule = sceneGuide.split('\n').find((l) => l.startsWith('- A figure adds what the page lacks'));
  assert.ok(rule, 'a rule of its own');
  for (const part of [
    'Do not draw again what the page already has (its graph, its table, its list of steps): point at it with marks',
    'the proof the figure on the page shows (not another proof of the same theorem)',
    'Where the page does not give the content (the method of a recipe that lists only ingredients), say in the step that it is general knowledge',
    'A label starts just to the right of its point, at the height of the point',
  ]) assert.ok(rule!.includes(part), part);
});
