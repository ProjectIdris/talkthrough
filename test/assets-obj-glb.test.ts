import assert from 'node:assert/strict';
import test from 'node:test';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Mesh } from 'three';
// @ts-expect-error a plain script module
import { bounds, isClosed, merge, normals, orientation, parseObj, transformPositions, weld, writeGlb } from '../scripts/assets/obj-glb.mjs';

// A tetrahedron: four vertices, four faces, closed.
const TETRA = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nv 0 0 1\nf 1 3 2\nf 1 2 4\nf 1 4 3\nf 2 3 4\n';

test('an OBJ is read for its vertices and faces: quads become triangles, slashes and negative indices are understood, a bad face is refused', () => {
  const m = parseObj('# a comment\nv 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvn 0 0 1\nf 1//1 2//1 3//1 4//1\nf -4 -3 -2\n');
  assert.deepEqual([...m.indices], [0, 1, 2, 0, 2, 3, 0, 1, 2]);
  assert.equal(m.positions.length, 12);
  assert.throws(() => parseObj('v 0 0 0\nf 1 2 3\n'), /vertex 2/);
  assert.throws(() => parseObj('v 0 x 0\n'), /bad vertex/);
});

test('the atlas axes become the scene axes by a rotation: head up, front toward the viewer, the left of the body on the viewer\'s right', () => {
  const rows = orientation('z+', 'y-');
  // atlas: x toward the person's left, y toward their back, z toward their head; millimetres
  const out = transformPositions(Float32Array.from([10, 0, 0, 0, 0, 20, 0, -30, 0]), rows, 0.001);
  assert.deepEqual([...out].map((v) => Math.round(v * 1e6) / 1e6), [0.01, 0, 0, 0, 0.02, 0, 0, 0, 0.03]);
  // left stays left: the three rows are a rotation (determinant +1), never a mirror
  const [r, u, f] = [rows.right, rows.up, rows.front];
  const det = r[0] * (u[1] * f[2] - u[2] * f[1]) - r[1] * (u[0] * f[2] - u[2] * f[0]) + r[2] * (u[0] * f[1] - u[1] * f[0]);
  assert.equal(det, 1);
  assert.throws(() => orientation('z+', 'z-'), /different axes/);
});

test('welding joins repeated vertices and drops degenerate faces; closedness is whether every edge has two faces', () => {
  const doubled = weld(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0]), [0, 1, 2, 3, 4, 5]);
  assert.equal(doubled.positions.length, 9);
  assert.deepEqual(doubled.indices, [0, 1, 2, 0, 1, 2]);
  const sliver = weld(Float32Array.from([0, 0, 0, 1, 0, 0, 1, 0, 0]), [0, 1, 2]);
  assert.deepEqual(sliver.indices, []);
  const m = parseObj(TETRA);
  assert.equal(isClosed(m.indices), true);
  assert.equal(isClosed(m.indices.slice(0, 9)), false);
  assert.equal(isClosed([]), false);
  const n = normals(m.positions, m.indices);
  for (let i = 0; i < n.length; i += 3) assert.ok(Math.abs(Math.hypot(n[i]!, n[i + 1]!, n[i + 2]!) - 1) < 1e-5);
});

test('a GLB of named parts loads in three\'s own loader with the parts as named nodes at their centres, each carrying its extras', async () => {
  const a = parseObj(TETRA);
  const shifted = { positions: Float32Array.from(a.positions as Float32Array, (v: number, i: number) => v + (i % 3 === 0 ? 5 : 0)), indices: a.indices };
  const glb = writeGlb('thing', [
    { key: 'first', positions: a.positions, indices: a.indices, files: ['FJ1'], confidence: 'atlas', color: [255, 0, 0] },
    { key: 'second', positions: shifted.positions, indices: shifted.indices, files: ['FJ2', 'FJ3'], confidence: 'grouped' },
  ]);
  assert.equal(glb.length % 4, 0);
  const gltf = await new Promise<{ scene: import('three').Group }>((ok, bad) => new GLTFLoader().parse(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, '', ok as never, bad));
  const root = gltf.scene.getObjectByName('thing')!;
  assert.deepEqual(root.children.map((c) => c.name), ['first', 'second']);
  const second = root.getObjectByName('second') as Mesh;
  const b = bounds(shifted.positions);
  assert.ok(Math.abs(second.position.x - b.center[0]) < 1e-5 && Math.abs(second.position.y - b.center[1]) < 1e-5);
  assert.deepEqual(second.userData.files, ['FJ2', 'FJ3']);
  assert.equal(second.userData.confidence, 'grouped');
  // the geometry is centred on itself
  second.geometry.computeBoundingBox();
  const c = second.geometry.boundingBox!.getCenter(new (second.position.constructor as new () => import('three').Vector3)());
  assert.ok(c.length() < 1e-5);
  // deterministic: the same inputs give the same bytes
  assert.ok(glb.equals(writeGlb('thing', [
    { key: 'first', positions: a.positions, indices: a.indices, files: ['FJ1'], confidence: 'atlas', color: [255, 0, 0] },
    { key: 'second', positions: shifted.positions, indices: shifted.indices, files: ['FJ2', 'FJ3'], confidence: 'grouped' },
  ])));
  assert.equal(merge([a, a]).indices.length, 24);
});
