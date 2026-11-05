import {test} from 'node:test';import assert from 'node:assert/strict';
import {systemPrompt,questionText} from '../src/adapters/subscription-shared.ts';import {sceneSchemaLean} from '../src/scene/schema.ts';
test('actual shared adapter prompt and lean schema expose bounded articulated authoring',()=>{
 const system=systemPrompt();assert.match(system,/root.parentPoint/);assert.match(system,/cyclic keyframes/);assert.match(system,/one-edge/);assert.match(system,/explain.*mechanism/i);assert.match(JSON.stringify(sceneSchemaLean),/flexSurface/);
 const q=questionText({question:'How does this mechanism work?',screenshot:'',thread:[],stage:{part:'next',n:2,plan:['Explain motion'],shown:[{say:'It opens a valve.',actions:[]}]}} as never);
 assert.match(q,/step 2/i);assert.match(system,/root/);assert.match(system,/period/);
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
