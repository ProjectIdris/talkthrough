/** Scene mark rotation is in degrees; canvas and hit geometry use radians. */
export const markRotationRadians = (degrees: number): number => degrees * Math.PI / 180;

/** The actual highlighter band in CSS pixels for the visible part of a stroke. */
export function underlineBand(x: number, y: number, width: number, height: number, dpr: number, head: number, tail: number) {
  const bandH = Math.round(Math.max(11, Math.min(34, height * 0.02)) * dpr) / dpr;
  const from = Math.max(0, Math.min(width, tail)), to = Math.max(0, Math.min(width, head));
  return to - from > 0.5 ? { x: x + from - 2, y: y - bandH + 3, w: to - from + 4, h: bandH } : undefined;
}

/** The actual triangular arrowhead, in CSS pixels, at its current reveal. */
export function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, lw: number, appear: number): { x: number; y: number }[] {
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
  if (len < 1 || appear <= 0.55) return [];
  const ux = dx / len, uy = dy / len;
  const reach = len * Math.min(1, appear / 0.8);
  const head = Math.min(len * 0.6, Math.max(14, lw * 4.4));
  const size = head * (0.4 + 0.6 * Math.min(1, (appear - 0.55) / 0.45));
  const tip = reach >= len - 0.5 ? { x: x2, y: y2 } : { x: x1 + ux * reach, y: y1 + uy * reach };
  const bx = tip.x - ux * size, by = tip.y - uy * size;
  const nx = -uy * size * 0.5, ny = ux * size * 0.5;
  return [tip, { x: bx + nx, y: by + ny }, { x: bx - nx, y: by - ny }];
}
