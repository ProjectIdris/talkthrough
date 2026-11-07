// A surface of revolution already knows which profile edges meet. Use that topology, not
// rounded position keys, so small shoulders and inner walls never borrow each other's light.
import type { BufferGeometry, Vector2 } from 'three';

type ProfileNormal = readonly [radial: number, vertical: number];

/** Shade a non-indexed Three.js lathe in its existing triangle order, without changing its geometry. */
export function shadeLatheProfile(geometry: BufferGeometry, points: readonly Vector2[], segments: number): void {
  const normal = geometry.getAttribute('normal');
  const count = points.length - 1;
  const faceted = segments <= 8;
  // A flat sector's radial plane lies at the middle angle. Its taper is shallower by cos(half a sector).
  const radialScale = faceted ? Math.cos(Math.PI / segments) : 1;
  const crease = Math.cos(faceted ? 0.4 : 0.9);
  const closed = points[0]!.equals(points[count]!);
  const edges: Array<ProfileNormal | undefined> = [];
  const axisSpans: boolean[] = [];
  for (let j = 0; j < count; j++) {
    const a = points[j]!, b = points[j + 1]!;
    const r = b.y - a.y, y = (a.x - b.x) * radialScale;
    const length = Math.hypot(r, y);
    const axisSpan = a.x === 0 && b.x === 0 && a.y !== b.y;
    axisSpans.push(axisSpan);
    edges.push(length > 0 && !axisSpan ? [r / length, y / length] : undefined);
  }
  // Skip duplicate profile points, but never join distinct nearby rings. The language bounds profile length.
  const adjacent = (start: number, direction: 1 | -1): ProfileNormal | undefined => {
    for (let step = 0; step < count; step++) {
      let j = start + step * direction;
      if (closed) j = (j % count + count) % count;
      else if (j < 0 || j >= count) return undefined;
      if (axisSpans[j]) return undefined; // a line along the axis joins no drawable surface
      if (edges[j]) return edges[j];
    }
    return undefined;
  };
  const blend = (own: ProfileNormal, other: ProfileNormal | undefined): ProfileNormal => {
    if (!other || own[0] * other[0] + own[1] * other[1] <= crease) return own;
    const r = own[0] + other[0], y = own[1] + other[1], length = Math.hypot(r, y);
    return [r / length, y / length];
  };
  const atPole = (n: ProfileNormal, point: Vector2): ProfileNormal => {
    // A rounded tip joins every angular sector. A sharp cone or an authored facet keeps its own normal.
    if (!faceted && point.x === 0 && n[1] * n[1] - n[0] * n[0] > crease) return [0, Math.sign(n[1])];
    return n;
  };
  const ends = edges.map((edge, j): [ProfileNormal, ProfileNormal] => {
    const own = edge ?? adjacent(j, 1) ?? adjacent(j, -1) ?? [1, 0];
    return [atPole(blend(own, adjacent(j - 1, -1)), points[j]!), atPole(blend(own, adjacent(j + 1, 1)), points[j + 1]!)];
  });
  for (let sector = 0; sector < segments; sector++) {
    const left = faceted ? (sector + 0.5) / segments : sector / segments;
    const right = faceted ? left : (sector + 1) / segments;
    // Set the wrap angle to exactly zero so duplicated seam vertices have identical normals.
    const angle = (u: number) => u === 1 ? 0 : u * Math.PI * 2;
    const s0 = Math.sin(angle(left)), c0 = Math.cos(angle(left));
    const s1 = Math.sin(angle(right)), c1 = Math.cos(angle(right));
    for (let j = 0; j < count; j++) {
      const [start, end] = ends[j]!;
      const base = (sector * count + j) * 6;
      // Three.js's two triangles: lower-left, lower-right, upper-left; upper-right, upper-left, lower-right.
      normal.setXYZ(base, start[0] * s0, start[1], start[0] * c0);
      normal.setXYZ(base + 1, start[0] * s1, start[1], start[0] * c1);
      normal.setXYZ(base + 2, end[0] * s0, end[1], end[0] * c0);
      normal.setXYZ(base + 3, end[0] * s1, end[1], end[0] * c1);
      normal.setXYZ(base + 4, end[0] * s0, end[1], end[0] * c0);
      normal.setXYZ(base + 5, start[0] * s1, start[1], start[0] * c1);
    }
  }
}
