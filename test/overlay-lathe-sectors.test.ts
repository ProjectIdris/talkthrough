import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Mesh, Raycaster, Vector3 } from 'three';
import type { Step } from '../src/scene/types.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { latheSectorGeometry } from '../src/overlay/lathe-sector.ts';
import { latheGeometry } from '../src/overlay/geometry.ts';
import type { Vec2 } from '../src/scene/types.ts';
import { emptyFrame, planStep, settle } from '../src/overlay/timeline.ts';

const profile = [[1, -1], [2, -1], [2, 1], [1, 1]];
function shown(sweep?: number) {
  const frame = settle(planStep(emptyFrame(), { say: '', actions: [{ op: 'add', shape: 'lathe', id: 'sector', profile, sweep, edges: false }] } as Step));
  const panel = new PanelScene();
  panel.sync(frame, 1);
  const mesh = panel.nodeOf(frame.objects[0]!.key) as Mesh;
  mesh.updateWorldMatrix(true, true);
  return { panel, frame, mesh };
}

test('a 90-degree lathe sector leaves the unauthored quadrants empty', () => {
  const { panel, mesh } = shown(90);
  try {
    const ray = new Raycaster(new Vector3(-4, 0, 0.7), new Vector3(1, 0, 0));
    const hits = ray.intersectObject(mesh, false);
    assert.ok(hits.length > 0, 'sector still has its positive-x wall');
    assert.ok(hits.every(h => h.point.x >= -1e-6), 'the negative-x wall of a full revolution must be absent');
  } finally { panel.destroy(); }
});

test('radial ends of a lathe sector are actual closed faces', () => {
  const { panel, mesh } = shown(90);
  try {
    const hits = new Raycaster(new Vector3(-3, 0, 1.5), new Vector3(1, 0, 0)).intersectObject(mesh, false);
    assert.ok(hits.some(h => Math.abs(h.point.x) < 1e-7), 'the start face fills the profile at x=0');
  } finally { panel.destroy(); }
});


function inspect(geo: BufferGeometry): number {
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
  assert.ok(p.count > 0, 'geometry is nonempty');
  assert.equal(p.count % 3, 0);
  assert.equal(n.count, p.count);
  const edges = new Map<string, { count: number; balance: number }>();
  const key = (v: Vector3) => [v.x || 0, v.y || 0, v.z || 0].join(',');
  const points = [new Vector3(), new Vector3(), new Vector3()];
  const face = new Vector3(), edge = new Vector3(), tmp = new Vector3();
  const originY = p.getY(0);
  let volume = 0;
  for (let i = 0; i < p.count; i += 3) {
    for (let j = 0; j < 3; j++) points[j]!.fromBufferAttribute(p, i + j);
    const [a, b, c] = points as [Vector3, Vector3, Vector3];
    face.crossVectors(edge.subVectors(b, a), tmp.subVectors(c, a));
    assert.ok(face.lengthSq() > 0, 'no zero-area triangles');
    face.normalize();
    for (let j = 0; j < 3; j++) {
      const normal = tmp.fromBufferAttribute(n, i + j);
      assert.ok(Number.isFinite(normal.lengthSq()) && Math.abs(normal.length() - 1) < 1e-6, 'unit finite normals');
      assert.ok(normal.dot(face) > 0, 'shading points to visible side');
      const from = key(points[j]!), to = key(points[(j + 1) % 3]!);
      const forward = from < to;
      const id = forward ? from + '/' + to : to + '/' + from;
      const e = edges.get(id) ?? { count: 0, balance: 0 };
      e.count++; e.balance += forward ? 1 : -1; edges.set(id, e);
    }
    // Shift y to keep the diagnostic stable for tiny sections high on the axis.
    const ay = a.y - originY, by = b.y - originY, cy = c.y - originY;
    volume += (a.x * (by * c.z - b.z * cy) + ay * (b.z * c.x - b.x * c.z) + a.z * (b.x * cy - by * c.x)) / 6;
  }
  for (const [id, e] of edges) {
    assert.equal(e.count, 2, 'closed surface edge ' + id);
    assert.equal(e.balance, 0, 'opposite edge winding ' + id);
  }
  assert.ok(volume > 0, 'outward winding encloses positive volume');
  return volume;
}

const profiles: Vec2[][] = [
  [[1,-1],[2,-1],[2,1],[1,1]],
  [[0,-1],[2,-1],[0,1]],
  [[1,-1],[2,-1],[2,-0.6],[1.5,-0.6],[1.5,0.6],[2,0.6],[2,1],[1,1]],
  Array.from({length: 20}, (_,i) => [2+0.5*Math.cos(i*Math.PI/10), 0.5*Math.sin(i*Math.PI/10)]),
  [[0.001,0.002],[0.003,0.002],[0.003,0.004],[0.001,0.004]],
  [[1,50],[2,50],[2,50.01],[1,50.01]],
];

test('sectors are closed, consistently wound and finite across concave, axis and compact profiles', () => {
  for (const outline of profiles) for (const sides of [3,8,20,36,64]) for (const sweep of [1,89,90,179,180,270,359]) {
    for (const reversed of [false,true]) {
      const geo = latheSectorGeometry(reversed ? [...outline].reverse() : outline, sides, sweep);
      try { inspect(geo); }
      catch (error) { throw new Error(JSON.stringify({outline,sides,sweep,reversed}), { cause: error }); }
      finally { geo.dispose(); }
    }
  }
});

test('sector volume matches its authored annulus and proportional angular tessellation', () => {
  for (const sides of [3,8,20,36,64]) for (const sweep of [1,90,180,270,359]) {
    const geo = latheSectorGeometry(profiles[0]!, sides, sweep);
    try {
      const segments = Math.max(Math.ceil(sweep/90), Math.ceil(sides*sweep/360));
      const expected = 3 * segments * Math.sin(sweep*Math.PI/180/segments);
      assert.ok(Math.abs(inspect(geo)-expected) / expected < 2e-6);
      assert.equal(geo.getAttribute('position').count, (segments*8+4)*3);
    } finally { geo.dispose(); }
  }
});

test('sector end caps stay flat and hard against smooth radial walls', () => {
  const geo = latheSectorGeometry(profiles[0]!, 64, 270);
  try {
    const p = geo.getAttribute('position'), n = geo.getAttribute('normal');
    const normalsAt = (v: number[]) => Array.from({length:p.count}, (_,i)=>i).filter(i => Math.hypot(p.getX(i)-v[0]!,p.getY(i)-v[1]!,p.getZ(i)-v[2]!)<1e-7).map(i => [n.getX(i),n.getY(i),n.getZ(i)]);
    const seam = normalsAt([0,-1,2]);
    assert.ok(seam.some(n=>n[0]===-1 && n[1]===0 && n[2]===0), 'start cap');
    assert.ok(seam.some(n=>n[1]===-1), 'bottom');
    assert.ok(seam.some(n=>n[2]===1), 'round outer wall');
  } finally { geo.dispose(); }
});

test('full lathes retain their exact old geometry when sweep is absent', () => {
  const {panel,mesh} = shown();
  const reference = latheGeometry(profile as Vec2[],36);
  try {
    for (const name of ['position','normal','uv']) assert.deepEqual(mesh.geometry.getAttribute(name).array, reference.getAttribute(name).array);
    assert.deepEqual(mesh.geometry.index?.array, reference.index?.array);
  } finally { reference.dispose(); panel.destroy(); }
});

test('invalid direct sector builder inputs return safely empty finite geometry', () => {
  for (const sweep of [NaN,Infinity,0,360]) {
    const g=latheSectorGeometry(profiles[0]!,32,sweep);
    assert.equal(g.getAttribute('position').count,0); g.dispose();
  }
  const invalid: Vec2[][] = [[[0,0],[1,1],[0,1],[1,0]],[[1,0],[1,0],[2,2]], [[-1,0],[1,0],[0,1]]];
  for(const p of invalid) { const g=latheSectorGeometry(p,32,90); assert.equal(g.getAttribute('position').count,0);g.dispose(); }
});

test('compact sectors retain the same crease outlines as ordinary-size sectors', () => {
  const linesAt = (scale: number): number => {
    const frame=settle(planStep(emptyFrame(), {say:'',actions:[{op:'add',shape:'lathe',id:'ring',profile:profiles[0]!.map(([r,y])=>[r*scale,y*scale]),sweep:90}]} as Step));
    const panel=new PanelScene(); panel.sync(frame,1);
    try {
      const mesh=panel.nodeOf(frame.objects[0]!.key) as Mesh;
      const lines=mesh.children.find(x=>x.type==='LineSegments') as Mesh;
      assert.ok(lines);
      return lines.geometry.getAttribute('position').count;
    } finally {panel.destroy();}
  };
  assert.equal(linesAt(0.0001),linesAt(1));
});

test('sectors keep transforms, cut caps, copies and independent disposal through replacement', () => {
  const first = settle(planStep(emptyFrame(), { say: '', actions: [
    { op: 'add', shape: 'group', id: 'parent', pos: [3,2,1], rot: [15,20,35] },
    { op: 'scale', id: 'parent', to: [2,0.7,1.3], dur: 0 },
    { op: 'add', shape: 'lathe', id: 'ring', parent: 'parent', profile: profiles[2], sweep: 220, color: 'teal' },
    { op: 'add', shape: 'array', id: 'copies', of: 'ring', count: 2, step: [4,0,0] },
    { op: 'cut', id: 'ring', axis: 'y', to: 0, dur: 0 },
  ] } as Step));
  const panel = new PanelScene();
  panel.sync(first, 1);
  const node = (frame: typeof first, id: string) => panel.nodeOf(frame.objects.find(o => o.id === id)!.key) as Mesh;
  const mesh = node(first, 'ring');
  const geometry = mesh.geometry;
  let disposed = 0; geometry.addEventListener('dispose', () => disposed++);
  assert.ok(mesh.parent === node(first, 'copies'));
  assert.ok(mesh.parent?.parent === node(first, 'parent'));
  assert.deepEqual(mesh.getWorldPosition(new Vector3()).toArray(), [3,2,1]);
  assert.ok(geometry.getAttribute('position').count > 0);
  const caps = () => panel.scene.children.filter(o => o.visible && o instanceof Mesh && !Array.isArray(o.material) && o.material.stencilWrite);
  assert.ok(caps().length > 0, 'closed sectors are capped by the normal cutaway pipeline');
  const held = geometry.getAttribute('position').array.slice();
  panel.sync(first, 1);
  assert.ok(mesh.geometry === geometry, 'ordinary sync reuses sector geometry');
  assert.equal(disposed, 0);
  const replacement = settle(planStep(first, { say: '', actions: [
    { op: 'add', shape: 'lathe', id: 'ring', parent: 'parent', profile: profiles[0], sweep: 90, color: 'red' },
  ] } as Step));
  panel.sync(replacement, 1);
  assert.equal(disposed, 1, 'old owned geometry disposed exactly once');
  assert.notEqual(node(replacement,'ring').geometry, geometry);
  assert.deepEqual(geometry.getAttribute('position').array, held, 'cutting and copying never mutate vertex buffers');
  const current = node(replacement, 'ring').geometry;
  let replacementDisposed = 0; current.addEventListener('dispose', () => replacementDisposed++);
  const cleared = settle(planStep(replacement, { say: '', actions: [{op:'clear',target:'all'}] } as Step));
  panel.sync(cleared,1);
  assert.equal(panel.count(), 0);
  assert.equal(caps().length, 0);
  assert.equal(replacementDisposed, 1);
  panel.destroy();
  assert.equal(disposed, 1); assert.equal(replacementDisposed,1);
});

test('the original three-form sector sample validates and builds at every detail tier', async () => {
  const { readFileSync } = await import('node:fs');
  const { validateScene } = await import('../src/scene/index.ts');
  const raw = JSON.parse(readFileSync(new URL('../samples/scenes/rotational-sectors.json', import.meta.url), 'utf8'));
  const result = validateScene(raw);
  assert.ok(result.scene); assert.deepEqual(result.issues, []);
  for (const tier of ['low','mid','high'] as const) {
    const panel = new PanelScene({tier}); let frame=emptyFrame();
    try {
      for (const step of result.scene.steps) {
        frame=settle(planStep(frame,step)); panel.sync(frame,1.5);
        for (const object of frame.objects) if(object.def.shape==='lathe') {
          const mesh=panel.nodeOf(object.key) as Mesh; inspect(mesh.geometry);
        }
      }
    } finally { panel.destroy(); }
  }
});
