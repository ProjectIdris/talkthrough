// Bounded bicubic Bézier sheets. Shared by scene admission and geometry construction;
// no DOM, Three.js, expression evaluation or external data is involved.
import type { Vec3 } from './types.ts';

/** Keep validator preflight and renderer resolution in one place. */
export const PATCH_SEGMENTS = { low: 8, mid: 12, high: 20 } as const;
export type PatchGrid = { positions: Float32Array; normals: Float32Array; indices: Uint16Array; segments: number };

const data = (object: object, key: string): unknown => {
  const d = Object.getOwnPropertyDescriptor(object, key);
  return d && 'value' in d ? d.value : undefined;
};

/** A net is not a polyline: trimming, clamping or skipping a control changes its meaning. */
export function readPatchControls(input: unknown): Vec3[] | undefined {
  if (!Array.isArray(input) || input.length !== 16) return undefined;
  const out: Vec3[] = [];
  for (let i = 0; i < 16; i++) {
    const p = data(input, String(i));
    if (!Array.isArray(p) || p.length !== 3) return undefined;
    const q: Vec3 = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      const n = data(p, String(axis));
      if (typeof n !== 'number' || !Number.isFinite(n) || n < -100 || n > 100) return undefined;
      q[axis] = n;
    }
    out.push(q);
  }
  return out;
}

function basis(t: number): { b: number[]; d: number[] } {
  const s = 1 - t;
  return { b: [s*s*s, 3*t*s*s, 3*t*t*s, t*t*t], d: [-3*s*s, 3*s*s-6*t*s, 6*t*s-3*t*t, 3*t*t] };
}

/**
 * Emit the exact grid the renderer uses, with analytic du × dv normals. Fail closed
 * on sampled singularities, Float32 collapse or reversed faces at this resolution.
 * This is numeric mesh safety, not a global self-intersection or regularity proof.
 */
export function preparePatch(input: unknown, segments: number): PatchGrid | undefined {
  const pts = readPatchControls(input);
  if (!pts || !Object.values(PATCH_SEGMENTS).some((n) => n === segments)) return undefined;
  const row = segments + 1, count = row * row;
  const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3);
  const indices = new Uint16Array(segments * segments * 6);
  const samples = Array.from({ length: row }, (_, i) => basis(i / segments));
  // Subtract an origin while summing to avoid cancellation in derivatives of a
  // small patch far from zero. Add it only to final positions.
  const origin = pts[0]!;
  const relative = pts.map((p) => p.map((x, axis) => x - origin[axis]!) as Vec3);
  for (let v = 0; v < row; v++) for (let u = 0; u < row; u++) {
    const ub = samples[u]!, vb = samples[v]!;
    let x=0, y=0, z=0, ux=0, uy=0, uz=0, vx=0, vy=0, vz=0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const p = relative[j*4+i]!, b = ub.b[i]! * vb.b[j]!;
      const du = ub.d[i]! * vb.b[j]!, dv = ub.b[i]! * vb.d[j]!;
      x+=p[0]*b; y+=p[1]*b; z+=p[2]*b;
      ux+=p[0]*du; uy+=p[1]*du; uz+=p[2]*du;
      vx+=p[0]*dv; vy+=p[1]*dv; vz+=p[2]*dv;
    }
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    const length=Math.hypot(nx,ny,nz), scale=Math.hypot(ux,uy,uz)*Math.hypot(vx,vy,vz);
    // Relative angular tolerance: small valid sheets are not rejected just for size.
    if (!(length > scale * 1e-8) || !Number.isFinite(length)) return undefined;
    const k=(v*row+u)*3;
    positions[k]=x+origin[0]; positions[k+1]=y+origin[1]; positions[k+2]=z+origin[2];
    normals[k]=nx/length; normals[k+1]=ny/length; normals[k+2]=nz/length;
  }
  let next=0;
  for (let v=0;v<segments;v++) for (let u=0;u<segments;u++) {
    const a=v*row+u, b=a+1, c=a+row, d=c+1;
    indices.set([a,b,c,b,d,c],next); next+=6;
  }
  // Check actual emitted coordinates, not double-precision points that might round
  // to the same vertex. Each visible triangle must agree with all three normals.
  for (let i=0;i<indices.length;i+=3) {
    const a=indices[i]!*3, b=indices[i+1]!*3, c=indices[i+2]!*3;
    const ux=positions[b]!-positions[a]!, uy=positions[b+1]!-positions[a+1]!, uz=positions[b+2]!-positions[a+2]!;
    const vx=positions[c]!-positions[a]!, vy=positions[c+1]!-positions[a+1]!, vz=positions[c+2]!-positions[a+2]!;
    const nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx, length=Math.hypot(nx,ny,nz);
    if (!(length > 0)) return undefined;
    for (const k of [a,b,c]) if (!(nx*normals[k]!+ny*normals[k+1]!+nz*normals[k+2]! > length*1e-6)) return undefined;
  }
  return { positions, normals, indices, segments };
}
