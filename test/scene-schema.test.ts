import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createSceneState, sceneGuide, sceneGuideExample, sceneSchema, sceneSchemaLean, validateScene, VARIANTS } from '../src/scene/index.ts';
import { check, strictProblems, expandedSchema, variantDefinitions } from './support/json-schema.ts';

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
  // The lean schema also leaves out `explode`, `loop.pivot` and `spin.onlyAxis` (see LEAN_OMITS in schema.ts): they are in the full schema and the validator only.
  const omittedIn: Record<string, string[]> = { loop: ['pivot'], spin: ['onlyAxis'] };
  let omitted = new Set(['explode']);
  const strip = (v: unknown): unknown => Array.isArray(v) ? v.map(strip)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'description').map(([k, x]) => {
      if (k === 'properties' && x && typeof x === 'object') return [k, strip(Object.fromEntries(Object.entries(x).filter(([name]) => !omitted.has(name))))];
      if (k === 'required' && Array.isArray(x)) return [k, x.filter((name) => !omitted.has(String(name)))];
      if (k === '$defs' && x && typeof x === 'object') {
        return [k, Object.fromEntries(Object.entries(x).map(([def, schema]) => {
          omitted = new Set(['explode', ...(omittedIn[def] ?? [])]);
          return [def, strip(schema)];
        }))];
      }
      return [k, strip(x)];
    })) : v;
  // Compare the exact resolved structures; short definition names and shared
  // fields cannot conceal a changed required field, enum, type or nullability.
  const stripped = strip(sceneSchema) as Record<string, unknown>;
  assert.deepEqual(expandedSchema(sceneSchemaLean), expandedSchema(stripped));
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
  assert.ok(sceneGuide.includes('words alone (actions: []), a mark on the page, a flat diagram or a 3D model'), 'the form is chosen for the question');
  assert.ok(sceneGuide.includes('one or two marks if useful (actions may be empty)'), 'step 1 can use words alone');
  assert.ok(sceneGuide.indexOf('- Choose words alone') >= 0 && sceneGuide.indexOf('- Choose words alone') < sceneGuide.indexOf('- Step 1 is short'), 'choose before the drawing instructions');
  assert.ok(sceneGuide.includes('use no actions when words suffice'));
  assert.ok(sceneGuide.includes('When a model explains a machine or mechanism') && sceneGuide.includes('set it running'), 'a machine is built and started, not only pointed at');
  const steps = (sceneGuideExample as { steps: { say: string; actions: unknown[] }[] }).steps;
  assert.ok((steps[0]?.actions.length ?? 99) <= 2, 'the first step of the example has one or two marks');
  assert.ok((steps[0]?.say.length ?? 999) <= 90, 'and one short sentence');
  assert.ok(JSON.stringify(sceneGuideExample).length < 1500, 'the example stays lean (a door attached by its hinge edge was added to teach attaching)');
});

test('the guide asks for a stage with room (about 60 percent of the screen height) and its example stages are that tall, since a model copies the example and the screen is wider than tall', () => {
  assert.ok(sceneGuide.includes('about 60 percent of the screen height (h near 600)'), 'the guide says how tall');
  const panels = (sceneGuideExample as { steps: { actions: Array<{ op: string; w?: number; h?: number }> }[] }).steps.flatMap((s) => s.actions.filter((a) => a.op === 'panel'));
  assert.ok(panels.length > 0);
  for (const p of panels) assert.ok((p.h ?? 0) >= 560 && (p.w ?? 1000) < (p.h ?? 0), `the example stage is taller than wide and at least 56 percent of the height: ${p.w}x${p.h}`);
});

test('the guide says the question sets the task and the page is material, never a subject (no talk of where knowledge comes from), that a figure adds what the page lacks, and that a label starts beside its point', () => {
  const rule = sceneGuide.split(String.fromCharCode(10)).find((l) => l.startsWith('- The question sets the task'));
  assert.ok(rule, 'a rule of its own');
  for (const part of [
    'is material to use, never a subject to report on. Never open with what the page or picture is, and never say where your knowledge comes from or what the page does or does not contain, unless asked',
    'Do not draw again what the page already has (its graph, its table, its list of steps): point at it with marks',
    'Where the page gives the content (the proof its figure shows, the steps and amounts it lists), use that, not another',
    'Draw only when it explains better than words alone',
    'A label starts just to the right of its point, at the height of the point',
  ]) assert.ok(rule!.includes(part), part);
  assert.ok(!sceneGuide.includes('general knowledge and not from this page'), 'the old instruction to announce general knowledge is gone');
});

test('the guide says a photo is stated from only when clear, no angle or size is quoted that cannot be measured, and a diagram of a physical thing is a 3D scene, not a flowchart', () => {
  assert.ok(sceneGuide.includes('State as fact only what a picture clearly shows'));
  assert.ok(sceneGuide.includes('Never quote an angle, size or distance you cannot measure: show a direction by drawing along a real edge or line in the picture'));
  assert.ok(sceneGuide.includes('a 3D scene for any physical thing, place or natural process (the water cycle, a heart, an engine, a river forming: its parts as shapes, streams for what moves), also when a diagram or drawing of it is asked for'));
  assert.ok(sceneGuide.includes('one sentence that begins the answer itself (never a description of the page or of what was circled)'));
});

test('what the prompt leaves out (loop pivot) is still in the language: the validator keeps it, the full schema asks for it, the guide and the lean schema do not; a joint keeps its dir (a tilted slide) in the prompt', () => {
  const r = validateScene({ steps: [{ say: 'x', actions: [
    { op: 'add', shape: 'box', id: 'b', size: [1, 1, 1] },
    { op: 'joint', id: 'b', kind: 'slide', dir: [3, 4, 0] },
    { op: 'loop', id: 'b', kind: 'swing', amount: 20, pivot: [0, 1, 0] },
  ] }] }, createSceneState());
  assert.deepEqual(r.issues, []);
  const actions = (r.scene as { steps: Array<{ actions: Array<Record<string, unknown>> }> }).steps[0]!.actions;
  assert.deepEqual(actions[1]!.dir, [3, 4, 0]);
  assert.deepEqual(actions[2]!.pivot, [0, 1, 0]);
  const full = JSON.stringify(sceneSchema), lean = JSON.stringify(sceneSchemaLean);
  assert.ok(full.includes('"dir":{"type":["array","null"]') && full.includes('"pivot":{"type":["array","null"]'));
  assert.ok(!/"loop":\{[^]*?"pivot"/.test(JSON.stringify(variantDefinitions(sceneSchemaLean).loop)));
  assert.ok(JSON.stringify(variantDefinitions(sceneSchemaLean).joint).includes('"dir"'));
  assert.ok(lean.includes('"pivot"'), 'a hinge joint still has its pivot in the lean schema');
  assert.ok(!sceneGuide.includes('- loop {') || !/- loop \{[^}]*pivot/.test(sceneGuide));
  assert.ok(/- joint \{[^}]*dir/.test(sceneGuide));
  assert.ok(/- joint \{[^}]*pivot/.test(sceneGuide));
});
