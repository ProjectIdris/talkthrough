// Offline authoring component. This is deliberately not a model action or a production tool.
// Expand trusted parameters here, then pass the resulting ordinary scene through validateScene.
import type { AddAction, Vec2 } from '../../src/scene/types.ts';
import { RESERVED_IDS } from '../../src/scene/spec.ts';

export type HingeOptions = {
  /** Unique scene namespace, at most 20 characters. The caller owns collision-free prefixes. */
  id: string;
  /** Width of each leaf, 0.8–6 scene units. Default 2.4. */
  width?: number;
  /** Length of the knuckle stack along y, 2–12 scene units. Default 5. */
  height?: number;
  /** Alternating knuckles, integer 3–7. Default 5. */
  knuckles?: number;
  /** Degrees about the pin's y axis: 0 lies flat, 180 folds back. Default 45. */
  fold?: number;
};
export type HingeIds = {
  root: string; fixed: string; moving: string; fixedLeaf: string; movingLeaf: string;
  pin: string; pinHead: string; pinTip: string; knuckles: string[]; necks: string[];
};
export type HingeComponent = { actions: AddAction[]; ids: HingeIds };

function controls(options: HingeOptions): Required<HingeOptions> {
  if (!options || typeof options !== 'object' || Object.getPrototypeOf(options) !== Object.prototype) throw new TypeError('hinge options must be a plain object');
  const fields = Object.getOwnPropertyDescriptors(options);
  for (const key of Reflect.ownKeys(fields)) {
    if (typeof key !== 'string' || !['id', 'width', 'height', 'knuckles', 'fold'].includes(key) || !('value' in fields[key]!)) throw new TypeError('unknown or non-data hinge option');
  }
  const id = fields.id?.value;
  if (typeof id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(id) || (RESERVED_IDS as readonly string[]).includes(id)) throw new TypeError('hinge id must be a non-reserved scene prefix of 1–20 characters');
  const bounded = (name: keyof Omit<HingeOptions, 'id'>, fallback: number, min: number, max: number): number => {
    const n: unknown = fields[name] ? fields[name]!.value : fallback;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max || (name === 'knuckles' && !Number.isInteger(n))) throw new RangeError(`${name} must be ${name === 'knuckles' ? 'an integer' : 'a finite number'} from ${min} to ${max}`);
    return n;
  };
  return { id, width: bounded('width', 2.4, 0.8, 6), height: bounded('height', 5, 2, 12), knuckles: bounded('knuckles', 5, 3, 7), fold: bounded('fold', 45, 0, 180) };
}

/** A fresh, bounded set of ordinary add actions, with no hidden instancing or unaddressable meshes. */
export function hingedPanels(options: HingeOptions): HingeComponent {
  const { id, width, height, knuckles, fold } = controls(options);
  const ids: HingeIds = {
    root: id, fixed: `${id}_fixed`, moving: `${id}_moving`, fixedLeaf: `${id}_fixed_leaf`, movingLeaf: `${id}_moving_leaf`,
    pin: `${id}_pin`, pinHead: `${id}_pin_head`, pinTip: `${id}_pin_tip`,
    knuckles: Array.from({ length: knuckles }, (_, i) => `${id}_knuckle${i + 1}`),
    necks: Array.from({ length: knuckles }, (_, i) => `${id}_neck${i + 1}`),
  };
  // Derive thickness and clearances from the barrel radius, including short, many-knuckle hinges.
  const r = Math.min(width * 0.12, height / (knuckles * 4));
  const pitch = height / knuckles, length = pitch * 0.94, thickness = r * 0.65;
  const fixedColor = '#a8b7c8', movingColor = '#68bcb3';
  const actions: AddAction[] = [
    { op: 'add', shape: 'group', id: ids.root },
    { op: 'add', shape: 'group', id: ids.fixed, parent: ids.root },
    { op: 'add', shape: 'group', id: ids.moving, parent: ids.root, rot: [0, fold, 0] },
  ];
  // Corner radius and edge bevel are separate: a thin plate still has a legible, rounded silhouette.
  const leafHeight = height * 0.96, corner = Math.min(width, leafHeight) * 0.12;
  const outline: Vec2[] = [];
  for (let q = 0; q < 4; q++) {
    const angle = q * Math.PI / 2;
    const cx = (q === 0 || q === 3 ? 1 : -1) * (width / 2 - corner);
    const cy = (q < 2 ? 1 : -1) * (leafHeight / 2 - corner);
    for (let k = 0; k <= 5; k++) {
      const a = angle + k * Math.PI / 10;
      outline.push([cx + corner * Math.cos(a), cy + corner * Math.sin(a)]);
    }
  }
  // Both leaves sit in front of the pin. Positive y rotation then folds away from the fixed leaf.
  for (const moving of [false, true]) {
    actions.push({ op: 'add', shape: 'extrude', id: moving ? ids.movingLeaf : ids.fixedLeaf, parent: moving ? ids.moving : ids.fixed,
      outline: outline.map(([x, y]) => [x, y]), depth: thickness, pos: [(moving ? 1 : -1) * (width / 2 + r * 0.95), 0, r * 0.85],
      bevel: thickness * 0.18, material: 'metal', color: moving ? movingColor : fixedColor, edges: false });
  }
  for (let i = 0; i < knuckles; i++) {
    const moving = i % 2 === 1, parent = moving ? ids.moving : ids.fixed, color = moving ? movingColor : fixedColor;
    const y = -height / 2 + pitch * (i + 0.5), half = length / 2, b = r * 0.09;
    // Turned lips and a small inner chamfer catch light without closing the real bore.
    const profile: Vec2[] = [
      [r * 0.62, -half + b], [r * 0.68, -half], [r * 0.91, -half],
      [r * 0.975, -half + b * 0.35], [r, -half + b],
      [r, half - b], [r * 0.975, half - b * 0.35], [r * 0.91, half],
      [r * 0.68, half], [r * 0.62, half - b], [r * 0.62, -half + b],
    ];
    actions.push({ op: 'add', shape: 'lathe', id: ids.knuckles[i]!, parent, profile, sides: 64, pos: [0, y, 0], material: 'metal', color, edges: false });
    // Flared shoulders cover more of the sleeve, but leave clearance from the bore and adjacent knuckles.
    const sign = moving ? 1 : -1;
    const neck: Vec2[] = [[-0.375, -0.35], [0.375, -0.46], [0.375, 0.46], [-0.375, 0.35]];
    actions.push({ op: 'add', shape: 'extrude', id: ids.necks[i]!, parent,
      outline: neck.map(([x, py]) => [sign * x * r, py * length]), depth: thickness,
      pos: [sign * r * 0.825, y, r * 0.85], bevel: thickness * 0.12, material: 'metal', color, edges: false });
  }
  // Separate turned caps remain children of the removable shaft. The shoulder and low crown replace bulbous discs.
  const cap: Vec2[] = [[0, -0.13], [0.56, -0.13], [0.56, -0.07], [0.77, -0.07],
    [0.82, -0.02], [0.82, 0.10], [0.78, 0.16], [0.66, 0.20], [0.40, 0.23], [0, 0.24]];
  actions.push(
    { op: 'add', shape: 'cylinder', id: ids.pin, parent: ids.root, size: [r * 1.1, height + r * 0.12, r * 1.1], material: 'metal', color: '#d5dce6', edges: false },
    { op: 'add', shape: 'lathe', id: ids.pinHead, parent: ids.pin, profile: cap.map(([x, y]) => [x * r, y * r]), sides: 64,
      pos: [0, height / 2 + r * 0.04, 0], material: 'metal', color: '#d5dce6', edges: false },
    { op: 'add', shape: 'lathe', id: ids.pinTip, parent: ids.pin, profile: cap.map(([x, y]) => [x * r, y * r]), sides: 64, rot: [180, 0, 0],
      pos: [0, -height / 2 - r * 0.04, 0], material: 'metal', color: '#d5dce6', edges: false },
  );
  return { actions, ids };
}
