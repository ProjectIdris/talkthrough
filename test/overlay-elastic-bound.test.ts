import test from 'node:test';
import assert from 'node:assert/strict';
import { Mesh } from 'three';
import type { BufferGeometry, Object3D } from 'three';
import type { Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, planStep } from '../src/overlay/timeline.ts';

// An elastic connector thickens as its span shortens, but never beyond what the span and the parts it joins allow: shortened a great deal it is squashed
// (no wider than the span, the parts' own width, or the authored look), never a ball that swallows what it joins, and its rounded ends stay near the anchors.

const group = (id: string, extra: object = {}) => ({ op: 'add', shape: 'group', id, ...extra });
const plate = (id: string, y: number, width = 1.4) => ({ op: 'add', shape: 'box', id, pos: [0, y, 0], size: [width, 0.4, width] });
const cord = (extra: object = {}) => ({ op: 'add', shape: 'connector', id: 'link', from: 'a', to: 'b', radius: 0.3, restLength: 5.6, ...extra });
function geometryOf(actions: unknown[]): BufferGeometry {
  const plan = planStep(emptyFrame(), { say: 'x', actions: [{ op: 'panel', x: 100, y: 100, w: 600, h: 500 }, ...actions] } as Step);
  const scene = new PanelScene();
  const frame = evaluate(plan, 1);
  scene.sync(frame, 1);
  const node = scene.nodeOf(frame.objects.find((o) => o.id === 'link')!.key) as Object3D;
  return (node.children[0] as Mesh).geometry;
}
const widest = (geo: BufferGeometry): number => {
  const p = geo.getAttribute('position');
  let r = 0;
  for (let i = 0; i < p.count; i++) r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)));
  return r;
};
const extent = (geo: BufferGeometry): [number, number] => {
  const p = geo.getAttribute('position');
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.count; i++) { lo = Math.min(lo, p.getY(i)); hi = Math.max(hi, p.getY(i)); }
  return [lo, hi];
};

test('a cord shortened about fifty times is squashed to its authored width, not swollen into a ball over the plates it joins', () => {
  const geo = geometryOf([plate('a', 0), plate('b', 0.1), cord()]);
  assert.ok(widest(geo) <= 0.3 + 1e-3, `radius ${widest(geo)} (authored 0.3, plates 1.4 wide, span 0.1)`);
});

test('a bulge may grow up to half the span, so a modest shortening is as before', () => {
  assert.ok(Math.abs(widest(geometryOf([plate('a', 0), plate('b', 2), cord({ radius: 0.2, restLength: 4 })])) - 0.2 * Math.SQRT2) < 1e-3, 'span 2 of rest 4: radius times sqrt 2');
  assert.ok(Math.abs(widest(geometryOf([plate('a', 0), plate('b', 1), cord({ radius: 0.2, restLength: 4 })])) - 0.4) < 1e-3, 'span 1 of rest 4: doubled, as long as it is under half the span');
});

test('the widest ring of a swelled cord is what is bounded, and the authored profile is never thinned', () => {
  const swell = [[0, 0.2], [0.5, 2], [1, 0.2]];
  const authored = widest(geometryOf([plate('a', 0), plate('b', 4), cord({ radius: 0.2, restLength: 4, swell })]));
  assert.ok(Math.abs(authored - 0.4) < 0.01, `at rest length the authored belly (${authored})`);
  const squashed = widest(geometryOf([plate('a', 0), plate('b', 0.3), cord({ radius: 0.2, restLength: 4, swell })]));
  assert.ok(squashed <= authored + 1e-3, `a 0.3 span keeps no more than the authored belly (${squashed})`);
});

test('a bulge is also bounded by the width of the parts it joins', () => {
  const small = geometryOf([{ ...plate('a', 0, 0.3) }, { ...plate('b', 2, 0.3) }, cord({ radius: 0.1, restLength: 100 })]);
  assert.ok(widest(small) <= 0.75 * 0.3 + 1e-3, `radius ${widest(small)} between parts 0.3 wide (a quarter-turn of scale would give 0.4)`);
});

test('the rounded ends of a squashed cord stay near their anchors, and are unchanged at ordinary spans', () => {
  const [lo, hi] = extent(geometryOf([plate('a', 0), plate('b', 0.2), cord()]));
  assert.ok(lo > -0.06 && hi < 0.2 + 0.06, `ends reach ${lo}..${hi} for anchors at 0 and 0.2 (they were -0.3..0.5)`);
  const [lo4, hi4] = extent(geometryOf([plate('a', 0), plate('b', 4), cord({ radius: 0.2, restLength: 4 })]));
  assert.ok(Math.abs(lo4 + 0.2) < 1e-3 && Math.abs(hi4 - 4.2) < 1e-3, `a full-length cord keeps its round ends (${lo4}..${hi4})`);
});

test('every normal stays finite and unit length on a flattened end', () => {
  const geo = geometryOf([plate('a', 0), plate('b', 0.2), cord()]);
  const n = geo.getAttribute('normal');
  for (let i = 0; i < n.count; i++) {
    const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i));
    assert.ok(Number.isFinite(l) && Math.abs(l - 1) < 1e-4, `normal ${i} has length ${l}`);
  }
});

// The bound is read in the connector's own space: the part's width is measured in the world and brought into that space, so a group scaled up or down
// around the parts and the cord gives the same cord as the unscaled scene.
for (const s of [0.2, 1, 4]) {
  test(`a bulge is bounded by the part width the same way inside a group scaled ${s}`, () => {
    const inGroup = (extra: object) => ({ ...extra, parent: 'g' });
    const geo = geometryOf([
      group('g'),
      inGroup(plate('a', 0, 0.3)), inGroup(plate('b', 2, 0.3)), inGroup(cord({ radius: 0.1, restLength: 100 })),
      { op: 'scale', id: 'g', to: [s, s, s], dur: 0 },
    ]);
    assert.ok(Math.abs(widest(geo) - 0.75 * 0.3) < 1e-3, `radius ${widest(geo)} in the cord's own space (3/4 of the 0.3 part width is ${0.75 * 0.3})`);
  });
}

// A group scaled differently on its axes: what matters is the width across the cord, so the bound is the same 3/4 of the part width in the cord's own space.
for (const s of [[1, 4, 1], [4, 1, 4], [1.5, 0.7, 0.5]]) {
  test(`a bulge is bounded by the part width across the cord inside a group scaled ${s.join(', ')}`, () => {
    const inGroup = (extra: object) => ({ ...extra, parent: 'g' });
    const geo = geometryOf([
      group('g'),
      inGroup(plate('a', 0, 0.3)), inGroup(plate('b', 2, 0.3)), inGroup(cord({ radius: 0.1, restLength: 100 })),
      { op: 'scale', id: 'g', to: s, dur: 0 },
    ]);
    assert.ok(Math.abs(widest(geo) - 0.75 * 0.3) < 1e-3, `radius ${widest(geo)} in the cord's own space (3/4 of the 0.3 part width is ${0.75 * 0.3})`);
  });
}

// A group turned (any way) around the parts and the cord: the part's box is built in the cord's own space, not boxed in the world and boxed again.
for (const turn of [[0, 30, 0], [0, 0, 45], [20, 50, 70]]) {
  test(`a bulge is bounded by the part width across the cord inside a group turned ${turn.join(', ')}`, () => {
    const inGroup = (extra: object) => ({ ...extra, parent: 'g' });
    const geo = geometryOf([
      group('g'),
      inGroup(plate('a', 0, 0.3)), inGroup(plate('b', 2, 0.3)), inGroup(cord({ radius: 0.1, restLength: 100 })),
      { op: 'turn', id: 'g', to: turn, dur: 0 },
    ]);
    assert.ok(Math.abs(widest(geo) - 0.75 * 0.3) < 1e-3, `radius ${widest(geo)} in the cord's own space (3/4 of the 0.3 part width is ${0.75 * 0.3})`);
  });
}
