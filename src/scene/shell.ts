// Bounded hollow ellipsoid sections. Pure data preparation shared by admission and rendering.
import type { Vec2, Vec3 } from './types.ts';

export const SHELL_DETAIL = { low: [16, 8], mid: [24, 12], high: [40, 20] } as const;
export type ShellTier = keyof typeof SHELL_DETAIL;
export type ShellMesh = { positions: Float32Array; normals: Float32Array; indices: number[]; edges: Float32Array };
const RAD = Math.PI / 180;
const own = (o: object, key: string): unknown => {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && 'value' in d ? d.value : undefined;
};
const scalar = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
function vector(value: unknown, length: number, lo: number, hi: number): number[] | undefined {
  if (!Array.isArray(value) || value.length !== length) return;
  const result: number[] = [];
  for (let i = 0; i < length; i++) {
    const n = own(value, String(i));
    if (!scalar(n, lo, hi)) return;
    result.push(n);
  }
  return result;
}
const unit = ([x, y, z]: Vec3): Vec3 => {
  const length = Math.hypot(x, y, z);
  return [Math.fround(x / length), Math.fround(y / length), Math.fround(z / length)];
};
const key = (p: Vec3): string => p.join(',');
type Vertex = { point: Vec3; normal: Vec3 };

/** No trimming, clamping, recentering or missing-face repair: unsafe shapes reject. */
export function prepareShell(size: unknown, inner: unknown, latitude: unknown, sweep: unknown, tier: ShellTier): ShellMesh | undefined {
  if (!Object.hasOwn(SHELL_DETAIL, tier)) return;
  const dimensions = vector(size, 3, .01, 100);
  const band = latitude == null ? [-90, 90] : vector(latitude, 2, -90, 90);
  const ratio = inner ?? .85, degrees = sweep ?? 360;
  if (!dimensions || !band || !scalar(ratio, .01, .99) || !scalar(degrees, 1, 360) || band[1]! - band[0]! < 1) return;
  const [a, b, c] = dimensions.map(n => n / 2) as Vec3;
  const [south, north] = band as Vec2;
  const [around, vertical] = SHELL_DETAIL[tier];
  const columns = Math.max(2, Math.ceil(around * degrees / 360));
  const rows = Math.max(2, Math.ceil(vertical * (north - south) / 180));
  const periodic = degrees === 360;
  // Reuse exact seam/pole coordinates across every face, including sharp rims.
  const angles: Vec2[] = Array.from({ length: columns + 1 }, (_, j) => {
    const phi = (j === columns && periodic ? 0 : degrees * j / columns) * RAD;
    return [Math.cos(phi), Math.sin(phi)];
  });
  const latitudes: Vec2[] = Array.from({ length: rows + 1 }, (_, i) => {
    const lat = i === rows ? north : south + (north - south) * i / rows;
    return Math.abs(lat) === 90 ? [0, lat / 90] : [Math.cos(lat * RAD), Math.sin(lat * RAD)];
  });
  const directions: Vec3[][] = latitudes.map(([cl, sl]) => angles.map(([cp, sp]) => [cl * cp, sl, cl * sp]));
  const points = [1, ratio].map(scale => directions.map(row => row.map(([x, y, z]): Vec3 => [a * x * scale, b * y * scale, c * z * scale])));
  const positions: number[] = [], normals: number[] = [], indices: number[] = [];
  // Keep vertices separate across different surfaces, but weld each smooth patch's poles and periodic seam.
  const patch = (grid: Vertex[][], reverse = false, wrap = false, poles: readonly number[] = []): void => {
    const vertices: number[][] = [];
    for (let i = 0; i < grid.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < grid[i]!.length; j++) {
        if ((poles.includes(i) && j > 0) || (wrap && j === grid[i]!.length - 1)) { row.push(row[0]!); continue; }
        const {point, normal} = grid[i]![j]!;
        row.push(positions.length / 3); positions.push(...point); normals.push(...normal);
      }
      vertices.push(row);
    }
    const triangle = (x: number, y: number, z: number): void => {
      // Only the analytically collapsed pole cell has repeated corners.
      if (x === y || y === z || z === x) return;
      indices.push(x, reverse ? z : y, reverse ? y : z);
    };
    for (let i = 0; i < grid.length - 1; i++) for (let j = 0; j < grid[0]!.length - 1; j++) {
      const x = vertices[i]![j]!, y = vertices[i]![j + 1]!, z = vertices[i + 1]![j + 1]!, w = vertices[i + 1]![j]!;
      triangle(x, w, y); triangle(y, w, z);
    }
  };
  for (let layer = 0; layer < 2; layer++) {
    const sign = layer === 0 ? 1 : -1;
    patch(directions.map((row, i) => row.map(([x, y, z], j) => ({ point: points[layer]![i]![j]!, normal: unit([sign * x / a, sign * y / b, sign * z / c]) }))), layer === 1, periodic, latitudes.flatMap(([cl], i) => cl === 0 ? [i] : []));
  }
  // A latitude rim follows radial thickness: it is generally conical, flat only at the equator.
  for (const [i, sign] of [[0, -1], [rows, 1]] as const) {
    const [cl, sl] = latitudes[i]!;
    if (cl === 0) continue;
    patch([1, 0].map(layer => angles.map(([cp, sp], j) => ({ point: points[layer]![i]![j]!, normal: unit([-sign * sl * cp / a, sign * cl / b, -sign * sl * sp / c]) }))), sign === 1, periodic);
  }
  // The start/end angular walls are flat and join the inner and outer curves.
  if (!periodic) for (const [j, sign] of [[0, -1], [columns, 1]] as const) {
    const [cp, sp] = angles[j]!, normal = unit([-sign * sp / a, 0, sign * cp / c]);
    patch(latitudes.map((_, i) => [1, 0].map(layer => ({ point: points[layer]![i]![j]!, normal }))), sign === 1);
  }
  const p = new Float32Array(positions), n = new Float32Array(normals);
  // Compare emitted triangles to their prequantized geometry. A smooth analytic
  // vertex normal can be obtuse to a coarse face after unequal-axis scaling; it
  // is not a winding test. Both triangle normals below refer to the same face.
  for (let i = 0; i < indices.length; i += 3) {
    const [x, y, z] = [indices[i]!, indices[i + 1]!, indices[i + 2]!].map(id => id * 3) as Vec3;
    const ux = p[y]! - p[x]!, uy = p[y + 1]! - p[x + 1]!, uz = p[y + 2]! - p[x + 2]!;
    const vx = p[z]! - p[x]!, vy = p[z + 1]! - p[x + 1]!, vz = p[z + 2]! - p[x + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ax = positions[y]! - positions[x]!, ay = positions[y + 1]! - positions[x + 1]!, az = positions[y + 2]! - positions[x + 2]!;
    const bx = positions[z]! - positions[x]!, by = positions[z + 1]! - positions[x + 1]!, bz = positions[z + 2]! - positions[x + 2]!;
    if (!(nx * (ay * bz - az * by) + ny * (az * bx - ax * bz) + nz * (ax * by - ay * bx) > 0)) return;
  }
  const edges: number[] = [], seen = new Set<string>();
  const edge = (from: Vec3, to: Vec3): void => {
    const first = from.map(Math.fround) as Vec3, last = to.map(Math.fround) as Vec3;
    const x = key(first), y = key(last);
    if (x === y) return;
    const k = x < y ? `${x}|${y}` : `${y}|${x}`;
    if (!seen.has(k)) { seen.add(k); edges.push(...first, ...last); }
  };
  for (const i of [0, rows]) if (latitudes[i]![0] !== 0) for (let layer = 0; layer < 2; layer++) {
    for (let j = 0; j < columns; j++) edge(points[layer]![i]![j]!, points[layer]![i]![j + 1]!);
  }
  if (!periodic) for (const j of [0, columns]) {
    for (let layer = 0; layer < 2; layer++) for (let i = 0; i < rows; i++) edge(points[layer]![i]![j]!, points[layer]![i + 1]![j]!);
    for (const i of [0, rows]) edge(points[0]![i]![j]!, points[1]![i]![j]!);
  }
  return { positions: p, normals: n, indices, edges: new Float32Array(edges) };
}
