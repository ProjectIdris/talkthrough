import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Mesh, Raycaster, Vector3 } from 'three';
import type { Step,Vec2 } from '../src/scene/types.ts';
import { taperedExtrudeGeometry } from '../src/overlay/tapered-extrusion.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { extrudeGeometry,DETAIL } from '../src/overlay/geometry.ts';
import { emptyFrame,planStep,settle } from '../src/overlay/timeline.ts';
const rectangle:Vec2[]=[[-2,-1],[2,-1],[2,1],[-2,1]];
function shown(outline:Vec2[]=rectangle,extra:Record<string,unknown>={}) {
  const frame=settle(planStep(emptyFrame(),{say:'',actions:[{op:'add',shape:'extrude',id:'body',outline,depth:4,taper:0.5,shift:[1,2],edges:false,...extra}]} as Step));
  const panel=new PanelScene();panel.sync(frame,1);const mesh=panel.nodeOf(frame.objects[0]!.key) as Mesh;
  mesh.updateWorldMatrix(true,true);return {panel,frame,mesh};
}
function inspect(g:BufferGeometry) {
  const p=g.getAttribute('position'),n=g.getAttribute('normal');assert.ok(p.count);assert.equal(p.count%3,0);
  const edges=new Map<string,{count:number,balance:number}>();let volume=0;
  const key=(p:Vector3)=>[p.x||0,p.y||0,p.z||0].join(',');
  const v=[new Vector3(),new Vector3(),new Vector3()];const face=new Vector3(),a=new Vector3(),b=new Vector3();
  for(let i=0;i<p.count;i+=3){
    for(let j=0;j<3;j++)v[j]!.fromBufferAttribute(p,i+j);
    face.crossVectors(a.subVectors(v[1]!,v[0]!),b.subVectors(v[2]!,v[0]!));assert.ok(face.lengthSq()>0);face.normalize();
    for(let j=0;j<3;j++){
      const normal=a.fromBufferAttribute(n,i+j);assert.ok(Math.abs(normal.length()-1)<1e-6);assert.ok(normal.dot(face)>0.999999);
      const from=key(v[j]!),to=key(v[(j+1)%3]!);const id=from<to?from+'/'+to:to+'/'+from;
      const edge=edges.get(id)??{count:0,balance:0};edge.count++;edge.balance+=from<to?1:-1;edges.set(id,edge);
    }
    volume+=v[0]!.dot(a.crossVectors(v[1]!,v[2]!))/6;
  }
  for(const [id,e]of edges){assert.equal(e.count,2,id);assert.equal(e.balance,0,id);}assert.ok(volume>0);return volume;
}
test('taper and shift set the positive-z endpoint and exact prismatoid volume',()=>{
  const {panel,mesh}=shown();try{
    const p=mesh.geometry.getAttribute('position');const top=Array.from({length:p.count},(_,i)=>i).filter(i=>p.getZ(i)===2);
    assert.equal(Math.min(...top.map(i=>p.getX(i))),0);assert.equal(Math.max(...top.map(i=>p.getX(i))),2);
    assert.equal(Math.min(...top.map(i=>p.getY(i))),1.5);assert.equal(Math.max(...top.map(i=>p.getY(i))),2.5);
    assert.ok(Math.abs(inspect(mesh.geometry)-8*4*(1+0.5+0.25)/3)<1e-6);
  }finally{panel.destroy();}
});
test('concave tapered and shifted profiles stay closed without filling their notch',()=>{
  const outline:Vec2[]=[[-2,-2],[2,-2],[2,-1],[-1,-1],[-1,2],[-2,2]];
  for(const reverse of [false,true])for(const taper of [0.05,0.5,1,4]){
    const {panel,mesh}=shown(reverse?[...outline].reverse():outline,{taper,shift:[1,2]});try{
      const expected=7*4*(1+taper+taper*taper)/3;assert.ok(Math.abs(inspect(mesh.geometry)-expected)/expected<1e-6);
      const ray=new Raycaster(new Vector3(1,2,10),new Vector3(0,0,-1));
      assert.equal(ray.intersectObject(mesh,false).length,0,'origin stays in missing quadrant along all interpolated sections');
    }finally{panel.destroy();}
  }
});
test('omitted and null deformation preserve exact old geometry',()=>{
  for(const taper of [undefined,null])for(const shift of [undefined,null]){
    const {panel,mesh}=shown(rectangle,{taper,shift});const expected=extrudeGeometry(rectangle,4,0.1,DETAIL.mid);
    try{for(const name of ['position','normal','uv'])assert.deepEqual(mesh.geometry.getAttribute(name).array,expected.getAttribute(name).array);}
    finally{panel.destroy();expected.dispose();}
  }
});

test('compact taper outlines keep the same twelve structural edges as larger copies',()=>{
  const count=(size:number)=>{
    const p:Vec2[]=[[-size,-size],[size,-size],[size,size],[-size,size]];
    const {panel,mesh}=shown(p,{taper:0.1,shift:[0,0],depth:0.01,edges:true});
    try{return (mesh.children.find(x=>x.type==='LineSegments') as Mesh).geometry.getAttribute('position').count;}
    finally{panel.destroy();}
  };
  assert.equal(count(0.0002),count(0.002));assert.equal(count(0.0002),24);
});


test('direct builder invalid inputs produce empty finite geometry',()=>{
  for(const [outline,depth,taper,shift] of [[rectangle,0,1,[0,0]],[rectangle,4,-1,[0,0]],[rectangle,4,1,[Infinity,0]],[[[0,0],[2,2],[0,2],[2,0]],4,1,[0,0]]] as [Vec2[],number,number,Vec2][]){
    const g=taperedExtrudeGeometry(outline,depth,taper,shift);assert.equal(g.getAttribute('position').count,0);g.dispose();
  }
});
test('tapered profiles keep transforms, copies, cut caps, reuse and exactly-once disposal',()=>{
  const first=settle(planStep(emptyFrame(),{say:'',actions:[
    {op:'add',shape:'group',id:'parent',pos:[3,2,1],rot:[15,20,35]},
    {op:'scale',id:'parent',to:[2,0.7,1.3],dur:0},
    {op:'add',shape:'extrude',id:'body',parent:'parent',outline:rectangle,depth:4,taper:0.5,shift:[1,2]},
    {op:'add',shape:'array',id:'copies',of:'body',count:2,step:[4,0,0]},
    {op:'cut',id:'body',axis:'y',to:0,dur:0},
  ]} as Step));
  const panel=new PanelScene();panel.sync(first,1);
  const node=(frame:typeof first,id:string)=>panel.nodeOf(frame.objects.find(o=>o.id===id)!.key) as Mesh;
  const mesh=node(first,'body'),geometry=mesh.geometry;const held=geometry.getAttribute('position').array.slice();
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++);
  assert.equal(mesh.parent,node(first,'copies'));assert.equal(mesh.parent?.parent,node(first,'parent'));
  assert.deepEqual(mesh.getWorldPosition(new Vector3()).toArray(),[3,2,1]);
  const caps=()=>panel.scene.children.filter(o=>o.visible&&o instanceof Mesh&&!Array.isArray(o.material)&&o.material.stencilWrite);
  assert.ok(caps().length>0);
  panel.sync(first,1);assert.equal(mesh.geometry,geometry);assert.equal(disposed,0);
  const replacement=settle(planStep(first,{say:'',actions:[{op:'add',shape:'extrude',id:'body',parent:'parent',outline:rectangle,depth:3,taper:2,shift:[0,0]}]} as Step));
  panel.sync(replacement,1);assert.equal(disposed,1);assert.notEqual(node(replacement,'body').geometry,geometry);
  assert.deepEqual(geometry.getAttribute('position').array,held);
  const current=node(replacement,'body').geometry;let currentDisposed=0;current.addEventListener('dispose',()=>currentDisposed++);
  panel.sync(settle(planStep(replacement,{say:'',actions:[{op:'clear',target:'all'}]} as Step)),1);
  assert.equal(panel.count(),0);assert.equal(caps().length,0);assert.equal(currentDisposed,1);panel.destroy();assert.equal(disposed,1);assert.equal(currentDisposed,1);
});

test('authored tapered sample validates without repair and builds at every tier',async()=>{
  const {readFileSync}=await import('node:fs');const {validateScene}=await import('../src/scene/index.ts');
  const raw=JSON.parse(readFileSync(new URL('../samples/scenes/tapered-extrusions.json',import.meta.url),'utf8'));
  const result=validateScene(raw);assert.ok(result.scene);assert.deepEqual(result.issues,[]);
  for(const tier of ['low','mid','high']as const){
    const panel=new PanelScene({tier});let frame=emptyFrame();
    try{for(const step of result.scene.steps){frame=settle(planStep(frame,step));panel.sync(frame,1.5);for(const o of frame.objects)if(o.def.shape==='extrude')inspect((panel.nodeOf(o.key)as Mesh).geometry);}}
    finally{panel.destroy();}
  }
});

test('direct geometry rejects the shallow folded-wall Float32 regression',()=>{
  const outline:Vec2[]=[[52.255289470776916,82.73688815999776],[52.25528988426754,82.73689152147436],[54.63333492865786,79.62561952415854]];
  const geometry=taperedExtrudeGeometry(outline,0.01,0.05,[0,0]);
  try{assert.equal(geometry.getAttribute('position').count,0);}finally{geometry.dispose();}
});

test('direct geometry rejects the aligned-normal self-crossing wall regression',()=>{
  const outline:Vec2[]=[[-89.82062,-68.04085],[-89.8205,-68.04098],[-86.5825,-72.26904]];
  const geometry=taperedExtrudeGeometry(outline,0.01,0.05,[22,-11]);
  try{assert.equal(geometry.getAttribute('position').count,0);}finally{geometry.dispose();}
});
