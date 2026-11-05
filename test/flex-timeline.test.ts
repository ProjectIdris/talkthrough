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
