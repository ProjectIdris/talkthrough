// Centripetal control spacing keeps a short tube span from borrowing the speed
// of a much longer neighbour. Motion curves and straight paths have other semantics.
import type { Vec3 } from '../scene/types.ts';

const delta = (a: Vec3, b: Vec3): Vec3 => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
const knot = (d: Vec3): number => Math.sqrt(Math.hypot(...d));

/** Open tube samples. Equal consecutive controls do not add a zero-length span. */
export function sampleOpenCurve(pts: readonly Vec3[], perSegment: number): Vec3[] {
  const controls = pts.filter((p, i) => i === 0 || p.some((v, axis) => v !== pts[i - 1]![axis]));
  if (controls.length < 2) return controls.length ? [[...controls[0]!], [...controls[0]!]] : [];
  const out: Vec3[] = [];
  for (let i = 0; i < controls.length - 1; i++) {
    const p = controls[i]!, q = controls[i + 1]!;
    const span = delta(p, q);
    // Extrapolate the missing endpoint neighbour rather than repeating an endpoint.
    const before = i > 0 ? delta(controls[i - 1]!, p) : span;
    const after = i + 2 < controls.length ? delta(q, controls[i + 2]!) : span;
    const a = knot(before), b = knot(span), c = knot(after);
    const m0: Vec3 = [0, 0, 0], m1: Vec3 = [0, 0, 0];
    for (let axis = 0; axis < 3; axis++) {
      // Evaluate the nonuniform tangent using differences, not world positions.
      // Dividing a vector before multiplying knot ratios also avoids squaring tiny lengths.
      m0[axis] = (before[axis]! / a * b) * (b / (a + b)) + span[axis]! * (a / (a + b));
      m1[axis] = span[axis]! * (c / (b + c)) + (after[axis]! / c * b) * (b / (b + c));
    }
    for (let k = 0; k < perSegment; k++) {
      if (k === 0) { out.push([...p]); continue; }
      const t = k / perSegment, t2 = t * t, t3 = t2 * t;
      const end = 3 * t2 - 2 * t3, startTangent = t3 - 2 * t2 + t, endTangent = t3 - t2;
      out.push([0, 1, 2].map(axis => p[axis]! + (span[axis]! * end + m0[axis]! * startTangent + m1[axis]! * endTangent)) as Vec3);
    }
  }
  out.push([...controls[controls.length - 1]!]);
  return out;
}
