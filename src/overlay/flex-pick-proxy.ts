import { Mesh, SkinnedMesh } from 'three';
const proxies=new WeakMap<SkinnedMesh,Mesh>();
export function flexPoseKey(mesh:SkinnedMesh):string {return mesh.skeleton.bones.map(b=>[...b.position.toArray(),...b.quaternion.toArray(),...b.scale.toArray()].join(',')).join(';')+'|'+(mesh.morphTargetInfluences??[]).join(',');}
export function registerFlexPick(mesh:SkinnedMesh,proxy:Mesh):void {proxies.set(mesh,proxy);}
/** Undefined means no current cache: callers must not guess an empty hit. */
export function flexPickObject(mesh:Mesh):Mesh|undefined {
 if(!(mesh instanceof SkinnedMesh))return mesh;
 const p=proxies.get(mesh);if(!p||p.userData.flexPoseKey!==flexPoseKey(mesh)||!p.matrixWorld.equals(mesh.matrixWorld)||p.visible!==mesh.visible||p.parent!==mesh.parent)return;
 return p;
}
export function unregisterFlexPick(mesh:SkinnedMesh):void {proxies.delete(mesh);}
