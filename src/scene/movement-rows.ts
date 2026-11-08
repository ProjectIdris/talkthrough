// The movement kinds as a catalogue. Each kind a scene can ask for (a loop that slides, swings, swells, opens a gate or floats; a crank; a cam; a flash) is one row of
// data: what general motion it is (turn, slide, scale, bob, follow a path), the facts about it the rest of the program needs (its default axis, where its cycle starts,
// what amount it takes) and its numbers as formulas in the small language of kit-expr.ts. The motions themselves are the few general passes in
// src/overlay/motion.ts: turn about an axis through a pivot, slide along an axis, swell about the middle, bob and rock, and follow a path (a crank pin's circle with a
// rod of fixed length, a cam's bump). A new movement of one of these motions is a row here. Nothing in this file touches a renderer.

import { BASE, evaluate, inner, num } from './kit-expr.ts';
import type { Scope, Value } from './kit-expr.ts';

export type LoopRow = {
  /** The general motion: a turn about an axis through a pivot (a hinge), a slide along an axis, a swell about the middle, or a bob with a rock. */
  motion: 'turn' | 'slide' | 'scale' | 'bob';
  /** The axis (0 x, 1 y, 2 z) it takes when none is written. */
  axis: 0 | 1 | 2;
  /** The angle, in degrees, of its cycle that a free loop starts at, so it begins at rest. */
  start: number;
  /** What amount a scene may write (held to this, with a note). */
  amount: readonly [low: number, high: number];
  /**
   * Its value from `a` (the angle of the cycle, radians), `amount`, `tilt`, `fade` (how much of it a damped loop still has) and `born` (0 to 1, easing in
   * over `ease` degrees from where a loop started; 1 when the row has no `ease`): degrees for a turn, units for a slide, a multiplier for a swell, units up for a bob.
   */
  value: string;
  /** Names set in order before `value` and `rock` are read, each able to read those before it (the cycle's turns and where in the turn it is, for a stepped motion). */
  lets?: Lets;
  /** A bob also rocks the part about z by this many degrees. */
  rock?: string;
  /** Degrees of the cycle it takes to come in from rest. */
  ease?: number;
};

type Lets = ReadonlyArray<readonly [string, Value]>;

// The order here is the order the scene language lists the kinds in (the guide and the schema read it from the keys), and `LoopName` is the keys.
const rows = {
  // The travel is the whole way, so half of it each side of the middle.
  slide: { motion: 'slide', axis: 1, start: 270, amount: [0.01, 100], value: 'cos(a)*amount*fade/2' },
  swing: { motion: 'turn', axis: 2, start: 270, amount: [-180, 180], value: 'cos(a)*amount*fade' },
  // Starts at its smallest (the cosine is -1).
  pulse: { motion: 'scale', axis: 1, start: 180, amount: [0.1, 5], value: '1 + (amount - 1)*((1 + cos(a))/2)*fade' },
  // Open on one half of the cycle, shut on the other: a one-way valve.
  gate: { motion: 'turn', axis: 2, start: 270, amount: [-170, 170], value: 'max(0, cos(a))*amount' },
  float: { motion: 'bob', axis: 1, start: 270, amount: [0.01, 100], value: 'cos(a)*amount*fade*born', rock: 'sin(a)*tilt*fade*born', ease: 180 },
  // Intermittent: it moves in steps. Each cycle `amount` degrees on, all of it in the first quarter (eased at both ends), then it stands: an escapement tooth, an indexing table.
  step: {
    motion: 'turn', axis: 2, start: 0, amount: [-360, 360],
    lets: [['c', 'a/(2*pi)'], ['k', 'floor(c)'], ['u', 'min(1, 4*(c - k))']],
    value: 'amount*(k + u*u*(3 - 2*u))',
  },
  // The same, with a push stroke: it advances its amount in the first half of each cycle and stands in the second, following a swing of half that amount, same period and
  // phase, exactly (a ratchet wheel pushed round by a lever's pawl, which then comes back over the teeth).
  ratchet: {
    motion: 'turn', axis: 2, start: 270, amount: [-360, 360],
    lets: [['m', 'a/(2*pi) - 0.5'], ['k', 'floor(m)'], ['f', 'min(1, 2*(m - k))']],
    value: 'amount*(k - cos(pi*f)/2)',
  },
  // A Geneva drive's driven wheel (the outside kind, which turns the opposite way to its driver): a driver pin of one turn a cycle moves a slotted wheel of 360/amount slots on by
  // one slot (amount degrees) while it is in the slot, and the wheel stands locked the rest of the turn. The slot's angle from the line of centres: tan(phi) = sin(theta)/(C - cos(theta)), C = 1/sin(amount/2), the pin on the slot through its engagement.
  geneva: {
    motion: 'turn', axis: 2, start: 180, amount: [20, 120],
    lets: [
      ['half', 'amount*deg/2'], ['k', 'floor(a/(2*pi) + 0.5)'], ['t', 'a - 2*pi*k'],
      ['slot', 'abs(t) < pi/2 - half ? atan2(sin(t), 1/sin(half) - cos(t)) : (t < 0 ? -half : half)'],
    ],
    value: '-(amount*(k - 0.5) + slot/deg)',
  },
  // A spring let go: it stands cocked, snaps `amount` degrees in a sixteenth of the cycle (fast to start and braking hard as it arrives), rests there, then is wound slowly back over a fifth (a mousetrap's hammer).
  snap: {
    motion: 'turn', axis: 2, start: 0, amount: [-180, 180],
    lets: [['f', 'a/(2*pi) - floor(a/(2*pi))'], ['u', 'min(1, max(0, (f - 0.12)/0.06))'], ['w', 'min(1, max(0, (f - 0.32)/0.22))']],
    value: 'amount*(f < 0.32 ? 1 - pow(1 - u, 3) : 1 - w*w*(3 - 2*w))',
  },
} satisfies Record<string, LoopRow>;

export type LoopName = keyof typeof rows;
export const LOOP_ROWS: Readonly<Record<LoopName, LoopRow>> = rows;

/** What a loop of an unnamed or stopped kind takes as an amount. */
export const DEFAULT_AMOUNT: readonly [number, number] = [0.1, 5];

export const loopRow = (kind: string): LoopRow | undefined => (Object.hasOwn(LOOP_ROWS, kind) ? LOOP_ROWS[kind as LoopName] : undefined);

/** Names set in order, each able to read those before it. */
export function bind(scope: Scope, lets: Lets): Scope {
  for (const [name, e] of lets) scope[name] = evaluate(e, scope);
  return scope;
}
export const fresh = (vars: Record<string, unknown>): Scope => Object.assign(inner(BASE), vars);
export { num };

/**
 * A crank follows a path: the pin goes round a circle of radius `r` (the throw) about the shaft, and the piston, at the far end of a rod of fixed `length`, stands
 * where the rod reaches. Inputs: shaftX/Y/Z, pistonX/Z, `turn` (the shaft's angle, degrees), `throws` and `pin` (which throw), `r`, the rod's `big` end and `length`,
 * `drop` (the wrist pin below the piston's middle), `plain` (the shaft is a plain disc that the crank draws the pin on) with its `thick`, `rodD` and `pinH`, and `rodZ`.
 */
export const CRANK_ROW = {
  lets: [
    ['theta', '(turn + (throws > 1 ? ((pin - 1)*360)/throws : 0))*deg'],
    ['pinX', 'shaftX - sin(theta)*r'],
    ['pinY', 'shaftY + cos(theta)*r'],
    ['dx', 'pistonX - pinX'],
    ['rise', 'sqrt(max(0, length*length - dx*dx))'],
    ['a', 'atan2(-dx, rise)'],
  ] as Lets,
  piston: ['pistonX', 'pinY + rise - drop', 'pistonZ'] as const,
  // On a plain disc the rod runs in front of it, on the pin the crank draws, so the rod and the pin are one thing to look at.
  rod: { pos: ['pinX + big*sin(a)', 'pinY - big*cos(a)', 'plain ? shaftZ + thick/2 + 0.02 + rodD/2 : rodZ'] as const, rotZ: 'a/deg' },
  pin: ['pinX', 'pinY', 'shaftZ + thick/2 + pinH/2 - 0.02'] as const,
};

/** A cam follows a profile: a bump (a half cosine, `open` degrees wide) once a turn, where its nose points at the valve; the valve drops by `lift` times it. Inputs: `turn`, `phase`, `open`, `liftSet` and `liftOpt`, `valveH`, `posY`. */
export const CAM_ROW = {
  lets: [
    ['d', 'abs((((turn - phase + 180) % 360) + 360) % 360 - 180)'],
    ['half', 'open/2'],
    ['bump', 'd < half ? 0.5*(1 + cos((pi*d)/half)) : 0'],
    ['lift', 'liftSet ? liftOpt : valveH*0.2'],
  ] as Lets,
  y: 'posY - lift*bump',
};

/** A flash lights an object over `span` degrees of a `cycle` that starts at `angle` of the driver's turn: a quick rise, a slow fall. Inputs: `turn`, `angle`, `span`, `cycle`, `opacity`. */
export const FLASH_ROW = {
  lets: [
    ['c', '(((turn - angle) % cycle) + cycle) % cycle'],
    ['u', 'c/span'],
    ['v', 'c < span ? (u < 0.1 ? u/0.1 : pow(1 - (u - 0.1)/0.9, 1.6)) : 0'],
  ] as Lets,
  opacity: 'opacity*v',
};

// ---- Joints ---------------------------------------------------------------------------------------------------------------------------
// A joint is what freedom a part has. The facts about each kind that the validator, the timeline and the pose pass all need are one row each, so none of them
// carries its own list of kinds.

export type JointRow = {
  /** What the joint is in the pose pass: a turn about an axis through a pivot, a slide, a turn about all three axes (a ball), or a ride with another part. */
  motion: 'turn' | 'slide' | 'ball' | 'ride';
  /** The turn is about the part's own axis through its own middle (a forearm, a screw), after its rest orientation, not about the parent's axis. */
  own: boolean;
  /** The axis (0 x, 1 y, 2 z) it takes when none is written. */
  axis: 0 | 1 | 2;
  /** The loop kind a loop on it takes when it names none. */
  loop: 'swing' | 'slide' | undefined;
  /** Whether it may name a point of the part to turn about (`about`), and a limit for each axis. */
  about: boolean;
  limit: boolean;
  /** What it is when coupled to or by another part: a turn or a slide; none for a ride. A ball is not coupled at all. */
  as: 'turn' | 'slide' | undefined;
  coupled: boolean;
};

const joints = {
  hinge: { motion: 'turn', own: false, axis: 2, loop: 'swing', about: true, limit: false, as: 'turn', coupled: true },
  slide: { motion: 'slide', own: false, axis: 1, loop: 'slide', about: false, limit: false, as: 'slide', coupled: true },
  fixed: { motion: 'ride', own: false, axis: 1, loop: undefined, about: false, limit: false, as: undefined, coupled: true },
  pivot: { motion: 'turn', own: true, axis: 1, loop: 'swing', about: false, limit: false, as: 'turn', coupled: true },
  ball: { motion: 'ball', own: false, axis: 1, loop: 'swing', about: true, limit: true, as: undefined, coupled: false },
} satisfies Record<string, JointRow>;

export type JointName = keyof typeof joints;
export const JOINT_ROWS: Readonly<Record<JointName, JointRow>> = joints;
export const jointRow = (kind: string | undefined): JointRow | undefined => (kind !== undefined && Object.hasOwn(JOINT_ROWS, kind) ? JOINT_ROWS[kind as JointName] : undefined);

/**
 * A coupling makes one part's value from another's. By ratio it is the same kind of freedom as the part it follows (a gear, a belt, a chain, a lever's ratio):
 * `b` (the value of the driver) times `ratio`, plus `phase`. By pitch it changes kind: a turn gives a slide of `pitch` units a whole turn (a screw, a rope on a
 * wheel), a slide gives a turn of 360 degrees for `pitch` units. `by` is what the driver is, `to` what the part becomes ('same' as the driver).
 */
export type CoupleRow = { by: 'turn' | 'slide' | 'any'; to: 'turn' | 'slide' | 'same'; value: string };
export const COUPLE_ROWS = {
  ratio: { by: 'any', to: 'same', value: 'ratio*b + phase' },
  screw: { by: 'turn', to: 'slide', value: 'pitch*b/360 + phase' },
  unscrew: { by: 'slide', to: 'turn', value: '360*b/pitch + phase' },
} as const satisfies Record<string, CoupleRow>;
/** The row a coupling takes: by ratio, or by pitch from a turn or from a slide. */
export const coupleRow = (pitched: boolean, driver: 'turn' | 'slide'): CoupleRow => (!pitched ? COUPLE_ROWS.ratio : driver === 'turn' ? COUPLE_ROWS.screw : COUPLE_ROWS.unscrew);
/** What the coupled part's freedom is, given the driver's. */
export const coupleAs = (row: CoupleRow, driver: 'turn' | 'slide'): 'turn' | 'slide' => (row.to === 'same' ? driver : row.to);

// ---- Muscle ---------------------------------------------------------------------------------------------------------------------------
/**
 * A muscle contracts to a fraction of its relaxed length along a cycle, and the pulled part's joint turns to make it so. The cycle is a half cosine of the
 * driver's angle `a` (0 relaxed, 1 most contracted); the target length is the relaxed length `rest` less `contract` (held to 0..1) of it, by the cycle. Where the
 * joint has to be to make that length is a geometric inverse and stays code (motion.ts): it walks the joint in `walk` steps of its range from rest the way that
 * shortens the muscle, then halves the stretch between `bisect` times. `low` and `high` are the range when the joint gives none.
 */
export const MUSCLE_ROW = {
  cycle: '(1 - cos(a))/2',
  target: 'rest*(1 - max(0, min(1, contract))*cycle)',
  low: -170, high: 170, walk: 96, bisect: 40,
};

// ---- Wave -----------------------------------------------------------------------------------------------------------------------------
/**
 * A wave along a tube puts a factor on its radius: `count` crests spaced evenly, each `width` of the length across, `phase` laps along. Per crest `j`: its place
 * `c`, the distance `d` from it in half-widths, and a half-cosine bump inside one; the strongest crest counts. Inputs: `u`, `phase`, `count`, `width`, `amount`.
 */
export const WAVE_ROW = {
  half: 'max(0.01, width/2)',
  place: '(((phase + j/count) % 1) + 1) % 1',
  reach: 'abs(u - c)/half',
  bump: '0.5*(1 + cos(pi*d))',
  factor: '1 + (amount - 1)*bump',
};

// ---- Stream markers -------------------------------------------------------------------------------------------------------------------
/**
 * The markers of a stream (dots, dashes, arrows along a path): marker `i` of `count` is `phase` laps along and `i/count` of a lap behind; it grows in over the first
 * and out over the last 6% of the path (a smoothstep), and the colour goes from one to the other across a stretch 0.24 wide round `shiftAt`.
 */
export const STREAM_ROW = {
  place: [['p', '(phase + i/count) % 1']] as Lets,
  at: 'p < 0 ? p + 1 : p',
  size: [['k1', 'max(0, min(1, u/0.06))'], ['k2', 'max(0, min(1, (1 - u)/0.06))']] as Lets,
  grow: '(k1*k1*(3 - 2*k1))*(k2*k2*(3 - 2*k2))',
  shift: [['k0', 'max(0, min(1, (u - (shiftAt - 0.12))/0.24))'], ['k', 'k0*k0*(3 - 2*k0)']] as Lets,
  mix: 'from + (to - from)*k',
};

// ---- A drop ---------------------------------------------------------------------------------------------------------------------------
/**
 * A drop is a constant pull: the first fall is the square of the time (in units of the first fall's), and each bounce `k` goes up and comes down in `span` of
 * them, `bounce` being the speed it keeps, reaching that squared. The bounces stop at `bounces` or when one would take under `least`. `seconds` is the first
 * fall's time for a drop of `height` units (about 0.8 s for 4), times everything the bounces add.
 */
export const FALL_ROW = {
  bounce: 'max(0, min(0.8, b))',
  bounces: 5,
  least: 0.04,
  span: '2*pow(bounce, k)',
  first: 't*t',
  rise: '1 - pow(bounce, 2*k)*(1 - x*x)',
  across: '(2*t)/span - 1',
  seconds: '0.4*sqrt(max(0.1, abs(height)))',
};
