// The geometry of the screen marks that are not a plain rectangle: a tilted box, a polygon, a smooth traced curve.
// Pure (no DOM), so the drawing, the timeline and the placement all use the same numbers.

export type Pt = [number, number];

/** The four corners of a w x h box centred on cx,cy turned `deg` degrees clockwise (screen axes, y down). */
export function tiltedCorners(cx: number, cy: number, w: number, h: number, deg: number): Pt[] {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as Pt[]).map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
}

/** Length of a polyline (closed adds the last side back to the first). */
export function pathLength(pts: readonly Pt[], closed = false): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot((pts[i] as Pt)[0] - (pts[i - 1] as Pt)[0], (pts[i] as Pt)[1] - (pts[i - 1] as Pt)[1]);
  if (closed && pts.length > 2) len += Math.hypot((pts[0] as Pt)[0] - (pts[pts.length - 1] as Pt)[0], (pts[0] as Pt)[1] - (pts[pts.length - 1] as Pt)[1]);
  return len;
}

/**
 * A smooth curve through the points (a Catmull-Rom spline, the ends held), flattened to a polyline: it passes through
 * every point, so a curve traced by points on the page lies on the page's curve and does not cut its corners.
 */
export function smoothPath(pts: readonly Pt[], samples = 8): Pt[] {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]] as Pt);
  const out: Pt[] = [[(pts[0] as Pt)[0], (pts[0] as Pt)[1]]];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)] as Pt, p1 = pts[i] as Pt, p2 = pts[i + 1] as Pt, p3 = pts[Math.min(pts.length - 1, i + 2)] as Pt;
    for (let s = 1; s <= samples; s++) {
      const t = s / samples, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number): number => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  return out;
}
