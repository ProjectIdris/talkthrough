import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { buildPart } from '../src/overlay/parts.ts';
import { DETAIL } from '../src/overlay/geometry.ts';
import type { AddPart, Vec3 } from '../src/scene/types.ts';

const variants = ['usb', 'usb3', 'ethernet', 'hdmi', 'usbc'] as const;
const make = (variant: string = 'usb3', tier: keyof typeof DETAIL = 'high', size: Vec3 = [5, 2.6, 2.4]) => {
  const built = buildPart({ op: 'add', shape: 'part', part: 'port', id: 'p', variant, size } as AddPart, DETAIL[tier]);
  for (const piece of built.pieces) piece.object.material = new MeshBasicMaterial();
  built.root.updateMatrixWorld(true);
  return built;
};
const frontHit = (built: ReturnType<typeof make>, x: number, y: number) =>
  new Raycaster(new Vector3(x, y, 10), new Vector3(0, 0, -1)).intersectObject(built.root, true)[0];

test('port sockets have real recesses behind their +z metal lips, for all variants and tiers', () => {
  for (const tier of ['low', 'mid', 'high'] as const) for (const variant of variants) {
    const built = make(variant, tier);
    const hit = frontHit(built, 0, 2.6 * .25);
    assert.ok(hit, `${variant} has a back to its cavity`);
    assert.ok(hit.point.z < -.5, `${variant}/${tier} cavity must extend into the body, got ${hit.point.z}`);
    const lip = frontHit(built, 0, 2.6 * .46);
    assert.ok(lip && lip.point.z > 1, `${variant}/${tier} has a front metal lip`);
  }
});

test('USB-C and HDMI use recognisable silhouettes instead of a rectangular metal block', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    assert.equal(frontHit(make('usbc', tier), 2.35, 1.1), undefined, 'USB-C has rounded ends');
    assert.equal(frontHit(make('hdmi', tier), 2.35, -1.1), undefined, 'HDMI lower corners taper');
    assert.ok(frontHit(make('usb', tier), 2.35, -1.1), 'USB-A keeps its rectangular outline');
  }
});

// Count physically disjoint contact solids, independent of their draw batching.
function componentCount(geometry: import('three').BufferGeometry): number {
  const p = geometry.getAttribute('position'), parents = new Map<string, string>();
  const key = (i: number) => [p.getX(i), p.getY(i), p.getZ(i)].map(x => Math.round(x * 1e6)).join(',');
  const find = (key: string): string => {
    if (!parents.has(key)) parents.set(key, key);
    const parent = parents.get(key)!;
    if (parent !== key) parents.set(key, find(parent));
    return parents.get(key)!;
  };
  for (let i = 0; i < (geometry.index?.count ?? p.count); i += 3) {
    const points = [0, 1, 2].map(j => key(geometry.index ? geometry.index.getX(i + j) : i + j));
    for (const point of points) parents.set(find(point), find(points[0]!));
  }
  return new Set([...parents.keys()].map(find)).size;
}

test('ports have inset physical contacts and tongues rather than face-painted strips', () => {
  const counts = { usb: 4, usb3: 9, ethernet: 8, hdmi: 19, usbc: 24 };
  for (const variant of variants) {
    const built = make(variant);
    const contacts = built.pieces.filter(p => p.surface === 'metal' && !p.tint);
    assert.equal(contacts.reduce((n, p) => n + componentCount(p.object.geometry), 0), counts[variant], `${variant} physical contact count`);
    for (const p of contacts) {
      const box = new Box3().setFromObject(p.object);
      assert.ok(box.max.z < 1 && box.min.z > -1.2, 'contacts sit inside the socket');
      assert.ok(box.getSize(new Vector3()).z > .2, 'contact has depth');
    }
    const tongue = built.pieces.find(p => p.surface === 'plastic');
    assert.ok(tongue, 'inset insulator');
    assert.ok(new Box3().setFromObject(tongue.object).max.z < 1, 'tongue recessed behind lip');
  }
});

test('a port cavity has a continuous recessed back, including beside the tongue', () => {
  for (const variant of variants) for (const tier of ['low', 'mid', 'high'] as const) {
    const built = make(variant, tier);
    const hit = frontHit(built, 5 * .38, 0);
    assert.ok(hit && hit.point.z < -.5, `${variant}/${tier} back closes the socket edges`);
  }
});

test('port meshes are closed with finite normals and outward drawable faces at every tier', () => {
  for (const tier of ['low', 'mid', 'high'] as const) for (const variant of variants) {
    const built = make(variant, tier);
    for (const [pieceIndex, piece] of built.pieces.entries()) {
      const geo = piece.object.geometry, p = geo.getAttribute('position'), normals = geo.getAttribute('normal');
      const edges = new Map<string, number>(), direction = new Map<string, number>();
      const key = (v: Vector3) => v.toArray().map(x => Math.round(x * 1e6)).join(',');
      let volume = 0;
      for (let i = 0; i < (geo.index?.count ?? p.count); i += 3) {
        const ix = [0, 1, 2].map(k => geo.index ? geo.index.getX(i + k) : i + k);
        const points = ix.map(j => new Vector3().fromBufferAttribute(p, j));
        const [a, b, c] = points as [Vector3, Vector3, Vector3];
        const cross = b.clone().sub(a).cross(c.clone().sub(a));
        assert.ok(cross.length() > 1e-12, `${variant}/${tier}/${pieceIndex} drawable triangle`);
        volume += a.dot(b.clone().cross(c)) / 6;
        for (const j of ix) {
          const normal = new Vector3().fromBufferAttribute(normals, j);
          assert.ok(normal.toArray().every(Number.isFinite));
          assert.ok(Math.abs(normal.length() - 1) < 1e-5, 'unit normal');
          assert.ok(cross.dot(normal) > 0, 'normal faces out of its drawable triangle');
        }
        for (let k = 0; k < 3; k++) {
          const from = key(points[k]!), to = key(points[(k + 1) % 3]!);
          const edge = [from, to].sort().join('/');
          edges.set(edge, (edges.get(edge) ?? 0) + 1);
          direction.set(edge, (direction.get(edge) ?? 0) + (from < to ? 1 : -1));
        }
      }
      assert.ok(volume > 0, 'outward volume');
      for (const [edge, count] of edges) {
        assert.equal(count, 2, `${variant}/${tier}/${pieceIndex} closed edge ${edge}`);
        assert.equal(direction.get(edge), 0, 'opposite edge directions');
      }
      assert.notEqual(piece.closed, false, 'closed pieces support cutaways');
    }
  }
});

test('port dimensions fit their centred box and do not affect mesh generation cost', () => {
  for (const tier of ['low', 'mid', 'high'] as const) for (const variant of variants) {
    const ordinary = make(variant, tier);
    for (const size of [[.01, .01, .01], [100, .01, 100], [.01, 100, .01], [5, 2.6, .01]] as Vec3[]) {
      const other = make(variant, tier, size), box = new Box3().setFromObject(other.root);
      assert.equal(other.pieces.length, ordinary.pieces.length);
      const extent = box.getSize(new Vector3()).toArray(), centre = box.getCenter(new Vector3()).toArray();
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(Math.abs(extent[axis]! - size[axis]!) < size[axis]! * 1e-5);
        assert.ok(Math.abs(centre[axis]!) < size[axis]! * 1e-5);
      }
      for (let i = 0; i < ordinary.pieces.length; i++) for (const attribute of ['position', 'normal']) {
        assert.deepEqual(other.pieces[i]!.object.geometry.getAttribute(attribute).array,
          ordinary.pieces[i]!.object.geometry.getAttribute(attribute).array, 'unit buffers do not depend on authored size');
      }
    }
  }
});

import { BufferGeometry, Mesh } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';

test('real PanelScene preserves port recesses through transforms and copies and releases replacement pieces', () => {
  const scene = new PanelScene();
  const first = { say: 'Socket', actions: [
    { op: 'add', shape: 'part', part: 'port', id: 'p', variant: 'usb3', size: [5, 2.6, 2.4], color: '#ee6644', pos: [1, 2, 3], rot: [15, 35, -12] },
    { op: 'scale', id: 'p', to: [1.2, .8, 1.1] },
    { op: 'add', shape: 'array', id: 'copies', of: 'p', count: 2, step: [7, 0, 0] },
  ] };
  scene.sync(frameAt([first] as never, 0, 99), 1);
  type Node = { obj: Mesh; geometries: BufferGeometry[]; pieces: { object: Mesh; tint: boolean; surface: { color: { getHexString(): string } }; closed: boolean }[] };
  const nodes = (scene as unknown as { nodes: Map<number, Node> }).nodes;
  const ports = [...nodes.values()].filter(n => n.pieces.length === 4);
  assert.equal(ports.length, 2, 'array count includes original');
  for (const node of ports) {
    node.obj.updateMatrixWorld(true);
    const local = new Vector3(0, .65, 10), target = new Vector3(0, .65, -1.008);
    const origin = node.obj.localToWorld(local), end = node.obj.localToWorld(target);
    const hit = new Raycaster(origin, end.clone().sub(origin).normalize()).intersectObject(node.obj, true)[0];
    assert.ok(hit && hit.point.distanceTo(end) < 1e-5, 'ray reaches transformed back wall');
    assert.ok(node.pieces.some(p => p.tint && p.surface.color.getHexString() === 'ee6644'));
    assert.ok(node.pieces.some(p => !p.tint && p.surface.color.getHexString() === '2c70e8'), 'USB3 blue stays fixed');
    assert.ok(node.pieces.every(p => p.closed));
  }
  const old = [...new Set([...nodes.values()].flatMap(n => n.geometries))];
  const disposed = new Map(old.map(g => [g, 0]));
  for (const g of old) g.addEventListener('dispose', () => disposed.set(g, disposed.get(g)! + 1));
  const second = { say: 'Replace', actions: [{ op: 'add', shape: 'part', part: 'port', id: 'p', variant: 'usbc', size: [4, 1.5, 2] }] };
  scene.sync(frameAt([first, second] as never, 1, 99), 2);
  assert.ok([...nodes.values()].some(n => n.pieces.some(p => !p.tint && componentCount(p.object.geometry) === 24)), 'replacement has its own USB-C contacts');
  scene.destroy();
  for (const count of disposed.values()) assert.equal(count, 1, 'owned geometry released once');
});

import { readFileSync } from 'node:fs';
import { validateScene } from '../src/scene/index.ts';

test('connector study validates unchanged and builds all five variants through every view', () => {
  const raw = JSON.parse(readFileSync(new URL('../samples/scenes/connector-sockets.json', import.meta.url), 'utf8'));
  const result = validateScene(raw);
  assert.equal(result.issues.length, 0);
  assert.deepEqual(result.scene, raw);
  const scene = new PanelScene();
  for (let i = 0; i < raw.steps.length; i++) {
    scene.sync(frameAt(raw.steps, i, 99), 1000 + i);
    assert.equal(scene.count(), 5);
  }
  scene.destroy();
});

test('dense port contacts use bounded geometry rather than full-tier rounded boxes', () => {
  for (const tier of ['low', 'mid', 'high'] as const) for (const variant of variants) {
    const built = make(variant, tier);
    const contacts = built.pieces.filter(p => p.surface === 'metal' && !p.tint);
    assert.equal(contacts.length, 1, 'contacts share one draw mesh');
    const geo = contacts[0]!.object.geometry;
    assert.ok((geo.index?.count ?? geo.getAttribute('position').count) / 3 <= 108 * componentCount(geo), 'a tiny contact needs at most 108 triangles');
    const triangles = built.pieces.reduce((sum, p) => sum + (p.object.geometry.index?.count ?? p.object.geometry.getAttribute('position').count) / 3, 0);
    assert.ok(triangles <= 6000, `${variant}/${tier} must stay below 6k triangles, got ${triangles}`);
  }
});

test('batched contacts keep closed cutaway helpers and replacement disposes the old geometry', () => {
  for (const variant of variants) {
    const scene = new PanelScene();
    const def: AddPart = { op: 'add', shape: 'part', part: 'port', id: 'p', variant, size: [5, 2.6, 2.4] };
    const steps = [{ say: 'Cut', actions: [def, { op: 'cut', id: 'p', axis: 'z', to: 0, dur: 0 }] }];
    const frame = frameAt(steps as never, 0, 99);
    scene.sync(frame, 1);
    const nodes = (scene as unknown as { nodes: Map<number, { geometries: BufferGeometry[]; pieces: unknown[] }> }).nodes;
    const old = [...nodes.values()].find(n => n.pieces.length > 0)!;
    const caps = scene.scene.children.filter(c => c.visible && (c as Mesh).isMesh && ((c as Mesh).material as { stencilWrite?: boolean }).stencilWrite);
    assert.equal(caps.length, old.pieces.length, 'one cap per closed draw mesh, including batched contacts');
    const disposed = new Map(old.geometries.map(g => [g, 0]));
    for (const g of old.geometries) g.addEventListener('dispose', () => disposed.set(g, disposed.get(g)! + 1));
    scene.sync(frameAt([...steps, { say: 'Replace', actions: [{ ...def, variant: variant === 'usbc' ? 'usb' : 'usbc' }] }] as never, 1, 99), 2);
    for (const count of disposed.values()) assert.equal(count, 1, 'old geometry released once during replacement');
    for (const cap of caps) assert.equal(cap.parent, null, 'old cut cap detached');
    scene.destroy();
    for (const count of disposed.values()) assert.equal(count, 1, 'no second disposal at destroy');
  }
});
