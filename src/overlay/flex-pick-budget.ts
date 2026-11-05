import { InstancedMesh, Mesh } from 'three';
import type { Object3D } from 'three';
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
