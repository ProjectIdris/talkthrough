import test from 'node:test';
import assert from 'node:assert/strict';
import { LIMITS, createDetailState, createSceneState, orderScore, sceneGuide, validateScene } from '../src/scene/index.ts';
import type { Action, Scene } from '../src/scene/index.ts';

const scene = (...actions: unknown[]) => ({ steps: [{ say: 'ok', actions }] });
const flow = (id = 'f', extra: object = {}) => ({ op: 'diagram', id, kind: 'flow', x: 500, y: 100, w: 400, h: 400, ...extra });
const node = (id: string, of = 'f', extra: object = {}) => ({ op: 'node', id, of, text: id.toUpperCase(), ...extra });
const edge = (id: string, from: string, to: string, extra: object = {}) => ({ op: 'edge', id, from, to, ...extra });
const actionsOf = (r: ReturnType<typeof validateScene>) => (r.scene as Scene).steps.flatMap((s) => s.actions);
const ids = (r: ReturnType<typeof validateScene>) => actionsOf(r).map((a) => (a as { id?: string }).id);
const dropped = (r: ReturnType<typeof validateScene>) => r.issues.filter((i) => i.kind === 'dropped').map((i) => i.message);

test('a flow is a diagram with nodes and edges that name it and each other; all four kinds validate and nothing is dropped', () => {
  const a = validateScene(scene(
    flow(), node('a'), node('b'), edge('ab', 'a', 'b', { text: 'then' }),
    { op: 'diagram', id: 't', kind: 'timeline', x: 0, y: 700, w: 900, h: 250 }, node('ev', 't', { when: '1066', pos: 1066, note: 'n' }),
  ));
  const b = validateScene(scene(
    { op: 'diagram', id: 's', kind: 'steps', x: 0, y: 0, w: 300, h: 300 }, node('one', 's'), { op: 'tick', id: 'one' },
    { op: 'diagram', id: 'c', kind: 'chart', x: 0, y: 0, w: 300, h: 300, xlabel: 'Qty', xrange: [0, 10] },
    { op: 'series', id: 'line', of: 'c', pts: [[0, 0], [5, 5]], curve: true, label: 'L' }, { op: 'dot', id: 'pt', of: 'c', x: 5, y: 5, text: 'here' },
  ));
  assert.deepEqual([...a.issues, ...b.issues], []);
  assert.equal(actionsOf(a).length + actionsOf(b).length, 12);
});

test('a piece goes only in the kinds of diagram it belongs to, and an edge only joins two different nodes of one diagram', () => {
  const r = validateScene(scene(
    flow('f'), { op: 'diagram', id: 'c', kind: 'chart', x: 0, y: 0, w: 300, h: 300 }, { op: 'diagram', id: 's', kind: 'steps', x: 0, y: 0, w: 300, h: 300 },
    node('a', 'f'), node('b', 'f'), node('x', 'c'), { op: 'series', id: 'sr', of: 'f', pts: [[0, 0], [1, 1]] }, node('c1', 's'),
    edge('e1', 'a', 'a'), edge('e2', 'a', 'c1'), edge('e3', 'c1', 'a'), { op: 'edge', id: 'e4', from: 'a', to: 'b' },
    { op: 'dot', id: 'd', of: 's', x: 1, y: 1 },
  ));
  assert.deepEqual(ids(r), ['f', 'c', 's', 'a', 'b', 'c1', 'e4']);
  const why = dropped(r).join(' | ');
  assert.match(why, /chart diagram holds series and dot, not node/);
  assert.match(why, /flow diagram holds node and edge, not series/);
  assert.match(why, /two different nodes/);
  assert.match(why, /same diagram/);
  assert.match(why, /steps diagram holds node, not dot/);
});

test('a diagram holds at most so many nodes, edges, series and dots, and only so many diagrams are on screen; a piece written again takes its own place', () => {
  const nodes = Array.from({ length: LIMITS.maxNodes + 2 }, (_, i) => node(`n${i}`));
  const r = validateScene(scene(flow(), ...nodes.slice(0, 12)));
  assert.equal(dropped(r).length, 0);
  const over = validateScene({ steps: [{ say: 'a', actions: [flow(), ...nodes.slice(0, 12)] }, { say: 'b', actions: [nodes[12], nodes[13], node('n0', 'f', { text: 'again' })] }] });
  assert.deepEqual(dropped(over).filter((m) => m.includes('at most')).length, 2, 'the 13th and 14th are refused');
  assert.equal(dropped(over).length, 3, 'and the node that is written again is refused as an id in use (not a replacement) on a scene that is not a detail pass');
  const many = validateScene(scene(flow('a'), flow('b'), flow('c'), flow('d'), flow('a', { x: 10 })));
  assert.deepEqual(ids(many), ['a', 'b', 'c']);
  assert.match(dropped(many)[0] ?? '', /3 diagrams are on screen/);
  // edges
  const edges = Array.from({ length: LIMITS.maxEdges + 1 }, (_, i) => edge(`e${i}`, 'p', 'q'));
  const er = validateScene({ steps: [{ say: 'a', actions: [flow(), node('p'), node('q'), ...edges.slice(0, 12)] }, { say: 'b', actions: edges.slice(12) }] });
  assert.equal(dropped(er).length, 1);
  assert.match(dropped(er)[0] ?? '', /at most 24 edges/);
});

test('ids: a piece written before its diagram waits for it, ids are unique, reserved names are refused, a piece for no diagram is dropped', () => {
  const early = validateScene(scene(node('a'), flow()));
  assert.deepEqual(ids(early), ['f', 'a'], 'held until its diagram arrived');
  const never = validateScene(scene(node('a', 'nowhere')));
  assert.deepEqual(ids(never), []);
  assert.match(dropped(never)[0] ?? '', /unknown id "nowhere"/);
  const dup = validateScene(scene(flow(), node('a'), node('a')));
  assert.equal(dropped(dup).length, 1);
  assert.equal(validateScene(scene(flow('all'))).ok && dropped(validateScene(scene(flow('all')))).length, 1);
});

test('numbers are clamped and lists cut: pos, chart points and the axis ranges', () => {
  const r = validateScene(scene(
    { op: 'diagram', id: 'c', kind: 'chart', x: 5000, y: 0, w: 5, h: 5000, xrange: [-9e9, 9e9] },
    { op: 'series', id: 's', of: 'c', pts: Array.from({ length: 60 }, (_, i) => [i, i * 2]) },
    { op: 'dot', id: 'd', of: 'c', x: 9e9, y: 0 },
  ));
  const [d, s, dot] = actionsOf(r) as Array<Record<string, unknown>>;
  assert.equal(d!.x, 1000);
  assert.equal(d!.w, 80);
  assert.equal(d!.h, 1000);
  assert.deepEqual(d!.xrange, [-1_000_000, 1_000_000]);
  assert.equal((s!.pts as unknown[]).length, LIMITS.maxSeriesPts);
  assert.equal(dot!.x, 1_000_000);
  assert.ok(r.issues.some((i) => i.kind === 'clamped') && r.issues.some((i) => i.kind === 'trimmed'));
});

test('tick is for the steps of a steps diagram only', () => {
  const r = validateScene(scene(flow(), node('a'), { op: 'diagram', id: 's', kind: 'steps', x: 0, y: 0, w: 300, h: 300 }, node('one', 's'), { op: 'tick', id: 'a' }, { op: 'tick', id: 'one', done: false }, { op: 'tick', id: 's' }));
  assert.deepEqual(actionsOf(r).filter((a) => a.op === 'tick').map((a) => (a as { id: string }).id), ['one']);
  assert.equal(dropped(r).length, 2);
});

test('clear: an id takes a diagram with its pieces, "marks" takes the diagrams with the marks, "panel" leaves them', () => {
  const state = createSceneState();
  validateScene(scene(flow(), node('a'), node('b'), edge('ab', 'a', 'b'), { op: 'add', shape: 'box', id: 'cube', size: [1, 1, 1] }, { op: 'box', id: 'bx', x: 1, y: 1, w: 10, h: 10, color: 'red' }), state);
  assert.deepEqual([...state.ids.keys()].sort(), ['a', 'ab', 'b', 'bx', 'cube', 'f']);
  validateScene(scene({ op: 'clear', target: 'panel' }), state);
  assert.deepEqual([...state.ids.keys()].sort(), ['a', 'ab', 'b', 'bx', 'f'], 'the 3D stage went; the diagram, its pieces and the mark stayed');
  validateScene(scene({ op: 'clear', target: 'a' }), state);
  assert.deepEqual([...state.ids.keys()].sort(), ['b', 'bx', 'f'], 'an edge goes with the node it leaves');
  validateScene(scene({ op: 'clear', target: 'marks' }), state);
  assert.equal(state.ids.size, 0, 'marks takes the diagram and every piece');
  assert.equal(state.diagramKinds.size, 0);
});

test('a diagram or a piece is not a 3D object: it cannot be moved, parented to, pinned or turned', () => {
  const r = validateScene(scene(
    flow(), node('a'),
    { op: 'move', id: 'f', to: [0, 0, 0] }, { op: 'spin', id: 'a', rpm: 10 }, { op: 'add', shape: 'box', id: 'x', parent: 'f', size: [1, 1, 1] },
    { op: 'pin', id: 'p', on: 'a', text: 'hi' }, { op: 'style', id: 'a', color: 'red' }, { op: 'highlight', id: 'f' },
  ));
  assert.equal(dropped(r).length, 4);
  assert.deepEqual(actionsOf(r).map((a) => a.op), ['diagram', 'node', 'style', 'highlight']);
});

test('on a detail pass a diagram or piece already on screen may be written again, richer, and only as its own kind', () => {
  const onScreen = createSceneState();
  validateScene(scene(flow(), node('a'), node('b'), { op: 'add', shape: 'box', id: 'cube', size: [1, 1, 1] }), onScreen);
  const detail = createDetailState(onScreen);
  const r = validateScene(scene(flow('f', { title: 'Richer' }), node('a', 'f', { note: 'more' }), edge('ab', 'a', 'b'), node('cube', 'f'), flow('b')), detail);
  assert.deepEqual(ids(r), ['f', 'a', 'ab'], 'a node cannot take a box\'s id, a diagram cannot take a node\'s');
  assert.equal(dropped(r).length, 2);
  assert.ok(detail.diagramKinds.get('f') === 'flow');
});

test('the order score treats a piece before its diagram as early and knows a diagram is not a 3D parent', () => {
  const ordered = orderScore([{ actions: [flow(), node('a'), node('b'), edge('ab', 'a', 'b')] }]);
  assert.equal(ordered.score, 1);
  const early = orderScore([{ actions: [node('a'), flow()] }]);
  assert.equal(early.early, 1);
  const wrong = orderScore([{ actions: [flow(), { op: 'add', shape: 'box', id: 'x', parent: 'f', size: [1, 1, 1] }] }]);
  assert.equal(wrong.wrong, 1);
});

test('the guide asks for diagrams in one rule line, with no worked example of a diagram, and lists every diagram action', () => {
  assert.match(sceneGuide, /Flat diagrams: /);
  for (const op of ['diagram', 'node', 'edge', 'series', 'dot', 'tick']) assert.ok(sceneGuide.includes(`- ${op} {`), op);
  const example = sceneGuide.slice(sceneGuide.indexOf('Example:'));
  assert.ok(!example.includes('"diagram"'), 'no diagram in the example');
});

test('a piece held for its diagram is drawn once the diagram arrives in the same step (streamed out of order)', async () => {
  const { beginLiveStep } = await import('../src/scene/index.ts');
  const state = createSceneState();
  const seen: Action[] = [];
  const live = beginLiveStep(state, { open: () => undefined, action: (a) => seen.push(a) });
  live.say('go');
  live.action(node('a'));
  assert.equal(seen.length, 0, 'held');
  live.action(flow());
  assert.deepEqual(seen.map((a) => a.op), ['diagram', 'node']);
  assert.deepEqual(live.finish().issues, []);
});
