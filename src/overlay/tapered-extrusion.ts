import { BufferAttribute, BufferGeometry, Vector3 } from 'three';
import { prepareTaperedExtrusion } from '../scene/tapered-extrusion.ts';
import type { Vec2 } from '../scene/types.ts';

/** Closed sharp-sided prismatoid. Invalid direct calls return empty finite geometry. */
export function taperedExtrudeGeometry(outline: readonly Vec2[], depth: number, taper = 1, shift: Vec2 = [0, 0]): BufferGeometry {
  const geometry = new BufferGeometry();
  const prepared = prepareTaperedExtrusion(outline, depth, taper, shift);
  const positions: number[] = [], normals: number[] = [], uvs: number[] = [];
  if (prepared.ok) {
    const { start, end, halfDepth, caps } = prepared.value;
    const point = (index: number, top: boolean): Vector3 => {
      const p = (top ? end : start)[index]!;
      return new Vector3(p[0], p[1], top ? halfDepth : -halfDepth);
    };
    const normal = new Vector3(), edge = new Vector3();
    const triangle = (a: Vector3, b: Vector3, c: Vector3): void => {
      normal.crossVectors(edge.subVectors(b, a), new Vector3().subVectors(c, a)).normalize();
      for (const p of [a, b, c]) { positions.push(p.x, p.y, p.z); normals.push(normal.x, normal.y, normal.z); uvs.push(p.x, p.y); }
    };
    for (const [a, b, c] of caps) {
      triangle(point(c, false), point(b, false), point(a, false));
      triangle(point(a, true), point(b, true), point(c, true));
    }
    for (let i = 0; i < start.length; i++) {
      const j = (i + 1) % start.length;
      const a = point(i, false), b = point(j, false), c = point(j, true), d = point(i, true);
      triangle(a, b, c); triangle(a, c, d);
    }
  }
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(normals), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  return geometry;
}

/** Exact Float32 endpoint keys preserve outlines on compact parts without a fixed spatial bin. */
export function taperedExtrudeEdges(geometry: BufferGeometry): BufferGeometry {
  const p = geometry.getAttribute('position');
  const edges = new Map<string, { a: Vector3; b: Vector3; normal: Vector3; count: number; sharp: boolean }>();
  const key = (p: Vector3) => `${p.x || 0},${p.y || 0},${p.z || 0}`;
  const threshold = Math.cos(28 * Math.PI / 180);
  for (let i = 0; i < p.count; i += 3) {
    const points = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(p, i + j));
    const normal = new Vector3().crossVectors(new Vector3().subVectors(points[1]!, points[0]!), new Vector3().subVectors(points[2]!, points[0]!)).normalize();
    for (let j = 0; j < 3; j++) {
      const a = points[j]!, b = points[(j + 1) % 3]!, ka = key(a), kb = key(b);
      const id = ka < kb ? `${ka}/${kb}` : `${kb}/${ka}`;
      const edge = edges.get(id);
      if (edge) { edge.count++; edge.sharp ||= edge.normal.dot(normal) <= threshold; }
      else edges.set(id, { a, b, normal, count: 1, sharp: false });
    }
  }
  const positions: number[] = [];
  for (const edge of edges.values()) if (edge.count === 1 || edge.sharp) positions.push(...edge.a.toArray(), ...edge.b.toArray());
  return new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
}
