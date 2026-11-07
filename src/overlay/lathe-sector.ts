// Closed partial revolutions. The legacy full lathe has a separate construction path.
import { BufferAttribute, BufferGeometry, ShapeUtils, Vector2, Vector3 } from 'three';
import { normalizeSectorProfile } from '../scene/sector-profile.ts';
import { prepareSectorRings } from '../scene/sector-sweep.ts';
import type { Vec2 } from '../scene/types.ts';

const CREASE_COS = Math.cos(0.9);
const DEG = Math.PI / 180;

/** Empty, finite geometry also makes a rejected direct renderer call safe to frame and dispose. */
function empty(): BufferGeometry {
  return new BufferGeometry()
    .setAttribute('position', new BufferAttribute(new Float32Array(), 3))
    .setAttribute('normal', new BufferAttribute(new Float32Array(), 3));
}

/**
 * Revolve an implicitly closed radius/y polygon from +z towards +x about +y.
 * `sides` is the full-revolution resolution; angular spans never exceed 90 degrees.
 * Both radial ends are flat caps, separate from the smooth walls' normal topology.
 */
export function latheSectorGeometry(profile: readonly Vec2[], sides: number, sweep: number): BufferGeometry {
  if (!Number.isFinite(sweep) || sweep < 1 || sweep > 359 || !Number.isFinite(sides) || sides < 3 || sides > 64) return empty();
  const checked = normalizeSectorProfile(profile);
  if (!checked.ok) return empty();
  const points = checked.profile;
  const count = points.length;
  const prepared = prepareSectorRings(points, sides, sweep);
  if (!prepared) return empty();
  const segments = prepared.length - 1;
  const angle = sweep * DEG;
  const smooth = sides > 8;
  // Validation and rendering share the exact Float32 positions, including every cap seam.
  const rings = prepared.map(ring => ring.map(point => new Vector3(...point)));
  const edgeNormals = points.map((a, i) => {
    const b = points[(i + 1) % count]!;
    return new Vector2(b[1] - a[1], a[0] - b[0]).normalize();
  });
  const axisEdge = (i: number): boolean => points[i]![0] === 0 && points[(i + 1) % count]![0] === 0;
  const cornerNormal = (edge: number, end: boolean): Vector2 => {
    const other = (edge + (end ? 1 : count - 1)) % count;
    const n = edgeNormals[edge]!;
    if (axisEdge(other) || n.dot(edgeNormals[other]!) <= CREASE_COS) return n;
    return n.clone().add(edgeNormals[other]!).normalize();
  };
  const position: number[] = [], normal: number[] = [];
  const face = new Vector3(), ab = new Vector3(), ac = new Vector3();
  let invalid = false;
  const triangle = (a: Vector3, b: Vector3, c: Vector3, normals?: readonly Vector3[]): void => {
    face.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
    // Never silently leave an unclosed hole if a direct input collapses at Float32 precision.
    if (!(face.lengthSq() > 0) || !Number.isFinite(face.lengthSq())) { invalid = true; return; }
    face.normalize();
    for (const [i, p] of [a, b, c].entries()) {
      const n = normals?.[i] ?? face;
      if (!Number.isFinite(n.lengthSq()) || n.lengthSq() < 0.99 || n.dot(face) <= 0) invalid = true;
      position.push(p.x, p.y, p.z);
      normal.push(n.x, n.y, n.z);
    }
  };
  const radialNormal = (n: Vector2, theta: number): Vector3 => new Vector3(n.x * Math.sin(theta), n.y, n.x * Math.cos(theta));
  for (let i = 0; i < count; i++) {
    if (axisEdge(i)) continue;
    const next = (i + 1) % count;
    const nA = cornerNormal(i, false), nB = cornerNormal(i, true);
    for (let j = 0; j < segments; j++) {
      const a = rings[j]![i]!, b = rings[j]![next]!, c = rings[j + 1]![i]!, d = rings[j + 1]![next]!;
      const from = angle * j / segments, to = angle * (j + 1) / segments, mid = (from + to) / 2;
      const a0 = radialNormal(nA, points[i]![0] === 0 ? mid : from), a1 = radialNormal(nA, points[i]![0] === 0 ? mid : to);
      const b0 = radialNormal(nB, points[next]![0] === 0 ? mid : from), b1 = radialNormal(nB, points[next]![0] === 0 ? mid : to);
      if (points[i]![0] !== 0) triangle(a, c, b, smooth ? [a0, a1, b0] : undefined);
      if (points[next]![0] !== 0) triangle(c, d, b, smooth ? [a1, b1, b0] : undefined);
    }
  }
  const caps = ShapeUtils.triangulateShape(points.map(([r, y]) => new Vector2(r, y)), []);
  if (caps.length !== count - 2) return empty();
  const first = rings[0]!, last = rings[segments]!;
  for (const t of caps) {
    const [a, b, c] = t as [number, number, number];
    triangle(first[a]!, first[b]!, first[c]!);
    triangle(last[c]!, last[b]!, last[a]!);
  }
  if (invalid) return empty();
  return new BufferGeometry()
    .setAttribute('position', new BufferAttribute(new Float32Array(position), 3))
    .setAttribute('normal', new BufferAttribute(new Float32Array(normal), 3));
}

/** Crease lines use the exact generated seams, not fixed world-unit coordinate buckets. */
export function latheSectorEdges(geometry: BufferGeometry): BufferGeometry {
  const position = geometry.getAttribute('position');
  const edges = new Map<string, { a: Vector3; b: Vector3; normal: Vector3; crease: boolean }>();
  const threshold = Math.cos(28 * DEG);
  const key = (p: Vector3): string => `${p.x || 0},${p.y || 0},${p.z || 0}`;
  const face = new Vector3(), ab = new Vector3(), ac = new Vector3();
  for (let i = 0; i < position.count; i += 3) {
    const points = [0, 1, 2].map(offset => new Vector3().fromBufferAttribute(position, i + offset));
    face.crossVectors(ab.subVectors(points[1]!, points[0]!), ac.subVectors(points[2]!, points[0]!)).normalize();
    for (let j = 0; j < 3; j++) {
      const a = points[j]!, b = points[(j + 1) % 3]!;
      const ka = key(a), kb = key(b), id = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
      const edge = edges.get(id);
      if (edge) edge.crease = edge.normal.dot(face) <= threshold;
      else edges.set(id, { a, b, normal: face.clone(), crease: false });
    }
  }
  const lines: number[] = [];
  for (const edge of edges.values()) if (edge.crease) lines.push(...edge.a.toArray(), ...edge.b.toArray());
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(lines), 3));
}
