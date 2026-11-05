/** A validated closed, scalar periodic PCHIP channel. Time is a cycle fraction. */
export type PeriodicCurve = { times: number[]; values: number[]; tangents: number[] };

export function periodicCurve(times: readonly number[], values: readonly number[]): PeriodicCurve {
  const n = times.length;
  if (n < 3 || n > 8 || values.length !== n || times[0] !== 0 || times[n - 1] !== 1 || values[0] !== values[n - 1]) throw new Error('invalid closed curve');
  const secants: number[] = [];
  const widths: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(times[i]) || !Number.isFinite(values[i])) throw new Error('nonfinite curve');
    if (i) {
      const h = times[i]! - times[i - 1]!;
      if (!(h > 0)) throw new Error('unordered curve');
      widths.push(h);
      secants.push((values[i]! - values[i - 1]!) / h);
    }
  }
  const tangents: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const before = (i + n - 2) % (n - 1);
    const dp = secants[before]!, dn = secants[i]!;
    if (dp === 0 || dn === 0 || Math.sign(dp) !== Math.sign(dn)) { tangents.push(0); continue; }
    const hp = widths[before]!, hn = widths[i]!;
    const w1 = 2 * hn + hp, w2 = hn + 2 * hp;
    tangents.push((w1 + w2) / (w1 / dp + w2 / dn));
  }
  tangents.push(tangents[0]!);
  return { times: [...times], values: [...values], tangents };
}

export function samplePeriodicCurve(curve: PeriodicCurve, t: number): number {
  if (!Number.isFinite(t)) throw new Error('nonfinite time');
  const x = ((t % 1) + 1) % 1;
  let i = 0;
  while (i + 1 < curve.times.length - 1 && x >= curve.times[i + 1]!) i++;
  const h = curve.times[i + 1]! - curve.times[i]!;
  const u = (x - curve.times[i]!) / h;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * curve.values[i]! + (u3 - 2 * u2 + u) * h * curve.tangents[i]!
    + (-2 * u3 + 3 * u2) * curve.values[i + 1]! + (u3 - u2) * h * curve.tangents[i + 1]!;
}
