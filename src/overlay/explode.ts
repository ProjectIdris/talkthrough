// The exploded view of a 3D model: where each part sits when its assembly is spread apart.
//
// Two things spread parts. The model's own `explode` action sets a spread on a group (0 assembled, 1 apart):
// its children sit at pos * (1 + spread), or, for a part that names its own `explode` direction, at
// pos + direction * spread. The person's Explode control adds a second, separate spread: each part moves away
// from the middle of its siblings (or along its own `explode` direction), further the deeper it is in the
// assembly, so an engine opens into its sub-assemblies and then into their parts.

export type Vec3 = [number, number, number];

/** What the maths needs to know about one 3D object. */
export type Part = {
  key: number;
  parentKey: number | null;
  /** Its own position inside its parent, assembled. */
  pos: Vec3;
  /** The offset it moves by when fully exploded (spread 1), if the scene says; otherwise it moves outward. */
  explode?: Vec3;
  /** A part that should not move on its own (text in the 3D scene). */
  fixed?: boolean;
};

/** How far apart the Explode control spreads a model, as a share of each part's distance from the middle of its siblings. */
export const USER_SPREAD = 1.25;
/** Distances past this (scene units) grow ever more slowly, so a part far from its siblings (a tower under its head) does not fly out of the picture. */
export const SOFT_REACH = 6;
/** Each level deeper in the assembly moves this much further (1 + this * (depth - 1)). */
export const DEPTH_GAIN = 0.45;
/** Seconds the Explode control takes to open or close the model. */
export const EXPLODE_SECONDS = 0.9;

/** Where a part sits for the model's own spread of its parent: outward from the parent's origin, or along its own direction. */
export function spreadPosition(pos: Vec3, explode: Vec3 | undefined, spread: number): Vec3 {
  if (explode) return [pos[0] + explode[0] * spread, pos[1] + explode[1] * spread, pos[2] + explode[2] * spread];
  const k = 1 + spread;
  return [pos[0] * k, pos[1] * k, pos[2] * k];
}

/** How many levels down a part is: 1 for the top of the model, 2 for what is attached to those. */
export function depthOf(parts: ReadonlyMap<number, Part>, key: number): number {
  let depth = 1;
  for (let cur = parts.get(key)?.parentKey ?? null; cur !== null && depth < 64; cur = parts.get(cur)?.parentKey ?? null) depth++;
  return depth;
}

/**
 * How far the person's spread (0 closed, 1 fully open) moves each part from where it sits, as an offset in
 * its parent's space. A part with its own `explode` direction moves along it; any other moves away from the
 * middle of the parts it is grouped with. A part alone in its group, or at the middle, stays.
 */
export function userOffsets(list: readonly Part[], spread: number): Map<number, Vec3> {
  const out = new Map<number, Vec3>();
  if (!(spread > 0)) return out;
  const byKey = new Map(list.map((p) => [p.key, p] as const));
  const families = new Map<number | null, Part[]>();
  for (const part of list) {
    if (part.fixed) continue;
    const family = families.get(part.parentKey);
    if (family) family.push(part);
    else families.set(part.parentKey, [part]);
  }
  for (const family of families.values()) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of family) {
      cx += p.pos[0];
      cy += p.pos[1];
      cz += p.pos[2];
    }
    const n = family.length;
    cx /= n;
    cy /= n;
    cz /= n;
    for (const p of family) {
      const gain = 1 + DEPTH_GAIN * (depthOf(byKey, p.key) - 1);
      let offset: Vec3;
      if (p.explode) offset = [p.explode[0] * spread * gain, p.explode[1] * spread * gain, p.explode[2] * spread * gain];
      else if (n < 2) continue;
      else {
        const dx = p.pos[0] - cx, dy = p.pos[1] - cy, dz = p.pos[2] - cz;
        const length = Math.hypot(dx, dy, dz);
        const k = length > 0 ? 1 / (1 + length / SOFT_REACH) : 0; // the share of the distance that is kept
        offset = [dx * k * spread * USER_SPREAD * gain, dy * k * spread * USER_SPREAD * gain, dz * k * spread * USER_SPREAD * gain];
      }
      if (offset[0] !== 0 || offset[1] !== 0 || offset[2] !== 0) out.set(p.key, offset);
    }
  }
  return out;
}

/**
 * The person's Explode value over time: eases between 0 (closed) and 1 (open) in EXPLODE_SECONDS, from
 * wherever it is, so it can be reversed half way.
 */
export class ExplodeValue {
  private from = 0;
  private to = 0;
  private startedAt = 0;

  /** Where it is at `now` (milliseconds). */
  value(now: number): number {
    const p = Math.max(0, Math.min(1, (now - this.startedAt) / (EXPLODE_SECONDS * 1000)));
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    return this.from + (this.to - this.from) * e;
  }

  /** Whether it is still moving at `now`. */
  moving(now: number): boolean {
    return now - this.startedAt < EXPLODE_SECONDS * 1000 && this.from !== this.to;
  }

  /** True when it is open or opening. */
  get open(): boolean {
    return this.to >= 0.5;
  }

  set(open: boolean, now: number): void {
    const target = open ? 1 : 0;
    if (target === this.to) return;
    this.from = this.value(now);
    this.to = target;
    this.startedAt = now;
  }

  toggle(now: number): void {
    this.set(!this.open, now);
  }

  /** Straight to a value with no movement (frame grabs). */
  jump(value: number): void {
    this.from = value;
    this.to = value;
    this.startedAt = 0;
  }

  /** Back to closed at once. */
  reset(): void {
    this.from = 0;
    this.to = 0;
  }
}
