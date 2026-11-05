import { InstancedMesh, Mesh, Sphere } from 'three';
import type { Intersection, Matrix4, Object3D, Raycaster } from 'three';
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
  const sphere=new Sphere(bound.center.clone().applyMatrix4(object.matrixWorld),bound.radius*scaleBound(object.matrixWorld));
  if(!Number.isFinite(sphere.radius)||![sphere.center.x,sphere.center.y,sphere.center.z].every(Number.isFinite))return true;
  return ray.ray.intersectsSphere(sphere);
 });
}

/** Upper bound on the largest singular value, from row sums of the Gram matrix. */
function scaleBound(matrix:Matrix4):number {
 const e=matrix.elements, a=[[e[0]!,e[1]!,e[2]!],[e[4]!,e[5]!,e[6]!],[e[8]!,e[9]!,e[10]!]];
 const dot=(i:number,j:number)=>a[i]![0]!*a[j]![0]!+a[i]![1]!*a[j]![1]!+a[i]![2]!*a[j]![2]!;
 return Math.sqrt(Math.max(...a.map((_,i)=>Math.abs(dot(i,0))+Math.abs(dot(i,1))+Math.abs(dot(i,2)))));
}
/** Three's world-space sphere precheck also needs a conservative affine scale.
 * Expand only synchronously while raycasting and restore shared bounds even on errors. */
export function safeRayIntersections(ray:Raycaster,objects:readonly Object3D[]):Intersection[] {
 const hits:Intersection[]=[];
 for(const object of objects){
  if(!(object instanceof Mesh)){ray.intersectObject(object,false,hits);continue;}
  const geometry=object.geometry;if(!geometry.boundingSphere)geometry.computeBoundingSphere();
  const sphere=geometry.boundingSphere, old=sphere?.radius;
  const e=object.matrixWorld.elements,maxScale=Math.sqrt(Math.max(e[0]!**2+e[1]!**2+e[2]!**2,e[4]!**2+e[5]!**2+e[6]!**2,e[8]!**2+e[9]!**2+e[10]!**2));
  const factor=object instanceof InstancedMesh ? Math.sqrt(3) : Math.max(1,scaleBound(object.matrixWorld)/maxScale);
  if(sphere && old!==undefined && Number.isFinite(old) && Number.isFinite(factor))sphere.radius=old*factor*(1+1e-12);
  let instanceSphere:Sphere|null=null,instanceRadius:number|undefined;
  if(object instanceof InstancedMesh){if(!object.boundingSphere)object.computeBoundingSphere();instanceSphere=object.boundingSphere;instanceRadius=instanceSphere?.radius;if(instanceSphere && instanceRadius!==undefined && Number.isFinite(instanceRadius)){const outer=Math.max(1,scaleBound(object.matrixWorld)/maxScale);if(Number.isFinite(outer))instanceSphere.radius=instanceRadius*outer*Math.sqrt(3)*(1+1e-12);}}
  try{ray.intersectObject(object,false,hits);}finally{if(sphere && old!==undefined)sphere.radius=old;if(instanceSphere && instanceRadius!==undefined)instanceSphere.radius=instanceRadius;}
 }
 return hits.sort((a,b)=>a.distance-b.distance);
}
