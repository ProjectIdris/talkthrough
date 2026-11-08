// Renderer-independent construction dimensions and local attachment points for validated kit parts.
// The normalized size is the authored construction envelope, not the exact rendered bounds: bolts,
// lips and other details can project beyond it. Anchors are points only, not mating normals or frames.

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

/** The normalized construction envelope, using the kit's existing axis and proportion rules. */
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

/** Describes a validated part without building meshes or changing the authored data. */
export function resolvePartGeometry(def: PartGeometryInput): PartGeometry {
  const size: Vec3 = [...normalSize(def.part, def.size)];
  const [sx, sy, sz] = size;
  const anchors: Record<string, Vec3> = { origin: [0, 0, 0] };
  switch (def.part) {
    case 'cylinder-block':
      anchors['bore-top'] = [0, sy / 2, 0];
      anchors['bore-bottom'] = [0, -sy / 2, 0];
      anchors.front = [0, 0, sz / 2];
      break;
    case 'piston':
      anchors.crown = [0, sy / 2, 0];
      anchors.pin = [0, -pistonPinDrop(size), 0];
      break;
    case 'connecting-rod': {
      const { big, small } = rodEnds(size);
      anchors['big-end'] = [0, big, 0];
      anchors['small-end'] = [0, small, 0];
      break;
    }
    case 'crankshaft': {
      const throwR = crankThrow(size);
      const n = Math.max(1, Math.min(def.n ?? 1, 8));
      const pitch = sz / n;
      for (let i = 0; i < n; i++) {
        const z = -sz / 2 + pitch * (i + 0.5);
        const a = (n > 1 ? (i * 360) / n : 0) * (Math.PI / 180);
        anchors[`pin${n > 1 ? i + 1 : ''}`] = [-Math.sin(a) * throwR, Math.cos(a) * throwR, z];
      }
      anchors['axis-front'] = [0, 0, sz / 2];
      anchors['axis-rear'] = [0, 0, -sz / 2];
      anchors.throw = [0, throwR, 0];
      break;
    }
    case 'valve':
      anchors.head = [0, -sy / 2, 0];
      anchors.tip = [0, sy / 2, 0];
      break;
    case 'camshaft':
      anchors['axis-front'] = [0, 0, sz / 2];
      anchors['axis-rear'] = [0, 0, -sz / 2];
      break;
    case 'spark-plug':
      anchors.tip = [0, -sy / 2, 0];
      anchors.terminal = [0, sy / 2, 0];
      break;
    case 'gear': case 'bearing':
      anchors.axis = [0, 0, sz / 2];
      break;
    case 'spring': case 'pipe':
      anchors.top = [0, sy / 2, 0];
      anchors.bottom = [0, -sy / 2, 0];
      break;
    case 'elbow': {
      const r = sz / 2;
      const bend = Math.max(r * 1.2, Math.min(sx, sy) - 2 * r);
      const cx = -bend / 2, cy = -bend / 2;
      anchors.a = [cx + bend, cy, 0];
      anchors.b = [cx, cy + bend, 0];
      break;
    }
    case 'housing':
      anchors.front = [0, 0, sz / 2];
      anchors.back = [0, 0, -sz / 2];
      break;
  }
  return { size, anchors };
}
