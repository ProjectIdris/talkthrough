import {test} from 'node:test';import assert from 'node:assert/strict';
import {systemPrompt,questionText} from '../src/adapters/subscription-shared.ts';import {sceneSchemaLean} from '../src/scene/schema.ts';
test('actual shared adapter prompt and lean schema expose bounded articulated authoring',()=>{
 const system=systemPrompt();assert.match(system,/root.parentPoint/);assert.match(system,/cyclic keyframes/);assert.match(system,/one-edge/);assert.match(system,/explain.*mechanism/i);assert.match(JSON.stringify(sceneSchemaLean),/flexSurface/);
 const q=questionText({question:'How does this mechanism work?',screenshot:'',thread:[],stage:{part:'next',n:2,plan:['Explain motion'],shown:[{say:'It opens a valve.',actions:[]}]}} as never);
 assert.match(q,/step 2/i);assert.match(system,/root/);assert.match(system,/period/);
});
test('shared guide and full schema describe endpoint and whole-root requirements',async()=>{
 const {sceneSchema}=await import('../src/scene/schema.ts');const prompt=systemPrompt(),full=JSON.stringify(sceneSchema);
 assert.match(prompt,/first u is exactly 0.*last u is exactly 1/i);assert.match(prompt,/seven root-edge samples.*unique outward intersection within maxGap/i);
 assert.match(full,/first u exactly 0, last u exactly 1/i);assert.match(full,/root-edge sample.*unique outward intersection within maxGap/i);
});


test('real staged adapter routing preserves the flex-capable schema for planned and unplanned later calls',async()=>{
 const {createStageModel}=await import('../src/adapters/stage-model.ts');const seen:Array<{id:string;req:any}>=[];const fake=(id:string)=>({id,async *ask(req:any){seen.push({id,req});yield {type:'step',step:{say:'x',actions:[]}} as any;}});const model=createStageModel(fake('first'),fake('later'));
 const base={question:'How does it work?',screenshot:{mime:'image/png' as const,base64:'A',width:4,height:4},thread:[],schema:sceneSchemaLean};
 for(const stage of [{part:'first',plan:true},{part:'next',n:2,shown:[{say:'It opens.',actions:[]}],plan:['Show mechanism']},{part:'next',n:2,shown:[{say:'It opens.',actions:[]}],plan:[],unplanned:true},{part:'rest',first:{say:'It opens.',actions:[]}}] as const){for await(const _ of model.ask({...base,stage} as never))void _;}
 assert.deepEqual(seen.map(s=>s.id),['first','later','later','later']);for(const {req} of seen){assert.match(JSON.stringify(req.schema),/flexSurface/);assert.match(systemPrompt(),/root.parentPoint/);assert.match(questionText(req),/step/i);}
});

test('the compact flex authoring example is valid scene input and appears in the adapter prompt',async()=>{
 const {sceneFlexGuideExample}=await import('../src/scene/guide.ts');const {validateScene}=await import('../src/scene/validate.ts');const r=validateScene(sceneFlexGuideExample);assert.deepEqual(r.issues,[]);assert.equal(r.scene!.steps[1]!.actions.length,3);assert.ok(systemPrompt().includes(JSON.stringify(sceneFlexGuideExample)));
});

test('actual staged provider requests teach an inboard joint with moving distal span',async()=>{
 const {createLocalModel}=await import('../src/adapters/local-model.ts');const {createStageModel}=await import('../src/adapters/stage-model.ts');const {startFakeLocal}=await import('./support/fake-local-model.ts');
 const {sceneFlexGuideExample}=await import('../src/scene/guide.ts');const {validateScene}=await import('../src/scene/validate.ts');const {emptyFrame,planStep,evaluate,settle}=await import('../src/overlay/timeline.ts');const {PanelScene}=await import('../src/overlay/scene3d.ts');const {SkinnedMesh,Vector3}=await import('three');
 const example=structuredClone(sceneFlexGuideExample) as any;const add=example.steps[1].actions.find((a:any)=>a.shape==='flexSurface'),cycle=example.steps[1].actions.find((a:any)=>a.op==='flexCycle');
 assert.ok(add.joints.length>=3,'an inboard moving hinge needs a distinct distal span');assert.ok(add.joints.some((j:any)=>j.u>0&&j.u<1));assert.equal(add.joints.at(-1).u,1);assert.ok(add.sections.at(-1).halfWidth<add.sections[1].halfWidth,'example tapers toward its tip');
 const run=(data:any)=>{const result=validateScene(data);assert.deepEqual(result.issues,[]);let f=settle(planStep(emptyFrame(),result.scene!.steps[0]!));f=evaluate(planStep(f,result.scene!.steps[1]!),1);const p=new PanelScene();p.sync(f,1);const mesh=p.nodeOf(f.objects.find(o=>o.id==='reed')!.key);assert.ok(mesh instanceof SkinnedMesh);return mesh;};
 const posed=run(example),disabled=structuredClone(example);for(const key of disabled.steps[1].actions.find((a:any)=>a.op==='flexCycle').keys)key.angles[1]=0;const still=run(disabled);let delta=0;for(let i=0;i<posed.geometry.getAttribute('position').count;i++)delta=Math.max(delta,posed.getVertexPosition(i,new Vector3()).distanceTo(still.getVertexPosition(i,new Vector3())));assert.ok(delta>.03,'the inboard joint changes geometry beyond its pivot');
 const reply=JSON.stringify({steps:[{say:'A flap bends.',actions:[]}],escalate:null}),server=await startFakeLocal({reply});
 try{const model=createStageModel(createLocalModel({baseUrl:server.baseUrl,model:'first'}),createLocalModel({baseUrl:server.baseUrl,model:'later'}));const base={question:'How does a flexible flap work?',screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},thread:[],schema:sceneSchemaLean};
  for(const stage of [undefined,{part:'first',plan:true},{part:'next',n:2,shown:[{say:'It bends.',actions:[]}],plan:['Show hinge']},{part:'next',n:2,shown:[{say:'It bends.',actions:[]}],plan:[],unplanned:true},{part:'rest',first:{say:'It bends.',actions:[]}}] as const)for await(const _ of model.ask({...base,...(stage ? {stage} : {})} as never))void _;
  const calls=server.sent.filter(s=>s.url==='/v1/chat/completions');assert.equal(calls.length,5);for(const call of calls){const sent=call.body!.messages[0].content as string;assert.ok(sent.includes(JSON.stringify(sceneFlexGuideExample)));assert.match(sent,/rigid wings and plates/i);assert.match(sent,/distributed bending, twisting or profile change/i);assert.match(sent,/supported opaque parent/i);assert.match(sent,/each distinct phase or mechanism/i);assert.match(sent,/align the spoken explanation with the motion/i);assert.match(sent,/inboard.*tip|tip.*inboard/i);assert.match(JSON.stringify(call.body!.response_format),/flexCycle/);}
 }finally{await server.close();}
});
