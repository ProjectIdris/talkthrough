import {test} from 'node:test';import assert from 'node:assert/strict';
import {emptyFrame,planStep,evaluate,settle,withMotion} from '../src/overlay/timeline.ts';
import {validateScene} from '../src/scene/validate.ts';
const actions=[{op:'add',shape:'box',id:'mount',size:[1,1,1]},{op:'add',shape:'flexSurface',id:'reed',parent:'mount',root:{parentPoint:[.45,0,0],normal:[1,0,0],maxGap:.1},joints:[{id:'a',u:0,offset:[0,0,0],axis:[0,0,1],min:-30,max:30},{id:'b',u:1,offset:[0,0,0],axis:[0,0,1],min:-20,max:20}],sections:[{u:0,center:[.45,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0},{u:.5,center:[1,0,0],chord:[0,0,1],halfWidth:.5,camber:0,profileDelta:.1},{u:1,center:[2,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0}]},{op:'flexCycle',ids:['reed'],period:2,phase:0,at:1,keys:[{t:0,angles:[0,0],profile:0},{t:.5,angles:[10,10],profile:1},{t:1,angles:[0,0],profile:0}]}];
const get=(frame:any)=>frame.objects.find((o:any)=>o.id==='reed')?.flexPose;
test('articulated cycle is time-derived, seekable and carries across steps and idle',()=>{const result=validateScene({steps:[{say:'x',actions}]});const step=result.scene!.steps[0]!;const plan=planStep(emptyFrame(),step);assert.equal(get(evaluate(plan,.5)),undefined);assert.deepEqual(get(evaluate(plan,1)),{angles:[0,0],profile:0});assert.deepEqual(get(evaluate(plan,2)),{angles:[10,10],profile:1});assert.deepEqual(get(evaluate(plan,2)),get(evaluate(plan,2)));const end=settle(plan);const continued=withMotion(end,1);assert.notDeepEqual(get(end),get(continued));const next=planStep(continued,{say:'next',actions:[]});assert.deepEqual(get(evaluate(next,0)),get(continued));});

test('later timeline event wins even when cycle actions arrive out of timestamp order',()=>{
 const late={...actions[2],at:2,keys:[{t:0,angles:[3,3],profile:0},{t:.5,angles:[9,9],profile:1},{t:1,angles:[3,3],profile:0}]};
 const early={...actions[2],at:1};const r=validateScene({steps:[{say:'x',actions:[...actions.slice(0,2),late,early]}]});const p=planStep(emptyFrame(),r.scene!.steps[0]!);assert.deepEqual(get(evaluate(p,2)),{angles:[3,3],profile:0});
});

test('stopping one target returns it to bind pose and leaves other targets driven',()=>{
 const second={...actions[1],id:'reed2'};const cycle={...actions[2],ids:['reed','reed2']};
 const r=validateScene({steps:[{say:'x',actions:[actions[0],actions[1],second,cycle,{op:'flexStop',ids:['reed'],at:1.5}]}]});
 assert.equal(r.scene!.steps[0]!.actions.length,5,JSON.stringify(r.issues));
 const frame=evaluate(planStep(emptyFrame(),r.scene!.steps[0]!),2);
 assert.equal(frame.objects.find(o=>o.id==='reed')?.flexPose,undefined);
 assert.deepEqual(frame.objects.find(o=>o.id==='reed2')?.flexPose,{angles:[10,10],profile:1});
});

test('replacing a rigid parent ends its attached surface rather than reparenting it',()=>{
 const r=validateScene({steps:[{say:'x',actions}]});const original=settle(planStep(emptyFrame(),r.scene!.steps[0]!));
 const replace=planStep(original,{say:'replace',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]}]});
 const after=evaluate(replace,1);assert.equal(after.objects.some(o=>o.id==='reed'),false);
});

test('clearing a surface ends its binding, and reusing the id does not silently retarget the feature',()=>{
 const feature={op:'add',shape:'box',id:'feat',size:[.1,.1,.1]},attach={op:'flexAttach',id:'feat',on:'reed',u:.5,v:.5,side:'front',tangentAngle:0};
 const sequence=[...actions.slice(0,2),feature,attach,{op:'clear',target:'reed',at:1},{...actions[1],at:2}];
 const r=validateScene({steps:[{say:'x',actions:sequence}]});assert.equal(r.scene!.steps[0]!.actions.length,6,JSON.stringify(r.issues));const f=evaluate(planStep(emptyFrame(),r.scene!.steps[0]!),3);assert.equal(f.objects.find(o=>o.id==='feat')?.flexAttachment,undefined);
});

test('fast cycles seek and carry by phase, and stop without replaying elapsed cycles',()=>{
 const fast={...actions[2],period:.125,phase:.25,at:1};
 const r=validateScene({steps:[{say:'fast',actions:[...actions.slice(0,2),fast]}]});
 assert.equal(r.scene!.steps[0]!.actions.length,3,JSON.stringify(r.issues));
 const p=planStep(emptyFrame(),r.scene!.steps[0]!);
 const first=get(evaluate(p,1.03125)),later=get(evaluate(p,126.03125));
 assert.deepEqual(first,{angles:[10,10],profile:1});assert.deepEqual(later,first);
 assert.deepEqual(get(evaluate(p,1.03125)),first,'reverse seek returns same pose');
 const base=settle(p),carried=withMotion(base,.03125);const next=planStep(carried,{say:'next',actions:[]});
 assert.deepEqual(get(evaluate(next,0)),get(carried));
 const stopping=planStep(carried,{say:'stop',actions:[{op:'flexStop',ids:['reed'],at:0}]});
 assert.equal(get(evaluate(stopping,.1)),undefined);
});

test('fast cycle posed bounds, attachment and model picking stay phase-equivalent to a slow cycle',async()=>{
 const {PanelScene}=await import('../src/overlay/scene3d.ts');const {surfacePoint}=await import('../src/overlay/flex-attachment.ts');
 const {hitVisibleModel}=await import('../src/overlay/model-hit.ts');const {SkinnedMesh,Vector3}=await import('three');
 const feature={op:'add',shape:'box',id:'feat',size:[.1,.1,.1]};const attach={op:'flexAttach',id:'feat',on:'reed',u:.6,v:.5,side:'front',tangentAngle:0};
 const build=(period:number)=>{const cycle={...actions[2],period,phase:0,at:0};const r=validateScene({steps:[{say:'x',actions:[...actions.slice(0,2),feature,attach,cycle]}]});assert.equal(r.scene!.steps[0]!.actions.length,5,JSON.stringify(r.issues));return planStep(emptyFrame(),r.scene!.steps[0]!);};
 const fast=build(.05),slow=build(2),p=new PanelScene(),q=new PanelScene();
 for(let i=0;i<16;i++){
  const phase=i/16,f=evaluate(fast,2+phase*.05),g=evaluate(slow,2+phase*2);p.sync(f,1);q.sync(g,1);
  const skin=p.nodeOf(f.objects.find(o=>o.id==='reed')!.key) as InstanceType<typeof SkinnedMesh>;
  const other=q.nodeOf(g.objects.find(o=>o.id==='reed')!.key) as InstanceType<typeof SkinnedMesh>;
  assert.ok(skin instanceof SkinnedMesh&&other instanceof SkinnedMesh);
  const envelope=(p as any).nodes.get(f.objects.find(o=>o.id==='reed')!.key).flexRig.envelope;
  for(let j=0;j<skin.geometry.getAttribute('position').count;j++){const a=skin.getVertexPosition(j,new Vector3()),b=other.getVertexPosition(j,new Vector3());assert.ok(a.distanceTo(b)<1e-5);assert.ok(skin.boundingBox!.containsPoint(a));assert.ok(envelope.containsPoint(a));}
  const featureNode=p.nodeOf(f.objects.find(o=>o.id==='feat')!.key)!;const expected=surfacePoint(skin,.6,.5,'front',false)!.position;assert.ok(featureNode.getWorldPosition(new Vector3()).distanceTo(expected)<1e-5,`phase ${phase} actual ${featureNode.getWorldPosition(new Vector3()).toArray()} expected ${expected.toArray()}`);
  const a=skin.getVertexPosition(72,new Vector3()),b=skin.getVertexPosition(79,new Vector3()),c=skin.getVertexPosition(73,new Vector3());const pixel=a.add(b).add(c).multiplyScalar(1/3).applyMatrix4(skin.matrixWorld).project(p.camera);
  const x=(pixel.x+1)*500,y=(1-pixel.y)*500;const before=p.flexPickBudget()!.trianglesRemaining;
  const fastHit=hitVisibleModel([skin],p.camera,1000,1000,x,y,p.flexPickBudget());const slowHit=hitVisibleModel([other],q.camera,1000,1000,x,y,q.flexPickBudget());
  assert.equal(fastHit,slowHit);assert.equal(before-p.flexPickBudget()!.trianglesRemaining,other.geometry.getIndex()!.count/3);
 }
});
