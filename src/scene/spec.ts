// Scene language v0: the single table the validator and the JSON Schema are both built from.
// Change a field here and both follow; docs/scene-language.md describes the same table.

export const PALETTE = [
  'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink', 'white', 'gray', 'black',
] as const;

/** Targets of `clear` that are not ids; no object may take one of these as its id. */
export const RESERVED_IDS = ['all', 'marks', 'panel'] as const;

export const ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

export const LIMITS = {
  /** Steps accepted per turn (one question and its answer). */
  maxSteps: 24,
  maxActionsPerStep: 24,
  maxActionsPerTurn: 240,
  /** Live objects (marks and 3D objects together) the scene may hold at once. */
  maxObjects: 160,
  /** Nesting depth of 3D groups. */
  maxDepth: 6,
  maxSay: 400,
  maxText: 80,
  /** The reason given with `escalate`. */
  maxEscalate: 160,
  maxPts: 24,
  /** Points of an outline or profile. */
  maxOutline: 40,
  /** Corners of a screen polygon, and points of a traced curve. */
  maxPoly: 24,
  maxTrace: 40,
  /** Copies one `array` may make, and the copies all arrays may make together in a scene. */
  maxArray: 64,
  maxCopies: 400,
  /** Rows of a note card. */
  maxRows: 6,
  /** Flat diagrams alive at once, and what one may hold. */
  maxDiagrams: 3,
  maxNodes: 12,
  /** Characters of a node's text: room for a short sentence (a step of a checklist). */
  maxNodeText: 56,
  maxEdges: 24,
  maxSeries: 4,
  maxDots: 16,
  /** Points of one line or curve of a chart. */
  maxSeriesPts: 40,
} as const;

/** The flat diagrams a `diagram` action draws. */
export const DIAGRAM_KINDS = ['flow', 'timeline', 'steps', 'chart'] as const;
export type DiagramKind = (typeof DIAGRAM_KINDS)[number];
/** The bounds of a number on a chart's axes or a timeline (the validator clamps to them). */
const AXIS = { min: -1_000_000, max: 1_000_000 } as const;

/**
 * `pin` is a label pinned to a 3D object: it lives on the screen but goes with its object. `diagram` is a flat diagram on the
 * screen, and `node`, `edge`, `series` and `dot` are what is drawn in it.
 */
export type ObjectKind = 'mark' | 'pin' | 'solid' | 'path' | 'text' | 'group' | 'diagram' | 'node' | 'edge' | 'series' | 'dot';

/** The kinds that live on the screen and are not 3D objects: none can be moved, turned or hold parts. */
export const SCREEN_KINDS: ReadonlySet<string | undefined> = new Set(['mark', 'pin', 'diagram', 'node', 'edge', 'series', 'dot']);
/** The kinds that make up a flat diagram: a `clear` of marks takes them away with the marks. */
export const DIAGRAM_PARTS: ReadonlySet<string | undefined> = new Set(['diagram', 'node', 'edge', 'series', 'dot']);

/** One field of an action. `opt` fields may be missing or null. */
export type Field =
  | { k: 'num'; min: number; max: number; int?: boolean; opt?: boolean; doc?: string }
  | { k: 'bool'; opt?: boolean; doc?: string }
  | { k: 'str'; min: number; max: number; opt?: boolean; doc?: string }
  | { k: 'color'; opt?: boolean; doc?: string }
  | { k: 'newId'; doc?: string }
  /** An existing id. `of` limits which kinds it may name. */
  | { k: 'ref'; of: 'any' | 'object3d' | 'diagram' | 'node'; opt?: boolean; doc?: string }
  | { k: 'parent'; opt?: boolean; doc?: string }
  /** An id, or one of the reserved clear targets. */
  | { k: 'target'; doc?: string }
  | { k: 'vec3'; min: number; max: number; opt?: boolean; doc?: string }
  | { k: 'vec2'; min: number; max: number; opt?: boolean; doc?: string }
  /** A list of [x,y] points (an outline or a profile). */
  | { k: 'pts2'; min: number; max: number; lo: number; hi: number; doc?: string }
  /** A short list of short texts. */
  | { k: 'strs'; max: number; len: number; opt?: boolean; doc?: string }
  | { k: 'pts'; min: number; max: number; lo: number; hi: number; doc?: string }
  | { k: 'enum'; values: readonly string[]; opt?: boolean; doc?: string };

export type Variant = {
  /** Unique name of this variant. */
  name: string;
  op: string;
  /** For `add`: the shapes this variant covers. */
  shapes?: readonly string[];
  /** The kind of object it creates, if it creates one. */
  creates?: ObjectKind;
  /** The field naming the object this one is pinned to: it is removed along with that object. */
  attach?: string;
  doc: string;
  fields: Record<string, Field>;
};

const SCREEN = { min: 0, max: 1000 } as const;
const SPAN = { min: 1, max: 1000 } as const;
const WORLD = { min: -100, max: 100 } as const;
const AT: Field = { k: 'num', min: 0, max: 60, opt: true, doc: 'seconds after the step starts' };
const DUR: Field = { k: 'num', min: 0, max: 30, opt: true, doc: 'seconds the change takes (default 0.6)' };
const COLOR: Field = { k: 'color' };
const TILT: Field = { k: 'num', min: -360, max: 360, opt: true, doc: 'degrees clockwise about the middle of the box: a tilted square or oval (default 0)' };
const COLOR_OPT: Field = { k: 'color', opt: true };
const OPACITY: Field = { k: 'num', min: 0, max: 1, opt: true };
const PARENT: Field = { k: 'parent', opt: true, doc: 'id of a group, or of a part or shape, to attach to (it carries this along)' };
const POS: Field = { k: 'vec3', ...WORLD, opt: true, doc: '[x,y,z], default [0,0,0]' };
const ROT: Field = { k: 'vec3', min: -3600, max: 3600, opt: true, doc: 'degrees [x,y,z]' };
const EXPLODE: Field = { k: 'vec3', ...WORLD, opt: true, doc: 'where it moves when the model is exploded, [x,y,z] in the units of the group it is in (spread 1); without it, it moves outward from the middle of the parts around it' };

/** The surfaces a 3D object can be made of; the colour tints them. */
export const MATERIALS = ['plastic', 'metal', 'rubber', 'pcb', 'glass', 'glow', 'paper'] as const;
const MATERIAL: Field = { k: 'enum', values: MATERIALS, opt: true, doc: 'surface, default plastic' };
const BEVEL: Field = { k: 'num', min: 0, max: 20, opt: true, doc: 'rounding of the edges in units (default small)' };
const EDGES: Field = { k: 'bool', opt: true, doc: 'dark edge lines (default true)' };
const DRAW: Field = { k: 'num', min: 0, max: 1, opt: true, doc: 'how much is drawn at first, 0 to 1 (default 1); grow it with reveal' };

export const SOLID_SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'] as const;
export const PARTS = [
  'chip', 'header', 'port', 'lens', 'screen', 'button', 'fan', 'wheel',
  'cylinder-block', 'piston', 'connecting-rod', 'crankshaft', 'valve', 'camshaft', 'spark-plug', 'gear', 'spring', 'bearing', 'pipe', 'elbow', 'housing',
] as const;
export const PART_VARIANTS = ['black', 'metal', 'usb', 'usb3', 'ethernet', 'hdmi', 'usbc', 'gold', 'cutaway', 'finned'] as const;

export const VARIANTS: readonly Variant[] = [
  {
    name: 'box', op: 'box', creates: 'mark',
    doc: 'Rectangle outline on the screenshot; x,y is the top-left corner. rot tilts it about its middle.',
    fields: { id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', ...SPAN }, h: { k: 'num', ...SPAN }, rot: TILT, color: COLOR, at: AT },
  },
  {
    name: 'circle', op: 'circle', creates: 'mark',
    doc: 'Circle or oval outline drawn inside the box x,y,w,h (x,y is the top-left corner). rot tilts it about its middle.',
    fields: { id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', ...SPAN }, h: { k: 'num', ...SPAN }, rot: TILT, color: COLOR, at: AT },
  },
  {
    name: 'underline', op: 'underline', creates: 'mark',
    doc: 'Line under text; x,y is its left end, w its length. y is just under the bottom of the letters, not the top of the text line.',
    fields: { id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', ...SPAN }, color: COLOR, at: AT },
  },
  {
    name: 'arrow', op: 'arrow', creates: 'mark',
    doc: 'Arrow on the screenshot from x1,y1 to x2,y2 (the head is at x2,y2).',
    fields: {
      id: { k: 'newId' }, x1: { k: 'num', ...SCREEN }, y1: { k: 'num', ...SCREEN },
      x2: { k: 'num', ...SCREEN }, y2: { k: 'num', ...SCREEN }, color: COLOR, at: AT,
    },
  },
  {
    name: 'poly', op: 'poly', creates: 'mark',
    doc: 'A closed outline through the screen points [[x,y],...], lightly filled: a triangle, a tilted square, any shape a box or oval does not fit. Put the points on the corners of the shape on the page.',
    fields: { id: { k: 'newId' }, pts: { k: 'pts2', min: 3, max: LIMITS.maxPoly, lo: SCREEN.min, hi: SCREEN.max }, color: COLOR, at: AT },
  },
  {
    name: 'point', op: 'point', creates: 'mark',
    doc: 'A marker (a ring with a dot) on one exact point of the screenshot: where two lines cross, a tip, a place on a map.',
    fields: { id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, color: COLOR, at: AT },
  },
  {
    name: 'trace', op: 'trace', creates: 'mark',
    doc: 'A smooth line that follows a curve or path on the screenshot through the points [[x,y],...]: a curve on a graph, a road, a coastline. head true ends it in an arrowhead.',
    fields: {
      id: { k: 'newId' }, pts: { k: 'pts2', min: 2, max: LIMITS.maxTrace, lo: SCREEN.min, hi: SCREEN.max },
      head: { k: 'bool', opt: true }, color: COLOR, at: AT,
    },
  },
  {
    name: 'label', op: 'label', creates: 'mark',
    doc: 'Short text on the screenshot; x,y is its top-left corner. size is the text height in y units (default 24).',
    fields: {
      id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN },
      text: { k: 'str', min: 1, max: LIMITS.maxText }, color: COLOR,
      size: { k: 'num', min: 10, max: 100, opt: true }, at: AT,
    },
  },
  {
    name: 'card', op: 'card', creates: 'mark',
    doc: 'A note card on the screen: a title and/or up to 6 short rows. layout: list (default), timeline (rows "when | what" along a line) or stat (a big first row). to: a screen point a curved line runs to from the card.',
    fields: {
      id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN },
      w: { k: 'num', min: 60, max: 700, opt: true, doc: 'width in x units, default 300' },
      title: { k: 'str', min: 1, max: 60, opt: true }, rows: { k: 'strs', max: LIMITS.maxRows, len: 60, opt: true },
      layout: { k: 'enum', values: ['list', 'timeline', 'stat'], opt: true }, to: { k: 'vec2', ...SCREEN, opt: true },
      color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'image', op: 'image', creates: 'mark',
    doc: 'A crop of the screenshot (the region sx,sy,sw,sh) shown as a card at dx,dy, dw wide, with an optional caption: to zoom in on something small.',
    fields: {
      id: { k: 'newId' }, sx: { k: 'num', ...SCREEN }, sy: { k: 'num', ...SCREEN }, sw: { k: 'num', ...SPAN }, sh: { k: 'num', ...SPAN },
      dx: { k: 'num', ...SCREEN }, dy: { k: 'num', ...SCREEN }, dw: { k: 'num', min: 40, max: 800 },
      caption: { k: 'str', min: 1, max: 60, opt: true }, color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'diagram', op: 'diagram', creates: 'diagram',
    doc: 'A flat diagram in the rectangle x,y,w,h (moved off the page\'s text if it sits on it), filled by node, edge, series and dot pieces that name it with of. kind flow: nodes joined by edges, laid out for you. timeline: nodes along an axis. steps: numbered nodes, ticked off with tick. chart: series (lines or curves through points) and dots on labelled axes; xrange and yrange [min,max] fix the axes, else they fit the data. Sent again under the same id it replaces the diagram.',
    fields: {
      id: { k: 'newId' }, kind: { k: 'enum', values: DIAGRAM_KINDS },
      x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', min: 80, max: 1000 }, h: { k: 'num', min: 60, max: 1000 },
      title: { k: 'str', min: 1, max: 60, opt: true }, xlabel: { k: 'str', min: 1, max: 24, opt: true }, ylabel: { k: 'str', min: 1, max: 24, opt: true },
      xrange: { k: 'vec2', ...AXIS, opt: true }, yrange: { k: 'vec2', ...AXIS, opt: true }, color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'node', op: 'node', creates: 'node', attach: 'of',
    doc: 'A piece of a flow, timeline or steps diagram: a box in a flow; an event on a timeline (when is its date, pos where it falls on the axis as a number, else events are spread in the order written); a numbered step in steps (in the order written). note is a short line under the text. A piece with no at appears with the words, one after another.',
    fields: {
      id: { k: 'newId' }, of: { k: 'ref', of: 'diagram' }, text: { k: 'str', min: 1, max: LIMITS.maxNodeText }, note: { k: 'str', min: 1, max: 60, opt: true },
      when: { k: 'str', min: 1, max: 24, opt: true }, pos: { k: 'num', ...AXIS, opt: true }, color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'edge', op: 'edge', creates: 'edge', attach: 'from',
    doc: 'An arrow from one node of a flow to another, drawn on as it comes in; text is a short label on it.',
    fields: {
      id: { k: 'newId' }, from: { k: 'ref', of: 'node' }, to: { k: 'ref', of: 'node' },
      text: { k: 'str', min: 1, max: 24, opt: true }, color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'series', op: 'series', creates: 'series', attach: 'of',
    doc: 'A line (a smooth curve with curve true) through points [x,y] in chart units, drawn along from its first point; label names it at its end.',
    fields: {
      id: { k: 'newId' }, of: { k: 'ref', of: 'diagram' }, pts: { k: 'pts2', min: 2, max: LIMITS.maxSeriesPts, lo: AXIS.min, hi: AXIS.max },
      label: { k: 'str', min: 1, max: 24, opt: true }, curve: { k: 'bool', opt: true }, color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'dot', op: 'dot', creates: 'dot', attach: 'of',
    doc: 'A labelled point of a chart at x,y in chart units.',
    fields: {
      id: { k: 'newId' }, of: { k: 'ref', of: 'diagram' }, x: { k: 'num', ...AXIS }, y: { k: 'num', ...AXIS },
      text: { k: 'str', min: 1, max: 30, opt: true }, color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'tick', op: 'tick',
    doc: 'Tick a step of a steps diagram off (done false takes the tick away): the guide does this as the person gets through each step.',
    fields: { id: { k: 'ref', of: 'node' }, done: { k: 'bool', opt: true }, at: AT },
  },
  {
    name: 'panel', op: 'panel',
    doc: 'The 3D stage: the rectangle on the screenshot a 3D model is fitted to. The model floats over the page and may reach past the rectangle; frame true draws a box behind it. Sent again, it moves or resizes.',
    fields: {
      x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', ...SPAN }, h: { k: 'num', ...SPAN },
      frame: { k: 'bool', opt: true }, at: AT, dur: DUR,
    },
  },
  {
    name: 'addSolid', op: 'add', shapes: SOLID_SHAPES, creates: 'solid',
    doc: 'A solid. size is its bounding box [x,y,z]: cylinder and cone stand on y with diameter x, torus lies flat with outer diameter x and tube thickness y, plane faces +z and ignores z. A box with a bevel has rounded edges.',
    fields: {
      shape: { k: 'enum', values: SOLID_SHAPES }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE, pos: POS,
      size: { k: 'vec3', min: 0.01, max: 100 }, rot: ROT, color: COLOR_OPT, material: MATERIAL, bevel: BEVEL, edges: EDGES, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addExtrude', op: 'add', shapes: ['extrude'], creates: 'solid',
    doc: 'A flat outline [[x,y],...] in the x,y plane, pushed out depth along z and centred on it: wings, fins, plates, brackets.',
    fields: {
      shape: { k: 'enum', values: ['extrude'] }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE, pos: POS, rot: ROT,
      outline: { k: 'pts2', min: 3, max: LIMITS.maxOutline, lo: WORLD.min, hi: WORLD.max },
      depth: { k: 'num', min: 0.01, max: 100 }, color: COLOR_OPT, material: MATERIAL, bevel: BEVEL, edges: EDGES, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addLathe', op: 'add', shapes: ['lathe'], creates: 'solid',
    doc: 'A profile [[radius,y],...] spun round the y axis: bodies, nozzles, rings, bottles. sides (default 48) makes it faceted.',
    fields: {
      shape: { k: 'enum', values: ['lathe'] }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE, pos: POS, rot: ROT,
      profile: { k: 'pts2', min: 2, max: LIMITS.maxOutline, lo: WORLD.min, hi: WORLD.max },
      sides: { k: 'num', min: 3, max: 64, int: true, opt: true }, color: COLOR_OPT, material: MATERIAL, edges: EDGES, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addTube', op: 'add', shapes: ['tube'], creates: 'path',
    doc: 'A smooth tube through the points: cables, pipes, vessels. flat (0.05 to 1) squashes it to a ribbon; draw below 1 starts it partly drawn.',
    fields: {
      shape: { k: 'enum', values: ['tube'] }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE,
      pts: { k: 'pts', min: 2, max: LIMITS.maxPts, lo: WORLD.min, hi: WORLD.max },
      radius: { k: 'num', min: 0.01, max: 20 }, flat: { k: 'num', min: 0.05, max: 1, opt: true },
      color: COLOR_OPT, material: MATERIAL, draw: DRAW, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addPath', op: 'add', shapes: ['line', 'arrow'], creates: 'path',
    doc: 'A thin line through the points, or an arrow from the first to the last point.',
    fields: {
      shape: { k: 'enum', values: ['line', 'arrow'] }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE,
      pts: { k: 'pts', min: 2, max: LIMITS.maxPts, lo: WORLD.min, hi: WORLD.max }, color: COLOR_OPT, draw: DRAW, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addPart', op: 'add', shapes: ['part'], creates: 'group',
    doc: 'A ready-made part fitted to the box size [x,y,z]. Electronics: chip (variant black or metal), header (n pins per row, two rows), port (variant usb, usb3, ethernet, hdmi, usbc; its opening faces +z), lens, screen, button, fan (n blades, axis y), wheel (n spokes, axis z). Mechanism, axis y: cylinder-block (variant cutaway or finned; the bore is round in x,z), piston, connecting-rod (small end up), valve (head down), spark-plug (tip down), spring (n coils), pipe, elbow, housing (variant cutaway); axis z: crankshaft (n throws), camshaft (n lobes), gear (n teeth), bearing (n balls). Each has good proportions and named anchors for pins.',
    fields: {
      shape: { k: 'enum', values: ['part'] }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE, pos: POS, rot: ROT,
      part: { k: 'enum', values: PARTS }, variant: { k: 'enum', values: PART_VARIANTS, opt: true },
      size: { k: 'vec3', min: 0.01, max: 100 }, n: { k: 'num', min: 1, max: LIMITS.maxArray, int: true, opt: true },
      color: COLOR_OPT, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addArray', op: 'add', shapes: ['array'], creates: 'group',
    doc: 'Copies of an existing object, count in all (the original is the first). step moves each copy [x,y,z] from the last; turn rotates each copy about the origin of the group the original sits in, which is how to put blades round a hub.',
    fields: {
      shape: { k: 'enum', values: ['array'] }, id: { k: 'newId' }, of: { k: 'ref', of: 'object3d' },
      count: { k: 'num', min: 2, max: LIMITS.maxArray, int: true }, step: POS, turn: ROT, at: AT,
    },
  },
  {
    name: 'addText', op: 'add', shapes: ['text'], creates: 'text',
    doc: 'Text in the 3D scene that always faces the camera; height is in 3D units.',
    fields: {
      shape: { k: 'enum', values: ['text'] }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE, pos: POS,
      text: { k: 'str', min: 1, max: LIMITS.maxText }, height: { k: 'num', min: 0.05, max: 50 }, color: COLOR, at: AT,
    },
  },
  {
    name: 'addGroup', op: 'add', shapes: ['group'], creates: 'group',
    doc: 'An empty node to move, turn and scale other objects together (attach them with parent).',
    fields: { shape: { k: 'enum', values: ['group'] }, id: { k: 'newId' }, parent: PARENT, explode: EXPLODE, pos: POS, rot: ROT, at: AT },
  },
  {
    name: 'pin', op: 'pin', creates: 'pin', attach: 'on',
    doc: 'A label pinned to a 3D object: a dot at point (in the object\'s own space, default its middle), a line and a tag that follow it as it moves. off is where the tag sits from the dot in screen units (default [0,-90]).',
    fields: {
      id: { k: 'newId' }, on: { k: 'ref', of: 'object3d' }, point: POS, anchor: { k: 'str', min: 1, max: 24, opt: true, doc: 'a named point of a ready-made part, instead of point' }, text: { k: 'str', min: 1, max: 40 },
      off: { k: 'vec2', min: -500, max: 500, opt: true }, color: COLOR_OPT, at: AT,
    },
  },
  {
    name: 'move', op: 'move',
    doc: 'Move a 3D object to an absolute position.',
    fields: { id: { k: 'ref', of: 'object3d' }, to: { k: 'vec3', ...WORLD }, at: AT, dur: DUR },
  },
  {
    name: 'along', op: 'along',
    doc: 'Move a 3D object along a smooth path through the points, ending on the last.',
    fields: { id: { k: 'ref', of: 'object3d' }, pts: { k: 'pts', min: 1, max: LIMITS.maxPts, lo: WORLD.min, hi: WORLD.max }, at: AT, dur: DUR },
  },
  {
    name: 'turn', op: 'turn',
    doc: 'Turn a 3D object to absolute angles in degrees; from [0,0,0], [0,360,0] is one full spin.',
    fields: { id: { k: 'ref', of: 'object3d' }, to: { k: 'vec3', min: -3600, max: 3600 }, at: AT, dur: DUR },
  },
  {
    name: 'scale', op: 'scale',
    doc: 'Scale a 3D object to absolute factors [x,y,z] (1 is the size it was added at).',
    fields: { id: { k: 'ref', of: 'object3d' }, to: { k: 'vec3', min: 0.01, max: 100 }, at: AT, dur: DUR },
  },
  {
    name: 'explode', op: 'explode',
    doc: 'Spread the parts of a group outward from its origin: 0 assembled, 1 apart (up to 3). A part that has its own explode offset moves by that offset times the spread instead. Back to 0 to assemble.',
    fields: { id: { k: 'ref', of: 'object3d' }, to: { k: 'num', min: 0, max: 3 }, at: AT, dur: DUR },
  },
  {
    name: 'reveal', op: 'reveal',
    doc: 'Draw a tube, line or arrow on, from its start: to 1 is all of it.',
    fields: { id: { k: 'ref', of: 'object3d' }, to: { k: 'num', min: 0, max: 1 }, at: AT, dur: DUR },
  },
  {
    name: 'style', op: 'style',
    doc: 'Change the colour and/or opacity of any object or mark; at least one of them.',
    fields: { id: { k: 'ref', of: 'any' }, color: { k: 'color', opt: true }, opacity: OPACITY, at: AT, dur: DUR },
  },
  {
    name: 'highlight', op: 'highlight',
    doc: 'Pulse an object or mark to draw the eye, optionally in a colour.',
    fields: { id: { k: 'ref', of: 'any' }, color: { k: 'color', opt: true }, at: AT, dur: DUR },
  },
  {
    name: 'spin', op: 'spin',
    doc: 'Make a part turn round its own axis and keep turning, until another spin on it says otherwise. rpm is turns a minute (negative the other way; 0 stops; dur is the time to get up to speed). Or give by, another part that drives it: it then turns ratio times as far as that part (0.5 half as fast, -1 a meshed gear) and phase degrees ahead. axis is x, y or z, default z (the axis of a crankshaft, camshaft, gear and bearing; use y for a fan).',
    fields: {
      id: { k: 'ref', of: 'object3d' }, rpm: { k: 'num', min: -600, max: 600, opt: true },
      by: { k: 'ref', of: 'object3d', opt: true, doc: 'the part that drives this one' },
      ratio: { k: 'num', min: -20, max: 20, opt: true, doc: 'with by: turns per turn of that part (default 1)' },
      phase: { k: 'num', min: -3600, max: 3600, opt: true, doc: 'with by: degrees ahead of that part' },
      axis: { k: 'enum', values: ['x', 'y', 'z'], opt: true }, at: AT, dur: DUR,
    },
  },
  {
    name: 'crank', op: 'crank',
    doc: 'Tie a piston to a spinning crankshaft through a connecting rod: the piston slides up and down its cylinder (along y, in the x,y plane) as the crank pin goes round, and the rod swings to join them. Put the three in one group, the crankshaft turning with spin. pin is which throw (1 is the first).',
    fields: {
      id: { k: 'ref', of: 'object3d', doc: 'the piston' }, shaft: { k: 'ref', of: 'object3d', doc: 'the crankshaft' },
      rod: { k: 'ref', of: 'object3d', opt: true, doc: 'the connecting-rod joining them' },
      pin: { k: 'num', min: 1, max: 8, int: true, opt: true }, at: AT,
    },
  },
  {
    name: 'cam', op: 'cam',
    doc: 'A valve (or any follower) that a spinning camshaft pushes down along y: it is down by lift while the cam nose points down at it, and back up otherwise. open is how many degrees of the turn of the cam it stays open (default 110), phase the cam angle where it is most open (default 180: the nose pointing down).',
    fields: {
      id: { k: 'ref', of: 'object3d', doc: 'the valve' }, by: { k: 'ref', of: 'object3d', doc: 'the camshaft' },
      lift: { k: 'num', min: 0.01, max: 50, opt: true, doc: 'how far it moves down in units (default a fifth of its length)' },
      open: { k: 'num', min: 10, max: 350, opt: true }, phase: { k: 'num', min: -3600, max: 3600, opt: true }, at: AT,
    },
  },
  {
    name: 'flash', op: 'flash',
    doc: 'A glow that comes on at one point of the cycle of a turning part: the object (a small sphere for a spark, a larger one for the burn) is invisible, flares to its opacity at the crank angle given and dies away over span degrees. by is the crankshaft; angle is degrees into a cycle of cycle degrees (default 720, a four-stroke engine: 0 is the piston at the top starting the intake, 360 the top of the compression).',
    fields: {
      id: { k: 'ref', of: 'object3d' }, by: { k: 'ref', of: 'object3d', doc: 'the part whose turning times it' },
      angle: { k: 'num', min: 0, max: 3600 }, span: { k: 'num', min: 1, max: 720 },
      cycle: { k: 'num', min: 90, max: 3600, opt: true }, at: AT,
    },
  },
  {
    name: 'cut', op: 'cut',
    doc: 'Cut a 3D object (usually a whole model) open with a plane, so the inside shows: everything beyond the plane is removed and the cut faces are capped. axis is x, y or z (default z, the plane faces the viewer at the front); to is where the plane is along that axis in the object own space (the middle of the object is 0). Move the plane through with another cut; to 100 puts it beyond everything: no cut.',
    fields: { id: { k: 'ref', of: 'object3d' }, axis: { k: 'enum', values: ['x', 'y', 'z'], opt: true }, to: { k: 'num', min: -100, max: 100 }, at: AT, dur: DUR },
  },
  {
    name: 'orbit', op: 'orbit',
    doc: 'Move the camera around what it looks at: az is the angle around (0 faces the front), el the height angle.',
    fields: { az: { k: 'num', min: -360, max: 360 }, el: { k: 'num', min: -89, max: 89 }, at: AT, dur: DUR },
  },
  {
    name: 'zoom', op: 'zoom',
    doc: 'Camera distance factor: 1 is the default framing, 2 is twice as close.',
    fields: { to: { k: 'num', min: 0.2, max: 5 }, at: AT, dur: DUR },
  },
  {
    name: 'focus', op: 'focus',
    doc: 'Aim the camera at a 3D object; without id, back at the middle of the stage.',
    fields: { id: { k: 'ref', of: 'object3d', opt: true }, at: AT, dur: DUR },
  },
  {
    name: 'wait', op: 'wait',
    doc: 'Guide mode: once this step has been drawn and spoken, wait for the person to click, and go on to the next step only when the screen has really changed. x,y,w,h is the box (top-left corner and size, on the screenshot) the click should land in; leave it out when it could be anywhere. Draw the target with a mark as well, and give each guide step its own ids.',
    fields: {
      for: { k: 'enum', values: ['click'] },
      x: { k: 'num', ...SCREEN, opt: true }, y: { k: 'num', ...SCREEN, opt: true },
      w: { k: 'num', ...SPAN, opt: true }, h: { k: 'num', ...SPAN, opt: true },
    },
  },
  {
    name: 'clear', op: 'clear',
    doc: 'Remove an object or mark (and what is attached to it), or everything with "all", every mark, card, diagram and pin with "marks", the 3D stage and its objects with "panel".',
    fields: { target: { k: 'target' }, at: AT },
  },
];

export const KNOWN_OPS: readonly string[] = [...new Set(VARIANTS.map((v) => v.op))];
