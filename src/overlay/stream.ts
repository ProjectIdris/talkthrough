// Streams: dots, dashes or arrows that run along a path (a tube, a connector, an arrow of a flow diagram). Where each marker is, how big and what colour,
// is a function of the stream's lap count alone (see the timeline), shared by the 3D stage and the flat diagrams so both read the same.

import type { Rgb } from '../scene/colors.ts';

/** Where each of `count` markers is along the path (0 to 1) after `phase` laps: evenly spaced, each a lap behind the next. */
export function markerPlaces(phase: number, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const u = (phase + i / count) % 1;
    out.push(u < 0 ? u + 1 : u);
  }
  return out;
}

const smooth = (x: number): number => {
  const k = Math.max(0, Math.min(1, x));
  return k * k * (3 - 2 * k);
};

/** How much of its size a marker has at `u`: it grows in from the start and shrinks away at the end, so it never pops in or out. */
export function markerSize(u: number): number {
  return smooth(u / 0.06) * smooth((1 - u) / 0.06);
}

/** The colour at `u`: `from` before, `to` after, changing smoothly over a stretch round `shiftAt` (the middle by default). Just `from` when there is no `to`. */
export function streamColour(from: Rgb, to: Rgb | undefined, u: number, shiftAt = 0.5): Rgb {
  if (!to) return from;
  const k = smooth((u - (shiftAt - 0.12)) / 0.24);
  return [from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k, from[2] + (to[2] - from[2]) * k];
}

/** The point `u` (0 to 1) of the way along a flat run of points by length, and the angle it heads in (radians). */
export function polylinePoint(pts: ReadonlyArray<{ x: number; y: number }>, u: number): { x: number; y: number; angle: number } {
  const last = pts.length - 1;
  if (last < 1) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, angle: 0 };
  let total = 0;
  const lens: number[] = [0];
  for (let i = 1; i <= last; i++) {
    const a = pts[i - 1] as { x: number; y: number }, b = pts[i] as { x: number; y: number };
    total += Math.hypot(b.x - a.x, b.y - a.y);
    lens.push(total);
  }
  const want = Math.max(0, Math.min(1, u)) * total;
  let i = 1;
  while (i < last && (lens[i] as number) < want) i++;
  const a = pts[i - 1] as { x: number; y: number }, b = pts[i] as { x: number; y: number };
  const span = (lens[i] as number) - (lens[i - 1] as number);
  const t = span > 1e-9 ? (want - (lens[i - 1] as number)) / span : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}
