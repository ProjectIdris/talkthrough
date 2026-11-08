import assert from 'node:assert/strict';
import test from 'node:test';
import { createSceneState, sceneGuide, validateStep } from '../src/scene/index.ts';
import { mountPosition } from '../src/scene/attach.ts';

type Act = { op: string; id?: string; rot?: [number, number, number]; pos?: [number, number, number]; [k: string]: unknown };
const board = (size = [6, 0.2, 4], extra: object = {}) => ({ op: 'add', shape: 'box', id: 'pcb', size, ...extra });
const part = (id: string, kind: string, parentAnchor: string, extra: object = {}) =>
  ({ op: 'add', shape: 'part', part: kind, id, parent: 'pcb', parentAnchor, size: [1.2, 0.8, 1], ...extra });
const run = (...actions: unknown[]) => {
  const r = validateStep({ say: 'x', actions: [{ op: 'panel', x: 500, y: 100, w: 400, h: 600 }, board(), ...actions] }, createSceneState());
  return { r, by: (id: string) => (r.step?.actions ?? []).find((a) => (a as Act).id === id) as Act | undefined };
};
const noted = (r: ReturnType<typeof run>['r'], re: RegExp) => r.issues.some((i) => re.test(i.message));
/** Where a part's facing points once turned by rot: the mount arithmetic is rot applied to a point, so the point's turned place is minus the shift. */
const turned = (rot: number[] | undefined, f: number[]) => mountPosition([0, 0, 0], f as never, (rot ?? [0, 0, 0]) as never, [0, 0, 0]).map((v) => Math.round(-v) + 0);

test('a port attached by the right face with no rot is turned so its opening points out of that face', () => {
  const { r, by } = run(part('usb', 'port', 'right', { selfAnchor: 'center' }));
  assert.deepEqual(by('usb')?.rot, [0, 90, 0]);
  assert.deepEqual(turned(by('usb')?.rot, [0, 0, 1]), [1, 0, 0]);
  assert.ok(noted(r, /usb.*turned to face/), JSON.stringify(r.issues));
});

test('every face turns a port, a header and a chip to point out of it', () => {
  const normals: Record<string, number[]> = { right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0], bottom: [0, -1, 0], front: [0, 0, 1], back: [0, 0, -1] };
  const facings: Record<string, number[]> = { port: [0, 0, 1], lens: [0, 0, 1], screen: [0, 0, 1], chip: [0, 1, 0], header: [0, 1, 0], button: [0, 1, 0], fan: [0, 1, 0] };
  for (const [kind, f] of Object.entries(facings)) for (const [face, n] of Object.entries(normals)) {
    const { by } = run(part('p', kind, face, { selfAnchor: 'center' }));
    assert.deepEqual(turned(by('p')?.rot, f), n, `${kind} on ${face}: rot ${JSON.stringify(by('p')?.rot)}`);
  }
});

test('an explicit rot wins, even [0,0,0]; a part already facing out is left as it is', () => {
  const zero = run(part('usb', 'port', 'right', { rot: [0, 0, 0] }));
  assert.deepEqual(zero.by('usb')?.rot, [0, 0, 0]);
  assert.ok(!noted(zero.r, /turned to face/));
  const given = run(part('usb', 'port', 'right', { rot: [0, 90, 0], selfAnchor: 'right' }));
  assert.deepEqual(given.by('usb')?.rot, [0, 90, 0]);
  const out = run(part('hdmi', 'port', 'front'), part('soc', 'chip', 'top', { selfAnchor: 'bottom' }));
  assert.equal(out.by('hdmi')?.rot, undefined);
  assert.equal(out.by('soc')?.rot, undefined);
  assert.ok(!noted(out.r, /turned to face/));
});

test('a part whose own facing side is the anchor it is attached by is left alone, as is a part with no facing', () => {
  // A chip hung under the board by its top: it was asked to put its top against the board.
  const under = run(part('soc', 'chip', 'bottom', { selfAnchor: 'top' }));
  assert.equal(under.by('soc')?.rot, undefined);
  const wheel = run(part('w', 'wheel', 'bottom', { selfAnchor: 'center', size: [1, 1, 0.2] }));
  assert.equal(wheel.by('w')?.rot, undefined);
  const plain = run({ op: 'add', shape: 'box', id: 'b', parent: 'pcb', parentAnchor: 'right', size: [1, 1, 1] });
  assert.equal(plain.by('b')?.rot, undefined);
  const noFace = run(part('usb', 'port', 'center'));
  assert.equal(noFace.by('usb')?.rot, undefined);
});

test('the turn is made before the placement is worked out, and the parent turning does not change it', () => {
  const plain = run(part('usb', 'port', 'right', { selfAnchor: 'back', pos: [0, 0.5, 0] }));
  const spun = (() => {
    const r = validateStep({ say: 'x', actions: [{ op: 'panel', x: 500, y: 100, w: 400, h: 600 }, board([6, 0.2, 4], { rot: [0, 40, 0] }), part('usb', 'port', 'right', { selfAnchor: 'back', pos: [0, 0.5, 0] })] }, createSceneState());
    return (r.step?.actions ?? []).find((a) => (a as Act).id === 'usb') as Act;
  })();
  assert.deepEqual(plain.by('usb')?.rot, [0, 90, 0]);
  assert.deepEqual(spun.rot, [0, 90, 0]);
  // Its back (at -z in its own space) is on the edge: after the turn the port stands outside the board, mouth out.
  assert.ok(!plain.r.issues.some((i) => /dropped/.test(i.kind)), JSON.stringify(plain.r.issues));
});

test('an anchor of the parent called right that is not on its right is not read as a face', () => {
  const r = validateStep({ say: 'x', actions: [
    { op: 'panel', x: 500, y: 100, w: 400, h: 600 }, board(), { op: 'anchor', id: 'pcb', name: 'right', pos: [-3, 0, 0] }, part('usb', 'port', 'right'),
  ] }, createSceneState());
  const usb = (r.step?.actions ?? []).find((a) => (a as Act).id === 'usb') as Act;
  assert.equal(usb.rot, undefined);
});

test('the guide gives the rule and the facings, and no longer only the port', () => {
  assert.match(sceneGuide, /turns to face out unless rot is given/);
  assert.match(sceneGuide, /\+z faces: port, lens, screen/);
  assert.match(sceneGuide, /\+y: chip, header, button, fan/);
  assert.ok(!/opening faces \+z/.test(sceneGuide), 'the old port-only sentence is gone');
});
