import test from 'node:test';
import assert from 'node:assert/strict';
import { createDetailState, createSceneState, validateScene, sceneGuide, sceneSchema } from '../src/scene/index.ts';
const outline = [[-2,-1],[2,-1],[2,1],[-2,1]];
const add = (extra: Record<string,unknown> = {}) => ({op:'add',shape:'extrude',id:'body',outline,depth:4,taper:0.5,shift:[1,2],...extra});
function run(action: unknown, state = createSceneState()) {
  const result = validateScene({steps:[{say:'',actions:[action]}]},state);
  return result.scene?.steps.flatMap(s=>s.actions) ?? [];
}
test('taper and shift survive validation and are described in schema and guide',()=>{
  const a=run(add())[0] as any;
  assert.equal(a?.taper,0.5); assert.deepEqual(a?.shift,[1,2]);
  const def=(sceneSchema as any).$defs.addExtrude;
  assert.deepEqual(def.properties.taper.type,['number','null']);
  assert.deepEqual(def.properties.shift.type,['array','null']);
  assert.match(def.description,/positive.z/); assert.match(sceneGuide,/taper\?/); assert.match(sceneGuide,/shift\?/);
});
test('tapered extrusions reject unsafe ranges, incompatible bevel and holes rather than silently repairing',()=>{
  const invalid=[{taper:0},{taper:-1},{taper:21},{taper:Infinity},{taper:'0.5'},{shift:[101,0]},{shift:[0]},{shift:[NaN,0]},{shift:[0,0,0]},{depth:0},{depth:101},{depth:NaN},{bevel:0.1},{holes:[[[0,0],[1,0],[0,1]]]},{outline:[[99,0],[100,0],[100,1]],taper:2}];
  for(const extra of invalid) assert.equal(run(add(extra)).length,0,JSON.stringify(extra));
  for(const extra of [{taper:0.05},{taper:20,shift:[0,0]},{taper:1},{taper:null},{shift:null},{bevel:0},{holes:[]}]) assert.equal(run(add(extra)).length,1,JSON.stringify(extra));
});
test('simple outlines normalize winding, closing duplicate and exact collinear runs',()=>{
  for(const p of [outline,[...outline].reverse(),[...outline,outline[0]], [[-2,-1],[0,-1],[2,-1],[2,1],[-2,1]]]) {
    const a=run(add({outline:p}))[0] as any;
    assert.equal(a?.outline.length,4);
    assert.ok(a.outline.reduce((s:number,p:number[],i:number)=>{const q=a.outline[(i+1)%4];return s+p[0]!*q[1]-q[0]*p[1]!;},0)>0);
  }
});
test('unsafe outlines and Float32 collapsed end rings reject before state changes',()=>{
  const bad=[[],[[0,0],[1,1]],[[0,0],[2,2],[0,2],[2,0]],[[0,0],[1,0],[2,0]],[[0,0],[2,0],[2,2],[1,0],[0,2]],[[0,0],[2,0],[1,0],[2,2],[0,2]],[[1,0],[1+1e-9,0],[1+1e-9,2],[1,2]],Array.from({length:41},(_,i)=>[Math.cos(i),Math.sin(i)])];
  for(const p of bad)assert.equal(run(add({outline:p})).length,0,JSON.stringify(p));
  assert.equal(run(add({outline:[[0,0],[0.00001,0],[0.00001,0.00001],[0,0.00001]],taper:0.05,shift:[99,99]})).length,0);
  const state=createSceneState();run({op:'add',shape:'box',id:'body',size:[1,1,1]},state);
  const detail=createDetailState(state);const before={ids:new Map(detail.ids),bodies:new Map(detail.bodies),replaceable:new Set(detail.replaceable)};
  assert.equal(run(add({taper:0}),detail).length,0);
  assert.deepEqual(detail.ids,before.ids);assert.deepEqual(detail.bodies,before.bodies);assert.deepEqual(detail.replaceable,before.replaceable);
  assert.equal(run(add(),detail).length,1);assert.equal(detail.replaceable?.has('body'),false);
});
test('accessor fields and sparse points reject without executing getters',()=>{
  let reads=0;
  for(const field of ['taper','shift','outline','depth','bevel','holes']){
    const a=add();Object.defineProperty(a,field,{get(){reads++;return 1;}});
    assert.equal(run(a).length,0,field);
  }
  const p=outline.map(p=>[...p]);Object.defineProperty(p[1],'0',{get(){reads++;return 2;}});
  assert.equal(run(add({outline:p})).length,0);
  const sparse=outline.map(p=>[...p]);delete sparse[1];assert.equal(run(add({outline:sparse})).length,0);
  assert.equal(reads,0);
});
test('omitted or null taper and shift preserve permissive legacy behavior',()=>{
  for(const taper of [undefined,null])for(const shift of [undefined,null]){
    const a=run(add({taper,shift,depth:200,bevel:0.1}))[0] as any;
    assert.equal(a?.depth,100);assert.equal('taper' in a,false);assert.equal('shift' in a,false);
  }
});

test('Float32-folded shallow walls reject before consuming replacement permission',()=>{
  const outline=[[52.255289470776916,82.73688815999776],[52.25528988426754,82.73689152147436],[54.63333492865786,79.62561952415854]];
  const state=createSceneState();run({op:'add',shape:'box',id:'body',size:[1,1,1]},state);
  const detail=createDetailState(state),body=detail.bodies.get('body');
  assert.equal(run(add({outline,depth:0.01,taper:0.05,shift:[0,0]}),detail).length,0);
  assert.equal(detail.bodies.get('body'),body);assert.equal(detail.replaceable?.has('body'),true);
  assert.equal(run(add({outline:[[52,82],[52.01,82.02],[54,79]],depth:0.01,taper:0.05,shift:[0,0]})).length,1);
});

test('self-crossing emitted wall sections reject even when endpoint caps and normals look safe',()=>{
  const outline=[[-89.82062,-68.04085],[-89.8205,-68.04098],[-86.5825,-72.26904]];
  assert.equal(run(add({outline,depth:0.01,taper:0.05,shift:[22,-11]})).length,0);
});
