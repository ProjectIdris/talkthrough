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
} as const;

export type ObjectKind = 'mark' | 'solid' | 'path' | 'text' | 'group';

/** One field of an action. `opt` fields may be missing or null. */
export type Field =
  | { k: 'num'; min: number; max: number; opt?: boolean; doc?: string }
  | { k: 'str'; min: number; max: number; opt?: boolean; doc?: string }
  | { k: 'color'; opt?: boolean; doc?: string }
  | { k: 'newId'; doc?: string }
  /** An existing id. `of` limits which kinds it may name. */
  | { k: 'ref'; of: 'any' | 'object3d'; opt?: boolean; doc?: string }
  | { k: 'parent'; opt?: boolean; doc?: string }
  /** An id, or one of the reserved clear targets. */
  | { k: 'target'; doc?: string }
  | { k: 'vec3'; min: number; max: number; opt?: boolean; doc?: string }
  | { k: 'pts'; min: number; max: number; lo: number; hi: number; doc?: string }
  | { k: 'enum'; values: readonly string[]; doc?: string };

export type Variant = {
  /** Unique name of this variant. */
  name: string;
  op: string;
  /** For `add`: the shapes this variant covers. */
  shapes?: readonly string[];
  /** The kind of object it creates, if it creates one. */
  creates?: ObjectKind;
  doc: string;
  fields: Record<string, Field>;
};

const SCREEN = { min: 0, max: 1000 } as const;
const SPAN = { min: 1, max: 1000 } as const;
const WORLD = { min: -100, max: 100 } as const;
const AT: Field = { k: 'num', min: 0, max: 60, opt: true, doc: 'seconds after the step starts' };
const DUR: Field = { k: 'num', min: 0, max: 30, opt: true, doc: 'seconds the change takes (default 0.6)' };
const COLOR: Field = { k: 'color' };
const OPACITY: Field = { k: 'num', min: 0, max: 1, opt: true };
const PARENT: Field = { k: 'parent', opt: true, doc: 'id of a group to attach to' };
const POS: Field = { k: 'vec3', ...WORLD, opt: true, doc: '[x,y,z], default [0,0,0]' };
const ROT: Field = { k: 'vec3', min: -3600, max: 3600, opt: true, doc: 'degrees [x,y,z]' };

export const SOLID_SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'plane'] as const;

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
    name: 'panel', op: 'panel',
    doc: 'The 3D panel: a rectangle on the screenshot where 3D objects are drawn. Sent again, it moves or resizes.',
    fields: { x: { k: 'num', ...SCREEN }, y: { k: 'num', ...SCREEN }, w: { k: 'num', ...SPAN }, h: { k: 'num', ...SPAN }, at: AT, dur: DUR },
  },
  {
    name: 'addSolid', op: 'add', shapes: SOLID_SHAPES, creates: 'solid',
    doc: 'A solid in the panel. size is its bounding box [x,y,z]: cylinder and cone stand on y with diameter x, torus lies flat with outer diameter x and tube thickness y, plane faces +z and ignores z.',
    fields: {
      shape: { k: 'enum', values: SOLID_SHAPES }, id: { k: 'newId' }, parent: PARENT, pos: POS,
      size: { k: 'vec3', min: 0.01, max: 100 }, rot: ROT, color: COLOR, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addPath', op: 'add', shapes: ['line', 'arrow'], creates: 'path',
    doc: 'A line through the points, or an arrow from the first to the last point.',
    fields: {
      shape: { k: 'enum', values: ['line', 'arrow'] }, id: { k: 'newId' }, parent: PARENT,
      pts: { k: 'pts', min: 2, max: LIMITS.maxPts, lo: WORLD.min, hi: WORLD.max }, color: COLOR, opacity: OPACITY, at: AT,
    },
  },
  {
    name: 'addText', op: 'add', shapes: ['text'], creates: 'text',
    doc: 'Text in the panel that always faces the camera; height is in panel units.',
    fields: {
      shape: { k: 'enum', values: ['text'] }, id: { k: 'newId' }, parent: PARENT, pos: POS,
      text: { k: 'str', min: 1, max: LIMITS.maxText }, height: { k: 'num', min: 0.05, max: 50 }, color: COLOR, at: AT,
    },
  },
  {
    name: 'addGroup', op: 'add', shapes: ['group'], creates: 'group',
    doc: 'An empty node to move, turn and scale other objects together (attach them with parent).',
    fields: { shape: { k: 'enum', values: ['group'] }, id: { k: 'newId' }, parent: PARENT, pos: POS, rot: ROT, at: AT },
  },
  {
    name: 'move', op: 'move',
    doc: 'Move a 3D object to an absolute position.',
    fields: { id: { k: 'ref', of: 'object3d' }, to: { k: 'vec3', ...WORLD }, at: AT, dur: DUR },
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
    doc: 'Aim the camera at a 3D object; without id, back at the middle of the panel.',
    fields: { id: { k: 'ref', of: 'object3d', opt: true }, at: AT, dur: DUR },
  },
  {
    name: 'clear', op: 'clear',
    doc: 'Remove an object or mark (and what is attached to it), or everything with "all", every mark with "marks", the panel and its objects with "panel".',
    fields: { target: { k: 'target' }, at: AT },
  },
];

export const KNOWN_OPS: readonly string[] = [...new Set(VARIANTS.map((v) => v.op))];
