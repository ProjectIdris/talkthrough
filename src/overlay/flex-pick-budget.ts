import { InstancedMesh, Mesh, Sphere } from 'three';
import type { Object3D, Raycaster } from 'three';
/** Conservative upper bound on tests: charge whole meshes even when broad phase would miss. */
export class FlexPickBudget {
  private queries:number; trianglesRemaining:number; exhausted=false;
  constructor(queries=24,trianglesRemaining=8192) {this.queries=queries;this.trianglesRemaining=trianglesRemaining;}
  query():boolean { if(this.queries<=0){this.exhausted=true;return false;}this.queries--;return true; }
  ray(objects:readonly Object3D[],recursive=false):boolean {
    let triangles=0;
    const charge=(obj:Object3D)=>{if(!(obj instanceof Mesh))return;const g=obj.geometry,p=g?.getAttribute('position');if(!p)return;const count=Math.floor((g.getIndex()?.count??p.count)/3);triangles+=count*(obj instanceof InstancedMesh?obj.count:1);};
    for(const obj of objects) {if(recursive)obj.traverse(charge);else charge(obj);if(triangles>this.trianglesRemaining){this.exhausted=true;return false;}}
    if(triangles>this.trianglesRemaining){this.exhausted=true;return false;}this.trianglesRemaining-=triangles;return true;
  }
}

/** Cull only ordinary meshes whose transformed geometry sphere provably misses this ray.
 * Instanced meshes and unknown/invalid bounds remain candidates and are charged in full. */
export function rayCandidates<T extends Object3D>(objects:readonly T[],ray:Raycaster):T[] {
 return objects.filter(object=>{
  if(!(object instanceof Mesh) || object instanceof InstancedMesh)return true;
  const geometry=object.geometry;if(!geometry.boundingSphere)geometry.computeBoundingSphere();
  const bound=geometry.boundingSphere;if(!bound || !Number.isFinite(bound.radius) || bound.radius<0)return true;
  const sphere=new Sphere().copy(bound).applyMatrix4(object.matrixWorld);
  if(!Number.isFinite(sphere.radius)||![sphere.center.x,sphere.center.y,sphere.center.z].every(Number.isFinite))return true;
  return ray.ray.intersectsSphere(sphere);
 });
}
