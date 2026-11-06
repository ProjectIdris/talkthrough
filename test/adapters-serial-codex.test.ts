import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,unlinkSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createCodexModel} from '../src/adapters/codex-model.ts';
import {createStepByStepModel} from '../src/adapters/step-by-step.ts';
import {createStageModel} from '../src/adapters/stage-model.ts';
import type {Model,ModelRequest} from '../src/adapters/model.ts';
import {sceneSchemaLean} from '../src/scene/schema.ts';

const fake=fileURLToPath(new URL('./support/fake-codex.mjs',import.meta.url));
for (const follow of [false,true]) test(`serial ${follow?'follow-up':'fresh'} answer reuses only its own staged thread`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';
 const inner=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true}),model=createStepByStepModel(inner);
 try{const thread=follow?[{question:'previous',steps:[]}]:[];const out=[];for await(const item of model.ask({question:'current',thread,screenshot:{mime:'image/png',base64:'AAAA',width:4,height:4},schema:sceneSchemaLean}))out.push(item);
  const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));const starts=events.filter(e=>e.method==='thread/start'),turns=events.filter(e=>e.method==='turn/start');
  assert.equal(out.filter(x=>x.type==='step').length,2);assert.equal(starts.length,1,'one staged thread');assert.equal(turns.length,2);assert.equal(turns[0].params.threadId,turns[1].params.threadId);
  const texts=turns.map(e=>e.params.input.find((x:{type:string})=>x.type==='text').text as string);
  assert.equal(texts[0]!.includes('Earlier in this conversation'),follow);assert.ok(!texts[1]!.includes('Earlier in this conversation'));assert.ok(!texts[1]!.includes('First.'));assert.match(texts[1]!,/current/);assert.match(texts[1]!,/Next/);assert.ok(turns.every(e=>e.params.outputSchema&&e.params.input.some((x:{type:string})=>x.type==='image')));
 }finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('a changed shown snapshot falls back to a fresh thread with the complete context',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';
 const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});const owner={},controller=new AbortController();
 const common={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean,serialOwner:owner,signal:controller.signal};
 try{for await(const _ of model.ask({...common,stage:{part:'first',plan:true}}))void _;
  for await(const _ of model.ask({...common,stage:{part:'next',n:2,shown:[{say:'changed',actions:[]}],plan:['Next']}}))void _;
  const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));const starts=events.filter(e=>e.method==='thread/start'),turns=events.filter(e=>e.method==='turn/start');assert.equal(starts.length,2);assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);assert.match(turns[1].params.input.find((x:{type:string})=>x.type==='text').text,/changed/);
 }finally{controller.abort();await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

for(const end of ['expiry','abort'] as const) test(`serial ${end} retires ownership; next call resends context`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';
 const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true,keepThreadMs:10});const owner={},controller=new AbortController(),base={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean,serialOwner:owner};let step:unknown;
 try{for await(const x of model.ask({...base,signal:controller.signal,stage:{part:'first',plan:true}}))if(x.type==='step')step=x.step;
  if(end==='abort')controller.abort();else await new Promise(r=>setTimeout(r,30));
  for await(const _ of model.ask({...base,stage:{part:'next',n:2,shown:[step],plan:['Next']}}))void _;
  const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));const turns=events.filter(e=>e.method==='turn/start');assert.equal(events.filter(e=>e.method==='thread/start').length,2);assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);assert.match(turns[1].params.input.find((x:{type:string})=>x.type==='text').text,/First\./);
 }finally{controller.abort();await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('overlapping independent serial owners use distinct active threads',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});
 const common={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean,stage:{part:'first' as const,plan:true as const}};
 const run=async(owner:object)=>{for await(const _ of model.ask({...common,serialOwner:owner}))void _;};
 try{await Promise.all([run({}),run({})]);const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));const turns=events.filter(e=>e.method==='turn/start');assert.equal(turns.length,2);assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);}
 finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('overlapping two-step rest does not share a serial stage thread',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});
 const common={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean};
 const run=async(req:Parameters<typeof model.ask>[0])=>{for await(const _ of model.ask(req))void _;};
 try{await Promise.all([run({...common,serialOwner:{},stage:{part:'first',plan:true}}),run({...common,stage:{part:'rest'}})]);const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));const turns=events.filter(e=>e.method==='turn/start');assert.equal(turns.length,2);assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);}
 finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('overlapping two-step calls cannot both claim the same primed thread',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true,prime:true,primeSchema:sceneSchemaLean});
 const common={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean};const run=async(req:Parameters<typeof model.ask>[0])=>{for await(const _ of model.ask(req))void _;};
 try{model.prime?.();await new Promise(r=>setTimeout(r,350));await Promise.all([run({...common,stage:{part:'first'}}),run({...common,stage:{part:'rest'}})]);const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),turns=events.filter(e=>e.method==='turn/start');assert.equal(turns.length,3);assert.notEqual(turns[1].params.threadId,turns[2].params.threadId);}
 finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('a continued stage uses the newest screenshot and schema',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});const owner={};let step:unknown;
 const base={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean,serialOwner:owner};
 try{for await(const x of model.ask({...base,stage:{part:'first',plan:true}}))if(x.type==='step')step=x.step;
  const schema={type:'object',title:'new schema'};for await(const _ of model.ask({...base,screenshot:{...base.screenshot,base64:'BBBB'},schema,stage:{part:'next',n:2,shown:[step],plan:['Next'],fresh:true}}))void _;
  const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),turns=events.filter(e=>e.method==='turn/start');assert.equal(turns[0].params.threadId,turns[1].params.threadId);assert.deepEqual(turns[1].params.outputSchema,schema);assert.ok(turns[1].params.input.some((x:{url?:string})=>x.url?.endsWith('BBBB')));assert.match(turns[1].params.input.find((x:{type:string})=>x.type==='text').text,/screen as it is now/);
 }finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('an unrelated ordinary history of the same length cannot claim a kept thread',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});
 const base={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean};
 try{for await(const _ of model.ask(base))void _;for await(const _ of model.ask({...base,thread:[{question:'unrelated',steps:[]}]}))void _;
  const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s));const turns=events.filter(e=>e.method==='turn/start');assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);assert.match(turns[1].params.input.find((x:{type:string})=>x.type==='text').text,/Earlier in this conversation/);
 }finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('leaving a staged iterator early never publishes its unfinished thread',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});const owner={};
 const base={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean,serialOwner:owner};let step:unknown;
 try{for await(const x of model.ask({...base,stage:{part:'first',plan:true}})){if(x.type==='step'){step=x.step;break;}}
  for await(const _ of model.ask({...base,stage:{part:'next',n:2,shown:[step],plan:['Next']}}))void _;
  const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),turns=events.filter(e=>e.method==='turn/start');assert.equal(turns.length,2);assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);assert.match(turns[1].params.input.find((x:{type:string})=>x.type==='text').text,/First\./);
 }finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('a refused tool event cannot leave a staged thread available to the next call',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='tool';const model=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});const owner={};
 const base={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean,serialOwner:owner};
 try{for(let i=0;i<2;i++)await assert.rejects(async()=>{for await(const _ of model.ask({...base,stage:{part:'first',plan:true}}))void _;});
  const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),turns=events.filter(e=>e.method==='turn/start');assert.equal(turns.length,2);assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);
 }finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('a subsequent answer gets a new owner even if its question is identical',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const inner=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true}),model=createStepByStepModel(inner);
 const base={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean};
 try{for(let i=0;i<2;i++)for await(const _ of model.ask(base))void _;const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),turns=events.filter(e=>e.method==='turn/start');assert.equal(turns.length,3);assert.equal(turns[0].params.threadId,turns[1].params.threadId);assert.notEqual(turns[1].params.threadId,turns[2].params.threadId);}
 finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});

test('a different first model supplies context once to the reused later-model thread',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'serial-test-')),log=join(dir,'requests.jsonl');process.env.FAKE_LOG=log;process.env.FAKE_MODE='serial';const later=createCodexModel({command:process.execPath,prefixArgs:[fake],keepThread:true});
 const first:Model={id:'local-first',async *ask(req:ModelRequest){req.onRaw?.(JSON.stringify({steps:[],plan:['later two','later three'],done:false}));yield {type:'step',step:{say:'From first model',actions:[]}};}};
 const model=createStepByStepModel(createStageModel(first,later)),base={question:'same',thread:[],screenshot:{mime:'image/png' as const,base64:'AAAA',width:4,height:4},schema:sceneSchemaLean};
 try{const output=[];for await(const x of model.ask(base))output.push(x);assert.equal(output.filter(x=>x.type==='step').length,3);const events=readFileSync(log,'utf8').trim().split('\n').map(s=>JSON.parse(s)),turns=events.filter(e=>e.method==='turn/start');assert.equal(turns.length,2);assert.equal(turns[0].params.threadId,turns[1].params.threadId);const text=(n:number)=>turns[n].params.input.find((x:{type:string})=>x.type==='text').text as string;assert.match(text(0),/From first model/);assert.doesNotMatch(text(1),/From first model|First\./);assert.match(text(1),/later three/);}
 finally{await model.close?.();delete process.env.FAKE_LOG;delete process.env.FAKE_MODE;try{unlinkSync(log);}catch{}rmdirSync(dir);}
});
