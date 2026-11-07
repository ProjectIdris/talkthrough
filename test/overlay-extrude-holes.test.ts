import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import type { Object3D } from 'three';
import { DETAIL, extrudeGeometry } from '../src/overlay/geometry.ts';
import type { Detail } from '../src/overlay/geometry.ts';
import { extrudeProfileIssue } from '../src/scene/extrude-profile.ts';
import type { Vec2, Step } from '../src/scene/index.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, evaluate, planStep, REPLACE_SECONDS, settle } from '../src/overlay/timeline.ts';

// This cast permits the tests to run against the old four-argument renderer, proving RED first.
const build = extrudeGeometry as (outer: readonly Vec2[], depth: number, bevel: number, detail: Detail, holes?: readonly (readonly Vec2[])[] | null) => BufferGeometry;
const outer: Vec2[] = [[-4, -3], [4, -3], [4, 3], [-4, 3]];
const holes: Vec2[][] = [[[-3, -1], [-1, -1], [-1, 1], [-3, 1]], [[1, -1], [3, -1], [3, 1], [1, 1]]];
const close = (ring: Vec2[]): Vec2[] => [...ring, [...ring[0]!] as Vec2];
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-5, `${a} vs ${b}`);

// A non-indexed or indexed triangle stream, independent of smoothing/vertex duplication.
function triangles(geo: BufferGeometry): Vector3[][] {
  const p = geo.getAttribute('position');
  const idx = geo.getIndex();
  const count = idx ? idx.count : p.count;
  assert.equal(count % 3, 0);
  const result: Vector3[][] = [];
  for (let i = 0; i < count; i += 3) result.push([0, 1, 2].map((j) => {
    const k = idx ? idx.getX(i + j) : i + j;
    return new Vector3(p.getX(k), p.getY(k), p.getZ(k));
  }));
  return result;
}
function verifyMesh(geo: BufferGeometry, capArea: number, volume: number): void {
  for (const name of ['position', 'normal']) {
    const a = geo.getAttribute(name);
    assert.ok(a, name);
    for (let i = 0; i < a.count; i++) assert.ok([a.getX(i), a.getY(i), a.getZ(i)].every(Number.isFinite), name);
  }
  const uv = geo.getAttribute('uv');
  assert.ok(uv);
  for (let i = 0; i < uv.count; i++) assert.ok(Number.isFinite(uv.getX(i)) && Number.isFinite(uv.getY(i)));
  assert.equal(uv.count, geo.getAttribute('position').count);
  assert.deepEqual(geo.groups.map((g) => g.materialIndex), [0, 1]);
  assert.equal(geo.groups[0]!.start, 0);
  assert.equal(geo.groups[1]!.start, geo.groups[0]!.count);
  assert.equal(geo.groups[1]!.start + geo.groups[1]!.count, uv.count);
  const positions = geo.getAttribute('position');
  for (let i = 0; i < geo.groups[0]!.count; i++) {
    near(uv.getX(i), positions.getX(i)); near(uv.getY(i), positions.getY(i));
  }
  const edges = new Map<string, { count: number; direction: number }>();
  let cap = 0, signedVolume = 0;
  const key = (v: Vector3) => `${v.x},${v.y},${v.z}`;
  for (const [a, b, c] of triangles(geo) as [Vector3, Vector3, Vector3][]) {
    const cross = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
    assert.ok(cross.lengthSq() > 0, 'no degenerate triangles');
    signedVolume += a.dot(new Vector3().crossVectors(b, c)) / 6;
    if (a.z === 1 && b.z === 1 && c.z === 1) cap += cross.length() / 2;
    for (const [u, v] of [[a, b], [b, c], [c, a]] as [Vector3, Vector3][]) {
      const x = key(u), y = key(v), k = x < y ? `${x}|${y}` : `${y}|${x}`;
      const edge = edges.get(k) ?? { count: 0, direction: 0 };
      edge.count++; edge.direction += x < y ? 1 : -1; edges.set(k, edge);
    }
  }
  near(cap, capArea); near(signedVolume, volume);
  for (const [key, edge] of edges) assert.deepEqual(edge, { count: 2, direction: 0 }, `welded edge ${key}`);
}
function hits(mesh: Mesh, origin: Vector3, direction: Vector3): number {
  return new Raycaster(origin, direction.normalize()).intersectObject(mesh, false).length;
}
function meshOf(root: Object3D): Mesh {
  let found: Mesh | undefined;
  root.traverse((o) => { if (o instanceof Mesh && !found) found = o; });
  assert.ok(found); return found;
}

test('perforated meshes have open caps, outward volume, and manifold walls at every detail and winding', () => {
  for (const detail of Object.values(DETAIL)) for (const reverseOuter of [false, true]) for (const reverseHoles of [false, true]) for (const closed of [false, true]) {
    const ring = (r: Vec2[], reverse: boolean) => closed ? close(reverse ? [...r].reverse() : r) : (reverse ? [...r].reverse() : r);
    const out = ring(outer, reverseOuter), hs = holes.map((h) => ring(h, reverseHoles)), snapshot = structuredClone([out, hs]);
    assert.equal(extrudeProfileIssue(out, hs), undefined);
    const geo = build(out, 2, 0.4, detail, hs);
    try {
      verifyMesh(geo, 40, 80);
      const material = new MeshBasicMaterial();
      const mesh = new Mesh(geo, material); mesh.updateMatrixWorld(true);
      assert.equal(hits(mesh, new Vector3(-2, 0, 5), new Vector3(0, 0, -1)), 0);
      assert.equal(hits(mesh, new Vector3(2, 0, 5), new Vector3(0, 0, -1)), 0);
      assert.ok(hits(mesh, new Vector3(0, 0.3, 5), new Vector3(0, 0, -1)) > 0);
      assert.ok(hits(mesh, new Vector3(-2, 0, 0), new Vector3(1, 0, 0)) > 0, 'inside opening sees its wall');
      material.dispose();
    } finally { geo.dispose(); }
    assert.deepEqual([out, hs], snapshot, 'input is not mutated');
  }
});

test('concave outer and hole rings with collinear boundary points remain a closed open solid', () => {
  const out: Vec2[] = [[-4, -3], [0, -3], [4, -3], [4, 0], [1, 0], [1, 3], [-4, 3]];
  const hs: Vec2[][] = [[[-3, -2], [-2, -2], [-1, -2], [-1, -1], [-2, -1], [-2, 1], [-3, 1]]];
  assert.equal(extrudeProfileIssue(out, hs), undefined);
  for (const detail of Object.values(DETAIL)) {
    const geo = build(out, 2, 0, detail, hs);
    try { verifyMesh(geo, 35, 70); } finally { geo.dispose(); }
  }
});

test('slanted aligned openings retain conforming cap boundaries after Float32 conversion', () => {
  // Affine image of the two-hole fixture. Determinant 0.89: area 35.6, volume 71.2.
  const shear = ([x, y]: Vec2): Vec2 => [x + 0.3 * y, 0.7 * x + 1.1 * y];
  const out = outer.map(shear), hs = holes.map((h) => h.map(shear));
  assert.equal(extrudeProfileIssue(out, hs), undefined);
  const geo = build(out, 2, 0, DETAIL.mid, hs);
  try { verifyMesh(geo, 35.6, 71.2); } finally { geo.dispose(); }
});

test('the maximum 128-point profile produces a manifold mesh with intact cap UVs and groups', () => {
  const square = (cx: number, cy: number, radius: number, divisions: number): Vec2[] => {
    const corners: Vec2[] = [[cx - radius, cy - radius], [cx + radius, cy - radius], [cx + radius, cy + radius], [cx - radius, cy + radius]];
    return corners.flatMap((a, i) => Array.from({ length: divisions }, (_, j): Vec2 => {
      const b = corners[(i + 1) % 4]!, t = j / divisions;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }));
  };
  const out = square(0, 0, 20, 8);
  const hs = [[-8, -8], [8, -8], [-8, 8], [8, 8]].map(([x, y]) => square(x!, y!, 3, 6));
  assert.equal(out.length + hs.reduce((n, h) => n + h.length, 0), 128);
  assert.equal(extrudeProfileIssue(out, hs), undefined);
  for (const detail of Object.values(DETAIL)) {
    const geo = build(out, 2, 0, detail, hs);
    try { verifyMesh(geo, 1456, 2912); } finally { geo.dispose(); }
  }
});

test('small and ordinary openings retain unit flat normals on caps and each wall', () => {
  const smallOuter: Vec2[] = [[0, 0], [0.008, 0], [0.008, 0.008], [0, 0.008]];
  const smallHole: Vec2[] = [[0.002, 0.002], [0.006, 0.003], [0.0055, 0.005], [0.0015, 0.004]];
  for (const factor of [1, 100]) for (const detail of Object.values(DETAIL)) {
    const scale = (ring: Vec2[]): Vec2[] => ring.map(([x, y]) => [x * factor, y * factor]);
    const out = scale(smallOuter), hs = [scale(smallHole)];
    assert.equal(extrudeProfileIssue(out, hs), undefined);
    const geo = build(out, 2, 0, detail, hs);
    try {
      assertFlatNormals(geo);
      const normals = geo.getAttribute('normal');
      const expected = new Vector3(-4, -1, 0).normalize();
      assert.ok(Array.from({ length: normals.count }, (_, i) => new Vector3(normals.getX(i), normals.getY(i), normals.getZ(i)).distanceTo(expected)).some((d) => d < 1e-5), 'expected slanted hole-wall normal exists');
    } finally { geo.dispose(); }
  }
});

test('cap-edge split preserves flat unit normals on aligned-hole caps and walls', () => {
  const geo = build(outer, 2, 0, DETAIL.mid, holes);
  try { assertFlatNormals(geo); } finally { geo.dispose(); }
});

function assertFlatNormals(geo: BufferGeometry): void {
  const position = geo.getAttribute('position'), normal = geo.getAttribute('normal');
  assert.equal(geo.getIndex(), null);
  assert.equal(position.count, normal.count);
  for (let i = 0; i < position.count; i += 3) {
    const p = [0, 1, 2].map((j) => new Vector3(position.getX(i + j), position.getY(i + j), position.getZ(i + j)));
    const face = new Vector3().subVectors(p[1]!, p[0]!).cross(new Vector3().subVectors(p[2]!, p[0]!)).normalize();
    assert.ok(face.lengthSq() > 0, `triangle ${i / 3} is nondegenerate`);
    for (let j = 0; j < 3; j++) {
      const n = new Vector3(normal.getX(i + j), normal.getY(i + j), normal.getZ(i + j));
      assert.ok(Math.abs(n.length() - 1) < 1e-5, `triangle ${i / 3} normal length ${n.length()}`);
      assert.ok(n.distanceTo(face) < 1e-5, `triangle ${i / 3} normal ${n.toArray()} vs face ${face.toArray()}`);
    }
  }
}

test('empty and absent holes preserve the legacy geometry including bevels', () => {
  for (const detail of Object.values(DETAIL)) for (const bevel of [0, 0.3]) {
    const legacy = extrudeGeometry(outer, 2, bevel, detail);
    const empty = [build(outer, 2, bevel, detail, []), build(outer, 2, bevel, detail, null)];
    try {
      for (const geo of empty) {
        for (const name of ['position', 'normal', 'uv']) assert.deepEqual(Array.from(geo.getAttribute(name).array), Array.from(legacy.getAttribute(name).array));
        assert.deepEqual(geo.groups, legacy.groups);
      }
    } finally { legacy.dispose(); empty.forEach((geo) => geo.dispose()); }
  }
});

const step = (...actions: unknown[]): Step => ({ say: 'x', actions }) as Step;
test('PanelScene retains openings in parent transforms and array copies, then disposes replaced meshes', () => {
  const initial = settle(planStep(emptyFrame(), step(
    { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
    { op: 'add', shape: 'group', id: 'parent', pos: [3, 2, 1], rot: [20, 30, 10] },
    { op: 'scale', id: 'parent', to: [1.5, 1.5, 1.5], dur: 0 },
    { op: 'add', shape: 'extrude', id: 'plate', parent: 'parent', outline: outer, holes, depth: 2, bevel: 0 },
    { op: 'add', shape: 'array', id: 'plates', of: 'plate', count: 3, turn: [0, 0, 120] },
  )), 2);
  const panel = new PanelScene();
  try {
    panel.sync(initial, 1); panel.scene.updateMatrixWorld(true);
    const parent = panel.nodeOf(initial.objects.find((o) => o.id === 'parent')!.key)!;
    near(parent.scale.x, 1.5); near(parent.scale.y, 1.5); near(parent.scale.z, 1.5);
    const pieces = initial.objects.filter((o) => o.shape === 'extrude');
    assert.equal(pieces.length, 3);
    for (const piece of pieces) {
      const root = panel.nodeOf(piece.key); assert.ok(root);
      const mesh = meshOf(root);
      const ray = (x: number) => hits(mesh, new Vector3(x, 0.3, 5).applyMatrix4(mesh.matrixWorld), new Vector3(0, 0, -1).transformDirection(mesh.matrixWorld));
      assert.equal(ray(-2), 0); assert.ok(ray(0) > 0);
    }
    const original = initial.objects.find((o) => o.id === 'plate')!;
    const oldRoot = panel.nodeOf(original.key)!;
    const oldGeometry = meshOf(oldRoot).geometry;
    let disposed = false; oldGeometry.addEventListener('dispose', () => { disposed = true; });
    const plan = planStep(initial, step({ op: 'add', shape: 'extrude', id: 'plate', outline: outer, holes, depth: 2 }));
    const done = evaluate(plan, REPLACE_SECONDS + 0.1); panel.sync(done, 1); panel.scene.updateMatrixWorld(true);
    assert.equal(panel.nodeOf(original.key), undefined); assert.equal(disposed, true);
    const fresh = done.objects.find((o) => o.id === 'plate')!;
    const mesh = meshOf(panel.nodeOf(fresh.key)!);
    assert.equal(hits(mesh, new Vector3(-2, 0, 5).applyMatrix4(mesh.matrixWorld), new Vector3(0, 0, -1).transformDirection(mesh.matrixWorld)), 0);
    const freshGeometry = mesh.geometry; let freshDisposed = false;
    freshGeometry.addEventListener('dispose', () => { freshDisposed = true; });
    panel.destroy(); assert.equal(freshDisposed, true);
  } finally { panel.destroy(); }
});
