import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LineSegments, Mesh, Vector3 } from 'three';
import type { BufferGeometry, MeshPhysicalMaterial, Object3D } from 'three';
import { sweepGeometry, sweepEdges } from '../src/overlay/sweep.ts';
import { loftGeometry, loftEdges } from '../src/overlay/loft.ts';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { emptyFrame, frameAt } from '../src/overlay/timeline.ts';
import { createDetailState, createSceneState, validateScene } from '../src/scene/index.ts';
import type { AddLoft, AddSweep, Scene, Vec2 } from '../src/scene/types.ts';

const circle = (radius = 1, count = 24): Vec2[] => Array.from({length: count}, (_, i) => [radius * Math.cos(i * 2 * Math.PI / count), radius * Math.sin(i * 2 * Math.PI / count)]);
const square: Vec2[] = [[-1,-1],[1,-1],[1,1],[-1,1]];
const definitions = (outline = circle()): Array<AddLoft | AddSweep> => [
  {op:'add',shape:'loft',id:'piece',outline,endOutline:outline,depth:4},
  {op:'add',shape:'sweep',id:'piece',outline,pts:[[0,0,-2],[0,0,2]]},
];
type Tier = 'low' | 'mid' | 'high';
function geometry(def: AddLoft | AddSweep, tier: Tier = 'high'): BufferGeometry {
  const result = def.shape === 'loft' ? loftGeometry(def,tier) : sweepGeometry(def,tier);
  assert.ok(result); return result;
}
const outlines = (def: AddLoft | AddSweep, geo: BufferGeometry): BufferGeometry => def.shape === 'loft' ? loftEdges(geo) : sweepEdges(geo);
function validate(actions: unknown[], state = createSceneState()): Scene {
  const result = validateScene({steps:[{say:'Profile surfaces.',actions}]},state);
  assert.deepEqual(result.issues,[]); assert.ok(result.scene); return result.scene;
}
function meshOf(node: Object3D | undefined): Mesh {
  let found: Mesh | undefined; node?.traverse(o => {if (!found && o instanceof Mesh) found = o;});
  assert.ok(found); return found;
}
function close(a: number, b: number, epsilon = 2e-6): void { assert.ok(Math.abs(a-b)<epsilon,`${a} ≈ ${b}`); }
function outward(geo: BufferGeometry): void {
  const p=geo.getAttribute('position'),n=geo.getAttribute('normal'),ix=geo.getIndex(); assert.ok(ix);
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),normal=new Vector3();
  for(let i=0;i<n.count;i++){normal.fromBufferAttribute(n,i);close(normal.length(),1);}
  for(let i=0;i<ix.count;i+=3){
    const ids=[ix.getX(i),ix.getX(i+1),ix.getX(i+2)];
    a.fromBufferAttribute(p,ids[0]!); b.fromBufferAttribute(p,ids[1]!); c.fromBufferAttribute(p,ids[2]!);
    const face=b.sub(a).cross(c.sub(a)); assert.ok(face.length()>0);
    for(const id of ids) assert.ok(face.dot(normal.fromBufferAttribute(n,id))>face.length()*1e-6,'normal remains outward on every incident triangle');
  }
}

test('smooth profile shading survives validation without changing default scenes',()=>{
  for(const def of definitions()) for(const smooth of [true,false]) {
    const action={...def,smooth}; assert.deepEqual(validate([action]).steps[0]!.actions,[action]);
  }
  for(const def of definitions()) {
    assert.deepEqual(validate([{...def,smooth:null}]).steps[0]!.actions,[def]);
    const result=validateScene({steps:[{say:'x',actions:[{...def,smooth:'yes'},def]}]},createSceneState());
    assert.deepEqual(result.scene?.steps[0]!.actions,[def]); assert.ok(result.issues.some(i=>i.kind==='dropped'));
  }
});

test('smooth round profiles receive radial wall lighting at every tier and winding',()=>{
  for(const tier of ['low','mid','high'] as const) for(const radius of [1,0.0001]) for(const reverse of [false,true]) {
    const ring=circle(radius); if(reverse)ring.reverse();
    for(const def of definitions(ring)) {
      const geo=geometry({...def,smooth:true} as AddLoft | AddSweep,tier);
      try {
        const p=geo.getAttribute('position'),n=geo.getAttribute('normal'); let walls=0;
        for(let i=0;i<n.count;i++) if(Math.abs(n.getZ(i))<0.5) {
          const length=Math.hypot(p.getX(i),p.getY(i));
          close(n.getX(i),p.getX(i)/length); close(n.getY(i),p.getY(i)/length); close(n.getZ(i),0); walls++;
        }
        assert.ok(walls>100); outward(geo);
        const lines=outlines(def,geo);
        try {const p=lines.getAttribute('position'); assert.equal(p.count,96,'only the two 24-sided cap perimeters remain');
          for(let i=0;i<p.count;i+=2)assert.equal(p.getZ(i),p.getZ(i+1));
        } finally {lines.dispose();}
      } finally {geo.dispose();}
    }
  }
});

test('smoothing preserves sharp caps, angular profiles, triangle data and omitted defaults',()=>{
  for(const ring of [circle(),square,circle(1,8)]) for(const def of definitions(ring)) {
    const plain=geometry(def),smooth=geometry({...def,smooth:true} as AddLoft | AddSweep),off=geometry({...def,smooth:false} as AddLoft | AddSweep);
    try {
      assert.deepEqual(smooth.getAttribute('position').array,plain.getAttribute('position').array);
      assert.deepEqual(smooth.getIndex()!.array,plain.getIndex()!.array);
      assert.deepEqual(smooth.groups,plain.groups);
      assert.deepEqual(off.getAttribute('normal').array,plain.getAttribute('normal').array);
      const n=plain.getAttribute('normal'),s=smooth.getAttribute('normal');
      for(let i=0;i<n.count;i++) if(Math.abs(n.getZ(i))>0.99 || ring.length<=8) {
        assert.deepEqual([s.getX(i),s.getY(i),s.getZ(i)],[n.getX(i),n.getY(i),n.getZ(i)]);
      }
      const a=outlines(def,plain),b=outlines(def,off),c=outlines(def,smooth);
      try {assert.deepEqual(a.getAttribute('position').array,b.getAttribute('position').array);
        if(ring.length<=8)assert.equal(c.getAttribute('position').count,a.getAttribute('position').count);
      } finally {a.dispose();b.dispose();c.dispose();}
      outward(smooth);
    } finally {plain.dispose();smooth.dispose();off.dispose();}
  }
});

test('rounded walls remain outward on bent sweeps and asymmetric lofts without changing mesh geometry',()=>{
  const ring=circle(.18);
  const cases: Array<AddLoft | AddSweep>=[
    {...definitions(ring)[1]!,pts:[[-3,0,0],[-1,.3,0],[1,1,.5],[3,2,1.5]]} as AddSweep,
    {...definitions(ring)[1]!,pts:[[0,0,0],[0,2,0],[.7,4,.4],[2,6,1]]} as AddSweep,
    {...definitions()[0]!,endOutline:circle().map(([x,y])=>[.6*x+.2*y+.4,1.2*y-.2]),depth:2} as AddLoft,
  ];
  for(const tier of ['low','mid','high'] as const) for(const def of cases) {
    const a=geometry(def,tier),b=geometry({...def,smooth:true} as AddLoft | AddSweep,tier);
    try {outward(b);assert.deepEqual(a.getAttribute('position').array,b.getAttribute('position').array);assert.deepEqual(a.getIndex()!.array,b.getIndex()!.array);
      assert.notDeepEqual(a.getAttribute('normal').array,b.getAttribute('normal').array);
    } finally {a.dispose();b.dispose();}
  }
});

test('mixed round and sharp section corners retain only their deliberate longitudinal outlines',()=>{
  const d: Vec2[]=Array.from({length:13},(_,i)=>i===0?[0,-1]:i===12?[0,1]:[Math.cos(-Math.PI/2+i*Math.PI/12),Math.sin(-Math.PI/2+i*Math.PI/12)]);
  for(const def of definitions(d)) {
    const geo=geometry({...def,smooth:true}),lines=outlines(def,geo);
    try {
      outward(geo);const p=lines.getAttribute('position');let joins=0;
      for(let i=0;i<p.count;i+=2)if(p.getZ(i)!==p.getZ(i+1)){
        close(p.getX(i),0);close(p.getX(i+1),0);close(Math.abs(p.getY(i)),1);close(p.getY(i),p.getY(i+1));joins++;
      }
      assert.equal(joins,def.shape==='loft'?2:24,'only the two corners where the arc meets the flat back remain sharp');
    } finally {geo.dispose();lines.dispose();}
  }
  const ring=circle(),def={...definitions(ring)[0]!,endOutline:ring.map(([x,y])=>[x,.1*y]),smooth:true} as AddLoft;
  const geo=geometry(def),lines=outlines(def,geo);
  try {
    outward(geo);const p=lines.getAttribute('position');let joins=0;
    for(let i=0;i<p.count;i+=2)if(p.getZ(i)!==p.getZ(i+1)){
      assert.ok(p.getZ(i)>-2,'a corner that becomes sharp does not redraw its smooth beginning');
      close(p.getZ(i+1),2);close(Math.abs(p.getX(i)),1);joins++;
    }
    assert.equal(joins,2,'the increasingly flat ellipse retains its two sharpened ends');
  } finally {geo.dispose();lines.dispose();}
});

test('near-tangent loft triangles retain outward normals instead of accepting an unsafe blend',()=>{
  const outline: Vec2[]=Array.from({length:16},(_,i)=>[.156*Math.cos(i*Math.PI/8),.534*Math.sin(i*Math.PI/8)]);
  const endOutline: Vec2[]=Array.from({length:16},(_,i)=>[.208*Math.cos(i*Math.PI/8+.853),2.25*Math.sin(i*Math.PI/8+.853)]);
  const def: AddLoft={op:'add',shape:'loft',id:'piece',outline,endOutline,depth:1.78,smooth:true};
  assert.equal(validate([def]).steps[0]!.actions.length,1);
  for(const tier of ['low','mid','high'] as const){
    const geo=geometry(def,tier);
    try{outward(geo);}finally{geo.dispose();}
  }
});

test('concave and normalized sweep sections smooth only their own neighbouring walls',()=>{
  const outer=Array.from({length:11},(_,i)=>-3*Math.PI/4+i*1.5*Math.PI/10);
  const outline: Vec2[]=[...outer.map(a=>[Math.cos(a),Math.sin(a)] as Vec2),...outer.toReversed().map(a=>[.65*Math.cos(a),.65*Math.sin(a)] as Vec2)];
  for(const ring of [outline,outline.toReversed()]) {
    const def={...definitions(ring)[1]!,smooth:true} as AddSweep,geo=geometry(def);
    try {
      outward(geo);const p=geo.getAttribute('position'),n=geo.getAttribute('normal');let inward=0;
      for(let i=0;i<p.count;i++)if(Math.abs(p.getY(i))<1e-6 && p.getX(i)>.6 && p.getX(i)<.7 && Math.abs(n.getZ(i))<.5){close(n.getX(i),-1);close(n.getY(i),0);inward++;}
      assert.ok(inward>10,'inner arc lighting points into the channel rather than borrowing the outer arc');
    } finally {geo.dispose();}
  }
  const normalized: Vec2[]=[[-1,-1],[0,-1],[1,-1],[1,1],[-1,1],[-1,-1]];
  const def={...definitions(normalized)[1]!,smooth:true} as AddSweep,geo=geometry(def);
  try {outward(geo);const p=geo.getAttribute('position');assert.equal(p.count,112,'construction uses the four normalized corners');}
  finally {geo.dispose();}
});

test('real profile objects retain smoothing through arrays, transforms, clipping, repeated sync and replacement',()=>{
  for(const def of definitions()) {
    const state=createSceneState(),first=validate([
      {op:'add',shape:'group',id:'model',pos:[3,0,0]},
      {...def,smooth:true,parent:'model',material:'metal'},
      {op:'add',shape:'array',id:'copies',of:'piece',count:2,step:[0,3,0]},
      {op:'scale',id:'model',to:[2,.7,1.3],dur:0},
      {op:'cut',id:'model',axis:'z',to:0,dur:0},
    ],state);
    const second=validate([{...def,smooth:false,parent:'model'}],createDetailState(state));
    const steps=[...first.steps,...second.steps],panel=new PanelScene({tier:'high'}),all=new Map<BufferGeometry,number>();
    try {
      for(const step of [0,1,0,1]) {
        const frame=frameAt(steps,step,99);panel.sync(frame,1);
        for(const obj of frame.objects.filter(o=>o.shape===def.shape)) {
          const mesh=meshOf(panel.nodeOf(obj.key));outward(mesh.geometry);
          assert.ok((mesh.material as MeshPhysicalMaterial).clippingPlanes?.length);
          const edges=mesh.children.find(o=>o instanceof LineSegments) as LineSegments;
          const replaced = step === 1 && obj.id === 'piece';
          assert.equal((obj.def as AddLoft | AddSweep).smooth,!replaced,'existing array copies retain their original definition');
          assert.equal(edges.geometry.getAttribute('position').count,replaced?(def.shape==='loft'?144:672):96);
          mesh.traverse(o=>{if((o instanceof Mesh || o instanceof LineSegments)&&!all.has(o.geometry)){all.set(o.geometry,0);o.geometry.addEventListener('dispose',()=>all.set(o.geometry,all.get(o.geometry)!+1));}});
          panel.sync(frame,1);assert.equal(meshOf(panel.nodeOf(obj.key)).geometry,mesh.geometry);
        }
      }
      panel.sync(emptyFrame(),1);for(const count of all.values())assert.equal(count,1);
    } finally {panel.destroy();for(const count of all.values())assert.equal(count,1);}
  }
});


test('authored smooth comparison keeps four real solids through its views and ordinary quality policy',()=>{
  const raw=JSON.parse(readFileSync(new URL('../samples/scenes/smooth-profiles.json',import.meta.url),'utf8'));
  const result=validateScene(raw,createSceneState());assert.deepEqual(result.issues,[]);assert.ok(result.scene);
  for(const tier of ['low','mid','high'] as const){
    const panel=new PanelScene({tier});
    try{for(let step=0;step<result.scene.steps.length;step++){
      const frame=frameAt(result.scene.steps,step,99);panel.sync(frame,1);
      const solids=frame.objects.filter(o=>o.shape==='loft'||o.shape==='sweep');assert.equal(solids.length,4);
      for(const obj of solids){const mesh=meshOf(panel.nodeOf(obj.key));outward(mesh.geometry);
        assert.equal(mesh.children.filter(o=>o instanceof LineSegments).length,tier==='low'?0:1);
      }
    }}finally{panel.destroy();}
  }
});
