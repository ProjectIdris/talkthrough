import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateScene,createSceneState,createDetailState} from '../src/scene/validate.ts';import {sceneSchema} from '../src/scene/schema.ts';
import {flexEndpointIssue} from '../src/scene/flex-validate.ts';
const flex={op:'add',shape:'flexSurface',id:'reed',parent:'mount',root:{parentPoint:[.45,0,0],normal:[1,0,0],maxGap:.1},joints:[{id:'a',u:0,offset:[0,0,0],axis:[0,0,1],min:-30,max:30},{id:'b',u:1,offset:[0,0,0],axis:[0,0,1],min:-20,max:20}],sections:[{u:0,center:[.45,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0},{u:.5,center:[1,0,0],chord:[0,0,1],halfWidth:.5,camber:0,profileDelta:.1},{u:1,center:[2,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0}]};
test('surface endpoints give an actionable bounded reason and do not admit a dependent cycle',()=>{
 const mount={op:'add',shape:'box',id:'mount',size:[1,1,1]},bad={...flex,joints:[flex.joints[0],{...flex.joints[1],u:.85}]};
 const cycle={op:'flexCycle',ids:['reed'],period:2,keys:[{t:0,angles:[0,0],profile:0},{t:.5,angles:[10,10],profile:1},{t:1,angles:[0,0],profile:0}]};
 const r=validateScene({steps:[{say:'x',actions:[mount,bad,cycle]}]});assert.equal(r.scene?.steps[0]?.actions.length,1);assert.ok(r.issues.some(i=>i.kind==='dropped'&&/joint.*first.*0.*last.*1/i.test(i.message)),JSON.stringify(r.issues));
 const good=validateScene({steps:[{say:'x',actions:[mount,flex,cycle]}]});assert.equal(good.scene?.steps[0]?.actions.length,3,JSON.stringify(good.issues));
 const badSection={...flex,sections:[{...flex.sections[0],u:.05},...flex.sections.slice(1)]};const s=validateScene({steps:[{say:'x',actions:[mount,badSection]}]});assert.ok(s.issues.some(i=>i.kind==='dropped'&&/section.*first.*0.*last.*1/i.test(i.message)));
});
test('endpoint diagnosis never invokes accessor properties',()=>{
 let reads=0;const bad={...flex,joints:[flex.joints[0],Object.defineProperty({},'u',{get(){reads++;throw Error('getter');}})]};
 assert.equal(flexEndpointIssue(bad),undefined);const r=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},bad]}]});assert.equal(r.scene?.steps[0]?.actions.length,1);assert.equal(reads,0);
});
test('scene schema and validator accept explicit bounded articulated surface',()=>{const result=validateScene({steps:[{say:'A reed opens.',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex]}]});assert.equal(result.scene?.steps[0]?.actions.length,2,JSON.stringify(result.issues));assert.ok(JSON.stringify(sceneSchema).includes('flexSurface'));});


test('only supported rigid parents and at most four surfaces are admitted',()=>{
 const blocked=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'group',id:'mount'},flex]}]});
 assert.equal(blocked.scene?.steps[0]?.actions.length,1,JSON.stringify(blocked.issues));
 const caps=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},...Array.from({length:5},(_,i)=>({...flex,id:'f'+i}))]}]});
 assert.equal(caps.scene?.steps[0]?.actions.length,5,JSON.stringify(caps.issues));
});

test('cycle accepts one or two compatible surfaces and rejects out-of-range channels and unknown targets',()=>{
 const keys=[{t:0,angles:[0,0],profile:0},{t:.5,angles:[10,10],profile:1},{t:1,angles:[0,0],profile:0}];
 const actions=[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex,{...flex,id:'second'}, {op:'flexCycle',ids:['reed','second'],period:2,phase:.25,keys}];
 const valid=validateScene({steps:[{say:'x',actions}]});assert.equal(valid.scene?.steps[0]?.actions.length,4,JSON.stringify(valid.issues));
 for(const bad of [{...actions[3],ids:['missing']},{...actions[3],period:13},{...actions[3],keys:[keys[0],{...keys[1],angles:[90,0]},keys[2]]}]){
  const result=validateScene({steps:[{say:'x',actions:[...actions.slice(0,3),bad]}]});assert.equal(result.scene?.steps[0]?.actions.length,3,JSON.stringify(result.issues));
 }
});

test('replacing a rigid parent invalidates the old surface and its cycle target',()=>{
 const state=createSceneState();validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex]}]},state);
 const detail=createDetailState(state), r=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]}]}]},detail);
 assert.ok(r.ok);assert.equal(detail.flexes.has('reed'),false);assert.equal(detail.ids.has('reed'),false);
});


test('surface features bind exact existing ids and reject a self or ancestor cycle',()=>{
 const feather={op:'add',shape:'box',id:'feather',size:[.2,.1,.1]};const attach={op:'flexAttach',id:'feather',on:'reed',u:.7,v:.5,side:'front',tangentAngle:0};
 const ok=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex,feather,attach]}]});assert.equal(ok.scene?.steps[0]?.actions.length,4,JSON.stringify(ok.issues));
 const bad=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex,{...attach,id:'mount'}]}]});assert.equal(bad.scene?.steps[0]?.actions.length,2,JSON.stringify(bad.issues));
});

test('forward declared flex feature resolves exact creator; failed reserved creator never redirects',()=>{
 const mount={op:'add',shape:'box',id:'mount',size:[1,1,1]},feature={op:'add',shape:'box',id:'feather',size:[.2,.1,.1]},attach={op:'flexAttach',id:'feather',on:'reed',u:.7,v:.5,side:'front',tangentAngle:0};
 const result=validateScene({steps:[{say:'x',actions:[mount,flex,attach,feature]}]});assert.equal(result.scene!.steps[0]!.actions.filter(a=>a.op==='flexAttach').length,1,JSON.stringify(result.issues));
 const failed=validateScene({steps:[{say:'x',actions:[mount,flex,attach,{...feature,size:'invalid'},{...feature,id:'other'}]}]});assert.equal(failed.scene!.steps[0]!.actions.some(a=>a.op==='flexAttach'),false,JSON.stringify(failed.scene));
});

test('a supported rigid parent becomes eligible again after opacity and cut are restored',()=>{
 const r=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1],opacity:.5},{op:'style',id:'mount',opacity:1},{op:'cut',id:'mount',to:0},{op:'cut',id:'mount',to:100},flex]}]});assert.equal(r.scene!.steps[0]!.actions.length,5,JSON.stringify(r.issues));
});

test('a flexible surface cannot be detached by generic transforms or used as a rigid parent',()=>{
 const mount={op:'add',shape:'box',id:'mount',size:[1,1,1]};const r=validateScene({steps:[{say:'x',actions:[mount,flex,{op:'move',id:'reed',to:[1,0,0]},{op:'add',shape:'box',id:'child',parent:'reed',size:[1,1,1]}]}]});assert.equal(r.scene!.steps[0]!.actions.length,2,JSON.stringify(r.issues));
});

test('per-surface feature cap rejects the thirteenth binding without discarding earlier features',()=>{
 const parts=Array.from({length:13},(_,i)=>({op:'add',shape:'box',id:'f'+i,size:[.1,.1,.1]}));const attaches=parts.map((p,i)=>({op:'flexAttach',id:p.id,on:'reed',u:i/13,v:.5,side:'front',tangentAngle:0}));const r=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex,...parts]},{say:'features',actions:attaches}]});assert.equal(r.scene!.steps[1]!.actions.length,12);assert.ok(r.issues.some(i=>i.kind==='dropped'&&i.message.includes('feature limit')));
});

test('attached features and deforming surfaces cannot be rebound through rigid transforms or surface-to-surface cycles',()=>{
 const feature={op:'add',shape:'box',id:'feather',size:[.2,.1,.1]},attach={op:'flexAttach',id:'feather',on:'reed',u:.7,v:.5,side:'front',tangentAngle:0};const r=validateScene({steps:[{say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex,{...flex,id:'other'},feature,attach,{op:'move',id:'feather',to:[3,0,0]},{...attach,id:'other'}]}]});assert.equal(r.scene!.steps[0]!.actions.length,5,JSON.stringify(r.issues));
});

test('streamed flex actions preserve exact forward references and match whole-step output',async()=>{
 const {beginLiveStep,validateStep}=await import('../src/scene/validate.ts');const state=createSceneState(),other=createSceneState(),events:any[]=[];const raw={say:'x',actions:[{op:'add',shape:'box',id:'mount',size:[1,1,1]},flex,{op:'flexAttach',id:'feather',on:'reed',u:.7,v:.5,side:'front',tangentAngle:0},{op:'add',shape:'box',id:'feather',size:[.2,.1,.1]}]};const expected=validateStep(raw,other);const live=beginLiveStep(state,{open:()=>{},action:a=>events.push(a)});live.say(raw.say);for(const a of raw.actions)live.action(a);const got=live.finish();assert.deepEqual(got.step,expected.step);assert.deepEqual(events,expected.step?.actions);assert.deepEqual([...state.flexFeatures],[...other.flexFeatures]);
});

test('forward flex driver waits for its declared target and never repairs a failed creator to another surface',()=>{
 const keys=[{t:0,angles:[0,0],profile:0},{t:.5,angles:[10,10],profile:1},{t:1,angles:[0,0],profile:0}],driver={op:'flexCycle',ids:['reed'],period:2,keys};const mount={op:'add',shape:'box',id:'mount',size:[1,1,1]};const r=validateScene({steps:[{say:'x',actions:[mount,driver,flex]}]});assert.equal(r.scene!.steps[0]!.actions.filter(a=>a.op==='flexCycle').length,1,JSON.stringify(r.issues));const bad=validateScene({steps:[{say:'x',actions:[mount,driver,{...flex,root:{parentPoint:[0,0,0],normal:[0,0,0],maxGap:.1}},{...flex,id:'other'}]}]});assert.equal(bad.scene!.steps[0]!.actions.some(a=>a.op==='flexCycle'),false);
});

test('flex surface waits for its exact later rigid parent',()=>{
 const r=validateScene({steps:[{say:'x',actions:[flex,{op:'add',shape:'box',id:'mount',size:[1,1,1]}]}]});assert.deepEqual(r.scene!.steps[0]!.actions.map(a=>a.op==='add'?a.id:a.op),['mount','reed']);assert.equal(r.issues.filter(i=>i.kind==='dropped').length,0);
});
