import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as layout from '../src/overlay/layout.ts';
import {modelButtonRects} from '../src/overlay/orbit.ts';
type Rect={x:number;y:number;w:number;h:number};
const sizes={explode:{w:99,h:32},cut:{w:137,h:32}};
const view={width:1000,height:800};
const poses:Rect[]=[{x:365.53,y:320.20,w:268.94,h:112.64},{x:351.88,y:369.46,w:296.25,h:66.27},{x:385.33,y:367.44,w:229.34,h:78.70},{x:365.69,y:331.33,w:268.63,h:101.51}];
test('control-only anchor does not chase a repeated already-seen model pose',()=>{
 const C=(layout as unknown as {StableControlBounds?:new()=>{update:(r:Rect|undefined,keys:readonly number[],v:typeof view)=>Rect|undefined}}).StableControlBounds;
 const envelope=C?new C():undefined;
 const positions=[];for(const p of [...poses,...poses]){const a=envelope?.update(p,[1,2],view)??p;positions.push(modelButtonRects(a,view,sizes).cut);}
 assert.deepEqual(positions.slice(4),Array(4).fill(positions[3]),'after envelope warmup, the same poses keep one control target');
});

test('control envelope grows for new geometry and resets on replacement, resize or clear',()=>{
 const a=new layout.StableControlBounds();
 assert.deepEqual(a.update({x:100,y:100,w:80,h:60},[1],view),{x:100,y:100,w:80,h:60});
 assert.deepEqual(a.update({x:90,y:110,w:120,h:50},[1,2],view),{x:90,y:100,w:120,h:60});
 assert.deepEqual(a.update({x:400,y:300,w:30,h:30},[3],view),{x:400,y:300,w:30,h:30});
 assert.deepEqual(a.update({x:10,y:10,w:30,h:30},[3],{width:800,height:600}),{x:10,y:10,w:30,h:30});
 assert.equal(a.update(undefined,[],view),undefined);
 assert.deepEqual(a.update({x:70,y:80,w:20,h:20},[3],view),{x:70,y:80,w:20,h:20});
 a.reset();assert.deepEqual(a.update({x:0,y:0,w:20,h:20},[3],view),{x:0,y:0,w:20,h:20});
});

test('oversized control envelope still produces finite on-screen controls',()=>{
 const a=new layout.StableControlBounds();const bounds=a.update({x:0,y:0,w:1000,h:800},[1],view)!;const r=modelButtonRects(bounds,view,sizes);
 for(const x of [r.explode,r.cut])assert.ok(Number.isFinite(x.x)&&Number.isFinite(x.y)&&x.x>=0&&x.y>=0&&x.x+x.w<=view.width&&x.y+x.h<=view.height);
});

test('authored view changes reset the envelope while idle motion and unchanged follow-ups retain it',()=>{
 const a=new layout.StableControlBounds();
 const sample=(x:number,camera:string,authored:boolean)=>a.update({x,y:100,w:20,h:20},[1],view,{camera,authored});
 assert.deepEqual(sample(10,'view-a',false),{x:10,y:100,w:20,h:20});
 assert.deepEqual(sample(30,'idle-turn',false),{x:10,y:100,w:40,h:20});
 assert.deepEqual(sample(20,'idle-turn',true),{x:10,y:100,w:40,h:20},'unchanged continuation keeps the anchor');
 assert.deepEqual(sample(200,'view-b',true),{x:200,y:100,w:20,h:20},'authored camera transition starts a fresh envelope');
 assert.deepEqual(sample(220,'view-c',true),{x:220,y:100,w:20,h:20},'the envelope tracks the changing authored view');
 assert.deepEqual(sample(210,'idle-again',false),{x:210,y:100,w:30,h:20},'idle turning warms rather than resetting the envelope');
});

test('authored panel relocation and resize reset the anchor without resetting an unchanged follow-up', async()=>{
 const {validateScene}=await import('../src/scene/index.ts');
 const {frameAt}=await import('../src/overlay/timeline.ts');
 const {PanelScene}=await import('../src/overlay/scene3d.ts');
 const scene=validateScene({steps:[
  {say:'',actions:[{op:'panel',x:650,y:250,w:300,h:400},{op:'add',shape:'box',id:'a',size:[1,1,1]},{op:'add',shape:'box',id:'b',pos:[1,0,0],size:[1,1,1]}]},
  {say:'',actions:[{op:'panel',x:50,y:250,w:300,h:400}]},
  {say:'',actions:[{op:'panel',x:50,y:250,w:400,h:400}]},
 ]});
 assert.deepEqual(scene.issues,[]);const panel=new PanelScene(),anchor=new layout.StableControlBounds();
 const sample=(step:number)=>{const f=frameAt(scene.scene!.steps,step,99),p=f.panel!.rect;panel.sync(f,1,{rect:{x:p.x,y:p.y*.8,w:p.w,h:p.h*.8},...view});const model=panel.screenBounds(view.width,view.height)!.model;const camera=JSON.stringify([f.camera.az,f.camera.el,f.camera.zoom,f.camera.focus.key,f.camera.focus.k]);const result=anchor.update(model,f.objects.map(o=>o.key),view,{camera,authored:true,panel:JSON.stringify([p.x,p.y,p.w,p.h])})!;return {model,result};};
 const first=sample(0),moved=sample(1),resized=sample(2),same=sample(2);
 assert.ok(first.model.x-moved.model.x>500,'fixture moves the actual model');
 assert.deepEqual(moved.result,moved.model,'old location must not remain in the control envelope');
 assert.deepEqual(resized.result,resized.model,'panel resize starts a new envelope');
 assert.deepEqual(same.result,resized.result,'unchanged panel retains the envelope');
 const f=frameAt(scene.scene!.steps,2,99),p=f.panel!.rect, panelKey=JSON.stringify([p.x,p.y,p.w,p.h]),c=f.camera;
 const expanded=anchor.update({...resized.model,x:resized.model.x-5},[1,2],view,{camera:JSON.stringify([c.az,c.el,c.zoom,c.focus.key,c.focus.k]),authored:false,panel:panelKey})!;
 assert.ok(expanded.x<resized.model.x,'ordinary pose expansion accumulates within the same panel');
 assert.deepEqual(sample(2).result,expanded,'unchanged follow-up preserves the warmed envelope');
 panel.destroy();
});

test('an existing rigid hinge loop has moving live bounds but stable controls after one sampled cycle', async()=>{
 const {validateScene}=await import('../src/scene/index.ts');
 const {frameAt}=await import('../src/overlay/timeline.ts');
 const {PanelScene}=await import('../src/overlay/scene3d.ts');
 const {overModel}=await import('../src/overlay/orbit.ts');
 const r=validateScene({steps:[{say:'',actions:[{op:'panel',x:100,y:100,w:800,h:800},{op:'add',shape:'box',id:'base',size:[1,1,1]},{op:'add',shape:'box',id:'arm',pos:[1,0,0],size:[2,.2,.2]},{op:'joint',id:'arm',kind:'hinge',axis:'z',pivot:[-1,0,0]},{op:'loop',id:'arm',amount:30,period:2}]}]});
 assert.deepEqual(r.issues,[]);const panel=new PanelScene(),anchor=new layout.StableControlBounds();const live=[] as Rect[],positions=[] as Rect[];
 for(let pass=0;pass<2;pass++)for(const t of [2,2.5,3,3.5]){const f=frameAt(r.scene!.steps,0,t);panel.sync(f,1,{rect:{x:100,y:100,w:800,h:800},width:1000,height:800});const model=panel.screenBounds(1000,800)!.model;live.push(model);positions.push(modelButtonRects(anchor.update(model,f.objects.map(o=>o.key),view)!,view,sizes).cut);}
 assert.ok(live.some(b=>Math.abs(b.y-live[0]!.y)>1),'the real projected rigid-loop bounds change');
 assert.deepEqual(positions.slice(4),Array(4).fill(positions[3]));
 const union=anchor.update(live[1]!,[1,2],view)!;const corners=[{x:union.x+1,y:union.y+1},{x:union.x+union.w-1,y:union.y+1},{x:union.x+1,y:union.y+union.h-1},{x:union.x+union.w-1,y:union.y+union.h-1}];
 const point=corners.find(p=>!overModel(live[0]!,p.x,p.y));assert.ok(point,'the envelope contains space outside the current live bounds');
 assert.equal(overModel(live[0]!,point.x,point.y),false,'blank envelope is not a model hit');
 panel.destroy();
});
