// The measures of the mechanism parts that the animation needs (where a crank pin is, how long a rod is),
// kept apart from the three.js builders so the timeline can use them without loading three.js. The builders
// in mechanism-parts.ts take their anchors from here, so the two cannot drift apart.

import type { Vec3 } from '../scene/types.ts';

/** Radius of the circle the crank pin travels, for a crankshaft of this size box. */
export function crankThrow(size: Vec3): number {
  return Math.min(size[0], size[1]) * 0.3;
}

/** Where a connecting rod's big end and small end sit on its y axis (its middle is 0). */
export function rodEnds(size: Vec3): { big: number; small: number; length: number } {
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
