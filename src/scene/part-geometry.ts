// Renderer-independent construction dimensions and local attachment points for validated kit parts.
// The normalized size is the authored construction envelope, not the exact rendered bounds: bolts,
// lips and other details can project beyond it. Anchors are points only, not mating normals or frames.

import { KIT_PRESETS, rowAnchors, rowScope } from './kit-presets.ts';
import type { AddPart, Vec3 } from './types.ts';

export type PartGeometryInput = Pick<AddPart, 'part' | 'size' | 'n'>;
export type PartGeometry = { size: Vec3; anchors: Record<string, Vec3> };

const LONG = 1.35;

/** A long thin part (rod, valve, spark plug, spring, pipe): its length goes along y, whichever side it was written on. */
export function lengthAlongY(size: Vec3): Vec3 {
  const [x, y, z] = size;
  if (y >= x && y >= z) return size;
  if (x >= z) return x >= LONG * Math.max(y, z) ? [y, x, z] : size;
  return z >= LONG * Math.max(x, y) ? [x, z, y] : size;
}

/** A part round about y (piston, valve, spark plug, spring, pipe): the same width both ways, so it fits the smaller one. */
export function roundAboutY(size: Vec3): Vec3 {
  const d = Math.min(size[0], size[2]);
  return [d, size[1], d];
}

/** A shaft that turns about z (camshaft): its length goes along z, its section is square and fits the smaller side. */
export function shaftAboutZ(size: Vec3): Vec3 {
  const [x, y, z] = size;
  const longest = Math.max(x, y, z);
  const rest = z === longest ? [x, y] : x === longest ? [y, z] : [x, z];
  if (z !== longest && longest >= LONG * Math.max(...(rest as number[]))) {
    const d = Math.min(...(rest as number[]));
    return [d, d, longest];
  }
  const d = Math.min(x, y);
  return [d, d, z];
}

/** A disc that turns about z (gear, bearing): the thinnest side is its thickness, the diameter fits the next. */
export function discAboutZ(size: Vec3): Vec3 {
  const [a, b] = [...size].sort((p, q) => p - q);
  return [b as number, b as number, a as number];
}

/** An elbow: its tube is no wider than a third of its bend, so it stays inside the box whatever depth it is given. */
export function elbowSize(size: Vec3): Vec3 {
  return [size[0], size[1], Math.min(size[2], Math.min(size[0], size[1]) * 0.6)];
}

/** The fitting rules a kit row can name (see kit-presets.ts); the row lists them in the order they apply. */
const FIT: Record<string, (size: Vec3) => Vec3> = { lengthAlongY, roundAboutY, shaftAboutZ, discAboutZ, elbowSize };

/** The normalized construction envelope: the kit row's fitting rules applied to the size written; a part with no row keeps its size. */
export function normalSize(part: string, size: Vec3): Vec3 {
  const row = KIT_PRESETS[part];
  return row?.fit ? row.fit.reduce((fitted, rule) => FIT[rule]!(fitted), size) : size;
}

/**
 * Which way a kit part faces in its own space (where its opening, glass or pins are), for the parts that have a front; the rest have none (a gear or a
 * piston is round about an axis, a wheel hangs by its centre) and are never turned for a face.
 */
export function partFacing(part: string): Vec3 | undefined {
  switch (part) {
    case 'port': case 'lens': case 'screen': return [0, 0, 1];
    case 'chip': case 'header': case 'button': case 'fan': return [0, 1, 0];
    default: return undefined;
  }
}

/** A named value of a kit row for a size already fitted (the row's own numbers: the crank throw, where a rod's ends sit). */
function rowValue(part: string, name: string, size: Vec3, n?: number): number {
  return rowScope(KIT_PRESETS[part]!, size, n, undefined)[name] as number;
}

/** Radius of the circle the crank pin travels, for a crankshaft of this size box. */
export function crankThrow(size: Vec3): number {
  return rowValue('crankshaft', 'throw', size);
}

/** Where a connecting rod's big end and small end sit on its y axis (its middle is 0). */
export function rodEnds(written: Vec3): { big: number; small: number; length: number } {
  const size = lengthAlongY(written);
  return { big: rowValue('connecting-rod', 'big', size), small: rowValue('connecting-rod', 'small', size), length: rowValue('connecting-rod', 'length', size) };
}

/** How far below a piston's middle its wrist pin sits. */
export function pistonPinDrop(size: Vec3): number {
  return rowValue('piston', 'pinDrop', size);
}

/** Describes a validated part without building meshes or changing the authored data. */
export function resolvePartGeometry(def: PartGeometryInput): PartGeometry {
  const size: Vec3 = [...normalSize(def.part, def.size)];
  const row = KIT_PRESETS[def.part];
  return { size, anchors: { origin: [0, 0, 0], ...(row ? rowAnchors(row, rowScope(row, size, def.n, undefined)) : {}) } };
}
