import { BufferGeometry, Float32BufferAttribute, Uint16BufferAttribute, Vector3 } from 'three';
import type { FlexFrame } from './flex-frames.ts';

/** Build the bounded surface only after its parent seam has been validated/projected. */
export function buildFlexGeometry(frames: readonly FlexFrame[], joints: readonly number[], seam: readonly Vector3[], mirror: boolean): BufferGeometry {
  if (frames.length !== 25 || seam.length !== 7 || joints.length < 2 || joints.length > 6 || joints[0] !== 0 || joints.at(-1) !== 1 || joints.some((v,i) => !Number.isFinite(v) || (i > 0 && v <= joints[i-1]!)) || seam.some(p => ![p.x,p.y,p.z].every(Number.isFinite))) throw Error('invalid surface');
  const positions: number[] = [], morphs: number[] = [], indices: number[] = [], weights: number[] = [], triangles: number[] = [];
  const add = (i:number,j:number,face:number) => {
    const f=frames[i]!, v=j/6, q=Math.sin(Math.PI*v);
    const point=i===0 ? seam[j]!.clone() : f.center.clone().addScaledVector(f.chord,(2*v-1)*f.halfWidth).addScaledVector(f.normal,f.camber*q+(face===0?.02:-.02));
    const delta=i===0 ? new Vector3() : f.normal.clone().multiplyScalar(f.profileDelta*q);
    if(mirror){point.x=-point.x;delta.x=-delta.x;}
    positions.push(point.x,point.y,point.z); morphs.push(delta.x,delta.y,delta.z);
    if(i===0){indices.push(0,0,0,0);weights.push(1,0,0,0);}
    else {let k=0; const u=i/24; while(k<joints.length-2&&u>joints[k+1]!)k++; const mix=(u-joints[k]!)/(joints[k+1]!-joints[k]!); indices.push(k+1,k+2,0,0);weights.push(1-mix,mix,0,0);}
  };
  for(let i=0;i<25;i++)for(let j=0;j<7;j++)add(i,j,0);
  for(let i=1;i<25;i++)for(let j=0;j<7;j++)add(i,j,1);
  const vertex=(side:number,i:number,j:number)=>i===0?j:side===0?i*7+j:175+(i-1)*7+j;
  const tri=(a:number,b:number,c:number)=>{if(mirror)triangles.push(a,b,c);else triangles.push(a,c,b);};
  for(let side=0;side<2;side++)for(let i=0;i<24;i++)for(let j=0;j<6;j++){
    const a=vertex(side,i,j),b=vertex(side,i+1,j),c=vertex(side,i,j+1),d=vertex(side,i+1,j+1);
    if(side===0){tri(a,b,c);tri(b,d,c);}else{tri(a,c,b);tri(b,c,d);}
  }
  for(let i=0;i<24;i++)for(const j of [0,6]){
    const a=vertex(0,i,j),b=vertex(0,i+1,j),c=vertex(1,i,j),d=vertex(1,i+1,j);
    if(j===0){if(i>0)tri(a,c,b);tri(b,c,d);} else {if(i>0)tri(a,b,c);tri(b,d,c);}
  }
  for(let j=0;j<6;j++){const a=vertex(0,24,j),b=vertex(0,24,j+1),c=vertex(1,24,j),d=vertex(1,24,j+1);tri(a,b,c);tri(b,d,c);}
  const geometry=new BufferGeometry(); geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
  geometry.setAttribute('skinIndex',new Uint16BufferAttribute(indices,4)); geometry.setAttribute('skinWeight',new Float32BufferAttribute(weights,4));
  geometry.setIndex(triangles); geometry.morphTargetsRelative=true; geometry.morphAttributes.position=[new Float32BufferAttribute(morphs,3)]; geometry.computeVertexNormals();
  const shaped=new BufferGeometry();shaped.setAttribute('position',new Float32BufferAttribute(positions.map((v,i)=>v+morphs[i]!),3));shaped.setIndex(triangles);shaped.computeVertexNormals();
  const base=geometry.getAttribute('normal'), changed=shaped.getAttribute('normal'), normalDelta:number[]=[];
  for(let i=0;i<base.count;i++)normalDelta.push(changed.getX(i)-base.getX(i),changed.getY(i)-base.getY(i),changed.getZ(i)-base.getZ(i));
  geometry.morphAttributes.normal=[new Float32BufferAttribute(normalDelta,3)];shaped.dispose();
  return geometry;
}

