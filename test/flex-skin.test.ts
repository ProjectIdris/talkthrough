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
