// The mechanism kit as a table. Every part (piston, crankshaft, gear, valve...) is one row of data: how its box is fitted, its own settings (how many teeth,
// throws, coils), the named values that follow from its size (the crank throw, where a rod's ends sit), the named points it offers and the list of
// shapes it is made of. The shapes themselves are the general generators in the renderer (lathe, cylinder, extruded outline, box, sphere, torus, coil,
// instanced bolts); a row only says which to use and with what numbers, in the small formula language of kit-expr.ts. Names in formulas: sx, sy, sz (the
// fitted size), n (the setting), variant, curve and radial (the level of detail, drawing only), the row's own values and the loop names it sets.
// A new part, or another look for one, is a row here. Nothing in this file touches a renderer.

import { BASE, evaluate, inner, num } from './kit-expr.ts';
import type { Scope, Value } from './kit-expr.ts';
import type { Vec3 } from './types.ts';

type E = Value;
type Triple = readonly [E, E, E];
export type Loop = { as: string; count?: E; in?: readonly number[] };
/** Repeats, names and conditions that any item of a row may carry; loops nest in the order listed, the outer first. */
export type Flow = { for?: Loop | readonly Loop[]; let?: ReadonlyArray<readonly [string, E]>; when?: E };

export type Hole = Flow & { circle: Triple };
export type PathOp = readonly [op: 'M' | 'L' | 'P' | 'A' | 'Z', ...args: E[]];
export type Outline =
  | { disc: E; holes?: readonly Hole[] }
  | { ring: readonly [outer: E, inner: E] }
  | { roundRect: readonly [w: E, h: E, r: E]; holes?: readonly Hole[] }
  | { path: ReadonlyArray<PathOp | (Flow & { ops: readonly PathOp[] })>; holes?: readonly Hole[] };
export type PointItem = readonly [E, E] | (Flow & { points: readonly PointItem[] });
export type Transform = readonly ['translate', E, E, E] | readonly ['rotateX' | 'rotateY' | 'rotateZ', E];
export type BoltAt = Flow & { p: Triple };

export type Look = { surface: string; tint?: boolean; color?: string; edges?: boolean; open?: boolean; pos?: Triple; rot?: Triple };
export type Shape =
  | { kind: 'lathe'; points: readonly PointItem[]; sides: E; crease: E; xf?: readonly Transform[] }
  | { kind: 'cylinder'; r: E; h: E; sides: E; axis?: 'z'; ends?: false; arc?: readonly [E, E]; xf?: readonly Transform[] }
  | { kind: 'slab'; outline: Outline; depth: E; bevel: E; xf?: readonly Transform[] }
  | { kind: 'box'; size: Triple; radius: E }
  | { kind: 'sphere'; r: E; across: E; down: E }
  | { kind: 'plane'; w: E; h: E }
  | { kind: 'torus'; R: E; r: E; radial: E; tubular: E; arc: E; crease: E; xf?: readonly Transform[] }
  | { kind: 'helix'; turns: E; per: E; r: E; y0: E; rise: E; wire: E; sides: E; crease: E }
  | { kind: 'bolts'; at: readonly BoltAt[]; r: E; h: E; axis: 'y' | 'z'; color?: string };
export type Feature = Flow & (({ features: readonly Feature[] }) | (Look & Shape));
/** A named point; the suffix, when given, is a formula appended to the name (the pins of a crank are pin1, pin2... when it has several). */
export type Anchor = Flow & { name: string; suffix?: E; at: Triple };

export type Setting = { default: number; min?: number; max?: number };
export type KitRow = {
  /** The fitting rules, in order, that turn the size written into the size the part is built to (named in part-geometry.ts). */
  fit?: readonly string[];
  /** `n`: what the author's count means for this part, its default and its limits. */
  settings?: { n?: Setting };
  /** Named values that follow from the size and settings, in order; they are shared by the anchors, the shapes and the motion. */
  values?: ReadonlyArray<readonly [string, E]>;
  anchors: readonly Anchor[];
  features: readonly Feature[];
};

const SIDES: Loop = { as: 'side', in: [-1, 1] };
const ring = (o: E, i: E) => ({ ring: [o, i] as const });

const presets = {
  // A block with a bore, optionally cut open to show inside (a hatched section), optionally finned (n fins).
  'cylinder-block': {
    settings: { n: { default: 6 } },
    values: [['bore', 'min(sx,sz)*0.36'], ['cut', "variant == 'cutaway'"], ['wall', 'sx/2-bore'], ['m', 'min(sx,sz)*0.11']],
    anchors: [{ name: 'bore-top', at: [0, 'sy/2', 0] }, { name: 'bore-bottom', at: [0, '-sy/2', 0] }, { name: 'front', at: [0, 0, 'sz/2'] }],
    features: [
      // Cut open: the back half only (z <= 0), the bore a half-round channel, open to the viewer.
      { kind: 'slab', when: 'cut', surface: 'cast', tint: true, edges: true, depth: 'sy', bevel: '0.02*sy', xf: [['rotateX', '-pi/2']],
        outline: { path: [['M', '-sx/2', 0], ['L', '-bore', 0], ['A', 0, 0, 'bore', 'pi', 0, true], ['L', 'sx/2', 0], ['L', 'sx/2', 'sz/2'], ['L', '-sx/2', 'sz/2'], ['Z']] } },
      { kind: 'slab', when: '!cut', surface: 'cast', tint: true, edges: true, depth: 'sy', bevel: '0.02*sy', xf: [['rotateX', '-pi/2']],
        outline: { roundRect: ['sx', 'sz', 'min(sx,sz)*0.08'], holes: [{ circle: [0, 0, 'bore'] }] } },
      // The cut face: the two walls either side of the bore, hatched like a section drawing.
      { kind: 'plane', when: 'cut', for: SIDES, surface: 'section', color: 'section', open: true, w: 'wall', h: 'sy*0.999', pos: ['side*(bore+wall/2)', 0, 0.003] },
      // Head bolts at the corners of the deck.
      { kind: 'bolts', surface: 'metal', color: 'steel', r: 'm*0.42', h: 'm*0.5', axis: 'y',
        at: [{ for: [{ as: 'i', in: [-1, 1] }, { as: 'j', in: [-1, 1] }], when: '!cut || j < 0', p: ['i*(sx/2-m)', 'sy/2', 'j*(sz/2-m)'] }] },
      // The bore wall, a darker honed liner, so the hole reads as a hole.
      { kind: 'cylinder', surface: 'metal', color: 'liner', open: true, r: 'bore*1.004', h: 'sy*0.98', sides: 'curve', ends: false, arc: ['cut ? pi/2 : 0', 'cut ? pi : pi*2'] },
      { kind: 'box', when: "variant == 'finned'", for: [{ as: 'i', count: 'n' }, SIDES], let: [['y', '-sy/2 + sy*(0.18 + (0.62*i)/max(1, n-1))']],
        surface: 'cast', tint: true, size: ['sx*0.16', 'sy*0.028', 'sz*0.96'], radius: 0.01, pos: ['side*(sx/2 + sx*0.06)', 'y', 0] },
    ],
  },

  // A crown rounded over, three ring grooves in the land with the rings sitting proud in them, and a wrist pin.
  piston: {
    fit: ['roundAboutY'],
    values: [['r', 'sx/2'], ['top', 'sy/2'], ['groove', 'sy*0.045'], ['depth', 'r*0.07'], ['pinDrop', 'sy*0.1']],
    anchors: [{ name: 'crown', at: [0, 'sy/2', 0] }, { name: 'pin', at: [0, '-pinDrop', 0] }],
    features: [
      { kind: 'lathe', surface: 'metal', tint: true, edges: false, sides: 'curve', crease: 0.6,
        points: [
          [0, '-sy/2'], ['r*0.92', '-sy/2'], ['r*0.97', '-sy/2 + sy*0.05'], ['r', '-sy/2 + sy*0.12'], ['r', 'top - sy*0.3 - groove'],
          { for: { as: 'k', in: [0.26, 0.18, 0.1] }, let: [['y', 'top - sy*k - sy*0.04']],
            points: [['r', 'y - groove/2'], ['r - depth', 'y - groove/2'], ['r - depth', 'y + groove/2'], ['r', 'y + groove/2']] },
          ['r', 'top - sy*0.035'], ['r*0.97', 'top - sy*0.012'], ['r*0.9', 'top'], [0, 'top'],
        ] },
      { kind: 'cylinder', for: { as: 'k', in: [0.1, 0.18, 0.26] }, surface: 'metal', color: 'darkSteel', r: 'r*1.006', h: 'groove*0.72', sides: 'curve', pos: [0, 'top - sy*k - sy*0.04', 0] },
      { kind: 'cylinder', surface: 'metal', color: 'bright', r: 'r*0.62', h: 'sy*0.012', sides: 'curve', pos: [0, 'sy/2 + 0.002', 0] },
      { kind: 'cylinder', surface: 'metal', color: 'steel', axis: 'z', r: 'r*0.2', h: 'sz*0.96', sides: 18, pos: [0, '-pinDrop', 0] },
    ],
  },

  // Big end, tapered shaft with a rib down it, small end; the small end is up.
  'connecting-rod': {
    fit: ['lengthAlongY'],
    values: [['rb', 'sx/2'], ['rs', 'sx*0.3'], ['big', '-sy/2 + rb'], ['small', 'sy/2 - rs'], ['length', 'small - big']],
    anchors: [{ name: 'big-end', at: [0, 'big', 0] }, { name: 'small-end', at: [0, 'small', 0] }],
    features: [
      { kind: 'slab', surface: 'metal', tint: true, edges: true, outline: ring('rb', 'rb*0.62'), depth: 'sz', bevel: '0.02*sz', pos: [0, 'big', 0] },
      { kind: 'slab', surface: 'metal', tint: true, edges: true, outline: ring('rs', 'rs*0.55'), depth: 'sz*0.8', bevel: '0.02*sz', pos: [0, 'small', 0] },
      { kind: 'slab', surface: 'metal', tint: true, edges: true, depth: 'sz*0.66', bevel: '0.03*sz',
        outline: { path: [['M', '-rb*0.62', 'big + rb*0.7'], ['L', 'rb*0.62', 'big + rb*0.7'], ['L', 'rs*0.62', 'small - rs*0.7'], ['L', '-rs*0.62', 'small - rs*0.7'], ['Z']] } },
      // The rib down the shaft (an I-beam's web) catches the light.
      { kind: 'slab', surface: 'metal', color: 'bright', depth: 'sz', bevel: '0.02*sz',
        outline: { path: [['M', '-rb*0.2', 'big + rb*0.7'], ['L', 'rb*0.2', 'big + rb*0.7'], ['L', 'rs*0.2', 'small - rs*0.7'], ['L', '-rs*0.2', 'small - rs*0.7'], ['Z']] } },
      { kind: 'cylinder', for: SIDES, surface: 'metal', color: 'darkSteel', r: 'sx*0.055', h: 'sz*1.04', sides: 12, rot: [90, 0, 0], pos: ['side*rb*0.82', 'big - rb*0.55', 0] },
    ],
  },

  // A main journal along z, and for each of n throws two webs, a counterweight opposite the pin, and the pin. The throws are spread evenly round the turn.
  crankshaft: {
    settings: { n: { default: 1, min: 1, max: 8 } },
    values: [['m', 'min(sx,sy)'], ['throw', 'min(sx,sy)*0.3'], ['rj', 'm*0.11'], ['rp', 'rj*0.92'], ['pitch', 'sz/n'], ['web', 'min(pitch*0.16, sz*0.12)'], ['half', '62*deg']],
    anchors: [
      { for: { as: 'i', count: 'n' }, let: [['z', '-sz/2 + pitch*(i+0.5)'], ['a', '(n > 1 ? (i*360)/n : 0)*deg']], name: 'pin', suffix: "n > 1 ? i + 1 : ''", at: ['-sin(a)*throw', 'cos(a)*throw', 'z'] },
      { name: 'axis-front', at: [0, 0, 'sz/2'] }, { name: 'axis-rear', at: [0, 0, '-sz/2'] }, { name: 'throw', at: [0, 'throw', 0] },
    ],
    features: [
      { kind: 'cylinder', surface: 'metal', color: 'steel', edges: true, axis: 'z', r: 'rj', h: 'sz', sides: 'curve' },
      { for: { as: 'i', count: 'n' }, let: [['z', '-sz/2 + pitch*(i+0.5)'], ['a', '(n > 1 ? (i*360)/n : 0)*deg']], features: [
        // Two webs, each a slot from the journal out to the pin; the counterweight is a wedge opposite the pin, a little thicker than the web so the faces never lie in one plane.
        { for: SIDES, let: [['zz', 'z + side*pitch*0.2']], features: [
          { kind: 'slab', surface: 'cast', tint: true, edges: true, outline: { roundRect: ['rj*3', 'throw + rj*3', 'rj*1.4'] }, depth: 'web', bevel: 'web*0.2',
            xf: [['translate', 0, 'throw/2', 0], ['rotateZ', 'a'], ['translate', 0, 0, 'zz']] },
          { kind: 'slab', surface: 'cast', tint: true, edges: true, depth: 'web*1.14', bevel: 'web*0.2', xf: [['rotateZ', 'a'], ['translate', 0, 0, 'zz']],
            outline: { path: [['M', 0, 0], ['A', 0, 0, 'm*0.44', '-pi/2 - half', '-pi/2 + half', false], ['Z']] } },
        ] },
        { kind: 'cylinder', surface: 'metal', color: 'bright', edges: true, axis: 'z', r: 'rp', h: 'pitch*0.4', sides: 'curve', xf: [['translate', 0, 'throw', 0], ['rotateZ', 'a'], ['translate', 0, 0, 'z']] },
      ] },
    ],
  },

  // A lathe-turned stem and head; the head points down.
  valve: {
    fit: ['lengthAlongY', 'roundAboutY'],
    values: [['rh', 'sx/2'], ['rs', 'sx*0.09'], ['y0', '-sy/2']],
    anchors: [{ name: 'head', at: [0, '-sy/2', 0] }, { name: 'tip', at: [0, 'sy/2', 0] }],
    features: [
      { kind: 'lathe', surface: 'metal', tint: true, edges: false, sides: 'curve', crease: 0.7,
        points: [[0, 'y0'], ['rh', 'y0'], ['rh*0.97', 'y0 + sy*0.035'], ['rs*1.7', 'y0 + sy*0.13'], ['rs', 'y0 + sy*0.2'], ['rs', 'sy/2 - sy*0.05'], ['rs*0.78', 'sy/2 - sy*0.025'], ['rs*0.78', 'sy/2'], [0, 'sy/2']] },
      { kind: 'cylinder', surface: 'metal', color: 'darkSteel', r: 'rs*1.5', h: 'sy*0.025', sides: 14, pos: [0, 'sy/2 - sy*0.09', 0] },
    ],
  },

  // A shaft along z with n lobes, each with its nose at +y when the shaft is at angle 0, and a bearing journal near each end.
  camshaft: {
    fit: ['shaftAboutZ'],
    settings: { n: { default: 4, min: 1, max: 12 } },
    values: [['rs', 'sx*0.15'], ['rBase', 'sx*0.27'], ['rNose', 'sx/2'], ['pitch', 'sz/n'], ['lobeW', 'min(pitch*0.34, sz*0.3)'], ['steps', 72], ['flank', '64*deg']],
    anchors: [{ name: 'axis-front', at: [0, 0, 'sz/2'] }, { name: 'axis-rear', at: [0, 0, '-sz/2'] }],
    features: [
      { kind: 'cylinder', surface: 'metal', color: 'steel', edges: true, axis: 'z', r: 'rs', h: 'sz', sides: 'curve' },
      { for: { as: 'end', in: [-1, 1] }, features: [
        { kind: 'cylinder', surface: 'metal', color: 'bright', edges: true, axis: 'z', r: 'rs*1.3', h: 'sz*0.1', sides: 'curve', pos: [0, 0, 'end*sz*0.4'] },
        { kind: 'cylinder', surface: 'metal', color: 'darkSteel', axis: 'z', r: 'rs*1.3', h: 'sz*0.04', sides: 'curve', pos: [0, 0, 'end*sz*0.485'] },
      ] },
      { for: { as: 'i', count: 'n' }, let: [['z', '-sz/2 + pitch*(i+0.5)']], features: [
        // A real lobe: a round base circle over most of the turn, two smooth flanks rising to a rounded nose.
        { kind: 'slab', surface: 'metal', tint: true, edges: true, depth: 'lobeW', bevel: 'lobeW*0.1', pos: [0, 0, 'z'],
          outline: { path: [
            { for: { as: 'k', count: 'steps' },
              let: [['a', 'k/steps*pi*2'], ['away', 'abs(atan2(sin(a - pi/2), cos(a - pi/2)))'], ['lift', 'away >= flank ? 0 : 0.5*(1 + cos((pi*away)/flank))'], ['r', 'rBase + (rNose - rBase)*lift']],
              ops: [['P', 'cos(a)*r', 'sin(a)*r']] },
            ['Z'],
          ] } },
        { kind: 'cylinder', for: SIDES, surface: 'metal', color: 'darkSteel', axis: 'z', r: 'rs*1.35', h: 'lobeW*0.35', sides: 'curve', pos: [0, 0, 'z + side*(lobeW/2 + lobeW*0.17)'] },
      ] },
    ],
  },

  // Thread, hex, ceramic, terminal and the electrode; the tip points down.
  'spark-plug': {
    fit: ['lengthAlongY', 'roundAboutY'],
    values: [['y0', '-sy/2'], ['shellR', 'sx*0.34'], ['teeth', 9]],
    anchors: [{ name: 'tip', at: [0, '-sy/2', 0] }, { name: 'terminal', at: [0, 'sy/2', 0] }],
    features: [
      { kind: 'lathe', surface: 'metal', color: 'steel', edges: false, sides: 'curve', crease: 0.5,
        points: [[0, 'y0 + sy*0.06'], { for: { as: 'i', count: 'teeth + 1' }, points: [['shellR*(i % 2 ? 0.93 : 1)', 'y0 + sy*(0.06 + (0.22*i)/teeth)']] }, ['shellR*0.93', 'y0 + sy*0.3'], [0, 'y0 + sy*0.3']] },
      { kind: 'cylinder', surface: 'metal', color: 'bright', edges: true, r: 'sx*0.5', h: 'sy*0.1', sides: 6, pos: [0, 'y0 + sy*0.35', 0] },
      { kind: 'lathe', surface: 'plastic', color: 'ceramic', sides: 'curve', crease: 0.6,
        points: [[0, 'y0 + sy*0.4'], ['sx*0.26', 'y0 + sy*0.4'], ['sx*0.26', 'y0 + sy*0.62'], ['sx*0.3', 'y0 + sy*0.64'], ['sx*0.3', 'y0 + sy*0.67'], ['sx*0.26', 'y0 + sy*0.69'], ['sx*0.26', 'y0 + sy*0.78'],
          ['sx*0.3', 'y0 + sy*0.8'], ['sx*0.3', 'y0 + sy*0.83'], ['sx*0.23', 'y0 + sy*0.85'], ['sx*0.23', 'y0 + sy*0.92'], [0, 'y0 + sy*0.92']] },
      { kind: 'cylinder', surface: 'metal', color: 'steel', r: 'sx*0.09', h: 'sy*0.1', sides: 14, pos: [0, 'sy/2 - sy*0.04', 0] },
      { kind: 'cylinder', surface: 'metal', color: 'bright', r: 'sx*0.15', h: 'sy*0.025', sides: 6, pos: [0, 'sy/2 - sy*0.06', 0] },
      { kind: 'cylinder', surface: 'metal', color: 'bright', r: 'sx*0.045', h: 'sy*0.09', sides: 10, pos: [0, 'y0 + sy*0.015', 0] },
      { kind: 'box', surface: 'metal', color: 'steel', size: ['sx*0.4', 'sy*0.02', 'sx*0.07'], radius: 0, pos: ['sx*0.17', 'y0 + sy*0.02', 0] },
    ],
  },

  // n teeth round the rim, a bore, lightening holes (from 14 teeth up) and a hub; the axis is z.
  gear: {
    fit: ['discAboutZ'],
    settings: { n: { default: 16, min: 6, max: 120 } },
    values: [['rOut', 'sx/2'], ['rRoot', 'rOut*(n > 40 ? 0.93 : 0.86)'], ['pitch', 'pi*2/n'], ['holes', 'min(6, floor(n/3))']],
    anchors: [{ name: 'axis', at: [0, 0, 'sz/2'] }],
    features: [
      { kind: 'slab', surface: 'metal', tint: true, edges: true, depth: 'sz', bevel: 'min(sz*0.12, 0.05)',
        outline: {
          path: [
            { for: { as: 'i', count: 'n' }, let: [['a', 'i*pitch']],
              ops: [['P', 'cos(a - 0.31*pitch)*rRoot', 'sin(a - 0.31*pitch)*rRoot'], ['P', 'cos(a - 0.15*pitch)*rOut', 'sin(a - 0.15*pitch)*rOut'],
                ['P', 'cos(a + 0.15*pitch)*rOut', 'sin(a + 0.15*pitch)*rOut'], ['P', 'cos(a + 0.31*pitch)*rRoot', 'sin(a + 0.31*pitch)*rRoot']] },
            ['Z'],
          ],
          holes: [{ circle: [0, 0, 'rOut*0.16'] }, { when: 'n >= 14', for: { as: 'i', count: 'holes' }, let: [['a', '(i/holes)*pi*2']], circle: ['cos(a)*rOut*0.5', 'sin(a)*rOut*0.5', 'rOut*0.11'] }],
        } },
      { kind: 'cylinder', surface: 'metal', color: 'darkSteel', edges: true, axis: 'z', r: 'rOut*0.26', h: 'sz*1.25', sides: 'curve' },
    ],
  },

  // A coil of wire along y, n turns, the end coils flat on their seats.
  spring: {
    fit: ['lengthAlongY', 'roundAboutY'],
    settings: { n: { default: 8, min: 2, max: 40 } },
    values: [['wire', 'max(0.01, min(sx*0.07, (sy/n)*0.34))'], ['r', 'sx/2 - wire']],
    anchors: [{ name: 'top', at: [0, 'sy/2', 0] }, { name: 'bottom', at: [0, '-sy/2', 0] }],
    features: [{ kind: 'helix', surface: 'metal', tint: true, turns: 'n', per: 14, r: 'r', y0: '-sy/2 + wire', rise: 'sy - 2*wire', wire: 'wire', sides: 8, crease: 0.8 }],
  },

  // Outer race, inner race, n balls between them and a seal; the axis is z.
  bearing: {
    fit: ['discAboutZ'],
    settings: { n: { default: 9, min: 5, max: 16 } },
    values: [['ro', 'sx/2'], ['rb', 'ro*0.1'], ['pitch', 'ro*0.7']],
    anchors: [{ name: 'axis', at: [0, 0, 'sz/2'] }],
    features: [
      { kind: 'slab', surface: 'metal', tint: true, edges: true, outline: ring('ro', 'ro*0.8'), depth: 'sz', bevel: 'sz*0.08' },
      { kind: 'slab', surface: 'metal', color: 'bright', edges: true, outline: ring('ro*0.6', 'ro*0.34'), depth: 'sz', bevel: 'sz*0.08' },
      { kind: 'sphere', for: { as: 'i', count: 'n' }, let: [['a', '(i/n)*pi*2']], surface: 'metal', color: 'steel', r: 'rb', across: 14, down: 10, pos: ['cos(a)*pitch', 'sin(a)*pitch', 0] },
      { kind: 'slab', surface: 'rubber', color: 'rubber', outline: ring('ro*0.8', 'ro*0.61'), depth: 'sz*0.3', bevel: 0 },
    ],
  },

  // A hollow tube with a flange at each end; the box holds the flanges.
  pipe: {
    fit: ['lengthAlongY', 'roundAboutY'],
    values: [['ro', 'sx/2/1.28'], ['ri', 'ro*0.84'], ['h', 'sy/2']],
    anchors: [{ name: 'top', at: [0, 'sy/2', 0] }, { name: 'bottom', at: [0, '-sy/2', 0] }],
    features: [
      { kind: 'lathe', surface: 'metal', tint: true, edges: false, sides: 'curve', crease: 0.8, points: [['ri', '-h'], ['ro', '-h'], ['ro', 'h'], ['ri', 'h'], ['ri', '-h']] },
      { kind: 'lathe', for: SIDES, surface: 'metal', color: 'darkSteel', edges: true, sides: 'curve', crease: 0.6, xf: [['translate', 0, 'side*(h - sy*0.04)', 0]],
        points: [['ri', '-sy*0.03'], ['ro*1.28', '-sy*0.03'], ['ro*1.28', 'sy*0.03'], ['ri', 'sy*0.03'], ['ri', '-sy*0.03']] },
    ],
  },

  // A quarter bend with a flange at each end; the tube's outside, end to end, is the smaller of the box's two sides.
  elbow: {
    fit: ['elbowSize'],
    values: [['r', 'sz/2'], ['bend', 'max(r*1.2, min(sx,sy) - 2*r)'], ['cx', '-bend/2'], ['cy', '-bend/2']],
    anchors: [{ name: 'a', at: ['cx + bend', 'cy', 0] }, { name: 'b', at: ['cx', 'cy + bend', 0] }],
    features: [
      { kind: 'torus', surface: 'metal', tint: true, edges: false, R: 'bend', r: 'r', radial: 'radial', tubular: 'curve', arc: 'pi/2', crease: 0.8, xf: [['translate', 'cx', 'cy', 0]] },
      // One flange opens downwards at (bend, 0), the other to the left at (0, bend).
      { kind: 'cylinder', surface: 'metal', color: 'darkSteel', edges: true, r: 'r*1.3', h: 'r*0.22', sides: 'curve', pos: ['cx + bend', 'cy - r*0.02', 0] },
      { kind: 'cylinder', surface: 'metal', color: 'darkSteel', edges: true, axis: 'z', r: 'r*1.3', h: 'r*0.22', sides: 'curve', xf: [['rotateZ', 'pi/2']], pos: ['cx - r*0.02', 'cy + bend', 0] },
    ],
  },

  // A casing with a lip and a bolt in each corner; "cutaway" leaves the front open so the inside shows.
  housing: {
    values: [['t', 'min(sx,sy,sz)*0.07'], ['cut', "variant == 'cutaway'"]],
    anchors: [{ name: 'front', at: [0, 0, 'sz/2'] }, { name: 'back', at: [0, 0, '-sz/2'] }],
    features: [
      { kind: 'box', when: 'cut', surface: 'enamel', tint: true, edges: true, size: ['sx', 'sy', 't'], radius: 't*0.3', pos: [0, 0, '-sz/2 + t/2'] },
      { kind: 'box', when: 'cut', for: SIDES, surface: 'enamel', tint: true, edges: true, size: ['t', 'sy', 'sz'], radius: 't*0.3', pos: ['side*(sx/2 - t/2)', 0, 0] },
      { kind: 'box', when: 'cut', for: SIDES, surface: 'enamel', tint: true, edges: true, size: ['sx', 't', 'sz'], radius: 't*0.3', pos: [0, 'side*(sy/2 - t/2)', 0] },
      { kind: 'box', when: '!cut', surface: 'enamel', tint: true, edges: true, size: ['sx', 'sy', 'sz'], radius: 't*0.5' },
      // A lip round the open or front face.
      { kind: 'box', when: 'cut', for: SIDES, surface: 'enamel', tint: true, edges: true, size: ['t*1.2', 'sy*1.04', 't*0.6'], radius: 't*0.2', pos: ['side*(sx/2 - t*0.1)', 0, 'sz/2'] },
      { kind: 'box', when: 'cut', for: SIDES, surface: 'enamel', tint: true, edges: true, size: ['sx*1.04', 't*1.2', 't*0.6'], radius: 't*0.2', pos: [0, 'side*(sy/2 - t*0.1)', 'sz/2'] },
      { kind: 'box', when: '!cut', surface: 'enamel', tint: true, edges: true, size: ['sx*1.04', 'sy*1.04', 't*0.6'], radius: 't*0.2', pos: [0, 0, 'sz/2 - t*0.3'] },
      { kind: 'bolts', surface: 'metal', r: 't*0.5', h: 't*0.6', axis: 'z',
        at: [{ for: [{ as: 'i', in: [-1, 1] }, { as: 'j', in: [-1, 1] }], p: ['i*(sx/2 - t*1.1)', 'j*(sy/2 - t*1.1)', 'sz/2 - t*0.1'] }] },
    ],
  },
} satisfies Record<string, KitRow>;

/** The names of the kit parts the table has today. */
export type KitPartName = keyof typeof presets;
/** The table, indexed by any name (a part that is not in the kit has no row). */
export const KIT_PRESETS: Readonly<Record<string, KitRow>> = presets;

/** The kit parts in the table, in its order (read when asked, so a row added to the table is a part). */
export const kitParts = (): string[] => Object.keys(KIT_PRESETS);

// ---- Reading a row ----------------------------------------------------------------------------------------------------

/** Runs `body` once for each turn of the loops in `flow`, with the loop names, the `let` names and the `when` condition applied. */
export function expand(flow: Flow, scope: Scope, body: (scope: Scope) => void): void {
  const loops = flow.for === undefined ? [] : Array.isArray(flow.for) ? (flow.for as readonly Loop[]) : [flow.for as Loop];
  const run = (depth: number, s: Scope): void => {
    if (depth < loops.length) {
      const loop = loops[depth]!;
      const items = loop.in ?? Array.from({ length: Math.max(0, Math.floor(num(loop.count ?? 0, s))) }, (_, i) => i);
      for (const v of items) { const next = inner(s); next[loop.as] = v; run(depth + 1, next); }
      return;
    }
    const here = inner(s);
    for (const [name, e] of flow.let ?? []) here[name] = evaluate(e, here);
    if (flow.when !== undefined && !evaluate(flow.when, here)) return;
    body(here);
  };
  run(0, scope);
}

/** The count a setting takes: what was written (or the row's default) held between the row's limits. */
export function settingN(row: KitRow, written: number | undefined): number {
  const s = row.settings?.n;
  if (!s) return written ?? 0;
  const v = written ?? s.default;
  return Math.max(s.min ?? -Infinity, Math.min(v, s.max ?? Infinity));
}

/** The scope a row's formulas read: the fitted size, the count, the variant, then its values in order. `extra` adds drawing names (curve, radial). */
export function rowScope(row: KitRow, size: Vec3, n: number | undefined, variant: string | undefined, extra: Scope = {}): Scope {
  const scope = inner(BASE);
  Object.assign(scope, { sx: size[0], sy: size[1], sz: size[2], n: settingN(row, n), variant: variant ?? '' }, extra);
  for (const [name, e] of row.values ?? []) scope[name] = evaluate(e, scope);
  return scope;
}

/** The named points of a row, in its own space, in the order the row lists them. */
export function rowAnchors(row: KitRow, scope: Scope): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const a of row.anchors) expand(a, scope, (s) => { out[a.name + (a.suffix === undefined ? '' : String(evaluate(a.suffix, s)))] = [num(a.at[0], s), num(a.at[1], s), num(a.at[2], s)]; });
  return out;
}
