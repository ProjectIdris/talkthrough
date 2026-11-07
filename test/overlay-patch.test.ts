import { variantDefinitions } from './support/json-schema.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DoubleSide, LineSegments, Mesh, Vector3 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial, Object3D } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt, emptyFrame } from '../src/overlay/timeline.ts';
import { createSceneState, createDetailState, sceneSchema, sceneSchemaLean, sceneGuide, validateScene } from '../src/scene/index.ts';
import type { Scene, Step, Vec3 } from '../src/scene/types.ts';

const controls = (z: (u: number, v: number) => number = () => 0): Vec3[] =>
  Array.from({ length: 16 }, (_, n) => { const u = n % 4 / 3, v = Math.floor(n / 4) / 3; return [3 * u - 1.5, 3 * v - 1.5, z(u, v)]; });
const saddle = () => controls((u, v) => 1.2 * (2 * u - 1) * (2 * v - 1));
const patch = (more: Record<string, unknown> = {}) => ({ op: 'add', shape: 'patch', id: 'sheet', pts: saddle(), ...more });
const box = { op: 'add', shape: 'box', id: 'sheet', size: [1,1,1] };
function validate(actions: unknown[], state = createSceneState()): Scene {
  const r = validateScene({ steps: [{ say: 'Curved sheets.', actions }] }, state);
  assert.deepEqual(r.issues, []);
  assert.ok(r.scene);
  return r.scene;
}
function meshOf(o: Object3D | undefined): Mesh {
  let found: Mesh | undefined;
  o?.traverse((c) => { if (!found && c instanceof Mesh) found = c; });
  assert.ok(found, 'a patch reaches the actual scene as a mesh');
  return found;
}
function build(action: unknown, tier: 'low' | 'mid' | 'high' = 'high') {
  const s = validate([action]);
  const f = frameAt(s.steps, 0, 99);
  const panel = new PanelScene({ tier });
  panel.sync(f, 1);
  return { panel, f, mesh: meshOf(panel.nodeOf(f.objects[0]!.key)) };
}
function close(actual: number, expected: number, tol = 2e-6) { assert.ok(Math.abs(actual - expected) < tol, `${actual} ≈ ${expected}`); }
function winding(g: BufferGeometry) {
  const p = g.getAttribute('position'), n = g.getAttribute('normal'), ix = g.getIndex()!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), normal = new Vector3();
  for (let i = 0; i < ix.count; i += 3) {
    const ia = ix.getX(i), ib = ix.getX(i + 1), ic = ix.getX(i + 2);
    a.fromBufferAttribute(p, ia); b.fromBufferAttribute(p, ib); c.fromBufferAttribute(p, ic);
    const cross = b.sub(a).cross(c.sub(a));
    assert.ok(cross.length() > 0, `nonzero triangle ${i/3}`);
    for (const j of [ia, ib, ic]) assert.ok(cross.dot(normal.fromBufferAttribute(n, j)) > 0, `positive winding ${i/3}:${j}`);
  }
}

test('patch admits exactly sixteen controls without changing authored order or input', () => {
  const a = patch({ pos: [1,2,3], rot: [10,20,30], material: 'metal', color: '#557799', edges: true });
  const before = JSON.stringify(a);
  assert.deepEqual(validate([a]).steps[0]!.actions[0], a);
  assert.equal(JSON.stringify(a), before);
});

test('patch rejects malformed or unsafe nets before consuming IDs or replacement', () => {
  const invalid: unknown[] = [[], saddle().slice(1), [...saddle(), [0,0,0]], Array(16), Array(16).fill([0,0,0]),
    controls().map(([x,y]) => [x,y,Infinity]), controls().map(([x,y]) => [x,y,101]),
    controls().map(([x]) => [x,0,0]), controls().map(([x,y]) => [100 + x * 1e-9,y * 1e-9,0])];
  for (const pts of invalid) {
    const state = createSceneState();
    const r = validateScene({ steps: [{ say: 'x', actions: [patch({ pts }), patch()] }] }, state);
    assert.ok(r.scene);
    assert.deepEqual(r.scene.steps[0]!.actions, [patch()], 'invalid add leaves the id available');
    assert.ok(r.issues.some((x) => x.kind === 'dropped'));
    const original = createSceneState(); validate([box], original);
    const detail = createDetailState(original);
    const d = validateScene({ steps: [{ say: 'x', actions: [patch({ pts })] }] }, detail);
    assert.ok(d.issues.some((x) => x.kind === 'dropped'));
    assert.equal(detail.replaceable?.has('sheet'), true);
    assert.equal(detail.ids.get('sheet'), 'solid');
    assert.deepEqual(validate([patch()], detail).steps[0]!.actions, [patch()]);
  }
});

test('patch rejects accessors and inherited or sparse coordinates without evaluating getters', () => {
  let reads = 0;
  const nets: unknown[] = [];
  const outer = saddle(); Object.defineProperty(outer, '0', { get() { reads++; return [0,0,0]; } }); nets.push(outer);
  const inner = saddle(); Object.defineProperty(inner[0]!, '0', { get() { reads++; return 0; } }); nets.push(inner);
  const sparse = saddle(); delete (sparse[3] as number[])[2]; nets.push(sparse);
  const strings = saddle() as unknown as unknown[][]; strings[0]![0] = '1'; nets.push(strings);
  for (const pts of nets) {
    const r = validateScene({ steps: [{ say: 'x', actions: [patch({ pts }), patch()] }] }, createSceneState());
    assert.deepEqual(r.scene?.steps[0]!.actions, [patch()]);
  }
  assert.equal(reads, 0);
});

test('patch tessellation is bounded by quality and has exact planar normals and perimeter only', () => {
  for (const [tier, segments] of [['low',8],['mid',12],['high',20]] as const) {
    const { panel, mesh } = build(patch({ pts: controls() }), tier);
    try {
      const g = mesh.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal');
      assert.equal(p.count, (segments + 1) ** 2); assert.equal(g.getIndex()!.count, segments ** 2 * 6);
      for (let i = 0; i < n.count; i++) { close(n.getX(i),0); close(n.getY(i),0); close(n.getZ(i),1); }
      assert.deepEqual(Array.from(p.array.slice(0,3)), [-1.5,-1.5,0]);
      assert.deepEqual(Array.from(p.array.slice(-3)), [1.5,1.5,0]);
      const edges = mesh.children.filter((o) => o instanceof LineSegments) as LineSegments[];
      assert.equal(edges.length, tier === 'low' ? 0 : 1);
      if (edges[0]) {
        const e = edges[0].geometry.getAttribute('position');
        assert.equal(e.count, segments * 8);
        for (let i = 0; i < e.count; i++) assert.ok(Math.abs(e.getX(i)) === 1.5 || Math.abs(e.getY(i)) === 1.5);
      }
      const m = mesh.material as MeshPhysicalMaterial;
      assert.equal(m.side, DoubleSide); assert.equal(m.forceSinglePass, true);
      winding(g);
    } finally { panel.destroy(); }
  }
});

test('patch analytic normals match a curved saddle at every vertex and do not tilt toward diagonals', () => {
  const { panel, mesh } = build(patch());
  try {
    const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal'), count = 21;
    for (let j = 0; j < count; j++) for (let i = 0; i < count; i++) {
      const u = i/20, v = j/20, k = j*count+i;
      close(p.getX(k),3*u-1.5); close(p.getY(k),3*v-1.5); close(p.getZ(k),1.2*(2*u-1)*(2*v-1));
      const want = new Vector3(-0.8*(2*v-1), -0.8*(2*u-1), 1).normalize();
      close(n.getX(k),want.x); close(n.getY(k),want.y); close(n.getZ(k),want.z);
    }
    winding(mesh.geometry);
  } finally { panel.destroy(); }
});

test('patch cubic interior controls shape the surface rather than interpolating all controls', () => {
  const pts = controls();
  for (const i of [5,6,9,10]) pts[i]![2] = 2;
  const { panel, mesh } = build(patch({ pts }));
  try {
    const p = mesh.geometry.getAttribute('position'), n = mesh.geometry.getAttribute('normal');
    close(p.getZ(10*21+10), 1.125); close(n.getZ(10*21+10),1);
    for (let i=0;i<21;i++) { close(p.getZ(i),0); close(p.getZ(i*21),0); }
    winding(mesh.geometry);
  } finally { panel.destroy(); }
});

test('reversing a control direction reverses orientation without opening or changing the surface', () => {
  const pts = saddle(); const reverse = Array.from({length:4}, (_,j) => pts.slice(j*4,j*4+4).reverse()).flat();
  const a = build(patch()), b = build(patch({ pts: reverse }));
  try {
    const pa=a.mesh.geometry.getAttribute('position'), pb=b.mesh.geometry.getAttribute('position');
    const na=a.mesh.geometry.getAttribute('normal'), nb=b.mesh.geometry.getAttribute('normal');
    for(let j=0;j<21;j++) for(let i=0;i<21;i++) for(let axis=0;axis<3;axis++) {
      close(pa.getComponent(j*21+i,axis), pb.getComponent(j*21+20-i,axis));
      close(na.getComponent(j*21+i,axis), -nb.getComponent(j*21+20-i,axis));
    }
    winding(b.mesh.geometry);
  } finally { a.panel.destroy(); b.panel.destroy(); }
});

test('compact and translated safe patches retain finite unit normals', () => {
  for(const [scale,offset] of [[0.0001,0],[0.01,90],[1,30]] as const) {
    const pts=saddle().map((p):Vec3=>p.map((x)=>x*scale+offset) as Vec3);
    const { panel,mesh } = build(patch({pts}));
    try {
      const n=mesh.geometry.getAttribute('normal');
      for(let i=0;i<n.count;i++) close(Math.hypot(n.getX(i),n.getY(i),n.getZ(i)),1);
      winding(mesh.geometry);
    } finally {panel.destroy();}
  }
});

test('patches inherit transforms and arrays, reuse geometry during sync, and dispose owned resources once', () => {
  const s=validate([{op:'add',shape:'group',id:'root',pos:[2,3,4],rot:[10,25,0]}, patch({parent:'root'}),
    {op:'scale',id:'root',to:[2,0.8,1.3],dur:0}, {op:'add',shape:'array',id:'copies',of:'sheet',count:3,step:[4,0,0]}]);
  const f=frameAt(s.steps,0,99), panel=new PanelScene({tier:'high'});
  try {
    panel.sync(f,1);
    const owned=new Map<BufferGeometry,number>();
    for(const o of f.objects) panel.nodeOf(o.key)?.traverse((c)=> {
      if ((c instanceof Mesh || c instanceof LineSegments) && !owned.has(c.geometry)) {
        owned.set(c.geometry,0); c.geometry.addEventListener('dispose',()=>owned.set(c.geometry,owned.get(c.geometry)!+1));
      }
    });
    assert.ok(owned.size>=2);
    const obj=f.objects.find((o)=>o.id==='sheet')!, m=meshOf(panel.nodeOf(obj.key));
    const g=m.geometry; const world=m.localToWorld(new Vector3());
    assert.deepEqual(world.toArray(),[2,3,4]);
    for(let i=0;i<12;i++) panel.sync(f,1);
    assert.equal(meshOf(panel.nodeOf(obj.key)).geometry,g); assert.ok([...owned.values()].every((n)=>n===0));
    panel.sync(emptyFrame(),1); assert.ok([...owned.values()].every((n)=>n===1));
    panel.destroy(); assert.ok([...owned.values()].every((n)=>n===1));
  } finally {panel.destroy();}
});

test('an open patch clips without a visible solid-volume cap and remains double-sided afterward', () => {
  const steps=validate([patch(),{op:'cut',id:'sheet',axis:'x',to:0,dur:0}]).steps;
  const f=frameAt(steps,0,99),panel=new PanelScene({tier:'high'});
  try {
    panel.sync(f,1);
    const m=meshOf(panel.nodeOf(f.objects[0]!.key));
    assert.equal((m.material as MeshPhysicalMaterial).clippingPlanes?.length,1);
    const nodes=(panel as unknown as {nodes:Map<number,{pieces:{closed:boolean}[]}>}).nodes;
    assert.ok(nodes.get(f.objects[0]!.key)!.pieces.every((p)=>!p.closed));
    const helpers: Mesh[]=[]; panel.scene.traverse((o)=>{if(o instanceof Mesh && (o.material as {stencilWrite?:boolean}).stencilWrite)helpers.push(o);});
    assert.ok(helpers.every((o)=>!o.visible));
    panel.sync(frameAt(validate([patch()]).steps,0,99),1);
    assert.equal((m.material as MeshPhysicalMaterial).side,DoubleSide);
  } finally {panel.destroy();}
});

test('patch replacement and reverse playback reconstruct the correct net', () => {
  const state=createSceneState(); const old=validate([patch()],state); const pts=controls((u,v)=>u+v);
  const next=validate([patch({pts})],createDetailState(state)); const steps=[...old.steps,...next.steps];
  const panel=new PanelScene();
  try {
    for(const i of [0,1,0,1]) {
      const f=frameAt(steps,i,99); panel.sync(f,1); const m=meshOf(panel.nodeOf(f.objects[0]!.key));
      close(m.geometry.getAttribute('position').getZ(0),i===0?1.2:0);
    }
  } finally {panel.destroy();}
});

test('both strict schemas and model guidance expose the bounded patch capability', () => {
  for(const schema of [sceneSchema,sceneSchemaLean]) {
    const defs=variantDefinitions(schema);
    assert.ok(defs.addPatch);
    assert.deepEqual(defs.addPatch!.properties!.shape,{enum:['patch']});
    assert.ok(defs.addPatch!.required!.includes('pts'));
  }
  assert.ok(sceneGuide.includes('patch') && sceneGuide.includes('16') && sceneGuide.includes('row'));
});

test('the authored three-form sample validates unchanged and builds all three tiers', async () => {
  const { readFileSync } = await import('node:fs');
  const scene=JSON.parse(readFileSync(new URL('../samples/scenes/curved-patches.json',import.meta.url),'utf8')) as Scene;
  const r=validateScene(scene,createSceneState());
  assert.deepEqual(r.issues,[]); assert.deepEqual(r.scene,scene);
  for(const tier of ['low','mid','high'] as const) {
    const panel=new PanelScene({tier});
    try {
      for(let step=0;step<scene.steps.length;step++) {
        const f=frameAt(scene.steps,step,99); panel.sync(f,1.4);
        const sheets=f.objects.filter((o)=>o.shape==='patch'); assert.equal(sheets.length,3);
        for(const sheet of sheets) winding(meshOf(panel.nodeOf(sheet.key)).geometry);
      }
    } finally {panel.destroy();}
  }
});

test('direct patch helpers fail closed on unsupported resolution and malformed data', async () => {
  const { preparePatch, readPatchControls }=await import('../src/scene/patch.ts');
  const { patchGeometry, patchEdges }=await import('../src/overlay/patch.ts');
  for(const n of [0,1,7,9,12.5,21,1000000,NaN,Infinity]) assert.equal(preparePatch(saddle(),n),undefined);
  for(const value of [null,undefined,{},'x',new Float32Array(48)]) assert.equal(readPatchControls(value),undefined);
  const g=patchGeometry([],20),e=patchEdges(g,20);
  try {assert.equal(g.getAttribute('position'),undefined);assert.equal(e.getAttribute('position'),undefined);} finally {g.dispose();e.dispose();}
});
