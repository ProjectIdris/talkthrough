// The measures of the mechanism parts that the animation needs (where a crank pin is, how long a rod is),
// kept apart from the three.js builders so the timeline can use them without loading three.js. The builders
// in mechanism-parts.ts take their anchors from here, so the two cannot drift apart.

import type { Vec3 } from '../scene/types.ts';

// A model writes the size of a part in whatever order it thinks of: a camshaft as [3.5, 0.9, 0.9] (its length first), a
// gear as [5, 1, 5]. The kit has its own axes (round parts stand along y, shafts and discs turn about z), so whatever
// size it is given is first put into those axes, and the part is made to fit inside the box, keeping its own shape.

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

/** The size each kit part is built to, whatever size was written. */
export function normalSize(part: string, size: Vec3): Vec3 {
  switch (part) {
    case 'piston': return roundAboutY(size);
    case 'valve': case 'spark-plug': case 'spring': case 'pipe': return roundAboutY(lengthAlongY(size));
    case 'connecting-rod': return lengthAlongY(size);
    case 'camshaft': return shaftAboutZ(size);
    case 'gear': case 'bearing': return discAboutZ(size);
    case 'elbow': return elbowSize(size);
    default: return size;
  }
}

/** Radius of the circle the crank pin travels, for a crankshaft of this size box. */
export function crankThrow(size: Vec3): number {
  return Math.min(size[0], size[1]) * 0.3;
}

/** Where a connecting rod's big end and small end sit on its y axis (its middle is 0). */
export function rodEnds(written: Vec3): { big: number; small: number; length: number } {
  const size = lengthAlongY(written);
  const rb = size[0] / 2;
  const rs = size[0] * 0.3;
  const big = -size[1] / 2 + rb;
  const small = size[1] / 2 - rs;
  return { big, small, length: small - big };
}

/** How far below a piston's middle its wrist pin sits. */
export function pistonPinDrop(size: Vec3): number {
  return size[1] * 0.1;
}
