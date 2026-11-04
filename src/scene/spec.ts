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
  /** Copies one `array` may make, and the copies all arrays may make together in a scene. */
  maxArray: 64,
  maxCopies: 400,
  /** Rows of a note card. */
  maxRows: 6,
} as const;

/** `pin` is a label pinned to a 3D object: it lives on the screen but goes with its object. */
export type ObjectKind = 'mark' | 'pin' | 'solid' | 'path' | 'text' | 'group';

/** One field of an action. `opt` fields may be missing or null. */
export type Field =
  | { k: 'num'; min: number; max: number; int?: boolean; opt?: boolean; doc?: string }
  | { k: 'bool'; opt?: boolean; doc?: string }
  | { k: 'str'; min: number; max: number; opt?: boolean; doc?: string }
  | { k: 'color'; opt?: boolean; doc?: string }
  | { k: 'newId'; doc?: string }
  /** An existing id. `of` limits which kinds it may name. */
  | { k: 'ref'; of: 'any' | 'object3d'; opt?: boolean; doc?: string }
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
export const PARTS = ['chip', 'header', 'port', 'lens', 'screen', 'button', 'fan', 'wheel'] as const;
export const PART_VARIANTS = ['black', 'metal', 'usb', 'usb3', 'ethernet', 'hdmi', 'usbc', 'gold'] as const;

export const VARIANTS: readonly Variant[] = [
  {
    name: 'box', op: 'box', creates: 'mark',
    doc: 'Rectangle outline on the screenshot; x,y is the top-left corner.',
    fields: { id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', ...SPAN }, h: { k: 'num', ...SPAN }, color: COLOR, at: AT },
  },
  {
    name: 'circle', op: 'circle', creates: 'mark',
    doc: 'Circle or oval outline drawn inside the box x,y,w,h (x,y is the top-left corner).',
    fields: { id: { k: 'newId' }, x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', ...SPAN }, h: { k: 'num', ...SPAN }, color: COLOR, at: AT },
  },
  {
    name: 'underline', op: 'underline', creates: 'mark',
    doc: 'Line under text; x,y is its left end, w its length.',
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
    doc: 'A ready-made part fitted to the box size [x,y,z]: chip (variant black or metal), header (n pins per row, two rows), port (variant usb, usb3, ethernet, hdmi, usbc; its opening faces +z), lens, screen, button, fan (n blades, axis y), wheel (n spokes, axis z).',
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
      id: { k: 'newId' }, on: { k: 'ref', of: 'object3d' }, point: POS, text: { k: 'str', min: 1, max: 40 },
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
    name: 'clear', op: 'clear',
    doc: 'Remove an object or mark (and what is attached to it), or everything with "all", every mark, card and pin with "marks", the 3D stage and its objects with "panel".',
    fields: { target: { k: 'target' }, at: AT },
  },
];

export const KNOWN_OPS: readonly string[] = [...new Set(VARIANTS.map((v) => v.op))];
