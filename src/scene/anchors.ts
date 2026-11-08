// Attachment points of a 3D object: the names a part can be attached at. Every shape has the built-in ones, worked out from its own extents (so none
// need declaring), a ready-made part adds its own (pin, crown, rim), and the model may name more with the `anchor` action. All are in the object's own
// space, so they turn and scale with it. Pure geometry, no renderer: the validator and the renderer both read it, and must agree.

import { resolvePartGeometry } from './part-geometry.ts';
import { findModel, modelBounds } from './models.ts';
import type { AddPart, Vec3 } from './types.ts';

type Box = { min: Vec3; max: Vec3 };
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const vec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every(num);
const vec2 = (v: unknown): v is [number, number] => Array.isArray(v) && v.length >= 2 && num(v[0]) && num(v[1]);

const around = (size: Vec3): Box => ({ min: [-Math.abs(size[0]) / 2, -Math.abs(size[1]) / 2, -Math.abs(size[2]) / 2], max: [Math.abs(size[0]) / 2, Math.abs(size[1]) / 2, Math.abs(size[2]) / 2] });

function grow(box: Box | undefined, p: Vec3, pad: Vec3 = [0, 0, 0]): Box {
  const b: Box = box ?? { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
  for (let i = 0; i < 3; i++) {
    b.min[i] = Math.min(b.min[i]!, p[i]! - pad[i]!);
    b.max[i] = Math.max(b.max[i]!, p[i]! + pad[i]!);
  }
  return b;
}

/** The box a shape fills in its own space, when what was written says it; undefined for a group, a text or a shape with nothing yet. */
export function boundsOf(def: object): Box | undefined {
  const d = def as Record<string, unknown>;
  switch (d.shape) {
    case 'box': case 'sphere': case 'cylinder': case 'cone': case 'plane': case 'shell':
      return vec3(d.size) ? around(d.size) : undefined;
    case 'model': {
      const model = findModel(d.model);
      return model ? around(modelBounds(model, typeof d.size === 'number' ? d.size : undefined)) : undefined;
    }
    case 'torus': return vec3(d.size) ? around([d.size[0], d.size[1], d.size[0]]) : undefined;
    case 'part': return vec3(d.size) && typeof d.part === 'string' ? around(resolvePartGeometry(d as unknown as AddPart).size) : undefined;
    case 'blob': {
      const sizes = d.sizes;
      if (!Array.isArray(d.pts) || !Array.isArray(sizes) || sizes.length === 0) return undefined;
      let box: Box | undefined;
      d.pts.forEach((p, i) => {
        const s: unknown = sizes[Math.min(i, sizes.length - 1)];
        if (vec3(p) && vec3(s)) box = grow(box, p, [Math.abs(s[0]) / 2, Math.abs(s[1]) / 2, Math.abs(s[2]) / 2]);
      });
      return box;
    }
    case 'hull': case 'patch': case 'sweep': {
      if (!Array.isArray(d.pts)) return undefined;
      // A sweep's outline is the section carried along the path: it widens the box by the section's reach.
      let reach = 0;
      if (d.shape === 'sweep' && Array.isArray(d.outline)) for (const q of d.outline) if (vec2(q)) reach = Math.max(reach, Math.abs(q[0]), Math.abs(q[1]));
      let box: Box | undefined;
      for (const p of d.pts) if (vec3(p)) box = grow(box, p, [reach, reach, reach]);
      return box;
    }
    case 'extrude': case 'loft': {
      if (!Array.isArray(d.outline) || !num(d.depth)) return undefined;
      let box: Box | undefined;
      const rings = d.shape === 'loft' && Array.isArray(d.endOutline) ? [d.outline, d.endOutline] : [d.outline];
      const shift = d.shape === 'extrude' && vec2(d.shift) ? d.shift : [0, 0];
      for (const ring of rings) for (const q of ring as unknown[]) if (vec2(q)) box = grow(box, [q[0] + shift[0]!, q[1] + shift[1]!, 0]);
      if (!box) return undefined;
      box.min[2] = -Math.abs(d.depth) / 2;
      box.max[2] = Math.abs(d.depth) / 2;
      return box;
    }
    case 'lathe': {
      if (!Array.isArray(d.profile)) return undefined;
      let box: Box | undefined;
      for (const q of d.profile) if (vec2(q)) box = grow(box, [Math.abs(q[0]), q[1], Math.abs(q[0])]);
      if (box) box.min[0] = box.min[2] = -box.max[0];
      return box;
    }
    default: return undefined;
  }
}

/** The names a model may use for a point of a 3D object, with where each is in the object's own space. */
export function anchorsOf(def: object): Record<string, Vec3> {
  const d = def as Record<string, unknown>;
  const out: Record<string, Vec3> = { origin: [0, 0, 0] };
  const box = boundsOf(d);
  if (box) {
    const mid = (i: number): number => (box.min[i]! + box.max[i]!) / 2;
    out.center = [mid(0), mid(1), mid(2)];
    out.top = [mid(0), box.max[1]!, mid(2)];
    out.bottom = [mid(0), box.min[1]!, mid(2)];
    out.right = [box.max[0]!, mid(1), mid(2)];
    out.left = [box.min[0]!, mid(1), mid(2)];
    out.front = [mid(0), mid(1), box.max[2]!];
    out.back = [mid(0), mid(1), box.min[2]!];
    out.rim = [box.max[0]!, mid(1), mid(2)];
  }
  // A tube, line or arrow has its ends: in the space it hangs from, since its points are written there.
  if ((d.shape === 'tube' || d.shape === 'line' || d.shape === 'arrow') && Array.isArray(d.pts) && d.closed !== true) {
    const first = d.pts[0], last = d.pts[d.pts.length - 1];
    if (vec3(first)) out.start = [first[0], first[1], first[2]];
    if (vec3(last)) out.end = [last[0], last[1], last[2]];
  }
  // A kit part's own names win over the plain ones (its crown is its top, its pin is where a rod joins).
  if (d.shape === 'part' && typeof d.part === 'string' && vec3(d.size)) Object.assign(out, resolvePartGeometry(d as unknown as AddPart).anchors);
  // What the model named on this object wins over everything.
  const named = d.points;
  if (named && typeof named === 'object') for (const [name, p] of Object.entries(named)) if (vec3(p)) out[name] = [p[0], p[1], p[2]];
  return out;
}

/** The built-in names, for the guide: which way each faces in the object's own space (they turn with the object). */
export const BUILT_IN_ANCHORS = 'origin (its own zero), center, top (+y), bottom (-y), right (+x), left (-x), front (+z, toward the viewer), back (-z), rim (as right); start and end of a tube, line or arrow (first and last point)';
