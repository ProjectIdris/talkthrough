// The assemblies as a catalogue. An assembly is a working mechanism built from kit parts (a differential, a planetary gear set, a gear train, a rack and pinion,
// a block and tackle...), already meshed, attached and coupled, with the right ratios and directions. It is not a new kind of object: asking for one with
// `add part` gives a group and, under it, one object for each piece (`<id>.<piece>`), then the spins, loops, joints and couplings that make it go, all as the
// ordinary actions of the scene language. So every operation that names an object (pin, highlight, style, explode, cut, spin, attach) can name a piece, and the
// model may take over any motion by writing its own for a piece. Each row is data: the box it fits, the numbers worked out from the box and `n`, the pieces
// with their formulas, the named points of the whole, and the motion. The formulas are read by kit-expr.ts. Nothing in this file touches a renderer or a scene.

import type { Value } from './kit-expr.ts';

type Lets = ReadonlyArray<readonly [string, Value]>;
type E3 = readonly [Value, Value, Value];
type Each = { as: string; count: Value };

/** One piece of the assembly: a kit part or a plain shape, its place (in the whole's space, or in the piece it hangs from) and what it is made of. */
export type AsmPiece = {
  /** The piece's name; `{i}` and the like are replaced by the value of that formula. The object is `<id>.<key>`. */
  key: string;
  /** A kit part, or `shape` a plain shape. */
  part?: string;
  shape?: 'box' | 'cylinder' | 'sphere' | 'cone' | 'torus' | 'plane' | 'group' | 'connector';
  /** For a connector (a rope, a belt, a chain): the two pieces it joins, by key. */
  link?: { from: string; to: string };
  /** Fields that are points (a connector's `fromPoint` and `toPoint`): three formulas each. */
  vecs?: Record<string, readonly [Value, Value, Value]>;
  /** The piece it hangs from (another piece of the row, by key); the whole when left out. A hung piece turns and moves with its holder. */
  on?: string;
  /** Left out for a group (an empty holder to turn or slide pieces together). */
  size?: E3;
  pos?: E3;
  rot?: E3;
  /** `n` of the kit part (teeth, blades, balls...). */
  n?: Value;
  /** A colour of the palette (or hex); `tint` takes the colour the scene gave the whole instead, when it gave one. */
  color?: string;
  tint?: boolean;
  /** Extra fields of the add as they are (a plain shape's `sides`, `variant`...); each is a formula. */
  fields?: Readonly<Record<string, Value>>;
  /** Fields that are words as they are (a plain shape's `variant`...). */
  texts?: Readonly<Record<string, string>>;
  /** Make one for each value of `as` from 0 to count - 1. */
  for?: Each;
  let?: Lets;
  /** Make it only while this holds. */
  when?: Value;
};

/** One thing the assembly does: an op of the scene language. `refs` are pieces (by key, `{i}` as in a key) for the fields that name an object; `fields` are formulas. */
export type AsmStep = {
  op: 'spin' | 'loop' | 'joint' | 'couple' | 'crank' | 'cam' | 'lever' | 'anchor';
  refs: Readonly<Record<string, string>>;
  fields?: Readonly<Record<string, Value>>;
  /** Fields of three numbers (`pivot`, `dir`). */
  vecs?: Readonly<Record<string, E3>>;
  /** Fields that are words as they are (`axis`, `kind`, `shape`). */
  texts?: Readonly<Record<string, string>>;
  for?: Each;
  let?: Lets;
  when?: Value;
};

export type AssemblyRow = {
  /** What it is, and what `n` is (one line for the hint). */
  note: string;
  /** What a scene may call it besides its name (a question's wording, a slip). */
  aka?: readonly string[];
  /** Words in a question that name it (whole words or phrases): the hint is given when one is there. */
  asks: readonly string[];
  /** The box it fits when a scene gives none, and the one the hint suggests. */
  size: readonly [number, number, number];
  /** The turn of the whole when a scene gives none (so it shows in three dimensions). */
  rot?: readonly [number, number, number];
  /** What `n` is, its default and range. */
  n: { default: number; min: number; max: number; what: string };
  /** The piece that is turned (or driven) by hand, and what turning it does: told to the model so it can change the speed or direction. */
  drive: { key: string; what: string };
  /** Named values worked out from sx, sy, sz (the box), n and the scene's `rpm`-free defaults, in order. */
  values: Lets;
  pieces: readonly AsmPiece[];
  /** Named points of the whole, in its own space (the pieces keep their own too). */
  anchors?: ReadonlyArray<{ name: string; at: E3 }>;
  steps: readonly AsmStep[];
};

// A compound gear train: n stages, each a small gear driving a large one on the next shaft, and the large gear carries the next small one on its shaft. Each large gear
// turns by its ratio to the small gear it meshes with, and the small gear beside it by one to the large gear, so every coupling is between gears that mesh or share a shaft. The planes the
// meshes lie in are one behind another so no gear meets a gear it does not drive. The teeth are in proportion (a tip radius of k per tooth, so the teeth are one size)
// and the centre distance is the least that leaves each gear's tips clear of the other's roots; the large gear's turn is set so a tooth meets a gap at the line of centres.
const gearTrain: AssemblyRow = {
  note: 'a compound gear train: n stages (default 2), each a small gear of 12 teeth driving a gear of 36 on the next shaft, a third of the speed and the other way round',
  aka: ['gear train', 'train of gears', 'compound gears', 'reduction gears', 'gear reduction'],
  asks: ['gear train', 'gear trains', 'gear ratio', 'gear ratios', 'train of gears', 'reduction gear', 'reduction gears', 'compound gear', 'compound gears'],
  size: [14, 7, 4],
  n: { default: 2, min: 1, max: 4, what: 'stages' },
  drive: { key: 'pinion0', what: 'the input: spin it at any rpm and the rest follow with the right ratios and directions' },
  values: [
    ['ns', 12], ['nl', 36], ['q', 'ns/nl'],
    // The tip radius of a gear is k per tooth; the centre distance (in k) clears each gear's tips from the other's roots; the width is the shafts and the two end gears.
    ['dn', 'max(ns + nl*0.86, nl + ns*0.86)'],
    ['wn', 'n*dn + ns + nl'],
    ['k', 'min(sx/wn, sy/(2*nl))'],
    ['rs', 'k*ns'], ['rl', 'k*nl'], ['dist', 'k*dn'],
    ['pz', 'sz/n'], ['t', 'min(pz*0.6, k*9)'],
    ['rotl', '180 - 180/nl'],
    ['rpm', 'min(120, 10*pow(3, n - 1))'],
  ],
  pieces: [
    // The shafts first, so that each gear is added on a shaft that already holds its middle; then the input gear, each stage's large gear and the small gear beside it on
    // the same shaft (a sibling, not a child, that turns with the large gear by a ratio of one, so every coupling is between two gears that mesh or share a shaft).
    { key: 'shaft0', part: 'shaft', size: ['k*5', 'k*5', 't*1.9'], n: 1, pos: ['-n*dist/2 + (rs - rl)/2', 0, '(0 - (n - 1)/2)*pz'] },
    { key: 'shaft{s}', for: { as: 'i', count: 'n' }, let: [['s', 'i + 1'], ['lo', 's - 1'], ['hi', 'min(s, n - 1)']], part: 'shaft', n: 1,
      size: ['k*5', 'k*5', '(hi - lo)*pz + t*1.9'], pos: ['(s - n/2)*dist + (rs - rl)/2', 0, '(i - (n - 1)/2)*pz + (hi - lo)*pz/2'] },
    { key: 'pinion0', part: 'gear', size: ['2*rs', '2*rs', 't'], n: 'ns', tint: true, pos: ['-n*dist/2 + (rs - rl)/2', 0, '(0 - (n - 1)/2)*pz'] },
    { key: 'gear{s}', for: { as: 'i', count: 'n' }, let: [['s', 'i + 1']], part: 'gear', size: ['2*rl', '2*rl', 't'], n: 'nl', color: 'blue',
      pos: ['(s - n/2)*dist + (rs - rl)/2', 0, '(i - (n - 1)/2)*pz'], rot: [0, 0, 'rotl'] },
    { key: 'pinion{s}', for: { as: 'i', count: 'n - 1' }, let: [['s', 'i + 1']], part: 'gear', size: ['2*rs', '2*rs', 't'], n: 'ns', tint: true,
      pos: ['(s - n/2)*dist + (rs - rl)/2', 0, '(s - (n - 1)/2)*pz'] },
  ],
  anchors: [{ name: 'input', at: ['-n*dist/2 + (rs - rl)/2', 0, '(0 - (n - 1)/2)*pz + t/2'] }, { name: 'output', at: ['n*dist/2 + (rs - rl)/2', 0, '((n - 1)/2)*pz + t/2'] }],
  steps: [
    { op: 'spin', refs: { id: 'pinion0' }, fields: { rpm: 'rpm' } },
    { op: 'spin', refs: { id: 'gear{s}', by: 'pinion{s - 1}' }, fields: { ratio: '-q' }, for: { as: 'i', count: 'n' }, let: [['s', 'i + 1']] },
    { op: 'spin', refs: { id: 'pinion{s}', by: 'gear{s}' }, fields: { ratio: 1 }, for: { as: 'i', count: 'n - 1' }, let: [['s', 'i + 1']] },
  ],
};

// A rack and pinion: a pinion of n teeth rocking to and fro, driving a toothed bar along x. The bar is a hinge-and-slide coupling with pitch n·p, so the bar goes
// exactly as far as the pitch circle rolls; the rack's teeth are one pitch apart (p = 2·pi·0.93·R/n, R the pinion's tip radius, as in the gear row) and a gap of the
// bar is under the pinion's tooth that points down. The bar is as long as whole teeth allow and the rock is held so the pinion never leaves it.
const rackAndPinion: AssemblyRow = {
  note: 'a rack and pinion: a pinion of n teeth (default 12) rocking to and fro and driving a toothed bar along x by exactly the length of its pitch circle that rolls',
  aka: ['rack and pinion', 'rack pinion', 'steering rack'],
  asks: ['rack and pinion', 'rack pinion', 'rack gear', 'steering rack', 'rack and pinion gear'],
  size: [12, 5, 2],
  n: { default: 12, min: 8, max: 24, what: 'pinion teeth' },
  drive: { key: 'pinion', what: 'the pinion: change its swing loop (amount, period) and the rack follows by the pitch of its teeth' },
  values: [
    ['R', 'min(sy/2.3, sx*0.12)'], ['p', '2*pi*0.93*R/n'], ['nr', 'min(60, floor(sx/p))'], ['lr', 'nr*p'], ['rh', '0.311*R'],
    ['t', 'min(sz, R*0.6)'], ['ytop', '-(1.93*R - rh)/2'], ['xr', 'lr/2 - p*floor(nr/2)'],
    ['trav', 'min(lr/2 - 0.8*R, 3*R)'], ['amp', 'min(170, 360*trav/(n*p))'],
  ],
  pieces: [
    { key: 'rack', part: 'rack', size: ['lr', 'rh', 't'], n: 'nr', tint: true, pos: ['xr', 'ytop - rh/2', 0] },
    { key: 'pinion', part: 'gear', size: ['2*R', '2*R', 't'], n: 'n', color: 'blue', pos: [0, 'ytop + 0.93*R', 0], rot: [0, 0, -90] },
    { key: 'pinion-shaft', part: 'shaft', on: 'pinion', size: ['R*0.35', 'R*0.35', 't*1.9'], n: 1 },
  ],
  anchors: [{ name: 'input', at: [0, 'ytop + 0.93*R', 't/2'] }, { name: 'output', at: ['xr + lr/2', 'ytop - rh/2', 0] }],
  steps: [
    { op: 'joint', refs: { id: 'pinion' }, texts: { kind: 'hinge', axis: 'z' } },
    { op: 'loop', refs: { id: 'pinion' }, texts: { kind: 'swing', axis: 'z' }, fields: { amount: 'amp', period: 4 } },
    { op: 'joint', refs: { id: 'rack' }, texts: { kind: 'slide', axis: 'x' } },
    { op: 'couple', refs: { id: 'rack', by: 'pinion' }, fields: { pitch: 'n*p' } },
  ],
};

// A crank and slider: the engine's moving parts (cylinder block cut away, crankshaft, connecting rod, piston) with the piston tied to the crank by the `crank` op, so
// the rod swings and the piston runs up its bore exactly as the crank pin goes round. The numbers are those of the engine sample, scaled to the box.
const crankSlider: AssemblyRow = {
  note: 'a crank and slider (the piston engine): a crankshaft turning, a connecting rod and a piston sliding in a cut-away cylinder',
  aka: ['crank slider', 'slider crank', 'piston and crank', 'piston engine'],
  asks: ['crank slider', 'slider crank', 'crank and slider', 'piston and crank', 'crank and piston', 'piston crank', 'connecting rod and piston'],
  size: [4.3, 8.3, 3.8],
  n: { default: 1, min: 1, max: 1, what: 'cylinder' },
  drive: { key: 'crankshaft', what: 'the crankshaft: spin it at any rpm and the piston follows' },
  values: [['s', 'min(sx/3.6, sy/6.9, sz/3.2)'], ['oy', '-1.95*s']],
  pieces: [
    { key: 'block', part: 'cylinder-block', size: ['3.6*s', '5*s', '3.2*s'], pos: [0, '2.9*s + oy', 0], texts: { variant: 'cutaway' } },
    { key: 'crankshaft', part: 'crankshaft', size: ['3*s', '3*s', '2*s'], pos: [0, 'oy', 0] },
    { key: 'rod', part: 'connecting-rod', size: ['0.7*s', '3.2*s', '0.5*s'], pos: [0, '1.9*s + oy', 0] },
    { key: 'piston', part: 'piston', size: ['2.2*s', '2*s', '2.2*s'], pos: [0, '3.34*s + oy', 0] },
  ],
  anchors: [{ name: 'input', at: [0, 'oy', 'sz/2'] }, { name: 'output', at: [0, '3.34*s + oy + s', 0] }],
  steps: [
    { op: 'crank', refs: { piston: 'piston', shaft: 'crankshaft', rod: 'rod' } },
    { op: 'spin', refs: { id: 'crankshaft' }, fields: { rpm: 15 } },
  ],
};

// A cam and follower: a camshaft with one lobe turning, and a valve that its nose pushes down once a turn and lets back up.
const camFollower: AssemblyRow = {
  note: 'a cam and follower: a camshaft turning and the valve its lobe pushes down once a turn and lets up again',
  aka: ['cam and follower', 'cam follower', 'camshaft and valve'],
  asks: ['cam and follower', 'cam follower', 'camshaft and valve', 'cam and valve', 'cam mechanism'],
  size: [3, 8, 6],
  n: { default: 1, min: 1, max: 1, what: 'follower' },
  drive: { key: 'camshaft', what: 'the camshaft: spin it at any rpm and the valve follows' },
  // The camshaft kit part has a base circle of 0.27 of its width and a nose at half of it, flanks of 64 degrees each side; the valve stands with its stem top on the base circle at rest and
  // is pushed down by the nose's height over those same 128 degrees, so the stem rides on the lobe the whole turn.
  values: [['s', 'min(sx/1.3, sy/3.62, sz/2.6)'], ['rb', '0.27*1.3*s'], ['rn', '0.5*1.3*s']],
  pieces: [
    { key: 'camshaft', part: 'camshaft', size: ['1.3*s', '1.3*s', '2.6*s'], n: 1, pos: [0, '1.09*s', 0], rot: [0, 0, 135] },
    { key: 'valve', part: 'valve', size: ['0.7*s', '2.6*s', '0.7*s'], pos: [0, '1.09*s - rb - 1.3*s', 0] },
  ],
  anchors: [{ name: 'input', at: [0, '1.09*s', 'sz/2'] }, { name: 'output', at: [0, '1.09*s - rb - 2.6*s', 0] }],
  steps: [
    { op: 'spin', refs: { id: 'camshaft' }, fields: { rpm: 20 } },
    { op: 'cam', refs: { id: 'valve', by: 'camshaft' }, fields: { lift: 'rn - rb', open: 128 } },
  ],
};

// The three classes of lever: a beam that rocks about a fulcrum with a load and an effort on it. n is the class: 1 the fulcrum between the load and the effort (a seesaw,
// a crowbar), 2 the load between the fulcrum and the effort (a wheelbarrow), 3 the effort between the fulcrum and the load (a fishing rod, tweezers). The load and the
// effort are children of the beam, so they rise and fall with it; the fulcrum stands still with its pivot on the beam's middle line.
const leverRow: AssemblyRow = {
  note: 'a lever, n its class (1, 2 or 3; default 1): a beam rocking about a fulcrum with a load (block) and an effort (arrow) in the places of that class',
  aka: ['lever', 'first class lever', 'second class lever', 'third class lever', 'seesaw'],
  asks: ['lever', 'levers', 'first class lever', 'second class lever', 'third class lever', 'class of lever', 'classes of lever', 'seesaw', 'see saw', 'crowbar'],
  size: [12, 5, 2.4],
  n: { default: 1, min: 1, max: 3, what: 'classes (1, 2 or 3)' },
  drive: { key: 'beam', what: 'the beam: change its lever loop (swing, period)' },
  values: [
    ['L', 'sx'], ['fh', 'min(sy*0.4, L*0.2)'], ['bh', 'fh*0.2'], ['bd', 'sz'],
    ['fx', 'L*(n == 1 ? -0.15 : -0.45)'], ['ex', 'L*(n == 1 ? 0.42 : n == 2 ? 0.45 : -0.05)'], ['lx', 'L*(n == 1 ? -0.42 : n == 2 ? -0.05 : 0.45)'],
    ['lh', 'min(sy*0.2, L*0.12)'], ['ch', 'min(sy*0.22, L*0.14)'],
  ],
  pieces: [
    { key: 'beam', shape: 'box', size: ['L', 'bh', 'bd'], tint: true, color: 'orange' },
    { key: 'fulcrum', part: 'fulcrum', size: ['fh*0.9', 'fh', 'bd*1.3'], pos: ['fx', '-0.4*fh', 0] },
    { key: 'load', on: 'beam', shape: 'box', size: ['lh*1.4', 'lh', 'bd*0.8'], color: 'blue', pos: ['lx', '(bh + lh)/2', 0] },
    { key: 'effort', on: 'beam', shape: 'cone', size: ['ch*0.7', 'ch', 'ch*0.7'], color: 'red', pos: ['ex', 'n == 1 ? (bh + ch)/2 : -(bh + ch)/2', 0], rot: [0, 0, 'n == 1 ? 180 : 0'] },
  ],
  steps: [
    { op: 'anchor', refs: { id: 'beam' }, texts: { name: 'fulcrum' }, vecs: { pos: ['fx', 0, 0] } },
    { op: 'lever', refs: { id: 'beam' }, texts: { fulcrum: 'fulcrum' }, fields: { swing: 10, period: 4 } },
  ],
};

// A differential: the ring gear and the pinion that drives it (bevels at right angles, 36 teeth to 12), the carrier the ring turns, the spider gears that ride on the
// carrier's cross pin, and the two side gears with their axles. Every cone has its apex at one point (the pinion and the ring at the point of the axle where the ring
// turns; the four gears of the cluster at the middle), which is what makes bevel teeth mesh; the cone shapes are those of the kit's bevel gear (a ratio of the width to
// the radius sets the half-angle: 1:1 gears are 45 degrees, the 3:1 pair 18 and 72). The carrier turns a third of the pinion; the spiders spin on their pin with the
// sides, one side faster than the carrier by what the spiders turn and the other slower by the same, so the sides' sum is twice the carrier's.
const differential: AssemblyRow = {
  note: 'a differential: a pinion (12 teeth) driving a ring gear (36) on the carrier; spider gears on a cross pin and two side gears with axles, cornering (one axle faster, the other slower)',
  aka: ['differential', 'car differential', 'differential gear', 'diff'],
  asks: ['differential', 'differentials', 'differential gear', 'differential gears', 'car differential', 'limited slip', 'ring and pinion', 'ring gear and pinion'],
  size: [12, 8.7, 13],
  rot: [-22, -32, 0],
  n: { default: 1, min: 1, max: 1, what: 'differential' },
  drive: { key: 'pinion', what: 'the pinion (the propeller shaft): spin it at any rpm and the ring, carrier, spiders and both axles follow; the cornering split is the spiders ratio' },
  values: [
    ['u', 'min(sx/10.7, sy/7.8, sz/11.6)'], ['szs', '0.871*u'], ['ap', '1.028*szs'],
    ['rbr', '3.9*u'], ['szr', '0.2903*rbr'], ['rbp', 'rbr/3'], ['szp', '2.613*rbp'], ['xa', '0.73*u'],
    ['d', 0.3], ['rpm', 12],
  ],
  pieces: [
    { key: 'carrier', shape: 'group' },
    { key: 'pin', on: 'carrier', shape: 'cylinder', size: ['0.3*u', '2*ap', '0.3*u'], color: 'gray', rot: [90, 0, 0] },
    { key: 'ring', part: 'bevel-gear', size: ['2*rbr', '2*rbr', 'szr'], n: 36, color: 'blue', pos: ['xa + 1.028*szr', 0, 0], rot: [0, -90, 0] },
    { key: 'pinion', part: 'bevel-gear', size: ['2*rbp', '2*rbp', 'szp'], n: 12, color: 'orange', pos: ['xa', 0, '1.028*szp'], rot: [180, 0, 15] },
    { key: 'driveshaft', on: 'pinion', part: 'shaft', size: ['0.6*u', '0.6*u', '2.5*u'], n: 1, pos: [0, 0, '-(szp/2 + 1.25*u)'] },
    { key: 'side-left', part: 'bevel-gear', size: ['2*u', '2*u', 'szs'], n: 12, tint: true, pos: ['-ap', 0, 0], rot: [0, 90, 0] },
    { key: 'side-right', part: 'bevel-gear', size: ['2*u', '2*u', 'szs'], n: 12, tint: true, pos: ['ap', 0, 0], rot: [0, -90, 0] },
    { key: 'axle-left', on: 'side-left', part: 'shaft', size: ['0.6*u', '0.6*u', '4*u'], n: 1, pos: [0, 0, '-(szs/2 + 2*u)'] },
    { key: 'axle-right', on: 'side-right', part: 'shaft', size: ['0.6*u', '0.6*u', '4*u'], n: 1, pos: [0, 0, '-(szs/2 + 2*u)'] },
    { key: 'spider-top', on: 'carrier', part: 'bevel-gear', size: ['2*u', '2*u', 'szs'], n: 12, color: 'teal', pos: [0, 0, 'ap'], rot: [180, 0, 15] },
    { key: 'spider-bottom', on: 'carrier', part: 'bevel-gear', size: ['2*u', '2*u', 'szs'], n: 12, color: 'teal', pos: [0, 0, '-ap'], rot: [0, 0, 15] },
  ],
  anchors: [{ name: 'input', at: ['xa', 0, '1.028*szp + szp/2 + 2.5*u'] }, { name: 'left-axle', at: ['-(ap + szs/2 + 4*u)', 0, 0] }, { name: 'right-axle', at: ['ap + szs/2 + 4*u', 0, 0] }],
  steps: [
    { op: 'spin', refs: { id: 'pinion' }, fields: { rpm: 'rpm' } },
    { op: 'spin', refs: { id: 'ring', by: 'pinion' }, fields: { ratio: -1 / 3 }, texts: { axis: 'x' } },
    { op: 'spin', refs: { id: 'carrier', by: 'pinion' }, fields: { ratio: -1 / 3 }, texts: { axis: 'x' } },
    { op: 'spin', refs: { id: 'side-left', by: 'pinion' }, fields: { ratio: '-(1 + d)/3' }, texts: { axis: 'x' } },
    { op: 'spin', refs: { id: 'side-right', by: 'pinion' }, fields: { ratio: '-(1 - d)/3' }, texts: { axis: 'x' } },
    { op: 'spin', refs: { id: 'spider-top', by: 'pinion' }, fields: { ratio: '-d/3' }, texts: { axis: 'z' } },
    { op: 'spin', refs: { id: 'spider-bottom', by: 'pinion' }, fields: { ratio: 'd/3' }, texts: { axis: 'z' } },
  ],
};

// A planetary gear set: a sun gear in the middle, n planet gears (2 to 4, default 3) round it on a carrier, and a fixed ring gear (the internal variant of the gear
// part) round them all. Sun and planets have 12 teeth and the ring 36 (the ring is worth the sun and two planets), so the centre distance of sun and planet is
// the pitch radius of the ring less that of the planet, and the teeth meet in the planes they should. The sun is driven; the carrier goes at 12/(12+36) = a quarter of its speed
// the same way, and each planet turns on its own pin three quarters as fast the other way (so a planet's own turn is the speed of the sun less that of the carrier, times 12/12).
const planetary: AssemblyRow = {
  note: 'a planetary gear set: a sun gear driving n planet gears (2 to 4, default 3) on a carrier inside a fixed ring gear; the carrier turns a quarter of the speed of the sun',
  aka: ['planetary gear', 'planetary gearset', 'planetary gear set', 'epicyclic gear', 'sun and planet gears'],
  asks: ['planetary gear', 'planetary gears', 'planetary gearset', 'planetary gear set', 'epicyclic', 'epicyclic gear', 'sun gear', 'sun and planet', 'planet gears', 'planet carrier'],
  size: [10, 10, 2],
  n: { default: 3, min: 2, max: 4, what: 'planet gears' },
  drive: { key: 'sun', what: 'the sun gear: spin it at any rpm and the carrier and the planets follow' },
  values: [
    ['ns', 12], ['nr', 36], ['k', 'min(sx, sy)/(2.2*nr)'], ['rs', 'k*ns'], ['dist', '0.93*k*(ns + ns)'],
    ['t', 'min(sz*0.8, rs*0.7)'], ['rc', 'ns/(ns + nr)'], ['rp', '-(1 - rc)'], ['rpm', 16], ['cr', 'dist + rs*0.55'],
  ],
  pieces: [
    { key: 'sun', part: 'gear', size: ['2*rs', '2*rs', 't'], n: 'ns', color: 'orange' },
    { key: 'sun-shaft', on: 'sun', part: 'shaft', size: ['rs*0.4', 'rs*0.4', 't*3'], n: 1, pos: [0, 0, 't*1.1'] },
    { key: 'ring', part: 'gear', size: ['2.2*k*nr', '2.2*k*nr', 't'], n: 'nr', tint: true, texts: { variant: 'internal' } },
    { key: 'carrier', shape: 'group' },
    { key: 'carrier-plate', on: 'carrier', shape: 'cylinder', size: ['2*cr', 't*0.3', '2*cr'], color: 'gray', rot: [90, 0, 0], pos: [0, 0, '-(t/2 + t*0.25)'], fields: { opacity: 0.4 } },
    { key: 'carrier-shaft', on: 'carrier', part: 'shaft', size: ['rs*0.4', 'rs*0.4', 't*3'], n: 1, pos: [0, 0, '-(t/2 + t*1.5)'] },
    { key: 'pin{i}', for: { as: 'i', count: 'n' }, let: [['a', 'i*360/n']], on: 'carrier', part: 'shaft', size: ['rs*0.35', 'rs*0.35', 't*2.6'], n: 1,
      pos: ['dist*cos(a*deg)', 'dist*sin(a*deg)', 't*0.3'] },
    { key: 'planet{i}', for: { as: 'i', count: 'n' }, let: [['a', 'i*360/n']], on: 'carrier', part: 'gear', size: ['2*rs', '2*rs', 't'], n: 'ns', color: 'teal',
      pos: ['dist*cos(a*deg)', 'dist*sin(a*deg)', 0], rot: [0, 0, 'a + 165'] },
  ],
  anchors: [{ name: 'input', at: [0, 0, 't*2.6'] }, { name: 'output', at: [0, 0, '-t*3'] }],
  steps: [
    { op: 'spin', refs: { id: 'sun' }, fields: { rpm: 'rpm' } },
    { op: 'spin', refs: { id: 'carrier', by: 'sun' }, fields: { ratio: 'rc' } },
    { op: 'joint', refs: { id: 'planet{i}' }, texts: { kind: 'hinge', axis: 'z' }, for: { as: 'i', count: 'n' } },
    { op: 'couple', refs: { id: 'planet{i}', by: 'sun' }, fields: { ratio: 'rp' }, for: { as: 'i', count: 'n' } },
  ],
};

// A four-bar linkage in its parallelogram form: a crank turning about one post, a rocker about the other, and the coupler between their free ends, which stays level
// and goes round in a circle (the crank and the rocker are of one length, the coupler and the ground of the other, so the rocker follows the crank turn for turn).
// A four-bar of any lengths has a rocker whose angle is not a straight ratio of the crank's (it comes from solving the loop), which no coupling of the scene language
// is; only this form is made here. The coupler is a child of the crank turned back by the crank's own turn, the rocker follows the crank with a ratio of one.
const fourBar: AssemblyRow = {
  note: 'a four-bar linkage (parallelogram form): a crank turning about a post, a rocker about another, and a coupler between their ends that stays level',
  aka: ['four bar linkage', 'four-bar', 'four bar', '4 bar linkage', 'parallelogram linkage', 'linkage'],
  asks: ['four bar linkage', 'four bar', 'four-bar', '4 bar linkage', 'parallelogram linkage', 'coupler link', 'crank rocker'],
  size: [10, 6, 2],
  n: { default: 1, min: 1, max: 1, what: 'linkage' },
  drive: { key: 'crank-arm', what: 'the crank arm (its hub): spin it at any rpm and the coupler and rocker follow' },
  values: [['a', 'min(sy*0.4, sx*0.2)'], ['b', 'sx - 2*a'], ['w', 'a*0.2'], ['th', 'min(sz/3, w*1.2)'], ['rpm', 10]],
  pieces: [
    { key: 'ground', shape: 'box', size: ['b + w*3', 'w', 'th*0.8'], color: 'gray', pos: [0, 0, '-th*1.7'] },
    { key: 'crank-arm', shape: 'sphere', size: ['w*1.5', 'w*1.5', 'w*1.5'], color: 'gray', pos: ['-b/2', 0, '-th*0.6'] },
    { key: 'crank-bar', on: 'crank-arm', shape: 'box', size: ['a + w', 'w', 'th'], tint: true, color: 'orange', pos: ['a/2', 0, 0] },
    { key: 'coupler', on: 'crank-arm', shape: 'group', pos: ['a', 0, 'th*1.2'] },
    { key: 'coupler-bar', on: 'coupler', shape: 'box', size: ['b + w', 'w', 'th'], color: 'blue', pos: ['b/2', 0, 0] },
    { key: 'rocker', shape: 'group', pos: ['b/2', 0, '-th*0.6'] },
    { key: 'rocker-bar', on: 'rocker', shape: 'box', size: ['a + w', 'w', 'th'], color: 'teal', pos: ['a/2', 0, 0] },
    { key: 'post-a', shape: 'cylinder', size: ['w*1.3', 'th*4.2', 'w*1.3'], color: 'gray', rot: [90, 0, 0], pos: ['-b/2', 0, '-th*0.5'] },
    { key: 'post-d', shape: 'cylinder', size: ['w*1.3', 'th*4.2', 'w*1.3'], color: 'gray', rot: [90, 0, 0], pos: ['b/2', 0, '-th*0.5'] },
    { key: 'pin-b', on: 'crank-arm', shape: 'cylinder', size: ['w*1.1', 'th*2.6', 'w*1.1'], color: 'gray', rot: [90, 0, 0], pos: ['a', 0, 'th*0.6'] },
    { key: 'pin-c', on: 'rocker', shape: 'cylinder', size: ['w*1.1', 'th*2.6', 'w*1.1'], color: 'gray', rot: [90, 0, 0], pos: ['a', 0, 'th*0.6'] },
  ],
  anchors: [{ name: 'input', at: ['-b/2', 0, 'th*1.7'] }],
  steps: [
    { op: 'spin', refs: { id: 'crank-arm' }, fields: { rpm: 'rpm' } },
    { op: 'joint', refs: { id: 'coupler' }, texts: { kind: 'hinge', axis: 'z' } },
    { op: 'couple', refs: { id: 'coupler', by: 'crank-arm' }, fields: { ratio: -1 } },
    { op: 'joint', refs: { id: 'rocker' }, texts: { kind: 'hinge', axis: 'z' } },
    { op: 'couple', refs: { id: 'rocker', by: 'crank-arm' }, fields: { ratio: 1 } },
  ],
};

// A bicycle drivetrain: a chainring of 44 teeth with its crank arm and pedal, a rear sprocket of 16, the chain round them, and the rear wheel on the sprocket. The
// chainring is the driven part; the sprocket turns 44/16 = 2.75 times as fast the same way (a chain does not reverse), and the wheel is part of the sprocket so it goes
// with it. The pedal stays level (it is turned back by the chainring turn). The tooth sizes are one (a chain pitch), so the radii are as the tooth counts.
const bicycle: AssemblyRow = {
  note: 'a bicycle drivetrain: a chainring (44 teeth) with crank arm and pedal, the chain, a rear sprocket (16 teeth) 2.75 times as fast and the rear wheel on it',
  aka: ['bicycle drivetrain', 'bike drivetrain', 'bicycle chain drive', 'bike gears', 'bicycle gears', 'chain drive'],
  asks: ['bicycle drivetrain', 'bike drivetrain', 'bicycle chain', 'bike chain', 'chain drive', 'chainring', 'chain ring', 'chain and sprocket', 'bicycle gears', 'bike gears', 'bicycle', 'bike', 'how a bicycle works', 'how a bike works'],
  size: [18, 14, 6],
  n: { default: 1, min: 1, max: 1, what: 'drivetrain' },
  drive: { key: 'chainring', what: 'the chainring (the pedals): spin it at any rpm and the sprocket and the wheel follow at 2.75 times, the same way' },
  values: [
    ['u', 'min(sx/9, sy/7.2, sz/3.5)'], ['d', '4.2*u'], ['r1', 'u'], ['r2', 'u*16/44'], ['rw', '3.4*u'], ['t', '0.3*u'], ['x0', '-3.3*u'], ['rpm', 20],
  ],
  pieces: [
    { key: 'chainring', part: 'sprocket', size: ['2*r1', '2*r1', 't'], n: 44, tint: true, pos: ['x0', 0, 0] },
    { key: 'crank-arm', on: 'chainring', shape: 'box', size: ['1.9*u', '0.26*u', '0.2*u'], color: 'gray', pos: ['0.8*u', 0, 't*1.4'] },
    { key: 'pedal', on: 'chainring', shape: 'box', size: ['0.35*u', '0.1*u', '0.9*u'], color: 'gray', pos: ['1.65*u', 0, 't*1.4 + 0.35*u'] },
    { key: 'sprocket', part: 'sprocket', size: ['2*r2', '2*r2', 't'], n: 16, color: 'orange', pos: ['x0 + d', 0, 0] },
    { key: 'wheel', on: 'sprocket', part: 'wheel', size: ['2*rw', '2*rw', '0.5*u'], n: 24, pos: [0, 0, '-0.9*u'] },
    { key: 'chainstay', shape: 'box', size: ['d', '0.25*u', '0.25*u'], color: 'gray', pos: ['x0 + d/2', 0, '-0.45*u'] },
    { key: 'chain', shape: 'connector', link: { from: 'chainring', to: 'sprocket' }, texts: { kind: 'wrapped' }, color: 'black' },
  ],
  anchors: [{ name: 'input', at: ['x0', 0, 't*3'] }, { name: 'output', at: ['x0 + d', 0, '-0.9*u'] }],
  steps: [
    { op: 'spin', refs: { id: 'chainring' }, fields: { rpm: 'rpm' } },
    { op: 'spin', refs: { id: 'sprocket', by: 'chainring' }, fields: { ratio: '44/16' } },
    { op: 'joint', refs: { id: 'pedal' }, texts: { kind: 'hinge', axis: 'z' } },
    { op: 'couple', refs: { id: 'pedal', by: 'chainring' }, fields: { ratio: -1 } },
  ],
};

// A block and tackle in its simplest working form: a fixed block on a beam and a moving block with the load, the rope tied to the beam, down round the moving block,
// up over the fixed block and down to the hand. Two strands carry the load, so it rises half as far as the hand pulls (the hand pulls two units for each one the
// load rises) with half the pull. The rope is straight strands between the rims; each sheave turns by the rope laid on it (2 x pi x groove radius for a turn). The
// load is the part the moving block hangs from (the sheave, which turns, never carries it), and each block is a sheave on a plate behind it.
const blockAndTackle: AssemblyRow = {
  note: 'a block and tackle: a fixed block, a moving block with the load, a rope tied to the beam, round both blocks to the hand; two strands carry the load, so it rises half as far as the hand pulls',
  aka: ['block and tackle', 'pulley system', 'compound pulley', 'pulley block and tackle', 'movable pulley', 'lifting tackle'],
  asks: ['block and tackle', 'block tackle', 'pulley system', 'compound pulley', 'movable pulley', 'moving pulley', 'mechanical advantage of pulleys', 'how pulleys lift', 'lifting tackle'],
  size: [7, 12, 2],
  n: { default: 1, min: 1, max: 1, what: 'tackle' },
  drive: { key: 'load', what: 'the load: change its slide loop (amount, period) and the hand, the sheaves and the rope follow' },
  values: [
    ['u', 'min(sx/6, sy/11.5, sz/0.8)'], ['rg', '0.88*u'], ['bh', '0.5*u'], ['yb', 'sy/2 - bh/2'], ['yf', 'sy/2 - bh - 2.3*u'], ['ym', 'yf - 3.6*u'], ['ud', '3*u'],
    ['yl', 'ym - ud'], ['yh', 'yf - 4.2*u'], ['rise', '1.6*u'], ['rope', '0.05*u'], ['turn', '2*pi*rg'],
  ],
  pieces: [
    { key: 'beam', shape: 'box', size: ['sx', 'bh', 'sz*0.8'], color: 'gray', pos: [0, 'yb', 0] },
    { key: 'fixed', part: 'pulley', size: ['2*u', '2*u', '0.5*u'], tint: true, pos: ['rg', 'yf', 0] },
    { key: 'fixed-hanger', on: 'beam', shape: 'box', size: ['0.4*u', '2.3*u + bh/2', '0.12*u'], color: 'gray', pos: ['rg', '(yf - yb)/2 - bh/4', '-0.36*u'] },
    { key: 'load', shape: 'box', size: ['1.8*u', '1.4*u', '0.9*u'], color: 'orange', pos: ['-rg', 'yl', 0] },
    { key: 'moving', on: 'load', part: 'pulley', size: ['2*u', '2*u', '0.5*u'], tint: true, pos: [0, 'ud', 0] },
    { key: 'moving-hanger', on: 'load', shape: 'box', size: ['0.4*u', 'ud', '0.12*u'], color: 'gray', pos: [0, 'ud/2', '-0.36*u'] },
    { key: 'hand', shape: 'box', size: ['0.5*u', '0.5*u', '0.5*u'], color: 'blue', pos: ['2*rg', 'yh', 0] },
    { key: 'rope-tie', shape: 'connector', link: { from: 'beam', to: 'load' }, vecs: { fromPoint: ['-2*rg', '-bh/2', 0], toPoint: ['-rg', 'ud', 0] }, fields: { radius: 'rope' }, color: 'yellow' },
    { key: 'rope-lift', shape: 'connector', link: { from: 'beam', to: 'load' }, vecs: { fromPoint: [0, 'yf - yb', 0], toPoint: ['rg', 'ud', 0] }, fields: { radius: 'rope' }, color: 'yellow' },
    { key: 'rope-haul', shape: 'connector', link: { from: 'beam', to: 'hand' }, vecs: { fromPoint: ['2*rg', 'yf - yb', 0], toPoint: [0, '0.25*u', 0] }, fields: { radius: 'rope' }, color: 'yellow' },
  ],
  anchors: [{ name: 'input', at: ['2*rg', 'yh', 0] }, { name: 'output', at: ['-rg', 'yl', 0] }],
  steps: [
    { op: 'joint', refs: { id: 'load' }, texts: { kind: 'slide', axis: 'y' } },
    { op: 'loop', refs: { id: 'load' }, texts: { kind: 'slide', axis: 'y' }, fields: { amount: 'rise', period: 6 } },
    { op: 'joint', refs: { id: 'hand' }, texts: { kind: 'slide', axis: 'y' } },
    { op: 'loop', refs: { id: 'hand' }, texts: { kind: 'slide', axis: 'y' }, fields: { amount: '2*rise', period: 6, phase: 180 } },
    { op: 'joint', refs: { id: 'moving' }, texts: { kind: 'hinge', axis: 'z' } },
    { op: 'couple', refs: { id: 'moving', by: 'load' }, fields: { pitch: 'turn' } },
    { op: 'joint', refs: { id: 'fixed' }, texts: { kind: 'hinge', axis: 'z' } },
    { op: 'couple', refs: { id: 'fixed', by: 'hand' }, fields: { pitch: 'turn' } },
  ],
};

// A Geneva drive: a driver disc with one pin, turning steadily, and a wheel with n slots that the pin moves on by one slot a turn and leaves locked still the rest of it. The wheel is the
// `geneva` loop kind locked to the driver (it turns the opposite way, one slot of 360/n degrees a turn); the geometry is the true one: the pin is on a circle of radius a, the middle of the
// wheel is a / sin(180/n) from the driver's, the wheel reaches a / tan(180/n) (where the pin's circle meets a slot's end on) and a slot runs from just inside the pin's nearest to there.
const genevaDrive: AssemblyRow = {
  note: 'a Geneva drive: a driver with a pin, turning steadily, and a wheel of n slots (default 4) that the pin moves on one slot a turn and locks still between, turning the other way',
  aka: ['geneva-drive', 'geneva drive', 'geneva wheel', 'geneva mechanism', 'maltese cross', 'maltese cross mechanism', 'intermittent drive'],
  asks: ['geneva drive', 'geneva wheel', 'geneva mechanism', 'geneva stop', 'maltese cross', 'maltese cross mechanism', 'intermittent motion', 'indexing drive'],
  size: [10, 6, 2],
  n: { default: 4, min: 3, max: 10, what: 'slots' },
  drive: { key: 'driver', what: 'the driver: change its spin rpm and the wheel indexes faster or slower, one slot a turn' },
  values: [
    ['q', 'pi/n'], ['kw', '1.45 + 1/sin(q) + 1/tan(q)'], ['kh', '2*max(1.45, 1/tan(q))'],
    ['a', 'min(sx/kw, sy/kh)'], ['c', 'a/sin(q)'], ['b', 'a/tan(q)'], ['rd', '1.45*a'],
    ['xd', 'rd - (rd + c + b)/2'], ['xw', 'xd + c'],
    ['t', 'min(sz/2.4, a*0.5)'], ['pr', 'a*0.17'], ['inn', 'c - a - pr'], ['amt', '360/n'],
  ],
  pieces: [
    { key: 'driver', shape: 'sphere', size: ['0.7*a', '0.7*a', '0.7*a'], pos: ['xd', 0, 0], color: 'gray' },
    { key: 'drive-disc', on: 'driver', shape: 'cylinder', size: ['2*rd', '0.8*t', '2*rd'], rot: [90, 0, 0], pos: [0, 0, '-t'], color: 'gray' },
    { key: 'pin', on: 'driver', shape: 'cylinder', size: ['2*pr', '1.95*t', '2*pr'], rot: [90, 0, 0], pos: ['-a', 0, '-0.425*t'], color: 'orange' },
    { key: 'wheel', shape: 'group', pos: ['xw', 0, 0] },
    { key: 'disc', on: 'wheel', shape: 'cylinder', size: ['2*b', 't', '2*b'], rot: [90, 0, 0], tint: true, color: 'blue' },
    { key: 'slot{i}', for: { as: 'i', count: 'n' }, let: [['s', '(180 + amt/2 + i*amt)*deg']], on: 'wheel', shape: 'box', size: ['b - inn', '2.2*pr', '1.04*t'],
      pos: ['(b + inn)/2*cos(s)', '(b + inn)/2*sin(s)', 0], rot: [0, 0, 's/deg'], color: 'black' },
    { key: 'hub', on: 'wheel', shape: 'cylinder', size: ['0.7*a', '1.3*t', '0.7*a'], rot: [90, 0, 0], color: 'gray' },
  ],
  anchors: [{ name: 'input', at: ['xd', 0, 't'] }, { name: 'output', at: ['xw', 0, 't'] }],
  steps: [
    { op: 'spin', refs: { id: 'driver' }, texts: { axis: 'z' }, fields: { rpm: 10 } },
    { op: 'loop', refs: { id: 'wheel', by: 'driver' }, texts: { kind: 'geneva', axis: 'z' }, fields: { amount: 'amt', ratio: 1, phase: 180 } },
  ],
};

// A clock escapement (the anchor, as in a longcase clock): an escape wheel of n teeth (default 30) with a seconds hand, the anchor that rocks over it with its pendulum, and the pendulum behind.
// The anchor swings with the pendulum (a period of 2 s); the wheel steps one tooth each time the anchor passes the middle, twice a period, so the hand ticks round once in n half periods.
const clockEscapement: AssemblyRow = {
  note: 'a clock escapement: an escape wheel of n teeth (default 30) with a seconds hand, stepping one tooth each beat while the anchor rocks over it with its pendulum (period 2 s)',
  aka: ['clock-escapement', 'clock escapement', 'anchor escapement', 'pendulum clock', 'escape wheel'],
  asks: ['clock escapement', 'escapement', 'anchor escapement', 'escape wheel', 'pendulum clock', 'clock tick', 'why does a clock tick', 'how does a clock tick'],
  size: [8, 12, 2],
  n: { default: 30, min: 12, max: 40, what: 'teeth' },
  drive: { key: 'anchor', what: 'the anchor (with the pendulum): change its swing loop, period and amount; the wheel loop steps twice in the anchor period' },
  values: [
    ['R', 'min(sx/2.4, sy/3.9)'], ['t', 'min(sz/2.6, R*0.25)'], ['rb', '0.3*R'],
    ['y1', 'sy/2 - 0.35*R'], ['y0', 'y1 - 1.55*R'], ['yb', 'y0 - R - 1.5*rb'],
    // The pallets lie on the wheel's rim, 38 degrees either side of the top: from the pivot, a step (xp, yp) to each.
    ['xp', '0.616*R'], ['yp', '-0.762*R'], ['la', 'sqrt(xp*xp + yp*yp)'], ['ar', 'atan2(yp, xp)/deg'], ['al', 'atan2(yp, -xp)/deg'],
    ['per', 2], ['amt', '360/n'],
  ],
  pieces: [
    { key: 'wheel', shape: 'group', pos: [0, 'y0', 0] },
    { key: 'disc', on: 'wheel', shape: 'cylinder', size: ['1.62*R', 't', '1.62*R'], rot: [90, 0, 0], tint: true, color: 'orange' },
    { key: 'tooth{i}', for: { as: 'i', count: 'n' }, let: [['s', '(i*amt + 90)*deg']], on: 'wheel', shape: 'box', size: ['0.3*R', 'min(0.08*R, 5.4*R/n)', 't'],
      pos: ['0.88*R*cos(s)', '0.88*R*sin(s)', 0], rot: [0, 0, 's/deg + 25'], color: 'orange' },
    { key: 'hand', on: 'wheel', shape: 'box', size: ['0.04*R', '0.8*R', '0.5*t'], pos: [0, '0.4*R', '0.7*t'], color: 'red' },
    { key: 'hub', on: 'wheel', shape: 'cylinder', size: ['0.22*R', '1.8*t', '0.22*R'], rot: [90, 0, 0], color: 'gray' },
    { key: 'anchor', shape: 'group', pos: [0, 'y1', 0] },
    { key: 'arm-left', on: 'anchor', shape: 'box', size: ['la', '0.1*R', 't'], pos: ['-xp/2', 'yp/2', 0], rot: [0, 0, 'al'], color: 'blue' },
    { key: 'arm-right', on: 'anchor', shape: 'box', size: ['la', '0.1*R', 't'], pos: ['xp/2', 'yp/2', 0], rot: [0, 0, 'ar'], color: 'blue' },
    { key: 'pallet-l', on: 'anchor', shape: 'box', size: ['0.3*R', '0.12*R', 't'], pos: ['-xp', 'yp', 0], rot: [0, 0, 'al + 90'], color: 'teal' },
    { key: 'pallet-r', on: 'anchor', shape: 'box', size: ['0.3*R', '0.12*R', 't'], pos: ['xp', 'yp', 0], rot: [0, 0, 'ar + 90'], color: 'teal' },
    { key: 'pivot', on: 'anchor', shape: 'cylinder', size: ['0.2*R', '1.8*t', '0.2*R'], rot: [90, 0, 0], color: 'gray' },
    { key: 'rod', on: 'anchor', shape: 'box', size: ['0.05*R', 'y1 - yb', '0.5*t'], pos: [0, '(yb - y1)/2', '-1.3*t'], color: 'gray' },
    { key: 'bob', on: 'anchor', shape: 'cylinder', size: ['2*rb', '0.6*t', '2*rb'], rot: [90, 0, 0], pos: [0, 'yb - y1', '-1.3*t'], color: 'yellow' },
  ],
  anchors: [{ name: 'input', at: [0, 'y1', 't'] }, { name: 'output', at: [0, 'y0', 't'] }],
  steps: [
    { op: 'loop', refs: { id: 'anchor' }, texts: { kind: 'swing', axis: 'z' }, fields: { amount: 9, period: 'per' } },
    { op: 'loop', refs: { id: 'wheel' }, texts: { kind: 'step', axis: 'z' }, fields: { amount: '-amt', period: 'per/2', phase: 45 } },
  ],
};

// A ratchet and pawl: a wheel of n sawtooth teeth, a lever that swings about the wheel's axle with a pawl that pushes a tooth on during its forward stroke and slips back over the teeth on
// the return, and a holding pawl that falls into each gap and stops the wheel running back. The wheel is the `ratchet` kind (it follows the lever's travel through the push, then stands);
// the lever swings half a tooth each side; the holding pawl lifts over a tooth while the wheel is pushed.
const ratchetPawl: AssemblyRow = {
  note: 'a ratchet and pawl: a wheel of n sawtooth teeth (default 12) pushed round a tooth at a time by a swinging lever with a pawl, and held by a second pawl that drops into each gap',
  aka: ['ratchet-and-pawl', 'ratchet and pawl', 'pawl and ratchet', 'ratchet wheel', 'ratchet mechanism'],
  asks: ['ratchet and pawl', 'pawl and ratchet', 'ratchet wheel', 'ratchet mechanism', 'ratchet', 'pawl', 'ratchet gear'],
  size: [9, 9, 2],
  n: { default: 12, min: 6, max: 30, what: 'teeth' },
  drive: { key: 'lever', what: 'the lever: change its swing amount and period (the wheel loop must follow: amount twice the lever swing, the same period)' },
  values: [
    ['R', 'min(sx, sy)/2.7'], ['t', 'min(sz/2.6, R*0.28)'], ['p', '360/n'], ['per', 2],
    ['hy', '1.25*R'], ['hx', '0.85*R'],
  ],
  pieces: [
    { key: 'wheel', shape: 'group', pos: [0, 0, 0] },
    { key: 'disc', on: 'wheel', shape: 'cylinder', size: ['1.6*R', 't', '1.6*R'], rot: [90, 0, 0], tint: true, color: 'blue' },
    { key: 'tooth{i}', for: { as: 'i', count: 'n' }, let: [['s', '(i*p)*deg']], on: 'wheel', shape: 'box', size: ['0.3*R', 'min(0.1*R, 4.5*R/n)', 't'],
      pos: ['0.86*R*cos(s)', '0.86*R*sin(s)', 0], rot: [0, 0, 's/deg + 28'], color: 'blue' },
    { key: 'hub', on: 'wheel', shape: 'cylinder', size: ['0.3*R', '2.6*t', '0.3*R'], rot: [90, 0, 0], color: 'gray' },
    { key: 'lever', shape: 'group', pos: [0, 0, 't*0.9'] },
    { key: 'arm', on: 'lever', shape: 'box', size: ['1.9*R', '0.16*R', '0.5*t'], pos: ['0.85*R', 0, 0], color: 'orange' },
    { key: 'push', on: 'lever', shape: 'box', size: ['0.4*R', '0.12*R', '0.6*t'], pos: ['0.95*R', '-0.1*R', 0], rot: [0, 0, 28], color: 'red' },
    { key: 'hold', shape: 'group', pos: ['hx', 'hy', 0] },
    { key: 'hold-arm', on: 'hold', shape: 'box', size: ['0.754*R', '0.13*R', 't'], pos: ['-0.35*R', '-0.14*R', 0], rot: [0, 0, 22], color: 'teal' },
    { key: 'hold-pin', on: 'hold', shape: 'cylinder', size: ['0.2*R', '1.6*t', '0.2*R'], rot: [90, 0, 0], color: 'gray' },
  ],
  anchors: [{ name: 'input', at: ['1.7*R', 0, 't'] }, { name: 'output', at: [0, 0, 't'] }],
  steps: [
    { op: 'loop', refs: { id: 'lever' }, texts: { kind: 'swing', axis: 'z' }, fields: { amount: 'p/2', period: 'per' } },
    { op: 'loop', refs: { id: 'wheel' }, texts: { kind: 'ratchet', axis: 'z' }, fields: { amount: 'p', period: 'per' } },
    { op: 'loop', refs: { id: 'hold' }, texts: { kind: 'gate', axis: 'z' }, fields: { amount: -10, period: 'per', phase: 90 } },
  ],
};

const rows = {
  'gear-train': gearTrain, 'rack-and-pinion': rackAndPinion, 'crank-slider': crankSlider, 'cam-follower': camFollower, lever: leverRow, differential, planetary, 'four-bar-linkage': fourBar, 'bicycle-drivetrain': bicycle, 'block-and-tackle': blockAndTackle, geneva: genevaDrive, escapement: clockEscapement, ratchet: ratchetPawl,
} satisfies Record<string, AssemblyRow>;
export type AssemblyName = keyof typeof rows;
export const ASSEMBLY_ROWS: Readonly<Record<string, AssemblyRow>> = rows;
