import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Mesh, MeshBasicMaterial, Matrix4, Vector3 } from 'three';
import { projectRoot } from '../src/overlay/flex-root.ts';

test('projects seven explicit seam points outward only onto the requested rigid parent', () => {
  const box=new Mesh(new BoxGeometry(1,2,2),new MeshBasicMaterial()); box.updateMatrixWorld(true);
  const seam=Array.from({length:7},(_,i)=>new Vector3(.45,0,(i-3)*.1));
  const result=projectRoot(box,seam,new Matrix4(),new Vector3(.45,0,0),new Vector3(1,0,0),.1);
  assert.equal(result.length,7);
  for(const v of result) assert.ok(Math.abs(v.x-.5)<1e-6);
  assert.throws(()=>projectRoot(box,seam,new Matrix4(),new Vector3(.45,0,0),new Vector3(-1,0,0),.1));
  assert.throws(()=>projectRoot(box,seam,new Matrix4(),new Vector3(.2,0,0),new Vector3(1,0,0),.1));
  box.scale.set(1,2,1);box.updateMatrixWorld(true);
  assert.throws(()=>projectRoot(box,seam,new Matrix4(),new Vector3(.45,0,0),new Vector3(1,0,0),.1));
  box.geometry.dispose(); (box.material as MeshBasicMaterial).dispose();
});

test('rejects negative scales, nonfinite input and unrelated parents instead of guessing',()=>{
 const box=new Mesh(new BoxGeometry(1,2,2),new MeshBasicMaterial());const seam=Array.from({length:7},(_,i)=>new Vector3(.45,0,(i-3)*.1));
 box.scale.set(-1,-1,1);box.updateMatrixWorld(true);assert.throws(()=>projectRoot(box,seam,new Matrix4(),new Vector3(.45,0,0),new Vector3(1,0,0),.1));
 box.scale.set(1,1,1);box.updateMatrixWorld(true);assert.throws(()=>projectRoot(box,seam,new Matrix4(),new Vector3(.45,0,0),new Vector3(NaN,0,0),.1));
 box.geometry.dispose();(box.material as MeshBasicMaterial).dispose();
});

// Equal basis lengths can still hide shear; the first implementation accepts only rigid-uniform transforms.
test('sheared parent matrix is rejected even when basis lengths match',()=>{
 const box=new Mesh(new BoxGeometry(1,2,2),new MeshBasicMaterial());box.matrixAutoUpdate=false;box.matrix.set(1,0.5,0,0, 0,Math.sqrt(.75),0,0, 0,0,1,0, 0,0,0,1);box.updateMatrixWorld(true);
 const seam=Array.from({length:7},(_,i)=>new Vector3(.45,0,(i-3)*.1));assert.throws(()=>projectRoot(box,seam,new Matrix4(),new Vector3(.45,0,0),new Vector3(1,0,0),.1));box.geometry.dispose();(box.material as MeshBasicMaterial).dispose();
});
