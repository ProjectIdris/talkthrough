// The timeline presets as a catalogue. A preset (a lever, a pulley, a pendulum, an oscillation, a float, a pump, an incline, a wedge, a screw) is not a motion of its own:
// it is a short list of the general ones, a joint to give a part, a loop to set going, a spin to start, a coupling to make, with its numbers worked out from what the
// scene wrote. Each is one row here: the fields it takes and what each is when left out, the names it works out from them, and the steps it expands into, as
// formulas in the small language of kit-expr.ts. What a preset has to read from the scene itself (where a rim is, which way a ramp lies, how long a string hangs, which
// side a block stands on, which of two kinds of cylinder it is) cannot be a formula, so it stays a short reader in the timeline that hands its answers to the row by name.
// Nothing in this file touches a renderer or a scene.

import { bind, fresh } from './movement-rows.ts';
import type { Scope, Value } from './kit-expr.ts';
import { evaluate } from './kit-expr.ts';

type Lets = ReadonlyArray<readonly [string, Value]>;

/** One step a preset takes: an op of the general motions, with each field as a formula (a word in quotes is a literal word); a field with an entry in `only` is written only while that formula holds. */
export type PresetStep = { op: 'joint' | 'loop' | 'spin' | 'couple'; fields: Readonly<Record<string, Value | undefined>>; only?: Readonly<Record<string, string>>; when?: string };

export type PresetRow = {
  /** Fields the action must carry that the steps use as they are (the part, the wheel, the screw). */
  copy: readonly string[];
  /** Fields with the value each takes when the action leaves it out. */
  defaults: Readonly<Record<string, Value>>;
  /** Fields with no value of their own: each is there as itself and as `has_<name>` (whether the action wrote it). */
  optional?: readonly string[];
  /** Names worked out from those, before the reader looks at the scene and after it. */
  lets?: Lets;
  then?: Lets;
  steps: readonly PresetStep[];
};

const rows = {
  // A hinge at the fulcrum and a swing about it.
  lever: {
    copy: ['id'], defaults: { axis: 'z', fulcrum: 'center', swing: 20, period: 3, phase: 0 },
    steps: [
      { op: 'joint', fields: { id: 'id', kind: "'hinge'", axis: 'axis', about: 'fulcrum' } },
      { op: 'loop', fields: { id: 'id', kind: "'swing'", axis: 'axis', amount: 'swing', period: 'period', phase: 'phase' } },
    ],
  },
  // The wheel spins; the load slides on y, coupled by the length of rope that comes off a turn. The reader gives `radius` (the rim, unless written) and `turnAxis`.
  pulley: {
    copy: ['id', 'wheel'], defaults: { rpm: 20 }, optional: ['min', 'max'],
    steps: [
      { op: 'spin', fields: { id: 'wheel', rpm: 'rpm', axis: 'turnAxis' } },
      { op: 'joint', fields: { id: 'id', kind: "'slide'", axis: "'y'", min: 'min', max: 'max' }, only: { min: 'has_min', max: 'has_max' } },
      { op: 'couple', fields: { id: 'id', by: 'wheel', pitch: '2*pi*radius' } },
    ],
  },
  // A swing about the hang point, let go at the far end, with the period a longer string asks for. The reader gives `hasPivot`, `pivotAt` (the point) and `length` (of the string).
  pendulum: {
    copy: ['id'], defaults: { axis: 'z', swing: 25 }, optional: ['period', 'damp', 'from'],
    then: [['seconds', 'has_period ? period : max(0.8, min(6, 1.6*sqrt(length)))']],
    steps: [
      { op: 'loop', fields: { id: 'id', kind: "'swing'", axis: 'axis', amount: 'swing', period: 'seconds', pivot: 'pivotAt', pivotOn: 'from', phase: 90, damp: 'damp' }, only: { pivot: 'hasPivot', pivotOn: '!hasPivot', damp: 'has_damp' } },
    ],
  },
  // A slide let go at the low end; amount is the travel each way, a slide's is the whole.
  oscillate: {
    copy: ['id'], defaults: { axis: 'y', amount: 0.5, period: 1.5 }, optional: ['damp'],
    steps: [{ op: 'loop', fields: { id: 'id', kind: "'slide'", axis: 'axis', amount: '2*amount', period: 'period', phase: 270, damp: 'damp' }, only: { damp: 'has_damp' } }],
  },
  float: {
    copy: ['id'], defaults: { bob: 0.15, tilt: 4, period: 3 }, optional: ['damp'],
    steps: [{ op: 'loop', fields: { id: 'id', kind: "'float'", amount: 'bob', tilt: 'tilt', period: 'period', damp: 'damp' }, only: { damp: 'has_damp' } }],
  },
  // The chamber squeezes and refills; the outlet flap opens while it squeezes and the inlet while it refills, all on the one cycle. The chamber's cycle starts at 180 degrees
  // (relaxed) and shrinks to 360; a flap opens on the cosine of its own angle, so the outlet's angle runs a quarter turn ahead of the chamber's and the inlet's a quarter behind.
  // The reader says which flaps are there (`hasOutlet`, `hasInlet`).
  pump: {
    copy: ['id'], defaults: { period: 1.2, open: 70, axis: 'z', squeeze: 0.7, hinge: 'left' }, optional: ['outlet', 'inlet'],
    steps: [
      { op: 'loop', fields: { id: 'id', kind: "'pulse'", amount: 'squeeze', period: 'period' } },
      { op: 'joint', fields: { id: 'outlet', kind: "'hinge'", axis: 'axis', about: 'hinge' }, when: 'hasOutlet' },
      { op: 'loop', fields: { id: 'outlet', kind: "'gate'", axis: 'axis', amount: 'open', period: 'period', phase: 0 }, when: 'hasOutlet' },
      { op: 'joint', fields: { id: 'inlet', kind: "'hinge'", axis: 'axis', about: 'hinge' }, when: 'hasInlet' },
      { op: 'loop', fields: { id: 'inlet', kind: "'gate'", axis: 'axis', amount: 'open', period: 'period', phase: -180 }, when: 'hasInlet' },
    ],
  },
  // The load slides along the slope, a tilted slide joint with a loop on it. The reader gives `along`, the way the slope lies.
  incline: {
    copy: ['id'], defaults: { travel: 4, period: 4 },
    steps: [
      { op: 'joint', fields: { id: 'id', kind: "'slide'", dir: 'along' } },
      { op: 'loop', fields: { id: 'id', kind: "'slide'", amount: 'travel', period: 'period' } },
    ],
  },
  // The wedge slides in and out along its axis; the part it drives slides across it by tan(angle) of that, to the side it lies on (the reader gives `side`, 1 or -1).
  wedge: {
    copy: ['id', 'drives'], defaults: { axis: 'y', travel: 2, period: 3, angle: 20 },
    lets: [['across', "axis == 'y' ? 'x' : 'y'"]],
    steps: [
      { op: 'joint', fields: { id: 'id', kind: "'slide'", axis: 'axis' } },
      { op: 'loop', fields: { id: 'id', kind: "'slide'", amount: 'travel', period: 'period' } },
      { op: 'joint', fields: { id: 'drives', kind: "'slide'", axis: 'across' } },
      { op: 'couple', fields: { id: 'drives', by: 'id', ratio: "tan((angle*pi)/180)*side*(axis == 'y' ? -1 : 1)" } },
    ],
  },
  // The screw turns about its length; the nut slides along that, by the pitch for each turn. The reader gives `turnAxis` and `dir` (the screw's length, unless written).
  screw: {
    copy: ['id', 'screw'], defaults: { rpm: 30, pitch: 0.5 }, optional: ['min', 'max'],
    steps: [
      { op: 'spin', fields: { id: 'screw', rpm: 'rpm', axis: 'turnAxis' } },
      { op: 'joint', fields: { id: 'id', kind: "'slide'", dir: 'dir', min: 'min', max: 'max' }, only: { min: 'has_min', max: 'has_max' } },
      { op: 'couple', fields: { id: 'id', by: 'screw', pitch: 'pitch' } },
    ],
  },
} satisfies Record<string, PresetRow>;

export type PresetName = keyof typeof rows;
export const PRESET_ROWS: Readonly<Record<PresetName, PresetRow>> = rows;
export const presetRow = (op: string): PresetRow | undefined => (Object.hasOwn(PRESET_ROWS, op) ? PRESET_ROWS[op as PresetName] : undefined);

/**
 * The ops a preset expands into. `action` is what the scene wrote; `read` is the timeline's reader for this preset, which gets the fields as the row has them so far and
 * answers with the names it works out from the scene (or nothing, when the scene lacks what the preset needs, and the preset does nothing).
 */
export function expandPreset(row: PresetRow, action: Readonly<Record<string, unknown>>, at: number, read: (scope: Scope) => Record<string, unknown> | undefined): Array<Record<string, unknown>> | undefined {
  const scope = fresh({});
  for (const k of row.copy) scope[k] = action[k];
  for (const [k, v] of Object.entries(row.defaults)) scope[k] = action[k] ?? v;
  for (const k of row.optional ?? []) {
    scope[k] = action[k];
    scope[`has_${k}`] = action[k] !== undefined;
  }
  if (row.lets) bind(scope, row.lets);
  const found = read(scope);
  if (!found) return undefined;
  Object.assign(scope, found);
  if (row.then) bind(scope, row.then);
  const out: Array<Record<string, unknown>> = [];
  for (const step of row.steps) {
    if (step.when !== undefined && !evaluate(step.when, scope)) continue;
    const op: Record<string, unknown> = { op: step.op };
    for (const [k, f] of Object.entries(step.fields)) {
      if (step.only?.[k] !== undefined && !evaluate(step.only[k] as string, scope)) continue;
      op[k] = typeof f === 'string' ? evaluate(f, scope) : f;
    }
    op.at = at;
    out.push(op);
  }
  return out;
}
