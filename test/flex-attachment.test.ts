import {test} from 'node:test';
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial, Vector3 } from 'three';
import { sampleFrames } from '../src/overlay/flex-frames.ts';
import { buildFlexGeometry } from '../src/overlay/flex-geometry.ts';
import { makeFlexSkin } from '../src/overlay/flex-skin.ts';
import { surfacePoint } from '../src/overlay/flex-attachment.ts';
const s=[{u:0,center:[0,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0},{u:.5,center:[1,0,0],chord:[0,0,1],halfWidth:.5,camber:0,profileDelta:0},{u:1,center:[2,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:0}] as const;
test('UV attachment follows exactly the selected skinned triangle including boundaries',()=>{
 const frames=sampleFrames(s), seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const parent=new Group(),geo=buildFlexGeometry(frames,[0,1],seam,false),mat=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,mat,s,[{u:0,offset:[0,0,0],axis:[0,0,1]},{u:1,offset:[0,0,0],axis:[0,0,1]}],false);
 parent.updateMatrixWorld(true);rig.skeleton.update();
 for(const uv of [[0,0],[1,1],[.31,.41],[.35,.48]] as const){const p=surfacePoint(rig.mesh,uv[0],uv[1],'front',false); assert.ok(p); assert.ok(Number.isFinite(p.position.x));assert.ok(Math.abs(p.normal.dot(p.tangent))<1e-8);}
 const before=surfacePoint(rig.mesh,.8,.5,'front',false)!.position.clone();rig.pose([25,15],0);parent.updateMatrixWorld(true);rig.skeleton.update();
 assert.ok(surfacePoint(rig.mesh,.8,.5,'front',false)!.position.distanceTo(before)>.1);
 assert.throws(()=>surfacePoint(rig.mesh,1.01,.5,'front',false));geo.dispose();mat.dispose();
});


test('exact reed example sits on seat when closed and lifts at the opening key',()=>{
 const reed=[{u:0,center:[.45,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:.02},{u:.5,center:[1.45,0,0],chord:[0,0,1],halfWidth:.5,camber:0,profileDelta:.05},{u:1,center:[2.45,0,0],chord:[0,0,1],halfWidth:.2,camber:0,profileDelta:.02}] as const;
 const frames=sampleFrames(reed), seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const parent=new Group(),geo=buildFlexGeometry(frames,[0,.5,1],seam,false),mat=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,mat,reed,[{u:0,offset:[0,0,0],axis:[0,0,1]},{u:.5,offset:[0,0,0],axis:[0,0,1]},{u:1,offset:[0,0,0],axis:[0,0,1]}],false);
 parent.updateMatrixWorld(true);rig.skeleton.update();const closed=surfacePoint(rig.mesh,.5,.5,'back',false)!.position;
 assert.ok(Math.abs(closed.y-(-.02))<1e-6,`closed face ${closed.y} must meet seat top -0.02`);
 rig.pose([12,18,8],1);parent.updateMatrixWorld(true);rig.skeleton.update();assert.ok(surfacePoint(rig.mesh,.5,.5,'back',false)!.position.y > -.02+.1);
 geo.dispose();mat.dispose();
});

test('front and back attachment normals follow their actual rendered winding',()=>{
 const frames=sampleFrames(s),seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const parent=new Group(),geo=buildFlexGeometry(frames,[0,1],seam,false),mat=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,mat,s,[{u:0,offset:[0,0,0],axis:[0,0,1]},{u:1,offset:[0,0,0],axis:[0,0,1]}],false);
 parent.updateMatrixWorld(true);rig.skeleton.update();for(const uv of [[.3,.4],[.31,.49]] as const){assert.ok(surfacePoint(rig.mesh,uv[0],uv[1],'front',false)!.normal.y>.99);assert.ok(surfacePoint(rig.mesh,uv[0],uv[1],'back',false)!.normal.y<-.99);}geo.dispose();mat.dispose();
});

test('attachments reuse a supplied posed-vertex cache rather than skinning again',()=>{
 const frames=sampleFrames(s),seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const parent=new Group(),geo=buildFlexGeometry(frames,[0,1],seam,false),mat=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,mat,s,[{u:0,offset:[0,0,0],axis:[0,0,1]},{u:1,offset:[0,0,0],axis:[0,0,1]}],false);parent.updateMatrixWorld(true);rig.skeleton.update();
 const n=geo.getAttribute('position').count,cache=new Float32Array(n*3);for(let i=0;i<n;i++){const p=rig.mesh.getVertexPosition(i,new Vector3());cache.set(p.toArray(),i*3);}
 const expected=surfacePoint(rig.mesh,.4,.6,'front',false)!;rig.mesh.getVertexPosition=()=>{throw Error('unexpected repeat skinning')};
 const actual=surfacePoint(rig.mesh,.4,.6,'front',false,cache)!;assert.ok(actual.position.distanceTo(expected.position)<1e-6);geo.dispose();mat.dispose();
});
