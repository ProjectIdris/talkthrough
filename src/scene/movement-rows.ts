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
  /** A bob also rocks the part about z by this many degrees. */
  rock?: string;
  /** Degrees of the cycle it takes to come in from rest. */
  ease?: number;
};

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
} satisfies Record<string, LoopRow>;

export type LoopName = keyof typeof rows;
export const LOOP_ROWS: Readonly<Record<LoopName, LoopRow>> = rows;

/** What a loop of an unnamed or stopped kind takes as an amount. */
export const DEFAULT_AMOUNT: readonly [number, number] = [0.1, 5];

export const loopRow = (kind: string): LoopRow | undefined => (Object.hasOwn(LOOP_ROWS, kind) ? LOOP_ROWS[kind as LoopName] : undefined);

type Lets = ReadonlyArray<readonly [string, Value]>;

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
