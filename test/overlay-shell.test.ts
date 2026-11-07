import test from 'node:test';
import assert from 'node:assert/strict';
import { LineSegments, Mesh, Vector3 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial, Object3D } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt, emptyFrame } from '../src/overlay/timeline.ts';
import { createSceneState, createDetailState, validateScene } from '../src/scene/index.ts';
import type { Scene } from '../src/scene/types.ts';

const shell = (extra: Record<string, unknown> = {}) => ({op:'add',shape:'shell',id:'piece',size:[4,6,8],...extra});
function validated(actions: unknown[], state = createSceneState()): Scene {
  const r=validateScene({steps:[{say:'Curved hollow sections.',actions}]},state);
  assert.deepEqual(r.issues, []); assert.ok(r.scene); return r.scene;
}
function meshOf(o: Object3D | undefined): Mesh {
  let mesh: Mesh | undefined; o?.traverse(c=>{if(!mesh && c instanceof Mesh)mesh=c;});
  assert.ok(mesh,'the authored shell reaches the actual renderer');return mesh;
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
    for(let k=0;k<3;k++){const x=key(ids[k]!),y=key(ids[(k+1)%3]!);const label=x<y?`${x}|${y}`:`${y}|${x}`;
      const e=edges.get(label)??{count:0,direction:0};e.count++;e.direction+=x<y?1:-1;edges.set(label,e);}
  }
  assert.ok(volume>0);for(const e of edges.values()){assert.equal(e.count,2,'closed edge incidence');assert.equal(e.direction,0);}
  return volume;
}

test('shell retains radial thickness, angular spans and ordinary object fields',()=>{
  const action=shell({inner:.7,latitude:[-35,80],sweep:250,parent:'model',pos:[2,1,0],rot:[10,20,30],explode:[1,0,0],material:'metal',color:'#7799aa',opacity:.7,edges:true});
  assert.deepEqual(validated([{op:'add',shape:'group',id:'model'},action]).steps[0]!.actions[1],action);
});

test('shell rejects unsafe parameters before consuming an ID or replacement permission',()=>{
  const cases=[{size:[0,1,1]},{size:[101,1,1]},{size:[1,2]},{size:[NaN,1,1]},
    {inner:0},{inner:1},{inner:Infinity},{latitude:[0,0]},{latitude:[30,-30]},{latitude:[89.5,90]},
    {latitude:[-91,90]},{latitude:[0,91]},{latitude:[0,45,90]},{sweep:0},{sweep:361},{sweep:'90'}];
  for(const bad of cases){const r=validateScene({steps:[{say:'x',actions:[shell(bad),shell()]}]},createSceneState());
    assert.deepEqual(r.scene?.steps[0]!.actions,[shell()],JSON.stringify(bad));assert.ok(r.issues.some(x=>x.kind==='dropped'));
    const initial=createSceneState();validated([{op:'add',shape:'box',id:'piece',size:[1,1,1]}],initial);
    const detail=createDetailState(initial),before=[...detail.bodies];validateScene({steps:[{say:'x',actions:[shell(bad)]}]},detail);
    assert.equal(detail.replaceable?.has('piece'),true);assert.deepEqual([...detail.bodies],before);
    assert.deepEqual(validated([shell()],detail).steps[0]!.actions,[shell()]);}
});

test('shell refuses sparse and accessor vectors without invoking getters',()=>{
  let reads=0;const a=[4,6,8];Object.defineProperty(a,'0',{get(){reads++;return 4;}});
  const b=[-90,90];Object.defineProperty(b,'1',{get(){reads++;return 90;}});
  const c=[4,6,8];delete c[0];
  for(const bad of [{size:a},{latitude:b},{size:c}]){const r=validateScene({steps:[{say:'x',actions:[shell(bad),shell()]}]},createSceneState());assert.deepEqual(r.scene?.steps[0]!.actions,[shell()]);}
  assert.equal(reads,0);
});

test('complete shells have a real inward-facing cavity, exact bounds and no seam outlines',()=>{
  for(const tier of ['low','mid','high'] as const){const {panel,mesh}=build(shell({inner:.5}),tier);try{
    const volume=inspect(mesh.geometry);assert.ok(volume>4*Math.PI/3*2*3*4*(1-.5**3)*.93);assert.ok(volume<4*Math.PI/3*2*3*4*(1-.5**3));
    mesh.geometry.computeBoundingBox();assert.deepEqual(mesh.geometry.boundingBox!.min.toArray(),[-2,-3,-4]);assert.deepEqual(mesh.geometry.boundingBox!.max.toArray(),[2,3,4]);
    const p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal');let inward=0,outward=0;
    for(let i=0;i<p.count;i++){const q=(p.getX(i)/2)**2+(p.getY(i)/3)**2+(p.getZ(i)/4)**2;
      const expected=new Vector3(p.getX(i)/4,p.getY(i)/9,p.getZ(i)/16).normalize();
      if(Math.abs(q-.25)<1e-6){expected.negate();inward++;}else{near(q,1);outward++;}
      near(new Vector3().fromBufferAttribute(n,i).distanceTo(expected),0);}
    assert.ok(inward&&outward);assert.equal(mesh.children.filter(c=>c instanceof LineSegments).length,0);
  }finally{panel.destroy();}}
});

test('hemispheres and cut-open shells remain closed material volumes with only boundary outlines',()=>{
  for(const tier of ['low','mid','high'] as const)for(const extra of [{latitude:[0,90]},{latitude:[-90,0]},{sweep:270},{latitude:[-35,55],sweep:120}]){
    const {panel,mesh}=build(shell(extra),tier);try{inspect(mesh.geometry);const lines=mesh.children.filter(c=>c instanceof LineSegments) as LineSegments[];assert.equal(lines.length,tier==='low'?0:1);
      if(tier==='low')continue;
      const p=lines[0]!.geometry.getAttribute('position');assert.ok(p.count>0&&p.count<=488);for(let i=0;i<p.count;i+=2)assert.notDeepEqual([p.getX(i),p.getY(i),p.getZ(i)],[p.getX(i+1),p.getY(i+1),p.getZ(i+1)]);
      if(extra.latitude?.[0]===0){mesh.geometry.computeBoundingBox();assert.equal(mesh.geometry.boundingBox!.min.y,0);assert.equal(mesh.geometry.boundingBox!.max.y,3);}
    }finally{panel.destroy();}}
});

test('shell keeps parent transforms, arrays, clipping, repeated sync and exactly-once disposal',()=>{
  const scene=validated([{op:'add',shape:'group',id:'model',pos:[3,0,0]},shell({parent:'model',sweep:270}),{op:'add',shape:'array',id:'copies',of:'piece',count:3,step:[0,7,0]},{op:'cut',id:'model',axis:'z',to:0,dur:0}]);
  const f=frameAt(scene.steps,0,99),panel=new PanelScene({tier:'high'});panel.sync(f,1);
  try{const objects=f.objects.filter(o=>o.shape==='shell');assert.equal(objects.length,3);const resources=new Set<BufferGeometry|MeshPhysicalMaterial>();
    for(const o of objects){const mesh=meshOf(panel.nodeOf(o.key));near(mesh.getWorldPosition(new Vector3()).x,3);assert.ok((mesh.material as MeshPhysicalMaterial).clippingPlanes?.length);
      mesh.traverse(c=>{if(c instanceof Mesh||c instanceof LineSegments){resources.add(c.geometry);resources.add(c.material as MeshPhysicalMaterial);}});
      panel.sync(f,1);assert.equal(meshOf(panel.nodeOf(o.key)).geometry,mesh.geometry);}
    const disposed=new Map<object,number>();for(const r of resources)r.addEventListener('dispose',()=>disposed.set(r,(disposed.get(r)??0)+1));panel.sync(emptyFrame(),1);
    for(const r of resources)assert.equal(disposed.get(r),1);panel.destroy();for(const r of resources)assert.equal(disposed.get(r),1);
  }finally{panel.destroy();}
});

test('shell replacement and backward seek retain the requested hemisphere',()=>{
  const state=createSceneState(),first=validated([shell({latitude:[0,90]})],state),second=validated([shell({latitude:[-90,0]})],createDetailState(state));
  const steps=[...first.steps,...second.steps],panel=new PanelScene();try{for(const i of [0,1,0,1]){const f=frameAt(steps,i,99);panel.sync(f,1);const mesh=meshOf(panel.nodeOf(f.objects[0]!.key));mesh.geometry.computeBoundingBox();near(mesh.geometry.boundingBox!.min.y,i===0?0:-3);near(mesh.geometry.boundingBox!.max.y,i===0?3:0);inspect(mesh.geometry);}}finally{panel.destroy();}
});

test('shell parents retain their transform for automatic attachment to child solids',()=>{
  const parent=shell({pos:[10,0,0]}),child={op:'add',shape:'box',id:'child',parent:'piece',size:[2,2,2]};
  const wire={op:'add',shape:'tube',id:'wire',pts:[[1,0,0],[5,0,0]],radius:.05};
  assert.equal((validated([parent,child,wire]).steps[0]!.actions[2] as {attach?:unknown}).attach,undefined);
  const r=validateScene({steps:[{say:'x',actions:[parent,child,{...wire,pts:[[11,0,0],[15,0,0]]}]}]},createSceneState());
  assert.ok(r.issues.every(x=>x.kind==='trimmed'));assert.deepEqual((r.scene!.steps[0]!.actions[2] as {attach?:unknown}).attach,[{to:'child',at:[1,0,0]},null]);
});

test('held shell references defer parameter work until the parent exists',()=>{
  let reads=0;const size=new Proxy([4,6,8],{getOwnPropertyDescriptor(target,key){reads++;return Reflect.getOwnPropertyDescriptor(target,key);}});
  const r=validateScene({steps:[{say:'x',actions:[shell({size,parent:'missing'}),{op:'add',shape:'box',id:'other',size:[1,1,1]}]}]},createSceneState());
  assert.equal(reads,0);assert.equal(r.scene?.steps[0]!.actions.length,1);
});

test('shell wall normals remain sharp and follow radial latitude rims',()=>{
  const {panel,mesh}=build(shell({size:[4,6,8],inner:.5,latitude:[-30,30],sweep:90}));try{
    inspect(mesh.geometry);const p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal');
    // Start wall is -z, end wall is -x; no centre fill between the inner and outer rim.
    let start=0,end=0,lower=0,upper=0;
    for(let i=0;i<p.count;i++){
      if(Math.abs(n.getZ(i)+1)<1e-7){near(p.getZ(i),0);assert.ok(p.getX(i)>0);start++;}
      if(Math.abs(n.getX(i)+1)<1e-7){near(p.getX(i),0);assert.ok(p.getZ(i)>0);end++;}
      const unitRadius=Math.sqrt((p.getX(i)/2)**2+(p.getY(i)/3)**2+(p.getZ(i)/4)**2);
      if(Math.abs(Math.abs(p.getY(i)/(3*unitRadius))-.5)<1e-6&&Math.abs(n.getY(i))>.7){
        const sign=p.getY(i)>0?1:-1,phi=Math.atan2(p.getZ(i)/4,p.getX(i)/2);
        const expected=new Vector3(-.5*Math.cos(phi)/2,sign*Math.sqrt(.75)/3,-.5*Math.sin(phi)/4).normalize();
        if(new Vector3().fromBufferAttribute(n,i).distanceTo(expected)<1e-6){if(sign>0)upper++;else lower++;}
      }
    }
    assert.ok(start&&end&&lower&&upper);
  }finally{panel.destroy();}
});

test('bounded shell preparation handles compact poles, thin walls and extreme aspect ratios',async()=>{
  const {prepareShell}=await import('../src/scene/shell.ts');const {shellGeometry}=await import('../src/overlay/shell.ts');
  for(const tier of ['low','mid','high'] as const)for(const size of [[.01,.01,.01],[100,.01,100],[.01,100,.01]])for(const latitude of [[-90,90],[89,90],[-90,-89],[-.5,.5]])for(const sweep of [1,90,359.99,360]){
    const mesh=prepareShell(size,.99,latitude,sweep,tier);assert.ok(mesh,`${tier} ${size} ${latitude} ${sweep}`);
    const geometry=shellGeometry(shell({size,inner:.99,latitude,sweep}) as never,tier);assert.ok(geometry);try{inspect(geometry);}finally{geometry.dispose();}}
  for(const tier of ['bad','__proto__',undefined,4])assert.equal(prepareShell([1,1,1],null,null,null,tier as never),undefined);
  for(const size of [null,{},'x',new Float32Array([1,1,1])])assert.equal(prepareShell(size,null,null,null,'high'),undefined);
  assert.equal(shellGeometry(shell({size:[0,1,1]}) as never,'high'),undefined);
  const max=prepareShell([4,6,8],.85,[-89,89],359,'high');assert.ok(max);
  assert.equal(max.positions.length/3,1970);assert.equal(max.indices.length/3,3440);assert.equal(max.edges.length/6,244);
});

test('shell optional nulls inherit defaults and material/edge choices stay ordinary',()=>{
  const a=build(shell()),b=build(shell({inner:null,latitude:null,sweep:null}));try{assert.deepEqual(a.mesh.geometry.getAttribute('position').array,b.mesh.geometry.getAttribute('position').array);}finally{a.panel.destroy();b.panel.destroy();}
  for(const extra of [{edges:false},{material:'glass'},{material:'glow'}]){const {panel,mesh}=build(shell({latitude:[0,90],...extra}));try{assert.equal(mesh.children.filter(c=>c instanceof LineSegments).length,0);}finally{panel.destroy();}}
});

test('the authored shell example validates unchanged and retains real geometry in each view',async()=>{
  const {readFileSync}=await import('node:fs');const scene=JSON.parse(readFileSync(new URL('../samples/scenes/ellipsoid-shells.json',import.meta.url),'utf8')) as Scene;
  const r=validateScene(scene,createSceneState());assert.deepEqual(r.issues,[]);assert.deepEqual(r.scene,scene);
  for(const tier of ['low','mid','high'] as const){const panel=new PanelScene({tier});try{for(let step=0;step<scene.steps.length;step++){
    const f=frameAt(scene.steps,step,99);panel.sync(f,1.4);const shells=f.objects.filter(o=>o.shape==='shell');assert.equal(shells.length,3);
    for(const o of shells)inspect(meshOf(panel.nodeOf(o.key)).geometry);
  }}finally{panel.destroy();}}
});

test('ellipsoidal shell admission does not confuse analytic vertex normals with coarse face normals',()=>{
  // An analytic vertex normal may be obtuse to a coarse triangle after unequal-axis scaling.
  // It is still the correct ellipsoid gradient; this does not reverse the emitted face.
  for(const tier of ['low','mid','high'] as const){const {panel,mesh}=build(shell({
    size:[0.8453663832123467,30.13938229928541,11.058454790771178],inner:.8799634898453951,
    latitude:[19.33869622135535,35.354411552414405],sweep:282.80823015631177,
  }),tier);try{
    inspect(mesh.geometry);
    const p=mesh.geometry.getAttribute('position'),n=mesh.geometry.getAttribute('normal');
    const axes=[.8453663832123467/2,30.13938229928541/2,11.058454790771178/2];
    const detail={low:[16,8],mid:[24,12],high:[40,20]}[tier]!;
    const columns=Math.max(2,Math.ceil(detail[0]!*282.80823015631177/360));
    const rows=Math.max(2,Math.ceil(detail[1]!*(35.354411552414405-19.33869622135535)/180));
    const skinVertices=(columns+1)*(rows+1);
    for(let i=0;i<skinVertices*2;i++){
      const gradient=new Vector3(p.getX(i)/axes[0]!**2,p.getY(i)/axes[1]!**2,p.getZ(i)/axes[2]!**2).normalize();
      if(i>=skinVertices)gradient.negate();
      near(gradient.distanceTo(new Vector3().fromBufferAttribute(n,i)),0);
    }
  }finally{panel.destroy();}}
});
