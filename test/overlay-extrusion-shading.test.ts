import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, ExtrudeGeometry, Shape, Mesh, Matrix3, Vector3 } from 'three';
import { DETAIL, extrudeGeometry } from '../src/overlay/geometry.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/types.ts';
import type { Vec2 } from '../src/scene/types.ts';

const tiers = ['low', 'mid', 'high'] as const;
const polygon = (radius: number, n = 32, offset: Vec2 = [0, 0]): Vec2[] => Array.from({ length: n }, (_, i) => [
  offset[0] + radius * Math.cos(i * 2 * Math.PI / n), offset[1] + radius * Math.sin(i * 2 * Math.PI / n),
]);
function near(a: number, b: number, tolerance = 2e-6): void {
  assert.ok(Math.abs(a - b) <= tolerance, `${a} should equal ${b} within ${tolerance}`);
}
function radialSides(geo: BufferGeometry, centre: Vec2 = [0, 0]): void {
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  const side = geo.groups[1]!;
  for (let i = side.start; i < side.start + side.count; i++) {
    const x = p.getX(i) - centre[0], y = p.getY(i) - centre[1], r = Math.hypot(x, y);
    near(n.getX(i), x / r, 1e-5); near(n.getY(i), y / r, 1e-5); near(n.getZ(i), 0);
  }
}

test('round extrusion walls shade radially instead of leaning with the triangle diagonal', () => {
  const geo = extrudeGeometry(polygon(1), 0.5, 0, DETAIL.mid);
  try { radialSides(geo); } finally { geo.dispose(); }
});

test('compact distinct extrusion corners do not share unrelated surface normals', () => {
  for (const tier of tiers) for (const radius of [0.0001, 0.001, 0.005, 0.02]) {
    const geo = extrudeGeometry(polygon(radius), 0.01, 0, DETAIL[tier]);
    try { radialSides(geo); } finally { geo.dispose(); }
  }
});

test('moving a compact profile within local coordinates does not change its lighting', () => {
  const reference = extrudeGeometry(polygon(0.02), 0.04, 0.006, DETAIL.high);
  try {
    for (const centre of [[0.003, -0.005], [1.001, 2.003]] as Vec2[]) {
      const geo = extrudeGeometry(polygon(0.02, 32, centre), 0.04, 0.006, DETAIL.high);
      try {
        const n = geo.getAttribute('normal'), expected = reference.getAttribute('normal');
        assert.equal(n.count, expected.count);
        for (let i = 0; i < n.array.length; i++) near(n.array[i]!, expected.array[i]!, 0.0005);
      } finally { geo.dispose(); }
    }
  } finally { reference.dispose(); }
});

test('sharp cap boundaries and ninety-degree outline corners remain flat', () => {
  const geo = extrudeGeometry([[-1, -1], [1, -1], [1, 1], [-1, 1]], 0.5, 0, DETAIL.mid);
  try {
    const n = geo.getAttribute('normal');
    for (let i = 0; i < n.count; i++) {
      near(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)), 1);
      assert.equal([n.getX(i), n.getY(i), n.getZ(i)].filter(v => Math.abs(v) > 1e-6).length, 1);
    }
  } finally { geo.dispose(); }
});

// This independently constructs the unchanged geometry contract, without its normal helper.
function rawExtrusion(outline: Vec2[], depth: number, bevel: number, tier: typeof tiers[number]): BufferGeometry {
  const shape = new Shape();
  outline.forEach((p, i) => i ? shape.lineTo(...p) : shape.moveTo(...p)); shape.closePath();
  const b = Math.min(bevel, depth / 2 - 1e-3, 2), enabled = b > 0.004;
  const straight = Math.max(0.001, depth - (enabled ? 2 * b : 0));
  return new ExtrudeGeometry(shape, { depth: straight, bevelEnabled: enabled, bevelThickness: b,
    bevelSize: b, bevelOffset: -b, bevelSegments: DETAIL[tier].bevel, curveSegments: 8 }).translate(0, 0, -straight / 2);
}

test('normal correction preserves extrusion geometry, UVs, groups and triangle budget exactly', () => {
  const outlines: Vec2[][] = [polygon(0.02), polygon(1), [[-1,-1],[1,-1],[1,0],[0,0],[0,1],[-1,1]]];
  for (const tier of tiers) for (const outline of outlines) for (const bevel of [0, 0.006, 0.1]) {
    const geo = extrudeGeometry(outline, 0.4, bevel, DETAIL[tier]), raw = rawExtrusion(outline, 0.4, bevel, tier);
    try {
      for (const name of ['position', 'uv']) assert.deepEqual(geo.getAttribute(name).array, raw.getAttribute(name).array);
      assert.deepEqual(geo.index, raw.index); assert.deepEqual(geo.groups, raw.groups);
      assert.deepEqual(geo.drawRange, raw.drawRange);
    } finally { geo.dispose(); raw.dispose(); }
  }
});

test('extrusion normals remain finite, unit and outward on drawable faces across outline variants', () => {
  const shape: Vec2[] = [[-1,-1],[1,-1],[1,0],[0,0],[0,1],[-1,1]];
  const outlines = [shape, [...shape].reverse(), [...shape, shape[0]!], [shape[0]!, ...shape], polygon(1, 40)];
  for (const tier of tiers) for (const outline of outlines) for (const scale of [0.001, 1, 10]) for (const bevel of [0, 0.1]) {
    const geo = extrudeGeometry(outline.map(([x,y]) => [x * scale, y * scale]), 0.3 * scale, bevel * scale, DETAIL[tier]);
    try {
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
      assert.ok(Array.from(n.array).every(Number.isFinite));
      for (let start = 0; start < p.count; start += 3) {
        const a = new Vector3().fromBufferAttribute(p, start), b = new Vector3().fromBufferAttribute(p, start + 1), c = new Vector3().fromBufferAttribute(p, start + 2);
        const face = b.sub(a).cross(c.sub(a));
        if (!face.lengthSq()) continue;
        face.normalize();
        for (let i = start; i < start + 3; i++) {
          const normal = new Vector3().fromBufferAttribute(n, i);
          near(normal.length(), 1);
          assert.ok(normal.dot(face) > 0.8, 'normal stays in the visible face hemisphere');
        }
      }
    } finally { geo.dispose(); }
  }
});

test('sharp polygon walls do not become smooth merely because the outline is small', () => {
  for (const radius of [0.0001, 1]) {
    const geo = extrudeGeometry(polygon(radius, 6), 0.01, 0, DETAIL.high);
    try {
      const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
      for (let i = 0; i < p.count; i += 3) {
        const a = new Vector3().fromBufferAttribute(p, i), b = new Vector3().fromBufferAttribute(p, i + 1), c = new Vector3().fromBufferAttribute(p, i + 2);
        const face = b.sub(a).cross(c.sub(a)).normalize();
        for (let k = 0; k < 3; k++) near(new Vector3().fromBufferAttribute(n, i + k).dot(face), 1);
      }
    } finally { geo.dispose(); }
  }
});

test('real scene transforms, repeated sync, cuts and replacement preserve extrusion shading and disposal', () => {
  const steps: Step[] = [
    { say: 'x', actions: [
      { op: 'panel', x: 100, y: 100, w: 600, h: 500 },
      { op: 'add', shape: 'group', id: 'parent', rot: [20, 30, 10] },
      { op: 'scale', id: 'parent', to: [100, 80, 60], dur: 0 },
      { op: 'add', shape: 'extrude', id: 'disk', parent: 'parent', outline: polygon(0.005), depth: 0.01, bevel: 0, edges: false },
      { op: 'cut', id: 'disk', axis: 'z', to: 0, dur: 0 },
    ] },
    { say: 'replace', actions: [{ op: 'add', shape: 'extrude', id: 'disk', outline: polygon(1), depth: 0.5, bevel: 0, edges: false }] },
    { say: 'clear', actions: [{ op: 'clear', target: 'all' }] },
  ];
  for (const tier of tiers) {
    const scene = new PanelScene({ tier });
    try {
      const first = frameAt(steps, 0, 99), next = frameAt(steps, 1, 99), empty = frameAt(steps, 2, 99);
      scene.sync(first, 1);
      const original = scene.nodeOf(first.objects.find(o => o.id === 'disk')!.key) as Mesh;
      radialSides(original.geometry);
      const normalMatrix = new Matrix3().getNormalMatrix(original.matrixWorld);
      const pos = original.geometry.getAttribute('position'), normal = original.geometry.getAttribute('normal');
      for (let i = original.geometry.groups[1]!.start; i < pos.count; i++) {
        const expected = new Vector3(pos.getX(i), pos.getY(i), 0).normalize().applyNormalMatrix(normalMatrix);
        const actual = new Vector3().fromBufferAttribute(normal, i).applyNormalMatrix(normalMatrix);
        near(actual.dot(expected), 1);
      }
      let disposed = 0; original.geometry.addEventListener('dispose', () => disposed++);
      for (let i = 0; i < 20; i++) scene.sync(first, 1);
      assert.equal(disposed, 0);
      assert.equal((scene.nodeOf(first.objects.find(o => o.id === 'disk')!.key) as Mesh).geometry, original.geometry);
      scene.sync(next, 1); assert.equal(disposed, 1);
      const replacement = scene.nodeOf(next.objects.find(o => o.id === 'disk')!.key) as Mesh;
      radialSides(replacement.geometry);
      let replacedDisposed = 0; replacement.geometry.addEventListener('dispose', () => replacedDisposed++);
      scene.sync(empty, 1); assert.equal(replacedDisposed, 1);
      scene.destroy(); assert.equal(disposed, 1); assert.equal(replacedDisposed, 1);
    } finally { scene.destroy(); }
  }
});

test('authored comparison scene validates unchanged and keeps matching scaled surfaces', async () => {
  const { readFile } = await import('node:fs/promises');
  const { validateScene } = await import('../src/scene/index.ts');
  const source = JSON.parse(await readFile(new URL('../samples/scenes/extrusion-shading.json', import.meta.url), 'utf8'));
  const checked = validateScene(source);
  assert.equal(checked.ok, true); assert.deepEqual(checked.issues, []); assert.deepEqual(checked.scene, source);
  const frame = frameAt(checked.scene!.steps, 0, 99);
  for (const tier of tiers) {
    const panel = new PanelScene({ tier });
    try {
      panel.sync(frame, 1);
      for (const form of ['round', 'bevel', 'fin']) {
        const full = panel.nodeOf(frame.objects.find(o => o.id === `${form}-full`)!.key) as Mesh;
        const small = panel.nodeOf(frame.objects.find(o => o.id === `${form}-small`)!.key) as Mesh;
        const a = full.geometry.getAttribute('position'), b = small.geometry.getAttribute('position');
        const an = full.geometry.getAttribute('normal'), bn = small.geometry.getAttribute('normal');
        assert.equal(a.count, b.count);
        const scale = small.getWorldScale(new Vector3());
        for (let i = 0; i < a.count; i++) {
          near(a.getX(i), b.getX(i) * scale.x); near(a.getY(i), b.getY(i) * scale.y); near(a.getZ(i), b.getZ(i) * scale.z);
          near(an.getX(i), bn.getX(i), 2e-5); near(an.getY(i), bn.getY(i), 2e-5); near(an.getZ(i), bn.getZ(i), 2e-5);
        }
      }
    } finally { panel.destroy(); }
  }
});
