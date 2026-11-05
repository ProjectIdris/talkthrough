import { Bone, BufferGeometry, Euler, Material, Object3D, Skeleton, SkinnedMesh, Vector3 } from 'three';
import type { FlexSection } from './flex-frames.ts';

type Joint = {u:number; offset:readonly [number,number,number]; axis:readonly [number,number,number]};
/** Construct a native serial skin; its first bone is a separate, never-driven anchor. */
export function makeFlexSkin(parent:Object3D, geometry:BufferGeometry, material:Material, sections:readonly FlexSection[], joints:readonly Joint[], mirror:boolean, transform?: {pos:readonly [number,number,number];rot:readonly [number,number,number]}) {
  if(joints.length<2||joints.length>6||joints[0]?.u!==0||joints.at(-1)?.u!==1) throw Error('invalid joints');
  const pivots:Vector3[]=[], axes:Vector3[]=[];
  for(let i=0;i<joints.length;i++){
    const joint=joints[i]!;
    if(![joint.u,...joint.offset,...joint.axis].every(Number.isFinite) || (i>0&&joint.u<=joints[i-1]!.u))throw Error('invalid joint');
    const offset=new Vector3(...joint.offset),axis=new Vector3(...joint.axis);
    if(offset.length()>.25||axis.lengthSq()<1e-16)throw Error('invalid joint offset or axis');
    let k=0;while(k<sections.length-2&&joint.u>sections[k+1]!.u)k++;
    const a=sections[k]!,b=sections[k+1]!,f=(joint.u-a.u)/(b.u-a.u);
    const p=new Vector3(...a.center).lerp(new Vector3(...b.center),f).add(offset);
    if(mirror){p.x=-p.x;axis.y=-axis.y;axis.z=-axis.z;}
    pivots.push(p);axes.push(axis.normalize());
  }
  const mesh=new SkinnedMesh(geometry,material),anchor=new Bone(),bones:Bone[]=[];
  if(transform){mesh.position.set(...transform.pos);mesh.rotation.copy(new Euler(...transform.rot.map(x=>x*Math.PI/180) as [number,number,number]));}
  parent.add(mesh);mesh.add(anchor);
  for(let i=0;i<joints.length;i++){
    const bone=new Bone();bone.position.copy(pivots[i]!);if(i)bone.position.sub(pivots[i-1]!);
    (bones[i-1]??anchor).add(bone);bones.push(bone);
  }
  parent.updateWorldMatrix(true,true);const skeleton=new Skeleton([anchor,...bones]);mesh.bind(skeleton);
  return {mesh,skeleton,pose(angles:readonly number[],profile:number){
    if(angles.length!==bones.length||!angles.every(Number.isFinite)||!Number.isFinite(profile)||profile<0||profile>1)throw Error('invalid pose');
    for(let i=0;i<bones.length;i++)bones[i]!.quaternion.setFromAxisAngle(axes[i]!,angles[i]!*Math.PI/180);
    if(mesh.morphTargetInfluences)mesh.morphTargetInfluences[0]=profile;
  }};
}
