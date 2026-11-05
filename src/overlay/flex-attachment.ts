import { SkinnedMesh, Vector3 } from 'three';
/** Evaluate exact declared UV triangle. Return undefined if the posed triangle degenerates. */
export function surfacePoint(mesh:SkinnedMesh,u:number,v:number,side:'front'|'back',mirror:boolean):{position:Vector3;tangent:Vector3;normal:Vector3}|undefined {
  if(!Number.isFinite(u)||!Number.isFinite(v)||u<0||u>1||v<0||v>1||(side!=='front'&&side!=='back'))throw Error('invalid surface coordinates');
  const i=Math.min(Math.floor(24*u),23),j=Math.min(Math.floor(6*v),5),fu=24*u-i,fv=6*v-j,s=side==='front'?0:1;
  const vertex=(row:number,col:number)=>row===0?col:s===0?row*7+col:175+(row-1)*7+col;
  const a=vertex(i,j),b=vertex(i+1,j),c=vertex(i,j+1),d=vertex(i+1,j+1);
  const ids=fu+fv<=1?[a,b,c]:[b,c,d], w=fu+fv<=1?[1-fu-fv,fu,fv]:[1-fv,1-fu,fu+fv-1];
  const p=ids.map(id=>mesh.localToWorld(mesh.getVertexPosition(id,new Vector3())));
  const pos=new Vector3().addScaledVector(p[0]!,w[0]!).addScaledVector(p[1]!,w[1]!).addScaledVector(p[2]!,w[2]!);
  const normal=new Vector3().subVectors(p[1]!,p[0]!).cross(new Vector3().subVectors(p[2]!,p[0]!));
  // The upper triangle [b,c,d] has the opposite vertex ordering to [a,b,c].
  if((fu+fv>1)===(side==='back')!==mirror)normal.negate();
  if(normal.lengthSq()<1e-16)return undefined;normal.normalize();
  const tangent=fu+fv<=1?new Vector3().subVectors(p[1]!,p[0]!):new Vector3().subVectors(p[2]!,p[1]!);
  tangent.addScaledVector(normal,-tangent.dot(normal));if(tangent.lengthSq()<1e-16)return undefined;tangent.normalize();
  return {position:pos,normal,tangent};
}

