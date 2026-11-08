// Gravity, illustrated: how far a dropped part has gone toward the floor, and how long a drop takes.
// A constant pull makes the fall a square of the time; each bounce goes up and comes down again in the time a smaller fall takes,
// `bounce` (0 to 0.8) being the speed it keeps, so the height it reaches is that squared. A pure function of the time, as every motion is.

const MAX_BOUNCES = 5;

/** The times of one fall, in units of the first fall's: the first fall is 1, bounce k takes 2 x bounce^k. */
function schedule(bounce: number): number[] {
  const out = [1];
  for (let k = 1; k <= MAX_BOUNCES; k++) {
    const t = 2 * Math.pow(bounce, k);
    if (t < 0.04) break;
    out.push(t);
  }
  return out;
}

/** How far toward the floor it is (0 at the start, 1 on the floor) after `u` (0 to 1) of the whole drop, bounces and all. */
export function fallCurve(u: number, bounce: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const e = Math.max(0, Math.min(0.8, bounce));
  const times = schedule(e);
  const total = times.reduce((a, b) => a + b, 0);
  let t = u * total;
  if (t < 1) return t * t;
  t -= 1;
  for (let k = 1; k < times.length; k++) {
    const span = times[k] as number;
    if (t <= span) {
      const x = (2 * t) / span - 1;
      return 1 - Math.pow(e, 2 * k) * (1 - x * x);
    }
    t -= span;
  }
  return 1;
}

/** Seconds a drop of `height` units takes, bounces included: longer for a greater fall, with a pull that makes a 4 unit fall take about 0.8 s. */
export function fallSeconds(height: number, bounce: number): number {
  const first = 0.4 * Math.sqrt(Math.max(0.1, Math.abs(height)));
  const e = Math.max(0, Math.min(0.8, bounce));
  return first * schedule(e).reduce((a, b) => a + b, 0);
}
