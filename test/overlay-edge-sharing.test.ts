import test from 'node:test';
import assert from 'node:assert/strict';
import { EdgesGeometry, LineSegments, Mesh } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';
const frame=(actions: unknown[])=>frameAt([{say:'x',actions} as Step],0,99);
const add=(id:string, size=[1,1,1])=>({op:'add',shape:'sphere',id,size});
const edge=(scene:PanelScene,f:ReturnType<typeof frame>,id:string)=>{const key=f.objects.find(x=>x.id===id)!.key;let line:LineSegments|undefined;scene.nodeOf(key)?.traverse(x=>{if(x instanceof LineSegments)line=x});return line!};
test('equal immutable outlines share only while live; clearing one retains the other and last clear disposes',()=>{
 const scene=new PanelScene({tier:'mid'});const both=frame([add('a'),add('b')]);scene.sync(both,1);const a=edge(scene,both,'a'),b=edge(scene,both,'b');assert.ok(a&&b);assert.equal(a.geometry,b.geometry);let disposed=0;a.geometry.addEventListener('dispose',()=>disposed++);
 const one={...both,objects:both.objects.filter(x=>x.id==='b')};scene.sync(one,1);assert.equal(disposed,0);assert.equal(edge(scene,one,'b').geometry,b.geometry);scene.sync({...both,objects:[]},1);assert.equal(disposed,1);scene.destroy();assert.equal(disposed,1);
});
test('different dimensions do not share and low tier does not create outlines',()=>{const f=frame([add('a'),add('b',[2,1,1])]);const scene=new PanelScene({tier:'mid'});scene.sync(f,1);assert.notEqual(edge(scene,f,'a').geometry,edge(scene,f,'b').geometry);scene.destroy();const low=new PanelScene({tier:'low'});low.sync(f,1);assert.equal(edge(low,f,'a'),undefined);low.destroy()});
test('shared outline exactly matches the original derivation and survives edits and re-add',()=>{
 const f=frame([add('a'),add('b')]);const scene=new PanelScene({tier:'mid'});scene.sync(f,1);const a=edge(scene,f,'a'),b=edge(scene,f,'b');const mesh=scene.nodeOf(f.objects.find(o=>o.id==='a')!.key) as Mesh;const expected=new EdgesGeometry(mesh.geometry,28);assert.deepEqual(Array.from(a.geometry.getAttribute('position').array),Array.from(expected.getAttribute('position').array));expected.dispose();
 const shared=a.geometry;let count=0;shared.addEventListener('dispose',()=>count++);const only={...f,objects:f.objects.filter(o=>o.id==='b')};scene.sync(only,1);assert.equal(count,0);scene.sync(f,1);assert.equal(edge(scene,f,'a').geometry,shared);scene.sync({...f,objects:[]},1);assert.equal(count,1);scene.sync(f,1);assert.notEqual(edge(scene,f,'a').geometry,shared);scene.destroy();
});
test('equal boxes and cylinders share; exact bevel and shape separate derived outlines',()=>{const actions=[{op:'add',shape:'box',id:'a',size:[1,1,1],bevel:0},{op:'add',shape:'box',id:'b',size:[1,1,1],bevel:0},{op:'add',shape:'box',id:'c',size:[1,1,1],bevel:0.1},{op:'add',shape:'cylinder',id:'d',size:[1,1,1]},{op:'add',shape:'cylinder',id:'e',size:[1,1,1]}];const f=frame(actions),scene=new PanelScene();scene.sync(f,1);assert.equal(edge(scene,f,'a').geometry,edge(scene,f,'b').geometry);assert.notEqual(edge(scene,f,'a').geometry,edge(scene,f,'c').geometry);assert.notEqual(edge(scene,f,'a').geometry,edge(scene,f,'d').geometry);assert.equal(edge(scene,f,'d').geometry,edge(scene,f,'e').geometry);scene.destroy()});
test('independent outline materials and disabled outlines remain independent',()=>{const f=frame([add('a'),add('b'),{...add('c'),edges:false},{...add('d'),material:'glass'}]);const scene=new PanelScene();scene.sync(f,1);const a=edge(scene,f,'a'),b=edge(scene,f,'b');assert.equal(a.geometry,b.geometry);assert.notEqual(a.material,b.material);assert.equal(edge(scene,f,'c'),undefined);assert.equal(edge(scene,f,'d'),undefined);assert.equal('parameters' in a.geometry,false);scene.destroy()});
test('repeated clear and re-add release each shared outline once',()=>{const f=frame([add('a'),add('b')]);const scene=new PanelScene();for(let i=0;i<30;i++){scene.sync(f,1);const g=edge(scene,f,'a').geometry;let disposed=0;g.addEventListener('dispose',()=>disposed++);scene.sync({...f,objects:[]},1);assert.equal(disposed,1)}scene.destroy()});
