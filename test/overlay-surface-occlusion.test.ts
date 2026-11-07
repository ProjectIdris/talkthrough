import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Mesh, MeshPhysicalMaterial, Vector3 } from 'three';
import { makeSurface, applySurface, TIERS } from '../src/overlay/materials.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, frameAt, planStep, settle } from '../src/overlay/timeline.ts';
import { createSceneState, validateScene } from '../src/scene/index.ts';
import type { Step } from '../src/scene/types.ts';

test('fully opaque surfaces draw before glass rather than competing in its transparent queue', () => {
  for (const tier of ['low', 'mid', 'high'] as const) {
    for (const name of ['plastic', 'metal', 'rubber', 'pcb', 'glow', 'bead', 'paper', 'tissue', 'enamel', 'cast', 'section']) {
      const surface = makeSurface(name, TIERS[tier]);
      try {
        applySurface(surface, [220, 100, 50], 1, 0, undefined);
        assert.equal(surface.transparent, false, `${tier} ${name} must write depth before translucent surfaces`);
        assert.equal(surface.depthWrite, true);
      } finally { surface.dispose(); }
    }
  }
});

test('the glass comparison sample retains matching world geometry despite different local origins', () => {
  const result = validateScene(JSON.parse(readFileSync('samples/scenes/surface-occlusion.json', 'utf8')), createSceneState());
  assert.deepEqual(result.issues, []);
  assert.ok(result.scene);
  assert.equal(result.scene.steps.length, 6);
  const frame = frameAt(result.scene.steps, 0, 99);
  const panel = new PanelScene();
  try {
    panel.sync(frame, 1);
    for (const row of [0, 1]) {
      const left = panel.nodeOf(frame.objects.find(o => o.id === `far${row}`)!.key) as Mesh;
      const right = panel.nodeOf(frame.objects.find(o => o.id === `near${row}`)!.key) as Mesh;
      assert.ok(left instanceof Mesh && right instanceof Mesh);
      assert.ok(left.position.z < 0 && right.position.z > 0);
      const a = left.geometry.getAttribute('position'), b = right.geometry.getAttribute('position');
      assert.equal(a.count, b.count);
      for (let i = 0; i < a.count; i++) {
        const av = new Vector3().fromBufferAttribute(a, i).applyMatrix4(left.matrixWorld);
        const bv = new Vector3().fromBufferAttribute(b, i).applyMatrix4(right.matrixWorld);
        av.x += 7;
        assert.ok(av.distanceTo(bv) < 1e-5, `paired vertex ${i} must differ only by the column spacing`);
      }
    }
    const spheres = ['farsphere', 'nearsphere'].map(id => panel.nodeOf(frame.objects.find(o => o.id === id)!.key) as Mesh);
    assert.equal(spheres[0]!.scale.x, 1);
    assert.equal(spheres[1]!.scale.x, 5);
    for (const sphere of spheres) {
      sphere.geometry.computeBoundingSphere();
      assert.ok(Math.abs(sphere.geometry.boundingSphere!.radius * sphere.scale.x - 0.7) < 1e-6);
    }
  } finally { panel.destroy(); }
});

test('fades switch the surface shader and depth policy only when crossing full opacity', () => {
  const surface = makeSurface('plastic', TIERS.mid);
  try {
    applySurface(surface, [255, 100, 50], 1, 0, undefined);
    const solidVersion = surface.version;
    applySurface(surface, [20, 180, 70], 1, 1, undefined);
    assert.equal(surface.version, solidVersion, 'tint and pulse do not invalidate a stable shader');
    for (const alpha of [0.9999, 0.999, 0.5, 0, 0.75]) {
      applySurface(surface, [20, 180, 70], alpha, 0, undefined);
      assert.equal(surface.transparent, true, `alpha ${alpha} retains blending`);
      assert.equal(surface.depthWrite, false, `alpha ${alpha} does not occlude later translucent surfaces`);
      assert.equal(surface.opacity, alpha);
      assert.equal(surface.version, solidVersion + 1, 'one invalidation on entering the translucent shader');
    }
    applySurface(surface, [20, 180, 70], 1, 0, undefined);
    assert.equal(surface.transparent, false);
    assert.equal(surface.depthWrite, true);
    assert.equal(surface.version, solidVersion + 2, 'the opaque shader is selected again');
  } finally { surface.dispose(); }
});

test('glass keeps its recipe opacity and blending throughout fades and return', () => {
  const surface = makeSurface('glass', TIERS.high);
  try {
    for (const alpha of [1, 0.4, 0, 0.9999, 1]) {
      applySurface(surface, [80, 150, 220], alpha, 0, undefined);
      assert.equal(surface.opacity, alpha * 0.34);
      assert.equal(surface.transparent, true);
      assert.equal(surface.depthWrite, false);
    }
  } finally { surface.dispose(); }
});

test('connector and attached-path endpoint fades retain blending and restore solid depth', () => {
  const actions = [
    { op: 'add', shape: 'box', id: 'left', size: [1, 1, 1], pos: [-2, 0, 0] },
    { op: 'add', shape: 'box', id: 'right', size: [1, 1, 1], pos: [2, 0, 0] },
    { op: 'add', shape: 'connector', id: 'link', from: 'left', to: 'right', kind: 'straight', radius: 0.1 },
    { op: 'add', shape: 'tube', id: 'tube', pts: [[-2, 0, 0], [2, 0, 0]], radius: 0.1,
      attach: [{ to: 'left', at: [0, 0, 0] }, { to: 'right', at: [0, 0, 0] }] },
  ];
  const frame = settle(planStep(emptyFrame(), { say: '', actions } as Step));
  const panel = new PanelScene();
  const surfaces = (id: string) => {
    const out: MeshPhysicalMaterial[] = [];
    panel.nodeOf(frame.objects.find(o => o.id === id)!.key)!.traverse(o => {
      if (o instanceof Mesh && o.material instanceof MeshPhysicalMaterial) out.push(o.material);
    });
    assert.ok(out.length);
    return out;
  };
  try {
    for (const held of [1, 0.5, 0.9999, 0.25, 1]) {
      panel.sync({ ...frame, objects: frame.objects.map(o => o.id === 'left' ? { ...o, appear: held } : o) }, 1);
      for (const id of ['link', 'tube']) for (const m of surfaces(id)) {
        assert.equal(m.opacity, held, id);
        assert.equal(m.transparent, held < 1, id);
        assert.equal(m.depthWrite, held === 1, id);
      }
    }
    const heldFrame = { ...frame, objects: frame.objects.map(o => o.id === 'left' ? { ...o, appear: 0.5 } : o) };
    panel.sync(heldFrame, 1);
    const heldSurfaces = [...surfaces('link'), ...surfaces('tube')];
    const versions = heldSurfaces.map(m => m.version);
    for (let repeat = 0; repeat < 5; repeat++) {
      panel.sync(heldFrame, 1);
      assert.deepEqual(heldSurfaces.map(m => m.version), versions, 'unchanged effective endpoint opacity does not invalidate shaders');
    }
  } finally { panel.destroy(); }
});
