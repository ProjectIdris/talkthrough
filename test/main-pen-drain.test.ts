import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/main/session.ts';

const circle: Array<[number,number]> = [[300,300],[450,300],[450,450],[300,450],[300,300]];
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function rig(delayMic = false) {
  const sent: any[] = [], composed: number[][] = [], recorded: number[][] = [];
  let releaseMic: (() => void) | undefined;
  let releaseSpeech: (() => void) | undefined;
  const mic = { samples: new Float32Array(16), sampleRate:16000, durationMs:1500, startLatencyMs:0 };
  const media = {
    startMic: async () => {}, stopMic: () => delayMic ? new Promise<typeof mic>(r => { releaseMic = () => r(mic); }) : Promise.resolve(mic),
    abortMic: () => {}, capture: async () => ({ screenshot:{mime:'image/png' as const,base64:'AAAA',width:10,height:10},ms:0,grabId:3 }),
    compose: async (_id:number, strokes:Array<Array<[number,number]>>) => { composed.push(strokes.map(x=>x.length)); return { screenshot:{mime:'image/png' as const,base64:'AAAA',width:10,height:10},focus:[] }; }, release:()=>{},
  };
  const record = new Proxy({strokes:(v:Array<Array<[number,number]>>) => recorded.push(v.map(x=>x.length))}, {get:(o,k)=>k in o?o[k as 'strokes']:()=>{}});
  const session = createSession({ pointerDisplayId:()=>7, media, setPen:()=>{}, speech:{id:'fake',transcribe:()=>new Promise(r=>{releaseSpeech=()=>r({text:'test'});})}, model:()=>({id:'stub',ask:async function*(){}}), send:(_id:number,m:any)=>sent.push(m), log:()=>{}, record:record as any, micWindowMs:40, penFlush:true } as any);
  return { session, sent, composed, recorded, releaseMic:()=>releaseMic?.(), releaseSpeech:()=>releaseSpeech?.() };
}
function start(r:ReturnType<typeof rig>) { r.session.arm(); r.session.start(); }
function piece(r:ReturnType<typeof rig>, attemptId:number, points=circle, done=true, display=7) { r.session.stroke(display,{id:1,points,done,attemptId}); }
function finish(r:ReturnType<typeof rig>, id=1, display=7) { r.session.penFlushed(display,id); }

test('first complete late stroke is included before explicit flush ack',async()=>{const r=rig();start(r);r.session.stop();await tick();assert.deepEqual(r.recorded,[]);piece(r,1);finish(r);await tick();assert.deepEqual(r.recorded,[[5]]);assert.deepEqual(r.composed,[[5]]);r.releaseSpeech();r.session.dispose();});
test('partial and done pieces drain in order before acknowledgement',async()=>{const r=rig();start(r);piece(r,1,circle.slice(0,2),false);r.session.stop();await tick();piece(r,1,circle.slice(2),true);finish(r);await tick();assert.deepEqual(r.composed,[[5]]);r.releaseSpeech();r.session.dispose();});
test('empty acknowledged drain completes without waiting for timeout',async()=>{const r=rig();start(r);r.session.stop();finish(r);await tick();assert.deepEqual(r.recorded,[[]]);assert.deepEqual(r.composed,[]);r.releaseSpeech();r.session.dispose();});
test('early ack is retained while microphone closes later',async()=>{const r=rig(true);start(r);r.session.stop();piece(r,1);finish(r);await tick();assert.deepEqual(r.recorded,[]);r.releaseMic();await tick();assert.deepEqual(r.composed,[[5]]);r.releaseSpeech();r.session.dispose();});
test('wrong display or attempt cannot acknowledge or add a piece',async()=>{const r=rig();start(r);r.session.stop();piece(r,1,circle,true,8);piece(r,2);finish(r,1,8);finish(r,2);await tick();assert.deepEqual(r.recorded,[]);piece(r,1);finish(r);await tick();assert.deepEqual(r.composed,[[5]]);r.releaseSpeech();r.session.dispose();});
test('timeout is finite and rejects pieces arriving after it',async()=>{const r=rig();start(r);r.session.stop();await wait(540);assert.deepEqual(r.recorded,[[]]);piece(r,1);finish(r);await tick();assert.deepEqual(r.composed,[]);r.releaseSpeech();r.session.dispose();});
test('superseded drain cannot accept old pieces or ack for a new attempt',async()=>{const r=rig();start(r);r.session.stop();await tick();start(r);piece(r,1);finish(r,1);piece(r,2);r.session.stop();finish(r,2);await tick();assert.deepEqual(r.composed,[[5]]);r.releaseSpeech();r.session.dispose();});
test('cancellation aborts drain and rejects late completion',async()=>{const r=rig();start(r);r.session.stop();r.session.dismiss();piece(r,1);finish(r,1);await tick();assert.deepEqual(r.composed,[]);r.session.dispose();});
test('after ack the same attempt is closed even while microphone is pending',async()=>{const r=rig(true);start(r);r.session.stop();finish(r);piece(r,1);r.releaseMic();await tick();assert.deepEqual(r.recorded,[[]]);assert.deepEqual(r.composed,[]);r.releaseSpeech();r.session.dispose();});
test('untagged renderer pieces cannot enter a flush-enabled attempt',async()=>{const r=rig();start(r);r.session.stroke(7,{id:1,points:circle,done:true});r.session.stop();finish(r);await tick();assert.deepEqual(r.recorded,[[]]);r.releaseSpeech();r.session.dispose();});
test('a first piece within the shared 500ms grace remains eligible when mic closure is delayed',async()=>{const r=rig(true);start(r);r.session.stop();await wait(200);piece(r,1);finish(r);r.releaseMic();await tick();assert.deepEqual(r.composed,[[5]]);r.releaseSpeech();r.session.dispose();});
