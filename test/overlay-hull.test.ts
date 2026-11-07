import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, Mesh, MeshPhysicalMaterial, Raycaster, Vector2 } from 'three';
import { validateScene } from '../src/scene/validate.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';

test('validated tetrahedron is rendered as a real mesh', () => {
  const result = validateScene({ steps: [{ say: 'x', actions: [{ op:'add', shape:'hull', id:'h', pts:[[0,0,0],[2,0,0],[0,3,0],[0,0,4]] }] }] });
  const frame = frameAt(result.scene!.steps, 0, 99);
  const scene = new PanelScene();
  scene.sync(frame, 1);
  const node = scene.nodeOf(frame.objects.find(o => o.id === 'h')!.key);
  assert.ok(node instanceof Mesh);
  assert.equal(node.geometry.getAttribute('position').count, 12);
  scene.destroy();
});

import { Box3, Group, LineSegments, Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { buildHullGeometry } from '../src/overlay/hull.ts';
import { emptyFrame, evaluate, planStep, REPLACE_SECONDS, settle } from '../src/overlay/timeline.ts';
import type { Vec3, Step } from '../src/scene/types.ts';
import type { Frame } from '../src/overlay/timeline.ts';

const tetra: Vec3[] = [[0,0,0],[2,0,0],[0,3,0],[0,0,4]];
const housing: Vec3[] = [[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0],[-1,-1,3],[1,-1,3],[1,1,3],[-1,1,3]];
const irregular: Vec3[] = Array.from({length:64},(_,i) => {
  const z=1-2*(i+0.5)/64, a=i*Math.PI*(3-Math.sqrt(5)), r=Math.sqrt(1-z*z);
  return [Math.cos(a)*r*3,Math.sin(a)*r*2,z*4];
});
const vector = (p: Vec3) => new Vector3(...p);
const key = (v: Vector3) => `${v.x},${v.y},${v.z}`;

function audit(points: Vec3[], knownVolume?: number): void {
  const result = buildHullGeometry(points); assert.equal(result.ok,true);
  if (!result.ok) return;
  const g=result.geometry, pos=g.getAttribute('position'), norm=g.getAttribute('normal');
  const vertices = new Set<string>(), edges = new Map<string,number>(), directed = new Map<string,number>();
  let volume=0;
  for(let i=0;i<pos.count;i+=3){
    const vs=[0,1,2].map(j=>new Vector3(pos.getX(i+j),pos.getY(i+j),pos.getZ(i+j)));
    const [a,b,c]=vs as [Vector3,Vector3,Vector3];
    const face=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    for(let j=0;j<3;j++) {
      const n=new Vector3(norm.getX(i+j),norm.getY(i+j),norm.getZ(i+j));
      assert.ok(Number.isFinite(n.length()) && Math.abs(n.length()-1)<1e-5);
      assert.ok(n.distanceTo(face)<1e-5, 'flat outward normal');
      vertices.add(key(vs[j]!));
      const x=key(vs[j]!),y=key(vs[(j+1)%3]!),edge=[x,y].sort().join('|');
      edges.set(edge,(edges.get(edge)??0)+1); directed.set(`${x}|${y}`,(directed.get(`${x}|${y}`)??0)+1);
    }
    for(const p of points) assert.ok(face.dot(vector(p).sub(a)) < 2e-5, 'all points inside each outward face');
    volume+=a.dot(b.clone().cross(c))/6;
  }
  assert.ok(volume>0); if(knownVolume!==undefined) assert.ok(Math.abs(volume-knownVolume)<1e-5,`${volume} vs ${knownVolume}`);
  assert.ok(pos.count/3 <= 2*vertices.size-4 && pos.count/3 <= 124);
  for(const [edge,count] of edges) { assert.equal(count,2); const [a,b]=edge.split('|'); assert.equal(directed.get(`${a}|${b}`),1); assert.equal(directed.get(`${b}|${a}`),1); }
  assert.equal(vertices.size-edges.size+pos.count/3,2);
  g.dispose();
}

test('real CPU hulls are closed, outward, flat and contain their source points', () => {
  audit(tetra,4); audit(housing,28); audit(irregular);
  for(const [scale, offset] of [[0.01, 0],[1,20],[10,-40]] as const) audit(tetra.map(p => p.map(x => x*scale+offset) as Vec3));
});

test('point order, duplicates and interior points leave the envelope unchanged', () => {
  const signature = (pts: Vec3[]) => {
    const r=buildHullGeometry(pts); if(!r.ok) throw new Error(r.message);
    const a=r.geometry.getAttribute('position'); const faces: string[]=[];
    for(let i=0;i<a.count;i+=3) faces.push([0,1,2].map(j=>`${a.getX(i+j)},${a.getY(i+j)},${a.getZ(i+j)}`).sort().join('|'));
    r.geometry.dispose(); return faces.sort();
  };
  assert.deepEqual(signature([...tetra].reverse()),signature(tetra));
  assert.deepEqual(signature([...tetra,[0,0,0],[0.1,0.1,0.1]]),signature(tetra));
});

test('hulls participate in parent transforms, copies, pins, framing and closed cuts on every tier', () => {
  const raw={steps:[{say:'x',actions:[
    {op:'panel',x:100,y:100,w:400,h:400}, {op:'add',shape:'group',id:'g',pos:[2,1,0],rot:[0,0,90]},
    {op:'add',shape:'hull',id:'h',parent:'g',pos:[1,0,0],pts:tetra,color:'red',material:'metal',edges:true,opacity:0.6},
    {op:'add',shape:'box',id:'child',parent:'h',size:[1,1,1],pos:[0,0,1]},
    {op:'add',shape:'array',id:'copies',of:'h',count:3,step:[5,0,0]},
    {op:'pin',id:'pin',on:'h',text:'Hull'}, {op:'scale',id:'g',to:[2,2,2],dur:0}, {op:'cut',id:'h',axis:'z',to:1,dur:0}
  ]}]};
  const validated=validateScene(raw); assert.deepEqual(validated.issues,[]);
  for(const tier of ['low','mid','high'] as const){
    const f=frameAt(validated.scene!.steps,0,99), panel=new PanelScene({tier});
    const view={rect:{x:100,y:100,w:400,h:400},width:1000,height:1000}; panel.sync(f,1,view);
    const item=f.objects.find(o=>o.id==='h')!, node=panel.nodeOf(item.key)!;
    assert.ok(node instanceof Mesh); assert.ok(node.parent===panel.nodeOf(item.parentKey!));
    assert.ok(panel.nodeOf(f.objects.find(o=>o.id==='copies')!.key)!.parent===panel.nodeOf(f.objects.find(o=>o.id==='g')!.key));
    assert.ok(panel.nodeOf(f.objects.find(o=>o.id==='child')!.key)!.parent===node);
    node.updateWorldMatrix(true,false); const world=node.getWorldPosition(new Vector3());
    assert.ok(world.distanceTo(new Vector3(2,3,0))<1e-6, world.toArray().join(','));
    const hulls = f.objects.filter(o => o.shape === 'hull');
    assert.equal(hulls.length, 3);
    const expectedColor = new Color().setRGB(1, 59 / 255, 71 / 255, 'srgb');
    const originalPositions = Array.from(node.geometry.getAttribute('position').array);
    const originalNormals = Array.from(node.geometry.getAttribute('normal').array);
    hulls.forEach((hull, index) => {
      const copy = panel.nodeOf(hull.key);
      assert.ok(copy instanceof Mesh, `${hull.id} has a rendered mesh`);
      assert.deepEqual(Array.from(copy.geometry.getAttribute('position').array), originalPositions);
      assert.deepEqual(Array.from(copy.geometry.getAttribute('normal').array), originalNormals);
      assert.equal(copy.geometry.getAttribute('position').count, 12);
      const surface = copy.material;
      assert.ok(surface instanceof MeshPhysicalMaterial);
      assert.equal(surface.metalness, 1);
      assert.ok(surface.color.equals(expectedColor), `${hull.id} has the requested red tint`);
      assert.ok(Math.abs(surface.opacity - 0.6) < 1e-6, `${hull.id} has the requested opacity`);
      copy.updateWorldMatrix(true, false);
      const origin = copy.getWorldPosition(new Vector3());
      assert.ok(origin.distanceTo(new Vector3(2, 3 + index * 10, 0)) < 1e-6, `${hull.id}: ${origin.toArray()}`);
      const position = copy.geometry.getAttribute('position');
      for (let i = 0; i < position.count; i++) {
        const ndc = new Vector3().fromBufferAttribute(position, i).applyMatrix4(copy.matrixWorld).project(panel.camera);
        const x = (ndc.x + 1) * 500, y = (1 - ndc.y) * 500;
        assert.ok(x >= view.rect.x - 1 && x <= view.rect.x + view.rect.w + 1 &&
          y >= view.rect.y - 1 && y <= view.rect.y + view.rect.h + 1 && ndc.z > -1 && ndc.z < 1,
        `${hull.id} vertex ${i} projects inside the stage: ${x},${y},${ndc.z}`);
      }
    });
    assert.ok(f.marks.some(m=>m.id==='pin' && m.onKey===item.key));
    assert.ok(panel.camera.position.toArray().every(Number.isFinite));
    const center=new Box3().setFromObject(node).getCenter(new Vector3()); assert.ok(center.toArray().every(Number.isFinite));
    assert.ok(((node as Mesh).material as {clippingPlanes?: unknown[]}).clippingPlanes?.length);
    assert.ok(panel.scene.children.some(c=>(c as Mesh).isMesh && ((c as Mesh).material as {stencilWrite?:boolean}).stencilWrite));
    if(tier!=='low') assert.ok(node.children.some(c=>c instanceof LineSegments));
    panel.destroy();
  }
});

test('a pin projects its local point onto the rendered hull and follows its movement', () => {
  const view = { rect: { x: 100, y: 100, w: 400, h: 400 }, width: 1000, height: 1000 };
  const point: Vec3 = [0.25, 0.25, 0.5];
  const makeFrame = (x: number) => {
    const result = validateScene({ steps: [{ say: 'x', actions: [
      { op: 'panel', x: 100, y: 100, w: 400, h: 400 },
      { op: 'add', shape: 'box', id: 'reference', size: [20,20,20], opacity: 0.2 },
      { op: 'add', shape: 'hull', id: 'h', pts: tetra },
      { op: 'pin', id: 'pin', on: 'h', point, text: 'Hull' },
      { op: 'move', id: 'h', to: [x,0,0], dur: 0 },
      { op: 'orbit', az: 0, el: 0, dur: 0 },
    ] }] });
    assert.deepEqual(result.issues, []);
    return frameAt(result.scene!.steps, 0, 99);
  };
  const panel = new PanelScene();
  try {
    const projectPin = (frame: Frame) => {
      panel.sync(frame, 1, view);
      const pin = frame.marks.find(m => m.id === 'pin')!;
      assert.equal(pin.mark.op, 'pin');
      if (pin.mark.op !== 'pin') throw new Error('expected pin');
      assert.deepEqual(pin.mark.point, point);
      const node = panel.nodeOf(pin.onKey!)!;
      const actual = panel.project(pin.onKey!, pin.mark.point, view.width, view.height)!;
      assert.equal(actual.visible, true);
      const expected = new Vector3(...point).applyMatrix4(node.matrixWorld).project(panel.camera);
      assert.ok(Math.abs(actual.x - (expected.x + 1) * view.width / 2) < 1e-6);
      assert.ok(Math.abs(actual.y - (1 - expected.y) * view.height / 2) < 1e-6);
      const ray = new Raycaster();
      ray.setFromCamera(new Vector2(actual.x / 500 - 1, 1 - actual.y / 500), panel.camera);
      assert.ok(ray.intersectObject(node, true).length > 0, 'anchor ray hits the hull');
      return actual;
    };
    const initial = projectPin(makeFrame(0));
    const moved = projectPin(makeFrame(4));
    assert.ok(moved.x > initial.x + 20, `pin follows the moved hull: ${initial.x} to ${moved.x}`);
  } finally { panel.destroy(); }
});

/** An empty failed hull must have exactly the same fit as the scene without it. */
function assertFailedFitMatches(panel: PanelScene, frame: Frame, hullKey: number): void {
  const control = new PanelScene();
  try {
    const view = { rect: { x: 100, y: 100, w: 400, h: 400 }, width: 1000, height: 1000 };
    control.sync({ ...frame, objects: frame.objects.filter(o => o.key !== hullKey) }, 1, view);
    assert.ok(panel.camera.position.distanceTo(control.camera.position) < 1e-8, 'failed node does not change camera position');
    assert.ok(panel.camera.quaternion.angleTo(control.camera.quaternion) < 1e-8, 'failed node does not change camera orientation');
    assert.deepEqual(panel.camera.projectionMatrix.elements, control.camera.projectionMatrix.elements);
    assert.deepEqual(panel.screenBounds(1000, 1000)?.model, control.screenBounds(1000, 1000)?.model);
  } finally { control.destroy(); }
}

test('invalid and unexpected construction failures are local, with no false mesh or invalid camera', () => {
  assert.equal(buildHullGeometry([[0,0,0],[1,0,0],[0,1,0],[1,1,0]]).ok,false);
  const good=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'hull',id:'h',pos:[80,80,80],pts:tetra},{op:'add',shape:'box',id:'b',size:[2,2,2]}]}]}).scene!;
  const f=frameAt(good.steps,0,99), panel=new PanelScene();
  const original=ConvexHull.prototype.setFromPoints, warn=console.warn;
  const warnings: unknown[][]=[];
  try {
    ConvexHull.prototype.setFromPoints=function(){throw new Error('test failure');};
    console.warn=(...args)=>warnings.push(args);
    panel.sync(f,1,{rect:{x:100,y:100,w:400,h:400},width:1000,height:1000});
    const node=panel.nodeOf(f.objects.find(o=>o.id==='h')!.key)!;
    assert.ok(node instanceof Group); assert.equal(node.children.length,0);
    assert.ok(panel.nodeOf(f.objects.find(o=>o.id==='b')!.key) instanceof Mesh);
    assert.ok(panel.camera.position.toArray().every(Number.isFinite));
    assert.ok(warnings.some(x=>String(x[0]).includes('test failure')));
    assertFailedFitMatches(panel, f, f.objects.find(o=>o.id==='h')!.key);
  } finally { ConvexHull.prototype.setFromPoints=original; console.warn=warn; panel.destroy(); }
});

test('replacement removes and disposes the old hull geometry', () => {
  const step=(...actions:unknown[])=>({say:'x',actions}) as Step;
  const base=settle(planStep(emptyFrame(),step({op:'add',shape:'hull',id:'h',pts:tetra})),2), panel=new PanelScene();
  panel.sync(base,1); const old=panel.nodeOf(base.objects[0]!.key) as Mesh;
  let disposed=0; old.geometry.addEventListener('dispose',()=>disposed++);
  const plan=planStep(base,step({op:'add',shape:'box',id:'h',size:[2,2,2]}));
  panel.sync(evaluate(plan,REPLACE_SECONDS+1),1);
  assert.equal(disposed,1); assert.equal(panel.nodeOf(base.objects[0]!.key),undefined); panel.destroy();
});

test('invalid constructed buffers are rejected and disposed', async () => {
  const { ConvexGeometry } = await import('three/addons/geometries/ConvexGeometry.js');
  const { Float32BufferAttribute } = await import('three');
  const original = ConvexGeometry.prototype.setAttribute;
  for (const values of [Array(27).fill(0), Array(54).fill(0), [NaN, ...Array(35).fill(0)]]) {
    let disposed = 0;
    try {
      ConvexGeometry.prototype.setAttribute = function(name, attribute) {
        if (name === 'position') {
          this.addEventListener('dispose', () => disposed++);
          return original.call(this, name, new Float32BufferAttribute(values,3));
        }
        if (name === 'normal') return original.call(this, name, new Float32BufferAttribute(Array(values.length).fill(0), 3));
        return original.call(this,name,attribute);
      };
      assert.equal(buildHullGeometry(tetra).ok,false);
      assert.equal(disposed,1);
    } finally { ConvexGeometry.prototype.setAttribute=original; }
  }
});

test('invalid directly supplied hull remains an empty group alongside a valid solid', () => {
  const model=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'hull',id:'h',pos:[80,80,80],pts:tetra},{op:'add',shape:'box',id:'b',size:[2,2,2]}]}]}).scene!;
  const f=frameAt(model.steps,0,99), h=f.objects.find(o=>o.id==='h')!;
  (h.def as {pts:Vec3[]}).pts=[[0,0,0],[1,0,0],[0,1,0],[1,1,0]];
  const panel=new PanelScene(), warn=console.warn; const warnings: unknown[][]=[];
  try {
    console.warn=(...args)=>warnings.push(args); panel.sync(f,1,{rect:{x:100,y:100,w:400,h:400},width:1000,height:1000});
    assert.ok(panel.nodeOf(h.key) instanceof Group); assert.equal(panel.nodeOf(h.key)!.children.length,0);
    assert.ok(panel.nodeOf(f.objects.find(o=>o.id==='b')!.key) instanceof Mesh);
    assert.ok(panel.camera.position.toArray().every(Number.isFinite)); assert.equal(warnings.length,1);
    assertFailedFitMatches(panel, f, h.key);
  } finally { console.warn=warn; panel.destroy(); }
});
