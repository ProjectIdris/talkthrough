import {test} from 'node:test';import assert from 'node:assert/strict';import { Mesh, BoxGeometry, MeshBasicMaterial } from 'three';
import { FlexPickBudget } from '../src/overlay/flex-pick-budget.ts';
test('frame budget bounds shared pin queries and all potential triangle tests',()=>{
 const mesh=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial()),b=new FlexPickBudget(24,30);assert.ok(b.query());assert.ok(b.ray([mesh,mesh]));assert.equal(b.ray([mesh]),false);assert.equal(b.trianglesRemaining,6);
 const q=new FlexPickBudget(2,100);assert.ok(q.query());assert.ok(q.query());assert.equal(q.query(),false);mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
});

test('exhausted shared budget conservatively retains interaction rather than dismissing visible content',async()=>{
 const {hitVisibleModel}=await import('../src/overlay/model-hit.ts');const {PerspectiveCamera}=await import('three');const camera=new PerspectiveCamera(50,1,.1,100);camera.position.z=5;camera.updateMatrixWorld();camera.updateProjectionMatrix();
 const mesh=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial());mesh.updateMatrixWorld(true);const budget=new FlexPickBudget(24,1);mesh.raycast=()=>{throw Error('budget did not prevent raycast');};
 assert.equal(hitVisibleModel([mesh],camera,1000,1000,500,500,budget),true);assert.equal(budget.trianglesRemaining,1);mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
});


test('an unregistered or stale skinned hit proxy is unknown, never a background-dismiss verdict',async()=>{
 const {SkinnedMesh,PerspectiveCamera}=await import('three');const {hitVisibleModel}=await import('../src/overlay/model-hit.ts');const camera=new PerspectiveCamera(50,1,.1,100);camera.position.z=5;camera.updateMatrixWorld();camera.updateProjectionMatrix();const geo=new BoxGeometry(1,1,1),mat=new MeshBasicMaterial(),mesh=new SkinnedMesh(geo,mat);mesh.raycast=()=>{throw Error('unknown skin should not raycast');};assert.equal(hitVisibleModel([mesh],camera,1000,1000,500,500,new FlexPickBudget()),true);geo.dispose();mat.dispose();
});

test('stale posed geometry is reported unknown before screen-rectangle rejection',async()=>{
 const {hasUnknownFlexPick}=await import('../src/overlay/model-hit.ts');const {BufferGeometry,MeshBasicMaterial,SkinnedMesh}=await import('three');const skin=new SkinnedMesh(new BufferGeometry(),new MeshBasicMaterial());assert.equal(hasUnknownFlexPick([skin]),true);
});

test('unknown posed geometry outside stale screen bounds is not routed as background',async()=>{
 const {hitModelRegion}=await import('../src/overlay/model-hit.ts');const {SkinnedMesh,PerspectiveCamera}=await import('three');const skin=new SkinnedMesh(new BoxGeometry(1,1,1),new MeshBasicMaterial()),camera=new PerspectiveCamera();
 assert.equal(hitModelRegion([skin],camera,{x:10,y:10,w:40,h:40},1000,1000,900,900,new FlexPickBudget()),'unknown');skin.geometry.dispose();(skin.material as MeshBasicMaterial).dispose();
});

test('exhaustion is explicitly observable so the overlay can schedule a fresh frame',()=>{
 const mesh=new Mesh(new BoxGeometry(1,1,1),new MeshBasicMaterial()),budget=new FlexPickBudget(24,1);assert.equal(budget.exhausted,false);assert.equal(budget.ray([mesh]),false);assert.equal(budget.exhausted,true);mesh.geometry.dispose();(mesh.material as MeshBasicMaterial).dispose();
});
