import test from 'node:test';
import assert from 'node:assert/strict';
import { LineSegments, Mesh, Vector3 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial, Object3D } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt, emptyFrame } from '../src/overlay/timeline.ts';
import { createSceneState, createDetailState, validateScene } from '../src/scene/index.ts';
import type { Scene, Vec2 } from '../src/scene/types.ts';

const square: Vec2[] = [[-1,-1],[1,-1],[1,1],[-1,1]];
const end: Vec2[] = [[-.5,-.8],[1.5,-.4],[.8,1.4],[-.8,.6]];
const loft = (extra: Record<string, unknown> = {}) => ({op:'add',shape:'loft',id:'piece',outline:square,endOutline:square,depth:4,...extra});
function validated(actions: unknown[], state = createSceneState()): Scene {
  const r=validateScene({steps:[{say:'Changing sections.',actions}]},state);
  assert.deepEqual(r.issues, []); assert.ok(r.scene); return r.scene;
}
function meshOf(o: Object3D | undefined): Mesh {
  let mesh: Mesh | undefined; o?.traverse(c=>{if(!mesh && c instanceof Mesh)mesh=c;});
  assert.ok(mesh,'the authored loft reaches the actual renderer');return mesh;
}
function build(action: unknown, tier:'low'|'mid'|'high'='high') {
  const scene=validated([action]),frame=frameAt(scene.steps,0,99),panel=new PanelScene({tier});
  panel.sync(frame,1);return {panel,frame,mesh:meshOf(panel.nodeOf(frame.objects[0]!.key))};
}
function near(a:number,b:number,tol=2e-6){assert.ok(Math.abs(a-b)<tol,`${a} ≈ ${b}`);}
function inspect(g:BufferGeometry){
  const p=g.getAttribute('position'),n=g.getAttribute('normal'),idx=g.getIndex();assert.ok(idx);
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3();
  const edges=new Map<string,{count:number;direction:number}>();let volume=0;
  const key=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i)].join(',');
  for(let i=0;i<n.count;i++){normal.fromBufferAttribute(n,i);near(normal.length(),1);}
  for(let i=0;i<idx.count;i+=3){
    const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];
    a.fromBufferAttribute(p,ids[0]!);b.fromBufferAttribute(p,ids[1]!);c.fromBufferAttribute(p,ids[2]!);
    volume+=a.dot(b.clone().cross(c))/6;const face=b.sub(a).cross(c.sub(a));assert.ok(face.length()>0);
    for(const id of ids)assert.ok(face.dot(normal.fromBufferAttribute(n,id))>0,'normals agree with triangle winding');
    for(let k=0;k<3;k++){const x=key(ids[k]!),y=key(ids[(k+1)%3]!);const label=x<y?`${x}|${y}`:`${y}|${x}`;
      const e=edges.get(label)??{count:0,direction:0};e.count++;e.direction+=x<y?1:-1;edges.set(label,e);}
  }
  assert.ok(volume>0);for(const e of edges.values()){assert.equal(e.count,2,'closed edge incidence');assert.equal(e.direction,0);}
  return volume;
}

test('loft retains matched end profiles and ordinary surface and transform fields',()=>{
  const action=loft({endOutline:end,parent:'model',pos:[2,1,0],rot:[10,20,30],explode:[1,0,0],material:'metal',color:'#7799aa',opacity:.7,edges:true});
  const before=JSON.stringify(action);assert.deepEqual(validated([{op:'add',shape:'group',id:'model'},action]).steps[0]!.actions[1],action);assert.equal(JSON.stringify(action),before);
});

test('loft rejects invalid or unsafe profiles before consuming IDs or replacement state',()=>{
  const cases:Record<string,unknown>[]=[{outline:[]},{outline:Array(25).fill([1,0])},{outline:[[0,0],[1,1],[0,1],[1,0]]},
    {outline:[[0,0],[1,0],[2,0]]},{endOutline:[[0,0],[1,0],[0,1]]},{endOutline:[...square].reverse()},
    {endOutline:[[0,0],[1,0],[.2,.2],[0,1]]},{outline:[[0,0],[101,0],[101,1],[0,1]]},
    {endOutline:[square[2],square[3],square[0],square[1]]},{depth:0},{depth:101},{depth:Infinity},
    {outline:square.map(([x,y])=>[99+x*1e-9,99+y*1e-9]),endOutline:square.map(([x,y])=>[99+x*1e-9,99+y*1e-9])}];
  for(const bad of cases){const state=createSceneState();const r=validateScene({steps:[{say:'x',actions:[loft(bad),loft()]}]},state);
    assert.deepEqual(r.scene?.steps[0]!.actions,[loft()],JSON.stringify(bad));assert.ok(r.issues.some(x=>x.kind==='dropped'));
    const original=createSceneState();validated([{op:'add',shape:'box',id:'piece',size:[1,1,1]}],original);
    const detail=createDetailState(original),before=[...detail.bodies];const dropped=validateScene({steps:[{say:'x',actions:[loft(bad)]}]},detail);
    assert.ok(dropped.issues.some(x=>x.kind==='dropped'));assert.equal(detail.replaceable?.has('piece'),true);assert.deepEqual([...detail.bodies],before);
    assert.deepEqual(validated([loft()],detail).steps[0]!.actions,[loft()]);}
});

test('loft refuses sparse and accessor profiles without reading getters',()=>{
  let reads=0;const a=square.map(p=>[...p]);Object.defineProperty(a,'0',{get(){reads++;return [0,0];}});
  const b=square.map(p=>[...p]);Object.defineProperty(b[0]!,'1',{get(){reads++;return 0;}});
  const c=square.map(p=>[...p]);delete c[0]![0];
  for(const bad of [{outline:a},{endOutline:b},{outline:c}]){const r=validateScene({steps:[{say:'x',actions:[loft(bad),loft()]}]},createSceneState());assert.deepEqual(r.scene?.steps[0]!.actions,[loft()]);}
  assert.equal(reads,0);
});

test('straight lofts are closed prisms with sharp caps and exact bounds at every tier and winding',()=>{
  for(const tier of ['low','mid','high'] as const)for(const outline of [square,[...square].reverse()]){
    const {panel,mesh}=build(loft({outline,endOutline:outline}),tier);try{
      mesh.geometry.computeBoundingBox();assert.deepEqual(mesh.geometry.boundingBox!.min.toArray(),[-1,-1,-2]);assert.deepEqual(mesh.geometry.boundingBox!.max.toArray(),[1,1,2]);near(inspect(mesh.geometry),16);
      const n=mesh.geometry.getAttribute('normal');for(let i=0;i<n.count;i++)assert.ok([Math.abs(n.getX(i)),Math.abs(n.getY(i)),Math.abs(n.getZ(i))].some(v=>Math.abs(v-1)<1e-7));
    }finally{panel.destroy();}}
});

test('loft interpolates independently shaped sections and shades warped walls without diagonal seams',()=>{
  const {panel,mesh}=build(loft({endOutline:end}));try{
    inspect(mesh.geometry);const p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal');
    // First side, halfway from [-1,-1]..[1,-1] to [-.5,-.8]..[1.5,-.4].
    // Edge at half = [2,.2,0], motion at first corner = [.5,.2,4]. Cross = [.8,-8,.3].
    const expected=new Vector3(.8,-8,.3).normalize();let found=false;
    for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)+.75)<1e-6&&Math.abs(p.getY(i)+.9)<1e-6&&p.getZ(i)===0&&n.getY(i)<-.5){
      near(n.getX(i),expected.x);near(n.getY(i),expected.y);near(n.getZ(i),expected.z);found=true;}
    assert.ok(found,'actual middle ring has the analytic ruled-surface normal');
    for(const [z,ring] of [[-2,square],[2,end]] as const)for(const [x,y] of ring)assert.ok(Array.from({length:p.count},(_,i)=>i).some(i=>Math.abs(p.getX(i)-x)<1e-6&&Math.abs(p.getY(i)-y)<1e-6&&p.getZ(i)===z));
  }finally{panel.destroy();}
});

test('loft outlines contain only end perimeters and corresponding corner joins',()=>{
  const {panel,mesh}=build(loft({endOutline:end}));try{
    const lines=mesh.children.filter(c=>c instanceof LineSegments) as LineSegments[];assert.equal(lines.length,1);
    const p=lines[0]!.geometry.getAttribute('position');assert.equal(p.count,24,'four edges at each end plus four joining corners');
    for(let i=0;i<p.count;i+=2)assert.ok(Math.abs(p.getZ(i))===2&&Math.abs(p.getZ(i+1))===2);
  }finally{panel.destroy();}
  const hidden=build(loft({edges:false}));try{assert.equal(hidden.mesh.children.filter(c=>c instanceof LineSegments).length,0);}finally{hidden.panel.destroy();}
});

test('loft keeps arrays, parent transforms, cutaways and exactly-once mesh and outline disposal',()=>{
  const scene=validated([{op:'add',shape:'group',id:'model',pos:[3,0,0]},loft({parent:'model'}),{op:'add',shape:'array',id:'copies',of:'piece',count:3,step:[0,3,0]},{op:'cut',id:'model',axis:'z',to:0,dur:0}]);
  const f=frameAt(scene.steps,0,99),panel=new PanelScene({tier:'high'});panel.sync(f,1);
  try{const pieces=f.objects.filter(o=>o.shape==='loft');assert.equal(pieces.length,3);const geometries=new Set<BufferGeometry>();
    for(const o of pieces){const mesh=meshOf(panel.nodeOf(o.key));near(mesh.getWorldPosition(new Vector3()).x,3);assert.ok((mesh.material as MeshPhysicalMaterial).clippingPlanes?.length);
      mesh.traverse(c=>{if(c instanceof Mesh||c instanceof LineSegments)geometries.add(c.geometry);});panel.sync(f,1);assert.equal(meshOf(panel.nodeOf(o.key)).geometry,mesh.geometry);}
    const disposed=new Map<BufferGeometry,number>();for(const g of geometries)g.addEventListener('dispose',()=>disposed.set(g,(disposed.get(g)??0)+1));panel.sync(emptyFrame(),1);
    for(const g of geometries)assert.equal(disposed.get(g),1);panel.destroy();for(const g of geometries)assert.equal(disposed.get(g),1);
  }finally{panel.destroy();}
});

test('loft replacement and backward seeks restore the correct profiles',()=>{
  const state=createSceneState(),first=validated([loft()],state),second=validated([loft({endOutline:square.map(([x,y])=>[x*2,y*3])})],createDetailState(state));
  const steps=[...first.steps,...second.steps],panel=new PanelScene();try{for(const i of [0,1,0,1]){const f=frameAt(steps,i,99);panel.sync(f,1);const mesh=meshOf(panel.nodeOf(f.objects[0]!.key));mesh.geometry.computeBoundingBox();near(mesh.geometry.boundingBox!.max.x,i===0?1:2);near(mesh.geometry.boundingBox!.max.y,i===0?1:3);inspect(mesh.geometry);}}finally{panel.destroy();}
});

test('loft parents retain their transforms when a tube locates a child solid',()=>{
  const parent=loft({pos:[10,0,0]});const child={op:'add',shape:'box',id:'child',parent:'piece',size:[2,2,2]};
  const wire={op:'add',shape:'tube',id:'wire',pts:[[1,0,0],[5,0,0]],radius:.05};
  assert.equal((validated([parent,child,wire]).steps[0]!.actions[2] as {attach?:unknown}).attach,undefined);
  const near=validateScene({steps:[{say:'x',actions:[parent,child,{...wire,pts:[[11,0,0],[15,0,0]]}]}]},createSceneState());
  assert.ok(near.issues.every(x=>x.kind==='trimmed'));assert.deepEqual((near.scene!.steps[0]!.actions[2] as {attach?:unknown}).attach,[{to:'child',at:[1,0,0]},null]);
});

test('loft rejects a collapsed intermediate section between all three tessellation grids',()=>{
  // The end is a 180-degree rotation at 1.5 times the scale: section t=.4 collapses.
  const endOutline=square.map(([x,y])=>[-1.5*x,-1.5*y]);
  const r=validateScene({steps:[{say:'x',actions:[loft({endOutline}),loft()]}]},createSceneState());
  assert.deepEqual(r.scene?.steps[0]!.actions,[loft()]);assert.ok(r.issues.some(x=>x.kind==='dropped'));
});

test('bounded loft preparation refuses direct malformed input and invalid resolution',async()=>{
  const {prepareLoft}=await import('../src/scene/loft.ts');
  for(const strips of [0,1,3,4.5,16,1e6,NaN,Infinity])assert.equal(prepareLoft(square,end,4,strips),undefined);
  for(const ring of [null,{},'x',new Float32Array(8)])assert.equal(prepareLoft(ring,end,4,12),undefined);
  const {loftGeometry}=await import('../src/overlay/loft.ts');assert.equal(loftGeometry(loft({outline:[]}) as never,'high'),undefined);
});

test('maximum loft remains bounded and compact local and translated shapes preserve topology',()=>{
  const profile=Array.from({length:24},(_,i)=>[Math.cos(i*Math.PI/12),Math.sin(i*Math.PI/12)]);
  const max=build(loft({outline:profile,endOutline:profile}));try{
    assert.equal(max.mesh.geometry.getAttribute('position').count,672);assert.equal(max.mesh.geometry.getIndex()!.count/3,620);inspect(max.mesh.geometry);
  }finally{max.panel.destroy();}
  for(const shift of [0,99])for(const scale of [.001,.1])for(const tier of ['low','mid','high'] as const){
    const outline=square.map(([x,y])=>[shift+x*scale,shift+y*scale]);
    const {panel,mesh}=build(loft({outline,endOutline:outline,depth:.01}),tier);try{inspect(mesh.geometry);}finally{panel.destroy();}}
});

test('the authored loft sample validates unchanged and retains three meshes through every view',async()=>{
  const {readFileSync}=await import('node:fs');const scene=JSON.parse(readFileSync(new URL('../samples/scenes/profile-lofts.json',import.meta.url),'utf8')) as Scene;
  const r=validateScene(scene,createSceneState());assert.deepEqual(r.issues,[]);assert.deepEqual(r.scene,scene);
  for(const tier of ['low','mid','high'] as const){const panel=new PanelScene({tier});try{
    for(let i=0;i<scene.steps.length;i++){const f=frameAt(scene.steps,i,99);panel.sync(f,1.4);const lofts=f.objects.filter(o=>o.shape==='loft');assert.equal(lofts.length,3);for(const o of lofts)inspect(meshOf(panel.nodeOf(o.key)).geometry);}
  }finally{panel.destroy();}}
});

test('held loft references defer profile work until their parent exists',()=>{
  let reads=0;const outline=new Proxy(square,{getOwnPropertyDescriptor(target,key){reads++;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const r=validateScene({steps:[{say:'x',actions:[loft({outline,parent:'missing'}),{op:'add',shape:'box',id:'other',size:[1,1,1]}]}]},createSceneState());
  assert.equal(reads,0);assert.equal(r.scene?.steps[0]!.actions.length,1);
});

test('loft accepts nonsingular matched sections with legal endpoint-only wall contacts',()=>{
  // A symmetric positive-definite end transform: eigenvalues about .0847 and 2.0053.
  // Every interpolated section remains convex. Adjacent original faces meet only
  // at their corner, including strip endpoints where a diagonal segment vanishes.
  const diamond=[[-.11,-.06],[2.03,-1.98],[.11,.06],[-2.03,1.98]];
  for(const tier of ['low','mid','high'] as const){const {panel,mesh}=build(loft({endOutline:diamond,depth:1}),tier);try{inspect(mesh.geometry);}finally{panel.destroy();}}
});

test('loft keeps thin translated profiles whose collinear wall events are spatially separate',()=>{
  // Seeded review case: exact rational section checks establish disjoint wall
  // segments at the shared collinearity event; raw floating signs alone disagree.
  const outline=[[-43.54353275443049,-12.627826865577502],[-43.43268184585119,-12.575254563757824],[-43.328381066074655,-12.510654887369471],[-43.43923197465395,-12.56322718918915]];
  const endOutline=[[-53.40766088514388,-29.68732225953849],[-53.41449685538817,-29.69988411188478],[-53.42058470995366,-29.712825079790633],[-53.41374873970937,-29.700263227444342]];
  for(const tier of ['low','mid','high'] as const){const {panel,mesh}=build(loft({outline,endOutline,depth:.09971563377835078}),tier);try{inspect(mesh.geometry);}finally{panel.destroy();}}
});
