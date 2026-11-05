import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Group, MeshBasicMaterial, Vector3 } from 'three';
import { sampleFrames } from '../src/overlay/flex-frames.ts';
import { buildFlexGeometry } from '../src/overlay/flex-geometry.ts';
import { makeFlexSkin } from '../src/overlay/flex-skin.ts';
const sections = [
  {u:0,center:[0,0,0],chord:[0,0,1],halfWidth:.2,camber:.02,profileDelta:.01},
  {u:.5,center:[1,0,0],chord:[0,0,1],halfWidth:.5,camber:.04,profileDelta:.02},
  {u:1,center:[2,0,0],chord:[0,0,1],halfWidth:.2,camber:.02,profileDelta:.01},
] as const;
test('skin uses a fixed seam anchor and exact interpolated joint pivots', () => {
 const parent=new Group(), frames=sampleFrames(sections), seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const geo=buildFlexGeometry(frames,[0,.37,1],seam,false), material=new MeshBasicMaterial();
 const rig=makeFlexSkin(parent,geo,material,sections,[{u:0,offset:[0,0,0],axis:[0,0,1]},{u:.37,offset:[0,.1,0],axis:[0,0,1]},{u:1,offset:[0,0,0],axis:[0,0,1]}],false);
 assert.equal(rig.skeleton.bones.length,4); assert.ok(rig.skeleton.bones[2]!.position.distanceTo(new Vector3(.74,.1,0))<1e-8);
 parent.updateMatrixWorld(true); rig.skeleton.update(); const rootBefore=rig.mesh.getVertexPosition(3,new Vector3()), tipBefore=rig.mesh.getVertexPosition(171,new Vector3());
 rig.pose([35,-15,5],.5); parent.updateMatrixWorld(true);rig.skeleton.update();
 assert.ok(rig.mesh.getVertexPosition(3,new Vector3()).distanceTo(rootBefore)<1e-7);
 assert.ok(rig.mesh.getVertexPosition(171,new Vector3()).distanceTo(tipBefore)>.1);
 geo.dispose();material.dispose();
});

test('declared conservative camera envelope contains posed vertices throughout a wide joint sweep',()=>{
 const parent=new Group(),frames=sampleFrames(sections),seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const geo=buildFlexGeometry(frames,[0,.37,1],seam,false),material=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,material,sections,[{u:0,offset:[0,0,0],axis:[0,0,1]},{u:.37,offset:[0,.1,0],axis:[0,0,1]},{u:1,offset:[0,0,0],axis:[0,0,1]}],false);
 for(const angle of [-120,-60,0,60,120]){rig.pose([angle,-angle/2,angle/4],1);parent.updateMatrixWorld(true);rig.skeleton.update();for(let i=0;i<geo.getAttribute('position').count;i++){const p=rig.mesh.getVertexPosition(i,new Vector3());assert.ok(rig.envelope.containsPoint(p),`escaped at ${angle}/${i}`);}}
 geo.dispose();material.dispose();
});

test('camera envelope is bounded by actual skin influences instead of an entire doubled chain',()=>{
 const parent=new Group(),frames=sampleFrames(sections),seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const geo=buildFlexGeometry(frames,[0,.37,1],seam,false),material=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,material,sections,[{u:0,offset:[0,0,0],axis:[0,0,1],min:-45,max:45},{u:.37,offset:[0,.1,0],axis:[0,0,1],min:-20,max:20},{u:1,offset:[0,0,0],axis:[0,0,1],min:-10,max:10}],false);
 assert.ok(rig.envelope.radius<3,`unnecessarily loose envelope ${rig.envelope.radius}`);geo.dispose();material.dispose();
});

test('limit-aware envelope contains every vertex at joint-limit corners',()=>{
 const parent=new Group(),frames=sampleFrames(sections),seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));
 const geo=buildFlexGeometry(frames,[0,.37,1],seam,false),mat=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,mat,sections,[{u:0,offset:[0,0,0],axis:[0,0,1],min:-45,max:45},{u:.37,offset:[0,.1,0],axis:[0,0,1],min:-20,max:20},{u:1,offset:[0,0,0],axis:[0,0,1],min:-10,max:10}],false);
 for(const a of [-45,45])for(const b of [-20,20])for(const c of [-10,10]){rig.pose([a,b,c],1);parent.updateMatrixWorld(true);rig.skeleton.update();for(let i=0;i<geo.getAttribute('position').count;i++)assert.ok(rig.envelope.containsPoint(rig.mesh.getVertexPosition(i,new Vector3())));}
 geo.dispose();mat.dispose();
});

test('pose outside declared limits is rejected so camera bounds remain valid',()=>{
 const parent=new Group(),frames=sampleFrames(sections),seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));const geo=buildFlexGeometry(frames,[0,1],seam,false),mat=new MeshBasicMaterial();
 const rig=makeFlexSkin(parent,geo,mat,sections,[{u:0,offset:[0,0,0],axis:[0,0,1],min:-20,max:20},{u:1,offset:[0,0,0],axis:[0,0,1],min:-10,max:10}],false);assert.throws(()=>rig.pose([21,0],0));geo.dispose();mat.dispose();
});

test('all seam vertices remain fixed while the moving chain bends',()=>{
 const parent=new Group(),frames=sampleFrames(sections),seam=Array.from({length:7},(_,j)=>frames[0]!.center.clone().addScaledVector(frames[0]!.chord,(2*j/6-1)*.2));const geo=buildFlexGeometry(frames,[0,.37,1],seam,false),mat=new MeshBasicMaterial(),rig=makeFlexSkin(parent,geo,mat,sections,[{u:0,offset:[0,0,0],axis:[0,0,1]},{u:.37,offset:[0,.1,0],axis:[0,0,1]},{u:1,offset:[0,0,0],axis:[0,0,1]}],false);parent.updateMatrixWorld(true);rig.skeleton.update();const before=Array.from({length:7},(_,i)=>rig.mesh.getVertexPosition(i,new Vector3()));for(const angle of [-90,0,90]){rig.pose([angle,30,-20],1);parent.updateMatrixWorld(true);rig.skeleton.update();for(let i=0;i<7;i++)assert.ok(rig.mesh.getVertexPosition(i,new Vector3()).distanceTo(before[i]!)<1e-7);}geo.dispose();mat.dispose();
});
