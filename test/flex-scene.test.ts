import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateScene,createSceneState,createDetailState} from '../src/scene/validate.ts';import {sceneSchema} from '../src/scene/schema.ts';
const flex={op:'add',shape:'flexSurface',id:'reed',parent:'mount',root:{parentPoint:[.45,0,0],normal:[1,0,0],maxGap:.1},joints:[{id:'a',u:0,offset:[0,0,0],axis:[0,0,1],min:-30,max:30},{id:'b',u:1,offset:[0,0,0],axis:[0,0,1],min:-20,max:20}],sections:[{u:0,center:[.45,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0},{u:.5,center:[1,0,0],chord:[0,0,1],halfWidth:.5,camber:0,profileDelta:.1},{u:1,center:[2,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0}]};
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

