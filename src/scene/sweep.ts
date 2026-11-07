// Bounded polygon sweeps, shared by admission and rendering. All inputs are data;
// Three.js supplies only its pure curve math and polygon triangulator here.
// Source-module exports avoid the renderer barrel's initialization in the validator.
import { CatmullRomCurve3 } from 'three/src/extras/curves/CatmullRomCurve3.js';
import { ShapeUtils } from 'three/src/extras/ShapeUtils.js';
import { Vector2 } from 'three/src/math/Vector2.js';
import { Vector3 } from 'three/src/math/Vector3.js';
import { Quaternion } from 'three/src/math/Quaternion.js';
import type { Vec2, Vec3 } from './types.ts';

export const SWEEP_SUBDIVISIONS = { low: 4, mid: 8, high: 12 } as const;
export type SweepMesh = { positions: Float32Array; normals: Float32Array; indices: Uint16Array; edges: Float32Array };
const value = (o: object, key: string): unknown => {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && 'value' in d ? d.value : undefined;
};
function vector(input: unknown, size: number): number[] | undefined {
  if (!Array.isArray(input) || input.length !== size) return undefined;
  const out: number[] = [];
  for (let i = 0; i < size; i++) {
    const n = value(input, String(i));
    if (typeof n !== 'number' || !Number.isFinite(n) || n < -100 || n > 100) return undefined;
    out.push(n);
  }
  return out;
}
function points(input: unknown, size: number, min: number, max: number): number[][] | undefined {
  if (!Array.isArray(input) || input.length < min || input.length > max) return undefined;
  const out: number[][] = [];
  for (let i = 0; i < input.length; i++) {
    const p = vector(value(input, String(i)), size);
    if (!p) return undefined;
    out.push(p);
  }
  return out;
}
const cross = (a: Vec2, b: Vec2, c: Vec2): number => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const same = (a: Vec2, b: Vec2): boolean => a[0] === b[0] && a[1] === b[1];

/** Normalize only exact redundant boundary data; other invalid profiles reject. */
function profile(input: unknown): { ring: Vec2[]; caps: number[][] } | undefined {
  const ring = points(input, 2, 3, 24) as Vec2[] | undefined;
  if (!ring) return undefined;
  if (same(ring[0]!, ring[ring.length-1]!)) ring.pop();
  let changed = true;
  while (changed && ring.length > 3) {
    changed = false;
    for (let i = 0; i < ring.length; i++) {
      const a=ring[(i+ring.length-1)%ring.length]!,b=ring[i]!,c=ring[(i+1)%ring.length]!;
      if (same(a,b) || same(b,c)) return undefined;
      if (cross(a,b,c) === 0 && (b[0]-a[0])*(b[0]-c[0])+(b[1]-a[1])*(b[1]-c[1]) < 0) {
        ring.splice(i,1); changed=true; break;
      }
    }
  }
  if (ring.length < 3) return undefined;
  const origin=ring[0]!, span=Math.max(...ring.map(p=>Math.max(Math.abs(p[0]-origin[0]),Math.abs(p[1]-origin[1]))));
  if (!(span>0)) return undefined;
  const q=ring.map(p=>[(p[0]-origin[0])/span,(p[1]-origin[1])/span] as Vec2);
  const eps=1e-12;
  for (let i=0;i<q.length;i++) {
    const a=q[i]!,b=q[(i+1)%q.length]!;
    if (Math.hypot(b[0]-a[0],b[1]-a[1])<eps || Math.abs(cross(q[(i+q.length-1)%q.length]!,a,b))<eps) return undefined;
    for (let j=i+1;j<q.length;j++) {
      if (j===i+1 || (i===0 && j===q.length-1)) continue;
      const c=q[j]!,d=q[(j+1)%q.length]!;
      if (Math.max(a[0],b[0])+eps < Math.min(c[0],d[0]) || Math.max(c[0],d[0])+eps < Math.min(a[0],b[0]) ||
          Math.max(a[1],b[1])+eps < Math.min(c[1],d[1]) || Math.max(c[1],d[1])+eps < Math.min(a[1],b[1])) continue;
      const abC=cross(a,b,c),abD=cross(a,b,d),cdA=cross(c,d,a),cdB=cross(c,d,b);
      if (((abC>=-eps && abD<=eps)||(abD>=-eps && abC<=eps)) && ((cdA>=-eps && cdB<=eps)||(cdB>=-eps && cdA<=eps))) return undefined;
    }
  }
  let area=0;
  for (let i=1;i<q.length-1;i++) area+=cross(q[0]!,q[i]!,q[i+1]!);
  if (Math.abs(area)<eps) return undefined;
  if (area<0) { ring.reverse();q.reverse();area=-area; }
  const caps=ShapeUtils.triangulateShape(q.map(p=>new Vector2(...p)),[]);
  if (caps.length!==ring.length-2) return undefined;
  let sum=0;
  for(const tri of caps) {
    const a=cross(q[tri[0]!]!,q[tri[1]!]!,q[tri[2]!]!);
    if (!(a>eps)) return undefined;
    sum+=a;
  }
  if (Math.abs(sum-area)>Math.max(eps,area*1e-10)) return undefined;
  return {ring,caps};
}

/** Prepare the actual emitted mesh. This detects local sampled folds/collapse,
 * not distant surface intersections or everything between curve samples. */
export function prepareSweep(outline: unknown, pointsInput: unknown, upInput: unknown, subdivisions: number): SweepMesh | undefined {
  if (!Object.values(SWEEP_SUBDIVISIONS).some(n=>n===subdivisions)) return undefined;
  const section=profile(outline), raw=points(pointsInput,3,2,16) as Vec3[] | undefined;
  if (!section || !raw) return undefined;
  const controls=raw.map(p=>new Vector3(...p));
  const origin=controls[0]!.clone(); controls.forEach(p=>p.sub(origin));
  const scale=Math.max(...controls.map(p=>p.length()));
  if (!(scale>0)) return undefined;
  for(let i=0;i<controls.length;i++) for(let j=i+1;j<controls.length;j++) {
    if (!(controls[i]!.distanceTo(controls[j]!)>scale*1e-10)) return undefined;
  }
  for(let i=1;i<controls.length-1;i++) {
    const before=controls[i]!.clone().sub(controls[i-1]!).normalize(), after=controls[i+1]!.clone().sub(controls[i]!).normalize();
    if (before.dot(after)<-0.999999) return undefined;
  }
  const providedUp=upInput!==undefined && upInput!==null;
  const up=providedUp?vector(upInput,3):[0,1,0];
  if (!up) return undefined;
  const curve=new CatmullRomCurve3(controls,false,'centripetal');
  const segments=(controls.length-1)*subdivisions;
  const frames:Array<{p:Vector3;t:Vector3;x:Vector3;y:Vector3}>=[];
  const rotation=new Quaternion();
  for(let i=0;i<=segments;i++) {
    const u=i/segments;
    const p=controls.length===2?controls[0]!.clone().lerp(controls[1]!,u):curve.getPoint(u);
    // The extrapolated endpoint controls make these exact tangent directions.
    // getTangent uses a finite difference that leans toward the next bend and can
    // turn an exactly parallel authored up into an unstable, apparently valid one.
    const t=i===0?controls[1]!.clone().sub(controls[0]!).normalize():i===segments?
      controls[controls.length-1]!.clone().sub(controls[controls.length-2]!).normalize():
      controls.length===2?controls[1]!.clone().sub(controls[0]!).normalize():curve.getTangent(u);
    if (!(t.lengthSq()>0.99) || ![p.x,p.y,p.z,t.x,t.y,t.z].every(Number.isFinite)) return undefined;
    let y:Vector3;
    if (i===0) {
      y=new Vector3(up[0],up[1],up[2]); const length=y.length();
      if (!(length>0)) return undefined;
      y.addScaledVector(t,-y.dot(t));
      if (y.length()<length*1e-8) {
        if (providedUp) return undefined;
        y.set(1,0,0).addScaledVector(t,-t.x);
      }
    } else {
      const previous=frames[i-1]!;
      if (previous.t.dot(t)<-0.99 || !(p.distanceTo(previous.p)>scale*1e-12)) return undefined;
      rotation.setFromUnitVectors(previous.t,t);
      y=previous.y.clone().applyQuaternion(rotation).addScaledVector(t,-previous.y.clone().applyQuaternion(rotation).dot(t));
    }
    y.normalize(); const x=y.clone().cross(t).normalize(); y=t.clone().cross(x).normalize();
    frames.push({p,t,x,y});
  }
  const {ring,caps}=section, width=ring.length, rings=frames.length;
  // Compute each Float32 corner once; caps, neighbouring walls and outlines share
  // exactly those coordinates, even when the section is far from its local origin.
  const grid=new Float32Array(rings*width*3);
  for(let i=0;i<rings;i++) for(let j=0;j<width;j++) {
    const f=frames[i]!,q=ring[j]!,p=f.p.clone().add(origin).addScaledVector(f.x,q[0]).addScaledVector(f.y,q[1]);
    grid.set(p.toArray(),(i*width+j)*3);
  }
  const at=(i:number,j:number):Vector3=>new Vector3().fromArray(grid,(i*width+j)*3);
  const positions:number[]=[], normals:number[]=[], indices:number[]=[], edges:number[]=[];
  for(let edge=0;edge<width;edge++) {
    const next=(edge+1)%width,base=positions.length/3;
    for(let i=0;i<rings;i++) {
      const across=at(i,next).sub(at(i,edge));
      for(const j of [edge,next]) {
        const longitudinal=at(Math.min(rings-1,i+1),j).sub(at(Math.max(0,i-1),j));
        const n=across.clone().cross(longitudinal);
        if (!(n.length()>across.length()*longitudinal.length()*1e-8)) return undefined;
        n.normalize();
        const expected=across.clone().cross(frames[i]!.t).normalize();
        if (!(n.dot(expected)>1e-6)) return undefined;
        positions.push(...at(i,j).toArray()); normals.push(...n.toArray());
      }
    }
    for(let i=0;i<rings-1;i++) {
      const a=base+i*2,b=a+1,c=a+2,d=a+3;
      indices.push(a,b,c,b,d,c);
      edges.push(...at(i,edge).toArray(),...at(i+1,edge).toArray());
    }
    edges.push(...at(0,edge).toArray(),...at(0,next).toArray(),...at(rings-1,edge).toArray(),...at(rings-1,next).toArray());
  }
  for(const end of [0,rings-1]) {
    const base=positions.length/3,n=frames[end]!.t.clone().multiplyScalar(end===0?-1:1);
    for(let j=0;j<width;j++) {positions.push(...at(end,j).toArray());normals.push(...n.toArray());}
    for(const tri of caps) indices.push(base+tri[0]!,base+tri[end===0?2:1]!,base+tri[end===0?1:2]!);
  }
  const pos=new Float32Array(positions),nor=new Float32Array(normals),ix=new Uint16Array(indices);
  const a=new Vector3(),b=new Vector3(),c=new Vector3(),n=new Vector3();
  for(let i=0;i<ix.length;i+=3) {
    const ids=[ix[i]!,ix[i+1]!,ix[i+2]!];
    a.fromArray(pos,ids[0]!*3);b.fromArray(pos,ids[1]!*3);c.fromArray(pos,ids[2]!*3);
    const face=b.sub(a).cross(c.sub(a)),length=face.length();
    if (!(length>0)) return undefined;
    for(const id of ids) if (!(face.dot(n.fromArray(nor,id*3))>length*1e-6)) return undefined;
  }
  return {positions:pos,normals:nor,indices:ix,edges:new Float32Array(edges)};
}
