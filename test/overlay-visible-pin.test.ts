import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector2 } from 'three';
import { PanelScene } from '../src/overlay/scene3d.ts';
import { frameAt } from '../src/overlay/timeline.ts';
import type { Step } from '../src/scene/index.ts';
const frame = (...actions: unknown[]) => frameAt([{say:'x',actions:[{op:'panel',x:100,y:100,w:800,h:800},...actions]} as Step],0,99);
const view={rect:{x:100,y:100,w:800,h:800},width:1000,height:1000};
const key=(f: ReturnType<typeof frame>,id:string)=>f.objects.find(o=>o.id===id)!.key;

test('a curved tube default pin projects onto its visible mesh, not its empty bounding-box centre',()=>{
 const f=frame({op:'add',shape:'tube',id:'tube',pts:[[-2,2,0],[-2,-2,0],[2,-2,0],[2,2,0]],radius:.15},{op:'orbit',az:0,el:0,dur:0});
 const s=new PanelScene();s.sync(f,1,view);const p=s.project(key(f,'tube'),undefined,1000,1000)!;
 const ray=new Raycaster();ray.setFromCamera(new Vector2(p.x/500-1,1-p.y/500),s.camera);
 assert.ok(p.visible && ray.intersectObject(s.nodeOf(key(f,'tube'))!,true).length>0,'pin ray must hit its target');
});

test('a fully occluded target is not visible',()=>{
 const f=frame({op:'add',shape:'box',id:'back',pos:[0,0,-2],size:[1,1,1]},{op:'add',shape:'box',id:'front',pos:[0,0,0],size:[5,5,1]},{op:'orbit',az:0,el:0,dur:0});
 const s=new PanelScene();s.sync(f,1,view);const p=s.project(key(f,'back'),undefined,1000,1000)!;
 assert.equal(p.visible,false,'fully occluded target must not produce a visible anchor');
});

test('a transparent foreground object does not hide a solid target',()=>{
 const f=frame({op:'add',shape:'box',id:'back',pos:[0,0,-2],size:[1,1,1]},{op:'add',shape:'box',id:'glass',pos:[0,0,0],size:[5,5,1],opacity:0.2},{op:'orbit',az:0,el:0,dur:0});
 const s=new PanelScene();s.sync(f,1,view);assert.equal(s.project(key(f,'back'),undefined,1000,1000)?.visible,true);
});

test('a vanished object is not visible and a partly occluded one uses its visible portion',()=>{
 const f=frame({op:'add',shape:'box',id:'gone',pos:[-8,0,0],size:[1,1,1],opacity:0},{op:'add',shape:'box',id:'back',pos:[0,0,-2],size:[4,4,1]},{op:'add',shape:'box',id:'front',pos:[1,0,0],size:[2,5,1]},{op:'orbit',az:0,el:0,dur:0});
 const s=new PanelScene();s.sync(f,1,view);assert.equal(s.project(key(f,'gone'),undefined,1000,1000)?.visible,false);assert.equal(s.project(key(f,'back'),undefined,1000,1000)?.visible,true);
});

test('a valid explicit point keeps its position and hidden points do not move to another surface',()=>{
 const f=frame({op:'add',shape:'box',id:'a',size:[2,2,2]},{op:'orbit',az:0,el:0,dur:0});const s=new PanelScene();s.sync(f,1,view);
 const valid=s.project(key(f,'a'),[.5,.5,0],1000,1000)!;assert.equal(valid.visible,true);
 const invalid=s.project(key(f,'a'),[9,9,0],1000,1000)!;assert.equal(invalid.visible,false);
});

test('an explicit point removed by a cut is suppressed',()=>{
 const f=frame({op:'add',shape:'box',id:'a',size:[2,2,2]},{op:'cut',id:'a',axis:'z',to:0,dur:0},{op:'orbit',az:0,el:0,dur:0});const s=new PanelScene();s.sync(f,1,view);
 assert.equal(s.project(key(f,'a'),[0,0,.8],1000,1000)?.visible,false);
});

test('a target in a moved parent follows that parent and remains on target',()=>{
 const f=frame({op:'add',shape:'group',id:'g',pos:[2,0,0]},{op:'add',shape:'box',id:'a',parent:'g',size:[2,2,2]},{op:'orbit',az:0,el:0,dur:0});const s=new PanelScene();s.sync(f,1,view);
 const p=s.project(key(f,'a'),undefined,1000,1000)!;const ray=new Raycaster();ray.setFromCamera(new Vector2(p.x/500-1,1-p.y/500),s.camera);assert.ok(p.visible && ray.intersectObject(s.nodeOf(key(f,'a'))!,true).length);
});

test('an object moved outside the camera frustum has no visible anchor',()=>{
 const f=frame({op:'add',shape:'box',id:'reference',size:[10,10,10],opacity:.1},{op:'add',shape:'box',id:'a',size:[1,1,1]},{op:'move',id:'a',to:[100,0,0],dur:0},{op:'orbit',az:0,el:0,dur:0});const s=new PanelScene();s.sync(f,1,view);const obj=s.nodeOf(key(f,'a'))!;obj.position.x=1000;obj.updateWorldMatrix(true,true);assert.equal(s.project(key(f,'a'),undefined,1000,1000)?.visible,false);
});

test('an explicit point on the back of an opaque solid is not treated as visible',()=>{
 const f=frame({op:'add',shape:'box',id:'a',size:[2,2,2]},{op:'orbit',az:0,el:0,dur:0});const s=new PanelScene();s.sync(f,1,view);assert.equal(s.project(key(f,'a'),[0,0,-1],1000,1000)?.visible,false);
});

test('explicit points behind or in front of a target are not snapped to its visible face',()=>{
 const f=frame({op:'add',shape:'box',id:'a',size:[2,2,2]},{op:'orbit',az:0,el:0,dur:0});const s=new PanelScene();s.sync(f,1,view);const k=key(f,'a');
 for(const z of [-1.2,-2,-5,1.2,2,5]) assert.equal(s.project(k,[0,0,z],1000,1000)?.visible,false,`outside z=${z}`);
 for(const z of [-.8,0,.8,1]) assert.equal(s.project(k,[0,0,z],1000,1000)?.visible,true,`inside/front z=${z}`);
});

test('an interior point on the retained side of a cut remains visible',()=>{
 const f=frame({op:'add',shape:'box',id:'a',size:[2,2,2]},{op:'cut',id:'a',axis:'z',to:0,dur:0},{op:'orbit',az:0,el:0,dur:0});const s=new PanelScene();s.sync(f,1,view);assert.equal(s.project(key(f,'a'),[0,0,-.5],1000,1000)?.visible,true);
});

test('the named piston crown remains visible',()=>{
 const f=frame({op:'add',shape:'part',id:'p',part:'piston',size:[3,3.4,3.2],pos:[1,2,0]});const s=new PanelScene();s.sync(f,1,view);
 assert.equal(s.project(key(f,'p'),undefined,1000,1000,'crown')?.visible,true);
});
