import test from 'node:test';
import assert from 'node:assert/strict';
import { LineSegments, Mesh, Vector3 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial, Object3D } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt, emptyFrame } from '../src/overlay/timeline.ts';
import { createSceneState, createDetailState, validateScene } from '../src/scene/index.ts';
import type { Scene, Vec2, Vec3 } from '../src/scene/types.ts';

const square: Vec2[] = [[-1,-0.5],[1,-0.5],[1,0.5],[-1,0.5]];
const straight: Vec3[] = [[0,0,-2],[0,0,2]];
const bent: Vec3[] = [[-3,0,0],[-1,0.3,0],[1,1,0.5],[3,2,1.5]];
const sweep = (extra: Record<string, unknown> = {}) => ({op:'add',shape:'sweep',id:'rail',outline:square,pts:straight,...extra});
function validated(actions: unknown[], state = createSceneState()): Scene {
  const result = validateScene({steps:[{say:'Shaped rails.',actions}]},state);
  assert.deepEqual(result.issues, []); assert.ok(result.scene); return result.scene;
}
function meshOf(o: Object3D | undefined): Mesh {
  let mesh: Mesh | undefined;
  o?.traverse(c=>{if (!mesh && c instanceof Mesh) mesh=c;});
  assert.ok(mesh, 'sweep reaches the actual renderer as a mesh'); return mesh;
}
function build(action: unknown, tier: 'low'|'mid'|'high'='high') {
  const scene=validated([action]), frame=frameAt(scene.steps,0,99), panel=new PanelScene({tier});
  panel.sync(frame,1); return {panel,frame,mesh:meshOf(panel.nodeOf(frame.objects[0]!.key))};
}
function close(actual:number,wanted:number,tol=2e-6) { assert.ok(Math.abs(actual-wanted)<tol,`${actual} ≈ ${wanted}`); }
function inspect(g:BufferGeometry) {
  const p=g.getAttribute('position'),n=g.getAttribute('normal'),index=g.getIndex(); assert.ok(index);
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3();
  const edges=new Map<string,{count:number;direction:number}>(); let volume=0;
  const key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].join(',');
  for (let i=0;i<n.count;i++) { normal.fromBufferAttribute(n,i); close(normal.length(),1); }
  for(let i=0;i<index.count;i+=3) {
    const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
    a.fromBufferAttribute(p,ids[0]!); b.fromBufferAttribute(p,ids[1]!); c.fromBufferAttribute(p,ids[2]!);
    volume+=a.dot(b.clone().cross(c))/6;
    const face=b.sub(a).cross(c.sub(a)); assert.ok(face.length()>0,'nonzero actual Float32 face');
    for(const id of ids) assert.ok(face.dot(normal.fromBufferAttribute(n,id))>0,'outward normals agree with winding');
    for(let j=0;j<3;j++) {const x=key(ids[j]!),y=key(ids[(j+1)%3]!);const k=x<y?`${x}|${y}`:`${y}|${x}`;const e=edges.get(k)??{count:0,direction:0}; e.count++;e.direction+=x<y?1:-1;edges.set(k,e);}
  }
  assert.ok(volume>0,'positive enclosed volume');
  for(const e of edges.values()) {assert.equal(e.count,2,'watertight edge incidence');assert.equal(e.direction,0,'opposite edge directions');}
  return volume;
}

test('sweep accepts bounded authored data unchanged, including initial orientation and transforms',()=>{
  const action=sweep({up:[0,1,0],parent:'model',pos:[2,1,0],rot:[10,20,30],explode:[1,0,0],material:'metal',color:'#7799aa',opacity:0.7,edges:true});
  const before=JSON.stringify(action);
  assert.deepEqual(validated([{op:'add',shape:'group',id:'model'},action]).steps[0]!.actions[1],action);
  assert.equal(JSON.stringify(action),before);
});

test('sweep rejects invalid geometry before consuming IDs or replacement state',()=>{
  const cases:Record<string,unknown>[]=[{outline:[]},{outline:Array(25).fill([1,0])},{outline:[[0,0],[1,1],[0,1],[1,0]]},{outline:[[0,0],[1,0],[2,0]]},
    {outline:[[0,0],[1,0],[1,1],[1,0],[0,1]]},{outline:[[0,0],[101,0],[0,1]]},{pts:[]},{pts:Array(17).fill([0,0,0])},
    {pts:[[0,0,0],[0,0,0]]},{pts:[[0,0,0],[1,0,0],[0,0,0]]},{pts:[[0,0,0],[Infinity,0,0]]},
    {up:[0,0,0]},{up:[0,0,1]},{up:[0,101,0]},
    {outline:square.map(([x,y])=>[x*1e-9,y*1e-9]),pts:[[99,99,98],[99,99,99]]}];
  for(const bad of cases){
    const state=createSceneState(),result=validateScene({steps:[{say:'x',actions:[sweep(bad),sweep()]}]},state);
    assert.deepEqual(result.scene?.steps[0]!.actions,[sweep()],JSON.stringify(bad));assert.ok(result.issues.some(x=>x.kind==='dropped'));
    const original=createSceneState();validated([{op:'add',shape:'box',id:'rail',size:[1,1,1]}],original);
    const detail=createDetailState(original); const r=validateScene({steps:[{say:'x',actions:[sweep(bad)]}]},detail);
    assert.ok(r.issues.some(x=>x.kind==='dropped')); assert.equal(detail.replaceable?.has('rail'),true);assert.equal(detail.ids.get('rail'),'solid');
    assert.deepEqual(validated([sweep()],detail).steps[0]!.actions,[sweep()]);
  }
});

test('sweep refuses sparse and accessor arrays without reading getters',()=>{
  let reads=0;const cases:Record<string,unknown>[]=[];
  const outline=square.map(p=>[...p]);Object.defineProperty(outline,'0',{get(){reads++;return [0,0];}});cases.push({outline});
  const pts=straight.map(p=>[...p]);Object.defineProperty(pts[0]!,'1',{get(){reads++;return 0;}});cases.push({pts});
  const up=[0,1,0];Object.defineProperty(up,'0',{get(){reads++;return 0;}});cases.push({up});
  const sparse=square.map(p=>[...p]);delete sparse[0]![0];cases.push({outline:sparse});
  for(const c of cases){const r=validateScene({steps:[{say:'x',actions:[sweep(c),sweep()]}]},createSceneState());assert.deepEqual(r.scene?.steps[0]!.actions,[sweep()]);}
  assert.equal(reads,0);
});

test('straight sweep has analytic bounds, closed caps, sharp corners and unit outward normals at each tier',()=>{
  for(const tier of ['low','mid','high'] as const){const {panel,mesh}=build(sweep(),tier);try{
    mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox!;
    assert.deepEqual(box.min.toArray(),[-1,-0.5,-2]);assert.deepEqual(box.max.toArray(),[1,0.5,2]);close(inspect(mesh.geometry),8);
    const n=mesh.geometry.getAttribute('normal');for(let i=0;i<n.count;i++)assert.ok([Math.abs(n.getX(i)),Math.abs(n.getY(i)),Math.abs(n.getZ(i))].some(v=>Math.abs(v-1)<1e-7),'axis-aligned normals without cap/side blending');
    assert.ok(mesh.geometry.getIndex()!.count/3<=100);
  }finally{panel.destroy();}}
});

test('sweep respects an explicit initial up and preserves translated section coordinates',()=>{
  const {panel,mesh}=build(sweep({outline:[[2,0],[4,0],[4,1],[2,1]],up:[1,0,0]}));try{
    mesh.geometry.computeBoundingBox();assert.deepEqual(mesh.geometry.boundingBox!.min.toArray(),[0,-4,-2]);assert.deepEqual(mesh.geometry.boundingBox!.max.toArray(),[1,-2,2]);close(inspect(mesh.geometry),8);
  }finally{panel.destroy();}
});

test('concave sweep caps preserve area with either winding and exact redundant boundary points',()=>{
  const ring:Vec2[]=[[0,0],[1,0],[2,0],[2,1],[1,1],[1,2],[0,2],[0,0]];
  for(const outline of [ring,[...ring].reverse()]){const {panel,mesh}=build(sweep({outline}));try{close(inspect(mesh.geometry),12);}finally{panel.destroy();}}
});

test('curved spatial sweeps stay closed, follow path endpoints and retain finite continuous side shading',()=>{
  const section=square.map(([x,y])=>[x*0.15,y*0.15]);
  for(const tier of ['low','mid','high'] as const){const {panel,mesh}=build(sweep({outline:section,pts:bent}),tier);try{inspect(mesh.geometry);assert.ok(mesh.geometry.getIndex()!.count/3<=8684);const p=mesh.geometry.getAttribute('position');for(let i=0;i<p.count;i++)assert.ok([p.getX(i),p.getY(i),p.getZ(i)].every(Number.isFinite));}finally{panel.destroy();}}
});

test('sweep outlines contain only longitudinal profile corners and end perimeters',()=>{
  const {panel,mesh}=build(sweep());try{
    const lines=mesh.children.filter(c=>c instanceof LineSegments) as LineSegments[];assert.equal(lines.length,1);
    const p=lines[0]!.geometry.getAttribute('position');for(let i=0;i<p.count;i+=2){const sameZ=p.getZ(i)===p.getZ(i+1);if(sameZ)assert.ok(Math.abs(p.getZ(i))===2);else{assert.equal(p.getX(i),p.getX(i+1));assert.equal(p.getY(i),p.getY(i+1));} }
  }finally{panel.destroy();}
  const without=build(sweep({edges:false}));try{assert.equal(without.mesh.children.filter(c=>c instanceof LineSegments).length,0);}finally{without.panel.destroy();}
});

test('sweep uses ordinary parent transforms, arrays, cutaways, repeated sync and exactly-once disposal',()=>{
  const scene=validated([{op:'add',shape:'group',id:'model',pos:[3,0,0]},sweep({parent:'model',color:'blue'}),{op:'add',shape:'array',id:'copies',of:'rail',count:3,step:[0,3,0]},{op:'cut',id:'model',axis:'z',to:0,dur:0}]);
  const frame=frameAt(scene.steps,0,99),panel=new PanelScene({tier:'high'});panel.sync(frame,1);
  try{const rails=frame.objects.filter(o=>o.shape==='sweep');assert.equal(rails.length,3);const geometries=new Set<BufferGeometry>();
    for(const o of rails){const mesh=meshOf(panel.nodeOf(o.key));close(mesh.getWorldPosition(new Vector3()).x,3);assert.ok((mesh.material as MeshPhysicalMaterial).clippingPlanes?.length);geometries.add(mesh.geometry);panel.sync(frame,1);assert.equal(meshOf(panel.nodeOf(o.key)).geometry,mesh.geometry);}
    const disposed=new Map<BufferGeometry,number>();for(const g of geometries)g.addEventListener('dispose',()=>disposed.set(g,(disposed.get(g)??0)+1));
    panel.sync(emptyFrame(),1);for(const g of geometries)assert.equal(disposed.get(g),1);panel.destroy();for(const g of geometries)assert.equal(disposed.get(g),1);
  }finally{panel.destroy();}
});

test('authored sweep examples validate unchanged and retain three real meshes across all views and tiers',async()=>{
  const {readFileSync}=await import('node:fs');
  const scene=JSON.parse(readFileSync(new URL('../samples/scenes/profile-sweeps.json',import.meta.url),'utf8')) as Scene;
  const r=validateScene(scene,createSceneState());assert.deepEqual(r.issues,[]);assert.deepEqual(r.scene,scene);
  for(const tier of ['low','mid','high'] as const){const panel=new PanelScene({tier});try{
    for(let i=0;i<scene.steps.length;i++){const f=frameAt(scene.steps,i,99);panel.sync(f,1.4);const sweeps=f.objects.filter(o=>o.shape==='sweep');assert.equal(sweeps.length,3);for(const o of sweeps)inspect(meshOf(panel.nodeOf(o.key)).geometry);}
  }finally{panel.destroy();}}
});

test('the maximum admitted profile and path remain within the mesh budget',()=>{
  const outline=Array.from({length:24},(_,i)=>[.1*Math.cos(i*Math.PI/12),.1*Math.sin(i*Math.PI/12)]);
  const pts=Array.from({length:16},(_,i)=>[0,0,i]);const {panel,mesh}=build(sweep({outline,pts}));
  try{assert.equal(mesh.geometry.getAttribute('position').count,8736);assert.equal(mesh.geometry.getIndex()!.count/3,8684);inspect(mesh.geometry);}finally{panel.destroy();}
});

test('initial vertical transport has a deterministic default and explicit up carries through a spatial bend',()=>{
  const action=sweep({outline:square.map(([x,y])=>[x*.05,y*.05]),pts:[[0,0,0],[0,1,0],[.3,2,.3],[1,3,1]],up:[1,0,0]});
  for(const a of [sweep({pts:[[0,0,0],[0,4,0]]}),action]){const {panel,mesh}=build(a);try{inspect(mesh.geometry);}finally{panel.destroy();}}
});

test('sweep replacement and backward seeking restore the authored section, without stale geometry',()=>{
  const state=createSceneState(),first=validated([sweep()],state),second=validated([sweep({outline:square.map(([x,y])=>[x*2,y*3])})],createDetailState(state));
  const steps=[...first.steps,...second.steps],panel=new PanelScene();
  try{for(const i of [0,1,0,1]){const f=frameAt(steps,i,99);panel.sync(f,1);const mesh=meshOf(panel.nodeOf(f.objects[0]!.key));mesh.geometry.computeBoundingBox();close(mesh.geometry.boundingBox!.max.x,i===0?1:2);close(mesh.geometry.boundingBox!.max.y,i===0?.5:1.5);inspect(mesh.geometry);}}
  finally{panel.destroy();}
});

test('direct sweep preparation bounds resolution and refuses malformed data without allocating a substitute',async()=>{
  const {prepareSweep}=await import('../src/scene/sweep.ts');
  for(const n of [0,1,3,5,12.5,1000000,NaN,Infinity])assert.equal(prepareSweep(square,straight,undefined,n),undefined);
  for(const input of [null,undefined,{},'x',new Float32Array(8)])assert.equal(prepareSweep(input,straight,undefined,12),undefined);
  const {sweepGeometry}=await import('../src/overlay/sweep.ts');assert.equal(sweepGeometry(sweep({outline:[]}) as never,'high'),undefined);
});

test('curved vertical starts reject exactly parallel up and use the documented default frame',async()=>{
  const {prepareSweep}=await import('../src/scene/sweep.ts');
  const outline:Vec2[]=[[-.05,-.1],[.05,-.1],[.05,.1],[-.05,.1]];
  for(const sign of [-1,1]){
    const pts=[[0,0,0],[0,1,0],[sign*.3,2,sign*.3],[sign,3,sign]];
    assert.equal(prepareSweep(outline,pts,[0,1,0],12),undefined,'a later bend must not make parallel up valid');
    const mesh=prepareSweep(outline,pts,undefined,12);assert.ok(mesh);
    // Initial +y uses world +x and section +x uses world +z, independent of later bend.
    close(mesh.positions[0]!,-.1);close(mesh.positions[1]!,0);close(mesh.positions[2]!,-.05);
  }
});

test('sweep parent transforms are retained when automatic tubes locate a child solid',()=>{
  const parent=sweep({pos:[10,0,0],outline:[[-.1,-.1],[.1,-.1],[.1,.1],[-.1,.1]]});
  const child={op:'add',shape:'box',id:'child',parent:'rail',size:[2,2,2]};
  const far={op:'add',shape:'tube',id:'wire',pts:[[1,0,0],[5,0,0]],radius:.05};
  const scene=validated([parent,child,far]);
  assert.equal((scene.steps[0]!.actions[2] as {attach?:unknown}).attach,undefined,'a child at world x=10 is not beside x=1');
  const near=validateScene({steps:[{say:'x',actions:[parent,child,{...far,pts:[[11,0,0],[15,0,0]]}]}]},createSceneState());
  assert.ok(near.issues.every(x=>x.kind==='trimmed'));
  assert.deepEqual((near.scene!.steps[0]!.actions[2] as {attach?:unknown}).attach,[{to:'child',at:[1,0,0]},null]);
});

test('held sweep references defer geometry work until their parent exists',()=>{
  let inspections=0;
  const outline=new Proxy(square,{getOwnPropertyDescriptor(target,key){inspections++;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const missing=validateScene({steps:[{say:'x',actions:[sweep({outline,parent:'missing'}),...Array.from({length:12},(_,i)=>({op:'add',shape:'box',id:`other${i}`,size:[1,1,1]}))]}]},createSceneState());
  assert.ok(missing.issues.some(x=>x.kind==='dropped'));assert.equal(inspections,0,'unresolved retries do not repeatedly triangulate unchanged geometry');
  const resolved=validated([sweep({outline,parent:'holder'}),{op:'add',shape:'group',id:'holder'}]);
  assert.equal(resolved.steps[0]!.actions.length,2);assert.ok(inspections>0,'the resolved sweep is still fully checked');
});
