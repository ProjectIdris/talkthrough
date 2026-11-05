import test from 'node:test';
import assert from 'node:assert/strict';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/index.ts';

// Connectors (a rope, belt, wire or pipe between two objects) and streams (dots, dashes or arrows travelling along a path, a connector or a
// flow diagram's arrow). Both name objects that are already in the scene; whatever the model names, the validator binds it to what fits or drops it with a line.

type Raw = Record<string, unknown>;
const box = (id: string, extra: Raw = {}): Raw => ({ op: 'add', shape: 'box', id, size: [1, 1, 1], ...extra });
const wheel = (id: string, extra: Raw = {}): Raw => ({ op: 'add', shape: 'cylinder', id, size: [2, 0.4, 2], rot: [90, 0, 0], ...extra });
const group = (id: string): Raw => ({ op: 'add', shape: 'group', id });
const tube = (id: string, extra: Raw = {}): Raw => ({ op: 'add', shape: 'tube', id, pts: [[0, 0, 0], [3, 0, 0]], radius: 0.1, ...extra });
const run = (...actions: Raw[]) => {
  const state = createSceneState();
  const r = validateScene({ steps: [{ say: 'x', actions }] }, state);
  const kept = r.scene ? (r.scene as Scene).steps.flatMap((s) => s.actions) : [];
  return { kept, state, issues: r.issues, ofOp: (op: string) => kept.filter((a) => a.op === op) as unknown as Raw[], shape: (shape: string) => kept.filter((a) => (a as Raw).shape === shape) as unknown as Raw[] };
};

test('a connector joins two objects that are there', () => {
  const { shape, issues } = run(wheel('w'), box('weight', { pos: [0, -3, 0] }), { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'weight', fromSide: 'left', toSide: 'top' });
  const [rope] = shape('connector');
  assert.deepEqual([rope?.from, rope?.to, rope?.fromSide, rope?.toSide], ['w', 'weight', 'left', 'top']);
  assert.deepEqual(issues, []);
});

test('a connector to an id that is not there, to itself, or to a mark is dropped with a line', () => {
  const bad = [
    { op: 'add', shape: 'connector', id: 'a', from: 'w', to: 'ghost' },
    { op: 'add', shape: 'connector', id: 'b', from: 'w', to: 'w' },
    { op: 'add', shape: 'connector', id: 'c', from: 'w', to: 'm' },
  ];
  const { shape, issues } = run(wheel('w'), { op: 'label', id: 'm', x: 100, y: 100, text: 'hi', color: 'red' }, ...bad);
  assert.equal(shape('connector').length, 0);
  assert.equal(issues.length, 3, JSON.stringify(issues));
  assert.ok(issues.some((i) => /itself|same/.test(i.message)), JSON.stringify(issues));
});

test('a connector is a path: a stream can run along it, and it can be swapped for a tube of the same id', () => {
  const { shape } = run(wheel('w'), box('b', { pos: [3, 0, 0] }), { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'b' }, { op: 'add', shape: 'stream', id: 's', along: 'rope' });
  assert.equal(shape('stream').length, 1);
});

test('a stream runs along a tube, a line, an arrow; it hangs from its path (goes with it) and is not a path itself', () => {
  const { shape, state } = run(tube('pipe'), tube('pipe2'), { op: 'add', shape: 'stream', id: 's1', along: 'pipe', color: 'blue', toColor: 'red' }, { op: 'add', shape: 'stream', id: 's2', along: 's1' });
  assert.equal(state.parents.get('s1'), 'pipe');
  assert.equal(state.ids.get('s1'), 'solid');
  // A stream along a stream is not a thing: it has no path to run on.
  assert.deepEqual(shape('stream').map((s) => s.id), ['s1']);
});

test('a stream along the id of a group that holds one pipe runs along that pipe, and says so', () => {
  const { shape, issues } = run(group('heart'), tube('aorta', { parent: 'heart' }), box('chamber', { parent: 'heart' }), { op: 'add', shape: 'stream', id: 's', along: 'heart' });
  assert.equal(shape('stream')[0]?.along, 'aorta');
  assert.ok(issues.some((i) => /repaired: "heart" is not a path.*"aorta"/.test(i.message)), JSON.stringify(issues));
});

test('a stream along a box, with several pipes in the scene and none under it, is dropped rather than guessed', () => {
  const { shape, issues } = run(box('b'), tube('p1'), tube('p2'), { op: 'add', shape: 'stream', id: 's', along: 'b' });
  assert.equal(shape('stream').length, 0);
  assert.ok(issues.some((i) => /"b" is not a path/.test(i.message)), JSON.stringify(issues));
});

test('a stream along the only pipe there is, named wrongly, binds to it', () => {
  const { shape } = run(box('b'), tube('only'), { op: 'add', shape: 'stream', id: 's', along: 'b' });
  assert.equal(shape('stream')[0]?.along, 'only');
});

test('a stream along an arrow of a flow diagram is kept, and goes with the diagram', () => {
  const diagram = [
    { op: 'diagram', id: 'd', kind: 'flow', x: 50, y: 50, w: 600, h: 300 },
    { op: 'node', id: 'a', of: 'd', text: 'Farm' }, { op: 'node', id: 'b', of: 'd', text: 'Shop' },
    { op: 'edge', id: 'e', from: 'a', to: 'b', text: 'milk' },
    { op: 'add', shape: 'stream', id: 's', along: 'e', mark: 'dot', color: 'green' },
  ];
  const { shape, state } = run(...diagram);
  assert.equal(shape('stream').length, 1);
  assert.equal(state.ids.get('s'), 'dot');
  const cleared = run(...diagram, { op: 'clear', target: 'marks' });
  assert.equal(cleared.state.ids.has('s'), false);
});

test('a stream locked to a group is not locked to it; a period of 0 is read as none', () => {
  const { shape, issues } = run(group('rig'), wheel('w', { parent: 'rig' }), tube('pipe'), { op: 'add', shape: 'stream', id: 's', along: 'pipe', by: 'rig', period: 0 });
  const [s] = shape('stream');
  assert.equal(s?.by, undefined);
  assert.equal(s?.period, undefined);
  assert.ok(issues.some((i) => /by/.test(i.path)) && issues.some((i) => /period/.test(i.path)), JSON.stringify(issues));
});

test('streams are capped in number of markers', () => {
  const { shape } = run(tube('pipe'), { op: 'add', shape: 'stream', id: 's', along: 'pipe', count: 500 });
  assert.equal(shape('stream')[0]?.count, 40);
});

// ---- a connector is a physical rope between two 3D objects, never a link between panels, cards, marks or diagram nodes -------------------------

test('a connector end that names a mark, a pin, a diagram, a diagram node or a flow arrow is refused with a line that says why', () => {
  const screen = [
    { op: 'label', id: 'tag', x: 100, y: 100, text: 'hi', color: 'red' },
    { op: 'diagram', id: 'd', kind: 'flow', x: 50, y: 50, w: 600, h: 300 },
    { op: 'node', id: 'a', of: 'd', text: 'Farm' }, { op: 'node', id: 'b', of: 'd', text: 'Shop' }, { op: 'edge', id: 'e', from: 'a', to: 'b' },
  ];
  for (const bad of ['tag', 'd', 'a', 'e']) {
    const { shape, issues } = run(wheel('w'), ...screen, { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: bad });
    assert.equal(shape('connector').length, 0, bad);
    assert.ok(issues.some((i) => /not a 3D object|a physical rope/.test(i.message) && /to/.test(i.path + i.message)), `${bad}: ${JSON.stringify(issues)}`);
  }
});

test('a connector end that names an object not added yet is refused (the line names the id), not drawn to nothing', () => {
  const { shape, issues } = run(wheel('w'), { op: 'add', shape: 'connector', id: 'rope', from: 'w', to: 'switch-later' });
  assert.equal(shape('connector').length, 0);
  assert.ok(issues.some((i) => /unknown id "switch-later"/.test(i.message)), JSON.stringify(issues));
});

test('the guide and the schema call a connector a physical rope, wire, belt or pipe between parts of one model, and keep the flat arrows for cards and nodes', async () => {
  const { sceneGuide, sceneSchemaLean } = await import('../src/scene/index.ts');
  const text = sceneGuide + JSON.stringify(sceneSchemaLean);
  assert.match(text, /physical/);
  assert.match(text, /parts of one 3D model/);
  assert.match(text, /edge/);
});

// ---- tubes and lines that end on a part --------------------------------------------------------------------------------------------

test('a hand-built tube with an end on a part (a hair off its surface) is joined to it: the end snaps onto the surface and the tube goes with the part; an end in clear air stays as written', () => {
  const { kept, issues } = run(
    box('bat', { size: [1, 1.6, 1], pos: [-2, 0, 0] }),
    tube('wire', { pts: [[-2, 0.9, 0], [-2, 2, 0], [2, 2, 0]], radius: 0.07 }), // starts 0.1 above the battery's top (y 0.8), ends in the air
  );
  const wire = kept.find((a) => (a as Raw).id === 'wire') as unknown as { pts: number[][]; attach: Array<{ to: string; at: number[] } | null> };
  assert.deepEqual(wire.pts[0], [-2, 0.8, 0], 'snapped onto the top face');
  assert.deepEqual(wire.pts[2], [2, 2, 0], 'an end in clear air is as written');
  assert.equal(wire.attach[0]?.to, 'bat');
  assert.deepEqual(wire.attach[0]?.at?.map((x) => Math.round(x * 1000) / 1000), [0, 0.8, 0], 'the point in the battery\'s own space');
  assert.equal(wire.attach[1], null);
  assert.ok(issues.some((i) => /repaired/.test(i.message) && /wire/.test(i.message) && /bat/.test(i.message)), JSON.stringify(issues));
});

test('a tube end a good way from every part is left alone, and a model cannot write the attachment itself', () => {
  const { kept } = run(box('bat', { pos: [0, 0, 0] }), tube('far', { pts: [[3, 0, 0], [5, 0, 0]] }), tube('own', { pts: [[3, 3, 0], [5, 3, 0]], attach: [{ to: 'bat', at: [0, 0.5, 0] }, null] }));
  for (const id of ['far', 'own']) assert.equal((kept.find((a) => (a as Raw).id === id) as Raw).attach, undefined, id);
});

test('a part added after the tube is what an end in the air was meant for: the tube is made over to end on it (same id), and not before the part is there', () => {
  const { kept, issues, state } = run(
    tube('wire', { pts: [[2, 2, 0], [0, 2, 0], [0, 0.17, 0]], radius: 0.07 }),
    box('sw', { size: [1, 0.3, 0.5], pos: [0, 0, 0], at: 1 }),
  );
  const ids = kept.map((a) => (a as Raw).id);
  assert.deepEqual(ids, ['wire', 'sw', 'wire'], 'the tube comes again right after the part');
  const again = kept[2] as unknown as { pts: number[][]; attach: Array<{ to: string } | null>; at?: number };
  assert.deepEqual(again.pts[2], [0, 0.15, 0], 'its end is on the top of the switch (0.02 off before)');
  assert.equal(again.attach[1]?.to, 'sw');
  assert.equal(again.attach[0], null);
  assert.equal(again.at, 1, 'it is made over when the part comes in');
  assert.ok(issues.some((i) => /came after/.test(i.message)), JSON.stringify(issues));
  assert.equal(state.ids.get('wire'), 'path');
});
