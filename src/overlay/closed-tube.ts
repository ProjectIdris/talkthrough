// Periodic tubes share the ordinary tube's draw metadata, but have no free ends.
// Keep them separate so open tubes retain their endpoint frames and caps.

import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from 'three';
import type { Vec2, Vec3 } from '../scene/types.ts';
import { swellAt } from './geometry.ts';

/** A continuous loop through at least three distinct controls. A repeated closing point is optional. */
export function closedTubeGeometry(pts: readonly Vec3[], radius: number, flat: number, radial: number, perSegment: number, swell?: readonly Vec2[]): { geo: BufferGeometry; sampled: Vec3[] } {
  const controls = pts.map((p) => new Vector3(...p)).filter((p, i, all) => i === 0 || !p.equals(all[i - 1]!));
  if (controls.length > 1 && controls[0]!.equals(controls[controls.length - 1]!)) controls.pop();
  // Estimate tangents near zero, so a very small loop far from the origin does
  // not lose its direction when two almost equal world positions are subtracted.
  const origin = controls[0]!.clone();
  for (const p of controls) p.sub(origin);
  const curve = new CatmullRomCurve3(controls, true, 'centripetal');
  const segments = controls.length * perSegment;
  // Arc-length sampling and transported frames keep both thickness and twist even.
  // Three.js distributes the remaining rotation around a closed curve, not at its seam.
  curve.arcLengthDivisions = Math.max(200, segments * 2);
  const centres = curve.getSpacedPoints(segments);
  const frames = curve.computeFrenetFrames(segments, true);
  const sampled: Vec3[] = centres.map((p) => [p.x + origin.x, p.y + origin.y, p.z + origin.z]);
  sampled[segments] = [...sampled[0]!];
  // A loop has one radius at the join: the start factor also supplies the endpoint.
  const profile: Vec2[] | undefined = swell?.length ? [[0, swellAt(swell, 0)], ...swell.filter((p) => p[0] > 0 && p[0] < 1), [1, swellAt(swell, 0)]] : undefined;
  const row = radial + 1;
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  const wide = new Vector3(), thin = new Vector3();
  const circum = new Vector3(), along = new Vector3(), normal = new Vector3(), outward = new Vector3();
  for (let i = 0; i <= segments; i++) {
    const k = i % segments;
    const centre = centres[k]!;
    wide.copy(frames.normals[k]!);
    thin.copy(frames.binormals[k]!).negate();
    const r = radius * (profile ? swellAt(profile, k / segments) : 1);
    for (let j = 0; j <= radial; j++) {
      const angle = (j % radial) / radial * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      positions.push(centre.x + r * (wide.x * c + thin.x * s * flat), centre.y + r * (wide.y * c + thin.y * s * flat), centre.z + r * (wide.z * c + thin.z * s * flat));
    }
  }
  // Derivatives of the actual surface account for taper and twist. Central
  // differences wrap at the join; an ellipse normal is the finite fallback at a fold.
  for (let i = 0; i < segments; i++) {
    wide.copy(frames.normals[i]!);
    thin.copy(frames.binormals[i]!).negate();
    for (let j = 0; j <= radial; j++) {
      const angle = (j % radial) / radial * Math.PI * 2;
      const c = Math.cos(angle), s = Math.sin(angle);
      const prev = ((i + segments - 1) % segments * row + j) * 3;
      const next = ((i + 1) % segments * row + j) * 3;
      along.set(positions[next]! - positions[prev]!, positions[next + 1]! - positions[prev + 1]!, positions[next + 2]! - positions[prev + 2]!);
      circum.copy(wide).multiplyScalar(-s).addScaledVector(thin, c * flat);
      outward.copy(wide).multiplyScalar(c * flat).addScaledVector(thin, s).normalize();
      normal.crossVectors(along, circum);
      if (normal.lengthSq() > 1e-20 && normal.dot(outward) > 0) normal.normalize();
      else normal.copy(outward);
      normals.push(normal.x, normal.y, normal.z);
    }
  }
  normals.push(...normals.slice(0, row * 3));
  for (let i = 0; i < positions.length; i += 3) {
    positions[i]! += origin.x; positions[i + 1]! += origin.y; positions[i + 2]! += origin.z;
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * row + j, b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geo.setIndex(indices);
  geo.userData = { rings: segments + 1, indicesPerRing: radial * 6, startCap: 0, endCap: 0 };
  return { geo, sampled };
}
