// Living things in the scene, drawn as living things. The scene language writes a soft subject as it writes anything: a blob of lumps, balls, rounded
// cylinders, a spun profile, thick tubes, each its own object with its own colour and material. Drawn one by one they are a toy: perfect ellipsoids stuck
// together. Here the soft solids of a frame are read as bodies. Solids of the same kind of tissue that touch and stand together become one field
// (organic-field.ts) and one skin (organic-mesh.ts), with a fillet where a finger leaves a palm or a vessel a chamber; each object keeps the patch of that
// skin that is its own, in its own node, so its colour, opacity, pins, highlight, cut and place work as before, and colours run into one another across a
// join. A body is cut as its parts stand at rest; when a machine moves one of them (a ventricle squeezing, a jaw opening) the skin near the join follows
// both parts, so the body stays one. The same field says what is under the skin: a cut through a body shows a face in layers (skin, flesh, what lies
// deeper: materials.ts has a row for each material), and a hollow part (a vessel, a see-through sac) shows its wall and the lining of its cavity.
// Nothing is added to the scene language: this is how its existing shapes are drawn.

import { BufferAttribute, BufferGeometry, Color, DoubleSide, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three';
import type { Material, Object3D, Plane } from 'three';
import type { AddAction, Vec2, Vec3 } from '../scene/types.ts';
import { fitTint, materialRow } from '../scene/material-library.ts';
import { BodyField, lumpReach, outlineDistance, primBounds, primDistance, primInside, tubeOf } from './organic-field.ts';
import type { FieldPart, Prim } from './organic-field.ts';
import { cutFace, cutSkinSteps, patches } from './organic-mesh.ts';
import type { Face, Patch, Skin } from './organic-mesh.ts';
import { samplePath, softBevel, swellAt } from './geometry.ts';
import { easeOutline } from './organic-sheet.ts';
import { treatmentOf } from './surface-treatment.ts';
import { TIERS, fitSection, hatched, insideOf, makeSectionSurface, makeSurface, sectionTone, setSurfaceOpacity } from './materials.ts';
import type { SectionSurface, Surface } from './materials.ts';
import type { Frame, ObjectFrame, Rgb } from './timeline.ts';

type Piece = { object: Object3D; surface: (Material & { vertexColors: boolean; color: Color; userData: { name?: string } }) | undefined; lines: { visible: boolean } | undefined; organic?: boolean; fused?: boolean };

/** What this needs to know of a drawn object (scene3d's node). */
export type OrganicNode = {
  obj: Object3D;
  pieces: Piece[];
  /** A tube's own drawn geometry, which the flow code keeps current. */
  path?: { geo: BufferGeometry } | undefined;
};

/**
 * The triangles one body's skin is aimed at, by tier (a body with thin parts is cut finer, never to more than twice this), and the most that the skins of
 * all the bodies of a scene have together: a ceiling, held whatever the scene (in a crowded one every body gets less).
 */
export const BODY_TRIANGLES = { low: 9_000, mid: 26_000, high: 60_000 } as const;
export const SCENE_BODY_TRIANGLES = { low: 40_000, mid: 110_000, high: 220_000 } as const;
/** A small body is aimed at no fewer triangles than this, while the scene has room for it. */
const BODY_FLOOR = 1_500;
/**
 * A skin may come out this many times what it was reckoned at (the reckoning is by a box round each part) while the scene has room; when all the
 * bodies' reckonings times this would pass the scene's ceiling, the room each has is what the ceiling leaves.
 */
const SKIN_ROOM = 2.5;
/** Skins are kept a little while after their last use; never more of them than this many times the scene's triangles (the oldest go first). */
export const KEPT_SKINS = 3;
/** A tube of living material at least this thick shows what runs in it through its wall; a thinner one carries its flow as beads, as a pipe does. */
export const FLOW_BORE = 0.15;

const SOFT_FAMILIES: ReadonlySet<string> = new Set(['body', 'plant', 'food']);
/** Soft tissues grow into one another whatever they are called; anything else joins only its own kind. */
const FLESH: ReadonlySet<string> = new Set(['tissue', 'muscle', 'skin', 'fat', 'organ', 'vessel', 'mucosa', 'nerve']);
/** Stiff things meet with a crease, not a swelling join. */
const STIFF: ReadonlySet<string> = new Set(['bone', 'tooth', 'cartilage', 'bark', 'tendon', 'hair']);

/** The thinnest a lump may be, as a share of its widest side (as blob.ts has it). */
const MIN_THICKNESS = 0.2;

type Kind = { prim: Prim; cls: string; soft: number; thin: number; material: string | undefined; living: boolean };

const defWords = new WeakMap<object, string>();
/**
 * A short word for what a definition says, the same for two definitions that say the same: a scene laid out anew (a seek does it for every frame) is the
 * same bodies, and finds the skins already cut for them.
 */
const idOf = (def: object): string => {
  let word = defWords.get(def);
  if (word === undefined) {
    const text = JSON.stringify(def);
    let h = 2166136261;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    word = `${(h >>> 0).toString(36)}${text.length.toString(36)}`;
    defWords.set(def, word);
  }
  return word;
};

/** The ways out from a part's middle along which its skin is tried, to tell whether it lies inside another: the six axes and the eight diagonals. */
const ENCLOSED_WAYS: readonly Vec3[] = (() => {
  const ways: Vec3[] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const r = Math.sqrt(1 / 3);
  for (const x of [-r, r]) for (const y of [-r, r]) for (const z of [-r, r]) ways.push([x, y, z]);
  return ways;
})();

/** Points well inside a solid from which its skin is tried: its middle, and for a long or lumpy one the middles along it (at most eight). */
function middlesOf(prim: Prim): Vec3[] {
  if (prim.kind === 'tube') {
    const n = prim.pts.length, step = Math.max(1, Math.ceil(n / 8));
    const out: Vec3[] = [];
    for (let i = 0; i < n; i += step) out.push(prim.pts[i] as Vec3);
    if ((n - 1) % step !== 0) out.push(prim.pts[n - 1] as Vec3);
    return out;
  }
  if (prim.kind === 'lumps' && prim.lumps.length > 1) return prim.lumps.slice(0, 8).map((lump) => lump.c);
  return [primInside(prim)];
}

/** Flat parts lie in one plane when their faces are this nearly parallel (the cosine of the angle between them). */
const PLANE_PARALLEL = 0.985;
/** A flat part joins another in their plane over this share of its narrower side. */
const FLAT_JOIN = 0.45;

/**
 * The flat parts of a body (pads and slabs) that lie in one plane with another are told so (`FieldPart.flat`): the field joins those as outlines in
 * the plane. Returns the planes' normals.
 */
function flatPlanes(parts: FieldPart[]): Vec3[] {
  type Flat = { part: FieldPart; n: Vec3; centre: Vec3; half: number; rim: number; reach: number };
  const flats: Flat[] = [];
  for (const part of parts) {
    const prim = part.prim;
    if (prim.kind !== 'pad' && prim.kind !== 'slab') continue;
    // The thin axis in the body's space: a row of the body-to-part matrix, and where the part's own origin (the middle of its thickness) stands.
    const m = part.toLocal, row = prim.kind === 'pad' ? prim.thin : 2;
    const nx = m[row * 4] as number, ny = m[row * 4 + 1] as number, nz = m[row * 4 + 2] as number;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) continue;
    // (the part's origin in body space: the point the matrix takes to zero; solved from the three rows, which are at right angles to one another)
    const centre: Vec3 = [0, 0, 0];
    for (let r = 0; r < 3; r++) {
      const ax = m[r * 4] as number, ay = m[r * 4 + 1] as number, az = m[r * 4 + 2] as number, t = m[r * 4 + 3] as number;
      const a2 = ax * ax + ay * ay + az * az;
      centre[0] -= (ax * t) / a2; centre[1] -= (ay * t) / a2; centre[2] -= (az * t) / a2;
    }
    let narrow: number, half: number;
    if (prim.kind === 'pad') {
      half = prim.half[prim.thin];
      narrow = 2 * Math.min(...prim.half.filter((_, a) => a !== prim.thin));
    } else {
      half = prim.half;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of prim.outline) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      narrow = Math.min(x1 - x0, y1 - y0);
    }
    flats.push({ part, n: [nx / l, ny / l, nz / l], centre, half: half * part.scale, rim: prim.rim * part.scale, reach: FLAT_JOIN * narrow * part.scale });
  }
  const planes: Vec3[] = [];
  const plane = flats.map(() => -1);
  for (let i = 0; i < flats.length; i++) {
    const a = flats[i] as Flat;
    for (let j = i + 1; j < flats.length; j++) {
      const b = flats[j] as Flat;
      const dot = a.n[0] * b.n[0] + a.n[1] * b.n[1] + a.n[2] * b.n[2];
      if (Math.abs(dot) < PLANE_PARALLEL) continue;
      // In one plane: the middle of one lies within the other's thickness, and their boxes come within a join of each other.
      const apart = Math.abs((b.centre[0] - a.centre[0]) * a.n[0] + (b.centre[1] - a.centre[1]) * a.n[1] + (b.centre[2] - a.centre[2]) * a.n[2]);
      if (apart > 0.6 * Math.max(a.half, b.half)) continue;
      const k = Math.min(a.reach, b.reach);
      let near = true;
      for (let c = 0; c < 3; c++) if (a.part.lo[c]! - k > b.part.hi[c]! || b.part.lo[c]! - k > a.part.hi[c]!) near = false;
      if (!near) continue;
      if (plane[i] === -1 && plane[j] === -1) { plane[i] = plane[j] = planes.length; planes.push(a.n); }
      else if (plane[i] === -1) plane[i] = plane[j] as number;
      else if (plane[j] === -1) plane[j] = plane[i] as number;
      else if (plane[i] !== plane[j]) { const gone = plane[j] as number, kept = plane[i] as number; for (let q = 0; q < plane.length; q++) if (plane[q] === gone) plane[q] = kept; }
    }
  }
  flats.forEach((f, i) => {
    const g = plane[i] as number;
    if (g < 0) return;
    const n = planes[g] as Vec3;
    f.part.flat = { plane: g, mid: f.centre[0] * n[0] + f.centre[1] * n[1] + f.centre[2] * n[2], half: f.half, rim: f.rim, reach: f.reach };
    // (a join in the plane can carry the skin a little way out of the part's own box)
    for (let c = 0; c < 3; c++) { f.part.lo[c] = (f.part.lo[c] as number) - f.reach / 4; f.part.hi[c] = (f.part.hi[c] as number) + f.reach / 4; }
  });
  return planes;
}

/** A limb is pressed by a flat part when it lies this nearly in the part's plane (the sine of the angle it may make with it). */
const PRESS_IN_PLANE = 0.35;

/**
 * A limb (a tube) that grows out of a flat part of its body, in the part's plane, and is thicker than the part is told so (`FieldPart.pressed`): a round
 * wrist written under a flat palm is no thicker than the palm where the two lie together. A flat part is a pad, a slab, or lumps whose box is at most
 * half as thick as it is wide either way.
 */
function pressLimbs(parts: FieldPart[]): void {
  type Flat = { part: FieldPart; n: Vec3; mid: number; half: number };
  const flats: Flat[] = [];
  for (const part of parts) {
    const prim = part.prim;
    let axis = -1, half = 0, off = 0;
    if (prim.kind === 'pad') { axis = prim.thin; half = prim.half[prim.thin]; }
    else if (prim.kind === 'slab') { axis = 2; half = prim.half; }
    else if (prim.kind === 'lumps') {
      const b = primBounds(prim);
      const size = [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
      axis = size[0]! <= size[1]! && size[0]! <= size[2]! ? 0 : size[1]! <= size[2]! ? 1 : 2;
      if (size[axis]! > 0.5 * Math.min(...size.filter((_, a) => a !== axis))) continue;
      half = size[axis]! / 2; off = (b.lo[axis]! + b.hi[axis]!) / 2;
    } else continue;
    // The thin axis in the body's space is a row of the body-to-part matrix; along it, the part's own coordinate is the row applied to the point.
    const m = part.toLocal;
    const nx = m[axis * 4] as number, ny = m[axis * 4 + 1] as number, nz = m[axis * 4 + 2] as number, t = m[axis * 4 + 3] as number;
    const l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-9)) continue;
    // own coordinate = (n . x) * l + t, and the middle is where that is `off`
    flats.push({ part, n: [nx / l, ny / l, nz / l], mid: (off - t) / l, half: half / l });
  }
  if (flats.length === 0) return;
  for (const part of parts) {
    const prim = part.prim;
    if (prim.kind !== 'tube' || prim.pts.length < 2) continue;
    // The tube's ends in the body's space (the inverse of the body-to-part matrix, whose rows are at right angles).
    const m = part.toLocal;
    const out = (q: Vec3): Vec3 => {
      const p: Vec3 = [0, 0, 0];
      for (let r = 0; r < 3; r++) {
        const ax = m[r * 4] as number, ay = m[r * 4 + 1] as number, az = m[r * 4 + 2] as number, t = m[r * 4 + 3] as number;
        const a2 = ax * ax + ay * ay + az * az, v = (q[r] as number) - t;
        p[0] += (ax * v) / a2; p[1] += (ay * v) / a2; p[2] += (az * v) / a2;
      }
      return p;
    };
    const first = out(prim.pts[0] as Vec3), last = out(prim.pts[prim.pts.length - 1] as Vec3);
    const dx = last[0] - first[0], dy = last[1] - first[1], dz = last[2] - first[2];
    const length = Math.hypot(dx, dy, dz);
    if (!(length > 1e-9)) continue;
    const radius = Math.max(prim.radii[0] as number, prim.radii[prim.radii.length - 1] as number) * part.scale;
    let best: Flat | undefined;
    for (const flat of flats) {
      if (flat.part === part || radius <= 1.05 * flat.half) continue;
      if (Math.abs((dx * flat.n[0] + dy * flat.n[1] + dz * flat.n[2]) / length) > PRESS_IN_PLANE) continue;
      // one of its ends is in the flat part
      const fm = flat.part.toLocal;
      const within = (p: Vec3): boolean => primDistance(flat.part.prim, fm[0]! * p[0] + fm[1]! * p[1] + fm[2]! * p[2] + fm[3]!, fm[4]! * p[0] + fm[5]! * p[1] + fm[6]! * p[2] + fm[7]!, fm[8]! * p[0] + fm[9]! * p[1] + fm[10]! * p[2] + fm[11]!) < 0;
      const end = within(first) ? first : within(last) ? last : undefined;
      if (!end) continue;
      // How thick the flat part is where the limb leaves it (lumps are thinner than their box): from the middle of its thickness out to its face.
      const h = (end[0] * flat.n[0] + end[1] * flat.n[1] + end[2] * flat.n[2]) - flat.mid;
      const foot: Vec3 = [end[0] - h * flat.n[0], end[1] - h * flat.n[1], end[2] - h * flat.n[2]];
      let half = flat.half;
      if (flat.part.prim.kind === 'lumps' && within(foot)) {
        let lo = 0, hi = flat.half * 1.01;
        for (let step = 0; step < 14; step++) {
          const t = (lo + hi) / 2;
          if (within([foot[0] + t * flat.n[0], foot[1] + t * flat.n[1], foot[2] + t * flat.n[2]])) lo = t; else hi = t;
        }
        half = (lo + hi) / 2;
      }
      if (radius <= 1.05 * half) continue;
      if (!best || half < best.half) best = { ...flat, half };
    }
    if (best) part.pressed = { of: best.part, n: best.n, mid: best.mid, half: best.half };
  }
}

/** A pad's rim is rounded over this share of its thickness (half would be all the way), and its corners by this share of its narrower side. */
const PAD_RIM = 0.44;
const PAD_CORNER = 0.24;
/** A flat outline of flesh at least this thick, as a share of its narrower side, is a slab of a body; thinner, it is a sheet. */
const SLAB_THICK = 0.18;

/** Made of soft tissue (see `FLESH`). */
const isFlesh = (def: AddAction): boolean => {
  const material = 'material' in def ? def.material : undefined;
  return material !== undefined && FLESH.has(material);
};

const kinds = new WeakMap<object, Kind | null>();

/** The soft solid a definition is, or nothing when it is drawn the ordinary way. */
export function organicKind(def: AddAction): Kind | null {
  const known = kinds.get(def);
  if (known !== undefined) return known;
  const made = readKind(def);
  kinds.set(def, made);
  return made;
}

/** A tube of the body wide enough to show what runs in it: a stream along it is drawn inside it, through its wall (scene3d-flow.ts), and it is hollow. */
export function carriesFlow(def: AddAction): boolean {
  if (def.shape !== 'tube' || def.closed || (def.flat ?? 1) < 0.9 || def.radius < FLOW_BORE) return false;
  return materialRow('material' in def ? def.material : undefined)?.family === 'body';
}

function readKind(def: AddAction): Kind | null {
  const material = 'material' in def ? def.material : undefined;
  const family = materialRow(material)?.family;
  const soft = family !== undefined && SOFT_FAMILIES.has(family);
  if (def.shape === 'shell' || (def.shape !== 'blob' && !soft)) return null;
  // A tube that wears a layer laid along its own rings (the fibres of a muscle or a tendon: surface-treatment.ts) stays the swept tube that layer is made for.
  if (def.shape === 'tube' && treatmentOf(def)) return null;
  const cls = material && FLESH.has(material) ? 'flesh' : `m:${material ?? ''}`;
  const give = material && STIFF.has(material) ? 0.07 : 0.3;
  const prim = primOf(def);
  if (!prim) return null;
  const b = primBounds(prim);
  let thin = Math.min(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
  if (prim.kind === 'tube') thin = Math.min(...prim.radii) * 2;
  if (prim.kind === 'lumps') for (const l of prim.lumps) thin = Math.min(thin, 2 * Math.min(l.r[0], l.r[1], l.r[2]));
  if (!(thin > 0)) return null;
  return { prim, cls, soft: give, thin, material, living: soft };
}

const prims = new WeakMap<object, Prim | null>();

/**
 * A closed solid as the field knows it, whatever it is made of (a ball of wood as much as a ball of flesh), or nothing when a shape has no inside the field
 * can tell. What sits inside a living body leaves its shape in the body's cut face: a stone in a peach, a bone in a limb.
 */
export function solidOf(def: AddAction): Prim | null {
  let prim = prims.get(def);
  if (prim === undefined) { prim = primOf(def); prims.set(def, prim); }
  return prim;
}

function primOf(def: AddAction): Prim | null {
  let prim: Prim | undefined;
  switch (def.shape) {
    case 'shell': {
      // A whole shell fills its outer ellipsoid (what is inside it is its own affair); an open one (a cup, a dome) has no inside.
      if (def.sweep != null || (def.latitude && (def.latitude[0] > -89 || def.latitude[1] < 89))) return null;
      const s = def.size;
      prim = { kind: 'lumps', lumps: [{ c: [0, 0, 0], r: [Math.max(1e-3, s[0] / 2), Math.max(1e-3, s[1] / 2), Math.max(1e-3, s[2] / 2)] }], reach: 1 };
      break;
    }
    case 'blob': {
      const lumps = def.pts.map((c, i) => {
        const s = (def.sizes[Math.min(i, def.sizes.length - 1)] ?? [1, 1, 1]) as Vec3;
        const floor = Math.max(1e-3, (Math.max(s[0], s[1], s[2]) / 2) * MIN_THICKNESS);
        return { c, r: [Math.max(floor, s[0] / 2), Math.max(floor, s[1] / 2), Math.max(floor, s[2] / 2)] as Vec3 };
      });
      if (lumps.length === 0) return null;
      prim = { kind: 'lumps', lumps, reach: lumpReach(def.soft ?? 0.5) };
      break;
    }
    case 'sphere': {
      const s = def.size;
      const floor = Math.max(1e-3, Math.max(s[0], s[1], s[2]) * 0.02);
      prim = { kind: 'lumps', lumps: [{ c: [0, 0, 0], r: [Math.max(floor, s[0] / 2), Math.max(floor, s[1] / 2), Math.max(floor, s[2] / 2)] }], reach: 1 };
      break;
    }
    case 'cylinder': {
      const [sx, sy, sz] = def.size;
      const r = Math.max(1e-4, sx / 2), half = Math.max(1e-4, sy / 2);
      prim = { kind: 'cylinder', r, half, round: Math.min(r, half) * 0.7, depth: Math.max(0.05, sz / Math.max(sx, 1e-6)) };
      break;
    }
    case 'cone': {
      const [sx, sy, sz] = def.size;
      const r = Math.max(1e-4, sx / 2), half = Math.max(1e-4, sy / 2);
      const family = materialRow('material' in def ? def.material : undefined)?.family;
      const rounded = family !== undefined && SOFT_FAMILIES.has(family);
      prim = { kind: 'cone', r, half, depth: Math.max(0.05, sz / Math.max(sx, 1e-6)), rounded };
      break;
    }
    case 'box': {
      const s = def.size;
      const least = Math.min(s[0], s[1], s[2]);
      const bevel = Math.max(0, Math.min(def.bevel ?? softBevel(s), least * 0.4999));
      if (isFlesh(def) && least > 0) {
        // A box of flesh is a pad (a palm, a sole, the heel of a hand): nothing alive has a machined edge. Its rim is rounded nearly all the way over, and
        // its corners, in its own plane, by a quarter of its narrower side.
        const thin = s[0] <= s[1] && s[0] <= s[2] ? 0 : s[1] <= s[2] ? 1 : 2;
        const narrow = Math.min(...s.filter((_, a) => a !== thin));
        const rim = Math.max(bevel, PAD_RIM * least);
        prim = { kind: 'pad', half: [s[0] / 2, s[1] / 2, s[2] / 2], thin, rim, corner: Math.min(narrow * 0.4999, Math.max(rim, bevel, PAD_CORNER * narrow)) };
        break;
      }
      prim = { kind: 'box', half: [s[0] / 2, s[1] / 2, s[2] / 2], round: bevel };
      break;
    }
    case 'extrude': {
      // A flat outline of flesh thick enough to be a part of a body (a palm, a sole, a slice) is a slab of it; a thin one is a sheet (organic-sheet.ts).
      if (!isFlesh(def) || def.holes?.length || def.taper != null || def.shift != null || !(def.depth > 0) || def.outline.length < 3) return null;
      const outline = easeOutline(def.outline, 4);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of outline) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
      const narrow = Math.min(x1 - x0, y1 - y0);
      if (!(narrow > 0) || def.depth < SLAB_THICK * narrow) return null;
      // the deepest point of the outline, on a coarse grid: where the slab is surely inside itself, and how far its rim can be rounded
      let deep = 0, inside: Vec2 = [(x0 + x1) / 2, (y0 + y1) / 2];
      for (let j = 1; j < 12; j++) for (let i = 1; i < 12; i++) {
        const x = x0 + ((x1 - x0) * i) / 12, y = y0 + ((y1 - y0) * j) / 12;
        const d = -outlineDistance(x, y, outline);
        if (d > deep) { deep = d; inside = [x, y]; }
      }
      if (!(deep > 0)) return null;
      prim = { kind: 'slab', outline, half: def.depth / 2, rim: Math.min(PAD_RIM * def.depth, 0.8 * deep), inside };
      break;
    }
    case 'torus': {
      const [sx, sy, sz] = def.size;
      const small = Math.max(0.005, sy / 2);
      prim = { kind: 'torus', big: Math.max(0.005, sx / 2 - small), small, depth: Math.max(0.05, sz / Math.max(sx, 1e-6)) };
      break;
    }
    case 'lathe': {
      if (def.sweep != null) return null;
      const profile = def.profile.map((p): Vec2 => [Math.abs(p[0]), p[1]]);
      const first = profile[0], last = profile[profile.length - 1];
      if (!first || !last || profile.length < 3) return null;
      const loop = first[0] === last[0] && first[1] === last[1];
      if (!loop && !(first[0] === 0 && last[0] === 0)) return null; // an open sheet (a bowl, a nozzle) has no inside
      prim = { kind: 'lathe', profile: easeProfile(profile, loop), closing: false };
      break;
    }
    case 'tube': {
      if (def.closed || (def.flat ?? 1) < 0.9 || def.pts.length < 2) return null;
      prim = limbOf(def);
      break;
    }
    default: return null;
  }
  return prim;
}

/**
 * A limb's joints. A tube of skin through a few points is a finger, a leg or a feeler, and its inner points are where it bends: a point the path turns
 * sharply at is a joint that is bent (an elbow, a knee, the leg of an insect), kept as a corner with a ball to it, and a point on a stretch that runs
 * straight is a joint held straight (a knuckle), a slight swelling with a fold across it. Between the two a point only steers a curve, as every point of
 * a vessel, a stem or a long tail does.
 */
const BEND_DEGREES = 55;
const STRAIGHT_DEGREES = 22;
const JOINT_POINTS = 6;
/** A joint's shape takes at most this share of the way to the next joint, or to the limb's end. */
const JOINT_ROOM = 0.42;
/** A limb is slender: at least this many of its own radii long (a forearm or a stump written through three points has no knuckle in its middle). */
const LIMB_SLENDER = 6;
/** A joint's shape along the limb, in the limb's own radii from the joint: where the path is cut, and how much wider (or, in a fold, narrower) it is there. */
const KNUCKLE: ReadonlyArray<readonly [number, number]> = [[-1.35, 1.008], [-0.85, 1.035], [-0.45, 1.07], [-0.17, 1.05], [0, 0.99], [0.17, 1.05], [0.45, 1.07], [0.85, 1.035], [1.35, 1.008]];
const ELBOW: ReadonlyArray<readonly [number, number]> = [[-1.3, 1.01], [-0.65, 1.07], [0, 1.15], [0.65, 1.07], [1.3, 1.01]];

/** A tube as the field has it: balls along its path. A limb of skin has its joints (see above). */
function limbOf(def: Extract<AddAction, { shape: 'tube' }>): Prim {
  const ctrl = def.pts;
  const n = ctrl.length;
  const joints: Array<'bend' | 'knuckle' | undefined> = ctrl.map(() => undefined);
  let reach = 0;
  for (let k = 1; k < n; k++) reach += Math.hypot(ctrl[k]![0] - ctrl[k - 1]![0], ctrl[k]![1] - ctrl[k - 1]![1], ctrl[k]![2] - ctrl[k - 1]![2]);
  if (n >= 3 && n <= JOINT_POINTS && reach >= LIMB_SLENDER * def.radius && materialRow(def.material)?.name === 'skin') {
    for (let k = 1; k < n - 1; k++) {
      const a = ctrl[k - 1] as Vec3, b = ctrl[k] as Vec3, c = ctrl[k + 1] as Vec3;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - b[0], vy = c[1] - b[1], vz = c[2] - b[2];
      const lu = Math.hypot(ux, uy, uz), lv = Math.hypot(vx, vy, vz);
      if (!(lu > 1e-9) || !(lv > 1e-9)) continue;
      const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uy * vy + uz * vz) / (lu * lv)))) * (180 / Math.PI);
      joints[k] = turn > BEND_DEGREES ? 'bend' : turn < STRAIGHT_DEGREES ? 'knuckle' : undefined;
    }
  }
  // The path: a curve through the points, broken where the limb is bent. Six samples a stretch either way, so a point's place along the path is the same.
  const per = 6;
  let pts: Vec3[] = [];
  let from = 0;
  for (let k = 1; k < n; k++) {
    if (k < n - 1 && joints[k] !== 'bend') continue;
    const run = samplePath(ctrl.slice(from, k + 1), true, per);
    pts = pts.concat(from === 0 ? run : run.slice(1));
    from = k;
  }
  const last = pts.length - 1;
  const radii = pts.map((_, i) => def.radius * (def.swell ? swellAt(def.swell, last > 0 ? i / last : 0) : 1));
  if (!joints.some(Boolean) || pts.length !== (n - 1) * per + 1) return tubeOf(pts, radii);
  // With joints the path is cut again by length: as it was away from them, and closely across each.
  const run: number[] = [0];
  for (let i = 1; i < pts.length; i++) run.push((run[i - 1] as number) + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1], pts[i]![2] - pts[i - 1]![2]));
  const length = run[last] as number;
  const at = (s: number): { p: Vec3; r: number } => {
    let i = 1;
    while (i < last && (run[i] as number) < s) i++;
    const a = run[i - 1] as number, b = run[i] as number;
    const t = b > a ? Math.max(0, Math.min(1, (s - a) / (b - a))) : 0;
    const p = pts[i - 1] as Vec3, q = pts[i] as Vec3;
    return { p: [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t], r: (radii[i - 1] as number) + ((radii[i] as number) - (radii[i - 1] as number)) * t };
  };
  const found = joints.map((kind, k) => (kind ? { kind, s: run[k * per] as number, r: radii[k * per] as number, fit: 1 } : undefined)).filter((j) => j !== undefined);
  // Joints that lie close together (the three of a finger written through five points) are each narrower and slighter, so that the stretch between two
  // of them is a stretch of the limb and not a third swelling.
  for (const j of found) {
    let room = Math.min(j.s, length - j.s);
    for (const other of found) if (other !== j) room = Math.min(room, Math.abs(other.s - j.s));
    const profile = j.kind === 'bend' ? ELBOW : KNUCKLE;
    j.fit = Math.min(1, (JOINT_ROOM * room) / ((profile[profile.length - 1] as readonly [number, number])[0] * j.r));
  }
  const stations: Array<{ s: number; wide: number }> = [];
  for (let i = 0; i <= last; i++) {
    const s = run[i] as number;
    if (i === 0 || i === last || found.every((j) => Math.abs(s - j.s) > 1.5 * j.r * j.fit)) stations.push({ s, wide: 1 });
  }
  for (const j of found) for (const [u, wide] of j.kind === 'bend' ? ELBOW : KNUCKLE) {
    const s = j.s + u * j.r * j.fit;
    if (s > length * 0.01 && s < length * 0.99) stations.push({ s, wide: 1 + (wide - 1) * j.fit });
  }
  stations.sort((a, b) => a.s - b.s);
  const outPts: Vec3[] = [], outRadii: number[] = [];
  let before = -Infinity;
  for (const st of stations) {
    if (st.s - before < length * 1e-4) continue;
    before = st.s;
    const here = at(st.s);
    outPts.push(here.p);
    outRadii.push(here.r * st.wide);
  }
  if (outPts.length < 2) return tubeOf(pts, radii);
  // (the folds are told by how far along the cut path they lie, which is the same length: the stations lie on the old path)
  const creases = found.filter((j) => j.kind === 'knuckle').map((j) => ({ at: j.s, width: 0.24 * j.r }));
  return tubeOf(outPts, outRadii, creases);
}

/**
 * A spun profile of living material is a curve through its points, not the polygon they make (a peach spun from a dozen points is round, not a stack of
 * cones); a sharp corner stays a corner. From pole to pole the curve crosses the axis squarely, as its mirror image on the other side asks.
 */
function easeProfile(profile: readonly Vec2[], loop: boolean): Vec2[] {
  const per = 5;
  if (loop) {
    const ring = easeOutline(profile.slice(0, -1), per);
    return [...ring, [ring[0]![0], ring[0]![1]]];
  }
  const n = profile.length;
  const mirrored: Vec2[] = [...profile];
  for (let i = n - 2; i >= 1; i--) mirrored.push([-profile[i]![0], profile[i]![1]]);
  const eased = easeOutline(mirrored, per).slice(0, (n - 1) * per).map((p): Vec2 => [Math.max(0, p[0]), p[1]]);
  eased[0] = [0, profile[0]![1]];
  eased.push([0, profile[n - 1]![1]]);
  return eased;
}

/** A cut face on a part: its plane's word, whether it was cut coarse (its plane was moving), and the frame its plane last moved in. */
type Cap = { mesh: Mesh; signature: string; hatch: boolean; coarse: boolean; since: number };

/** What is kept for a drawn object from frame to frame. */
type Held = {
  node: OrganicNode;
  mesh: Mesh;
  kind: Kind;
  original: BufferGeometry;
  built: Built | undefined;
  index: number;
  local: string;
  movedAt: number;
  /** Where it stands at rest (its world matrix with every machine's pose left out), as of the last frame. */
  rest: Matrix4;
  color: Rgb;
  caps: Cap[];
  lining: Mesh | undefined;
};

/** A closed solid of the frame, of any material, where it stands at rest. */
type Solid = { key: number; prim: Prim; rest: Matrix4; lo: Vector3; hi: Vector3; centre: Vector3 };
/** A solid that sits inside a body: its shape in the body's own space (negative inside it), and what it is, for telling when it has changed. */
type Inner = { prim: Prim; toLocal: Matrix4; scale: number };

type Member = { o: ObjectFrame; held: Held; kind: Kind; lo: Vector3; hi: Vector3; centre: Vector3; clear: boolean; hollow: boolean; cutKey: string; still: boolean };

type Built = {
  key: string;
  field: BodyField;
  cell: number;
  geometries: BufferGeometry[];
  patches: Patch[];
  /** For each field part, the member (index into the body's members) it came from, and the other way. */
  memberOf: number[];
  partOf: number[];
  /** Each member's own space to the body's, as the body was cut; its thickness in the body's units; whether it is hollow. */
  rel: Matrix4[];
  sizes: number[];
  hollow: boolean[];
  /** It has no skin (the scene could not afford one fine enough for it): its parts are drawn as their own shapes. */
  plain: boolean;
  /** The skin as it was cut (a posed body's vertices are moved from these), and the vertices of each patch that another member has a hold on. */
  restPosition: Float32Array[];
  restNormal: Float32Array[];
  held: Uint32Array[];
  posed: boolean;
  /** The drawn meshes wearing the patches, this frame. */
  wearers: Mesh[];
  lining: { geometries: Array<BufferGeometry | undefined>; patches: Patch[] } | undefined;
  /** The lining while it is being cut. */
  liningSteps: Generator<void, Skin, void> | undefined;
  /** What sits inside it this frame (other solids, wholly within it), and a word for the set. */
  inner: Inner[];
  innerKey: string;
  /** The objects (by key) that sit inside it, where it is living material. */
  innerKeys: number[];
  tints: string;
  linear: number[][];
  triangles: number;
  used: number;
};

type Plan = {
  key: string; rel: Matrix4[]; area: number;
  /** The body's thinnest part and the cell its skin is cut at, in the body's units; the triangles that is reckoned to make, and the most it may make. */
  thin: number; cell: number; reckoned: number; ceiling: number;
};
/** A skin being cut a little each frame, and the frame it was last asked for. */
type Job = { steps: Generator<void, Built, void>; wanted: number };

const SETTLE_MS = 180;
/**
 * The milliseconds of a frame that cutting skins may take when the scene is drawn live, by tier. A large body's skin is then cut over several frames, and
 * its parts are drawn as they were meanwhile; a host that draws single frames (a test, a still) gives no slice and has every skin whole at once.
 */
export const SKIN_SLICE_MS = { low: 4, mid: 6, high: 7 } as const;
/** How much coarser a cut face is while its plane is moving (the camera turning, the control easing open), and the frames of rest after which it is cut fine. */
const FACE_MOVING = 1.5;
const FACE_REST = 8;

export class OrganicBodies {
  private tier: 'low' | 'mid' | 'high';
  private held = new Map<number, Held>();
  private built = new Map<string, Built>();
  private clock = 0;
  private insideLiving = new Set<number>();
  private jobs = new Map<string, Job>();
  /** Whether a part lies inside the others of its body, by what they say and where they stand (see `enclosed`). */
  private enclosedKnown = new Map<string, boolean>();
  private slice: number | undefined;
  private now: () => number;
  /** This frame is one of a live run (the host gave a clock and a slice): cutting stops at `deadline` and goes on in the next frame. */
  private live = false;
  private deadline = Infinity;
  private unfinished = false;
  /** Called when a node's geometry is exchanged (what hangs on the old geometry, a cut's caps, must let go). */
  onSwap: ((node: OrganicNode) => void) | undefined;

  /** `slice`: the milliseconds of a live frame that cutting may take (none: every skin is cut whole at once); `clock`: what it is timed by. */
  constructor(tier: 'low' | 'mid' | 'high', options: { slice?: number | undefined; clock?: () => number } = {}) {
    this.tier = tier;
    this.slice = options.slice;
    this.now = options.clock ?? (() => performance.now());
  }

  /** True while something is still to come in a later frame: a skin or a lining being cut, a cut face waiting to be cut fine. */
  busy(): boolean {
    return this.unfinished;
  }

  /** The triangles the bodies now drawn are made of. */
  triangles(): number {
    let n = 0;
    for (const b of this.built.values()) if (b.used === this.clock) n += b.triangles;
    return n;
  }

  /** True when the object sits inside a living body (a stone in a fruit): its own cut face is then drawn plain, not as a drawing's hatched section. */
  within(key: number): boolean {
    return this.insideLiving.has(key);
  }

  /** The triangles of every skin now kept, worn or not. */
  keptTriangles(): number {
    let n = 0;
    for (const b of this.built.values()) n += b.triangles;
    return n;
  }

  /**
   * Brings the soft solids of a frame in line: which bodies there are, their skins, and each object's patch in its own node. `nodes` are the drawn objects by
   * key, laid out as they stand at rest (no machine's pose) and with their world matrices current. `now` is a steady clock in milliseconds; without it
   * everything is taken as settled.
   */
  update(frame: Frame, nodes: ReadonlyMap<number, OrganicNode>, now?: number): void {
    this.clock++;
    this.live = now !== undefined && this.slice !== undefined;
    this.deadline = this.live ? this.now() + (this.slice as number) : Infinity;
    const byKey = new Map<number, ObjectFrame>();
    const flows = new Set<number>();
    for (const o of frame.objects) {
      byKey.set(o.key, o);
      if (o.shape === 'stream' && o.parentKey !== null) flows.add(o.parentKey);
    }
    const members: Member[] = [];
    const solids: Solid[] = [];
    const exploded = (frame.userExplode ?? 0) > 0;
    const boxOf = (prim: Prim, world: Matrix4): { lo: Vector3; hi: Vector3 } => {
      const b = primBounds(prim);
      const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
      const corner = new Vector3();
      for (const x of [b.lo[0], b.hi[0]]) for (const y of [b.lo[1], b.hi[1]]) for (const z of [b.lo[2], b.hi[2]]) {
        corner.set(x, y, z).applyMatrix4(world);
        lo.min(corner); hi.max(corner);
      }
      return { lo, hi };
    };
    for (const o of frame.objects) {
      const node = nodes.get(o.key);
      if (!node) continue;
      const solid = o.opacity * o.appear * o.fade > 0.003 ? solidOf(o.def) : null;
      if (solid) {
        const rest = (node.pieces[0]?.object ?? node.obj).matrixWorld.clone();
        solids.push({ key: o.key, prim: solid, rest, ...boxOf(solid, rest), centre: new Vector3(...primInside(solid)).applyMatrix4(rest) });
      }
      const kind = organicKind(o.def);
      if (!kind) continue;
      const piece = node.pieces[0];
      const mesh = piece?.object as Mesh | undefined;
      if (!piece || !mesh || !(mesh as { isMesh?: boolean }).isMesh || !piece.surface) continue;
      let held = this.held.get(o.key);
      if (!held || held.mesh !== mesh) {
        if (held) this.strip(held);
        held = { node, mesh, kind, original: mesh.geometry, built: undefined, index: 0, local: '', movedAt: -Infinity, rest: new Matrix4(), color: o.color as Rgb, caps: [], lining: undefined };
        this.held.set(o.key, held);
      }
      held.node = node;
      held.kind = kind;
      held.color = o.color as Rgb;
      // A tube being drawn on, or with a wave running along it, is its own drawn tube until it is whole and still.
      if (o.def.shape === 'tube' && (o.draw < 0.999 || o.wave)) { this.restore(held); continue; }
      // Where it is put, all the way up: a part whose parent is being moved is moving too, and a moving part is a body of its own until it settles.
      let local = '';
      let still = !exploded;
      let cutKey = '';
      for (let p: ObjectFrame | undefined = o; p; p = p.parentKey !== null ? byKey.get(p.parentKey) : undefined) {
        local += `${p.pos}|${p.rot}|${p.scale}|${p.parentKey};`;
        if (p.cut) cutKey += `${p.key},`;
        if (p !== o && p.spread > 0) still = false;
      }
      if (local !== held.local) {
        if (held.local !== '' && now !== undefined) held.movedAt = now;
        held.local = local;
      }
      if (now !== undefined && now - held.movedAt < SETTLE_MS) still = false;
      const flow = flows.has(o.key) && carriesFlow(o.def);
      const clear = o.opacity < 0.98 || flow;
      const hollow = kind.material === 'vessel' || flow || (kind.cls === 'flesh' && clear);
      held.rest.copy(mesh.matrixWorld);
      const { lo, hi } = boxOf(kind.prim, held.rest);
      const centre = new Vector3(...primInside(kind.prim)).applyMatrix4(held.rest);
      members.push({ o, held, kind, lo, hi, centre, clear, hollow, cutKey, still });
    }
    // Objects that are gone let go of what was made for them.
    const live = new Set(members.map((m) => m.o.key));
    for (const key of [...this.held.keys()]) if (!live.has(key) && !nodes.has(key)) this.release(key);

    // Bodies: solids of one kind that touch and stand together.
    const group = members.map((_, i) => i);
    const find = (i: number): number => { while (group[i] !== i) { group[i] = group[group[i] as number] as number; i = group[i] as number; } return i; };
    for (let i = 0; i < members.length; i++) {
      const a = members[i] as Member;
      if (!a.still) continue;
      for (let j = i + 1; j < members.length; j++) {
        const b = members[j] as Member;
        if (!b.still || a.kind.cls !== b.kind.cls || a.cutKey !== b.cutKey) continue;
        if (!touches(a, b)) continue;
        // A see-through part and a solid one are one body only where one grows out of the other (a vessel out of a chamber): what sits inside a
        // see-through part is there to be seen through it, and stays its own.
        if (a.clear !== b.clear && !apart(a, b)) continue;
        group[find(i)] = find(j);
      }
    }
    const bodies = new Map<number, Member[]>();
    members.forEach((m, i) => { const g = find(i); const list = bodies.get(g); if (list) list.push(m); else bodies.set(g, [m]); });
    // A part that lies wholly inside the others (a medulla in a kidney's cortex, a yolk in an egg) has no skin of its own in their body: it is not grown
    // into them, it sits in them. It stays its own body, and the one round it finds it inside (below) and shows it where it is cut.
    for (const [g, list] of [...bodies]) {
      if (list.length < 2) continue;
      const inner = list.filter((m) => this.enclosed(m, list));
      if (inner.length === 0 || inner.length === list.length) continue;
      bodies.set(g, list.filter((m) => !inner.includes(m)));
      for (const m of inner) bodies.set(-1 - m.o.key, [m]);
    }

    // How fine: each body has its share of the scene's triangles by its size.
    let area = 0;
    const areas = new Map<number, number>();
    for (const [g, list] of bodies) {
      // A tube whose ends are held to other parts is drawn by the flow code (it follows them) unless it has grown into a body.
      if (list.length === 1 && (list[0]!.o.def as { attach?: unknown }).attach) { this.restore(list[0]!.held); bodies.delete(g); continue; }
      // A tube on its own, with nothing grown into it and no hollow to show, is already its swept tube: there is nothing for a field to add.
      if (list.length === 1 && list[0]!.o.def.shape === 'tube' && !list[0]!.hollow) { this.restore(list[0]!.held); bodies.delete(g); continue; }
      let a = 0;
      for (const m of list) { const s = new Vector3().subVectors(m.hi, m.lo); a += 0.55 * 2 * (s.x * s.y + s.y * s.z + s.z * s.x); }
      areas.set(g, a);
      area += a;
    }
    this.insideLiving.clear();
    // How fine each body is to be cut: its share of the scene's triangles by its size, a body's own figure at most and a small one's floor at least.
    const plans = new Map<number, Plan>();
    let reckoned = 0;
    for (const [g, list] of bodies) {
      const a = areas.get(g) as number;
      const plan = this.plan(list, a, Math.max(BODY_FLOOR, Math.min(BODY_TRIANGLES[this.tier], SCENE_BODY_TRIANGLES[this.tier] * (a / Math.max(area, 1e-9)))));
      plans.set(g, plan);
      reckoned += plan.reckoned;
    }
    // And the most triangles each skin may have, so that all of them together never pass the scene's ceiling: some room over what it is reckoned at, and
    // in a crowded scene (many bodies, each with its floor) what the ceiling leaves, by steps of a tenth so a body coming or going does not have every
    // skin cut again each time. A skin over its ceiling is cut coarser (see `make`).
    const room = SCENE_BODY_TRIANGLES[this.tier] / Math.max(reckoned, 1);
    const tight = room >= SKIN_ROOM ? 0 : Math.ceil(Math.log(SKIN_ROOM / room) / Math.log(1.1) - 1e-9);
    for (const plan of plans.values()) {
      plan.ceiling = Math.min(2 * BODY_TRIANGLES[this.tier], plan.reckoned * (SKIN_ROOM / 1.1 ** tight));
      plan.key = `${tight}|${plan.key}`;
    }
    for (const [g, list] of bodies) {
      const plan = plans.get(g) as Plan;
      let made = this.built.get(plan.key);
      if (!made) {
        let job = this.jobs.get(plan.key);
        if (!job) { job = { steps: this.make(list, plan), wanted: this.clock }; this.jobs.set(plan.key, job); }
        job.wanted = this.clock;
        made = this.advance(plan.key, job);
      }
      if (!made) { this.wait(list); continue; }
      const body = this.wear(list, made);
      // What sits inside the body: other solids wholly within its box whose middle is in its flesh.
      const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
      const own = new Set<number>();
      for (const m of list) { lo.min(m.lo); hi.max(m.hi); own.add(m.o.key); }
      const world = list[0]!.held.rest, toBody = new Matrix4().copy(world).invert();
      body.inner = [];
      body.innerKeys = [];
      let word = '';
      const p = new Vector3();
      for (const s of solids) {
        if (own.has(s.key) || s.lo.x < lo.x || s.lo.y < lo.y || s.lo.z < lo.z || s.hi.x > hi.x || s.hi.y > hi.y || s.hi.z > hi.z) continue;
        p.copy(s.centre).applyMatrix4(toBody);
        if (!(body.field.value(p.x, p.y, p.z) < 0)) continue;
        const toLocal = new Matrix4().copy(s.rest).invert().multiply(world);
        const e = new Matrix4().copy(toLocal).invert().elements;
        body.inner.push({ prim: s.prim, toLocal, scale: Math.min(Math.hypot(e[0]!, e[1]!, e[2]!), Math.hypot(e[4]!, e[5]!, e[6]!), Math.hypot(e[8]!, e[9]!, e[10]!)) });
        word += `${s.key}:${toLocal.elements.map((v) => Math.round(v * 500)).join(',')};`;
        if (list.some((m) => m.kind.living)) { this.insideLiving.add(s.key); body.innerKeys.push(s.key); }
      }
      body.innerKey = word;
    }
    // A skin nobody asked for this frame (its body changed again before it was whole) is given up.
    for (const [key, job] of this.jobs) if (job.wanted !== this.clock) this.jobs.delete(key);
    this.unfinished = this.jobs.size > 0;
    // Skins nothing wears any more are thrown away, a few frames after their last use (a body that comes back at once is not cut again), and sooner when
    // too many are kept: the oldest first, down to a few scenes' worth.
    let kept = 0;
    for (const [key, b] of this.built) {
      if (this.clock - b.used > 240) this.discard(key, b);
      else kept += b.triangles;
    }
    const most = SCENE_BODY_TRIANGLES[this.tier] * KEPT_SKINS;
    if (kept > most) {
      const idle = [...this.built.values()].filter((b) => b.used !== this.clock).sort((a, b) => a.used - b.used);
      for (const b of idle) {
        if (kept <= most) break;
        this.discard(b.key, b);
        kept -= b.triangles;
      }
    }
  }

  /** Whether a part lies wholly inside the other parts of its body: every point of its own skin that is tried is in the flesh of another. */
  private enclosed(m: Member, list: Member[]): boolean {
    const word = `${m.o.key}:${idOf(m.o.def)}:${m.held.local}|` + list.map((q) => (q === m ? '' : `${q.o.key}:${idOf(q.o.def)}:${q.held.local}`)).join('|');
    const known = this.enclosedKnown.get(word);
    if (known !== undefined) return known;
    const prim = m.kind.prim;
    const b = primBounds(prim);
    const reach = Math.hypot(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]);
    const others = list.filter((q) => q !== m).map((q) => ({ prim: q.kind.prim, toLocal: new Matrix4().copy(q.held.rest).invert() }));
    const p = new Vector3(), l = new Vector3();
    let inside = true;
    // Tried from each of the part's middles (a long part has several: one end of a limb can lie in the body while the other stands out of it).
    for (const c of middlesOf(prim)) {
      inside = inside && primDistance(prim, c[0], c[1], c[2]) < 0;
      for (let i = 0; inside && i < ENCLOSED_WAYS.length; i++) {
        const d = ENCLOSED_WAYS[i] as Vec3;
        // Out from the middle to the part's own skin along this way.
        let lo = 0, hi = reach;
        if (!(primDistance(prim, c[0] + d[0] * hi, c[1] + d[1] * hi, c[2] + d[2] * hi) > 0)) continue;
        for (let k = 0; k < 22; k++) {
          const mid = (lo + hi) / 2;
          if (primDistance(prim, c[0] + d[0] * mid, c[1] + d[1] * mid, c[2] + d[2] * mid) < 0) lo = mid; else hi = mid;
        }
        p.set(c[0] + d[0] * hi, c[1] + d[1] * hi, c[2] + d[2] * hi).applyMatrix4(m.held.rest);
        inside = others.some((q) => { l.copy(p).applyMatrix4(q.toLocal); return primDistance(q.prim, l.x, l.y, l.z) < 0; });
      }
      if (!inside) break;
    }
    if (this.enclosedKnown.size > 400) this.enclosedKnown.clear();
    this.enclosedKnown.set(word, inside);
    return inside;
  }

  private discard(key: string, b: Built): void {
    for (const g of b.geometries) g.dispose();
    for (const g of b.lining?.geometries ?? []) g?.dispose();
    this.built.delete(key);
  }

  /** What a body's skin is known by: its parts, how they stand to one another and how fine it is cut. */
  private plan(list: Member[], area: number, budget: number): Plan {
    const first = list[0] as Member;
    const toBody = new Matrix4().copy(first.held.rest).invert();
    const rel = list.map((m) => new Matrix4().multiplyMatrices(toBody, m.held.rest)); // each member's own space to the body's (the first member's)
    const q = (m: Matrix4): string => m.elements.map((v) => Math.round(v * 2000)).join(',');
    // The fineness in steps of a quarter, so a budget that wavers (a body that comes and goes beside it) does not ask for a new skin each time.
    const key = `${this.tier}|${Math.round(Math.log(budget) / Math.log(1.25))}|` + list.map((m, i) => `${m.o.key}:${idOf(m.o.def)}:${m.hollow ? 'h' : ''}:${i === 0 ? '' : q(rel[i] as Matrix4)}`).join('|');
    const worldScale = Math.cbrt(Math.abs(first.held.rest.determinant())) || 1;
    const inBody = area / (worldScale * worldScale);
    let thin = Infinity;
    list.forEach((m, i) => {
      const r = (rel[i] as Matrix4).elements;
      thin = Math.min(thin, m.kind.thin * Math.min(Math.hypot(r[0]!, r[1]!, r[2]!), Math.hypot(r[4]!, r[5]!, r[6]!), Math.hypot(r[8]!, r[9]!, r[10]!)));
    });
    // Fine enough for the budget, and finer (to a point) where the thinnest part would otherwise be lost.
    const byBudget = Math.sqrt((2 * inBody) / budget);
    const cell = Math.min(byBudget, Math.max(thin / 3.2, byBudget / 2.4));
    return { key, rel, area: inBody, thin, cell, reckoned: (2 * inBody) / (cell * cell), ceiling: Infinity };
  }

  /** Cuts the skin of one body, in steps (organic-mesh.ts): the last step returns it, each member's patch a geometry in the member's own space. */
  private *make(list: Member[], plan: Plan): Generator<void, Built, void> {
    const { key, rel, ceiling } = plan;
    const most = Math.min(BODY_TRIANGLES[this.tier], Math.max(64, Math.floor(ceiling / 2)));
    const parts: Array<FieldPart & { tag: number }> = [];
    const sizes: number[] = [];
    let thin = Infinity;
    list.forEach((m, i) => {
      const fromBody = new Matrix4().copy(rel[i] as Matrix4).invert();
      const e = fromBody.elements; // column major
      const b = primBounds(m.kind.prim);
      const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
      const c = new Vector3();
      for (const x of [b.lo[0], b.hi[0]]) for (const y of [b.lo[1], b.hi[1]]) for (const z of [b.lo[2], b.hi[2]]) {
        c.set(x, y, z).applyMatrix4(rel[i] as Matrix4);
        lo[0] = Math.min(lo[0], c.x); lo[1] = Math.min(lo[1], c.y); lo[2] = Math.min(lo[2], c.z);
        hi[0] = Math.max(hi[0], c.x); hi[1] = Math.max(hi[1], c.y); hi[2] = Math.max(hi[2], c.z);
      }
      const r = (rel[i] as Matrix4).elements;
      const scale = Math.min(Math.hypot(r[0]!, r[1]!, r[2]!), Math.hypot(r[4]!, r[5]!, r[6]!), Math.hypot(r[8]!, r[9]!, r[10]!));
      const inside = new Vector3(...primInside(m.kind.prim)).applyMatrix4(rel[i] as Matrix4);
      const size = m.kind.thin * scale;
      thin = Math.min(thin, size);
      sizes.push(size);
      parts.push({
        prim: m.kind.prim, tag: i,
        toLocal: new Float64Array([e[0]!, e[4]!, e[8]!, e[12]!, e[1]!, e[5]!, e[9]!, e[13]!, e[2]!, e[6]!, e[10]!, e[14]!]),
        scale, soft: list.length > 1 ? m.kind.soft * size : 0, wall: m.hollow ? insideOf(m.kind.material).wall * size : 0,
        lo, hi, inside: [inside.x, inside.y, inside.z], size,
      });
    });
    pressLimbs(parts);
    const field = new BodyField(parts, flatPlanes(parts));
    // At the cell the plan reckoned, and never past the skin's ceiling: a closed skin has two triangles a vertex, and one that still comes out over (a
    // body with holes through it has a few more) is cut again coarser.
    let cell = plan.cell;
    let skin = yield* cutSkinSteps(field, { cell, maxVertices: most });
    for (let again = 0; again < 12 && skin.index.length / 3 > ceiling; again++) {
      cell = Math.max(cell, skin.cell) * 1.15;
      skin = yield* cutSkinSteps(field, { cell, maxVertices: most });
    }
    // A body whose skin the scene cannot afford (its cells would be wider than its thinnest part, which they would then miss) has none: its parts stay
    // the shapes they were drawn as, which is what `wear` gives them back.
    const plain = skin.position.length === 0 || skin.index.length / 3 > ceiling || skin.cell > thin;
    if (plain) {
      return {
        key, field, cell: skin.cell || cell, geometries: [], patches: [], memberOf: [], partOf: [], rel, sizes, hollow: list.map(() => false), plain: true,
        restPosition: [], restNormal: [], held: [], posed: false, wearers: [], lining: undefined, liningSteps: undefined,
        inner: [], innerKey: '', innerKeys: [], tints: '', linear: [], triangles: 0, used: this.clock,
      };
    }
    const memberOf = field.parts.map((p) => (p as FieldPart & { tag: number }).tag);
    const partOf = list.map(() => 0);
    memberOf.forEach((member, part) => { partOf[member] = part; });
    yield;
    const cut = patches(skin, field.parts.length);
    const geometries: BufferGeometry[] = list.map(() => new BufferGeometry());
    const ordered: Patch[] = list.map(() => cut[0] as Patch);
    const restPosition: Float32Array[] = list.map(() => new Float32Array(0)), restNormal: Float32Array[] = list.map(() => new Float32Array(0));
    const heldBy: Uint32Array[] = list.map(() => new Uint32Array(0));
    let triangles = 0;
    for (let part = 0; part < cut.length; part++) {
      yield;
      const patch = cut[part] as Patch;
      const member = memberOf[part] as number;
      ordered[member] = patch;
      const geo = toMember(patch, rel[member] as Matrix4, geometries[member] as BufferGeometry);
      restPosition[member] = (geo.getAttribute('position').array as Float32Array).slice();
      restNormal[member] = (geo.getAttribute('normal').array as Float32Array).slice();
      // The vertices another member has a hold on: those it owns outright, and those it shares across the join.
      const hold: number[] = [];
      for (let v = 0; v < patch.owner.length; v++) {
        if (memberOf[patch.owner[v] as number] !== member || ((patch.mix[v] as number) > 1e-4 && memberOf[patch.other[v] as number] !== member)) hold.push(v);
      }
      heldBy[member] = Uint32Array.from(hold);
      triangles += patch.index.length / 3;
    }
    return {
      key, field, cell: skin.cell || cell, geometries, patches: ordered, memberOf, partOf, rel, sizes, hollow: list.map((m) => m.hollow), plain: false,
      restPosition, restNormal, held: heldBy, posed: false, wearers: [], lining: undefined, liningSteps: undefined,
      inner: [], innerKey: '', innerKeys: [], tints: '', linear: [], triangles, used: this.clock,
    };
  }

  /**
   * Takes a skin's cutting on: all of it when nothing is being drawn live, else as much as this frame's share of time allows (and one step at the least,
   * so it ends however little time there is). The skin, once it is whole.
   */
  private advance(key: string, job: Job): Built | undefined {
    do {
      const step = job.steps.next();
      if (!step.done) continue;
      this.jobs.delete(key);
      this.built.set(key, step.value);
      return step.value;
    } while (!this.live || this.now() < this.deadline);
    return undefined;
  }

  /**
   * A body whose skin is still being cut. A part goes on wearing the skin it wore when that body has only grown (a finger added to a hand: the hand stays
   * as it was until the new skin is whole); otherwise it is its own drawn shape meanwhile.
   */
  private wait(list: Member[]): void {
    const here = new Set(list.map((m) => m.held.mesh));
    for (const m of list) {
      const old = m.held.built;
      if (old && this.built.get(old.key) === old && old.wearers.every((w) => here.has(w))) {
        old.used = this.clock;
        for (const key of old.innerKeys) this.insideLiving.add(key);
      } else this.restore(m.held);
    }
  }

  /** Puts each member's patch of a body's skin in its node, in the members' colours. */
  private wear(list: Member[], body: Built): Built {
    body.used = this.clock;
    if (body.plain) {
      for (const m of list) this.restore(m.held);
      return body;
    }
    body.wearers = list.map((m) => m.held.mesh);
    // Colours: each vertex its own part's, running into the next part's across a join, darker in a crease.
    const tints = list.map((m) => fitTint(m.held.node.pieces[0]?.surface?.userData.name, m.o.color as Rgb));
    const sig = tints.map((t) => t.map((v) => Math.round(v)).join(',')).join('|');
    if (sig !== body.tints) {
      body.tints = sig;
      body.linear = tints.map((t) => t.map((v) => srgbToLinear(v / 255)));
      list.forEach((_, member) => paint(body, body.patches[member] as Patch, body.geometries[member] as BufferGeometry, () => 1, true));
      this.paintLining(body);
    }
    list.forEach((m, i) => {
      const held = m.held;
      const geo = body.geometries[i] as BufferGeometry;
      const piece = held.node.pieces[0]!;
      piece.fused = list.length > 1;
      if (held.built !== body) this.strip(held);
      held.built = body;
      held.index = i;
      if (held.mesh.geometry !== geo) {
        held.mesh.geometry = geo;
        piece.organic = true;
        if (piece.lines) piece.lines.visible = false;
        if (piece.surface && !piece.surface.vertexColors) { piece.surface.vertexColors = true; piece.surface.needsUpdate = true; }
        // (the skin carries the colour in its vertices: the surface is white from this frame on, as scene3d sets it in every later one)
        piece.surface?.color.setRGB(1, 1, 1);
        this.onSwap?.(held.node);
      }
    });
    return body;
  }

  /**
   * Lets a body follow its parts where a machine has moved them from where they stood when it was cut: each vertex near a join goes with both parts it
   * lies between, by its share of each, so the skin stretches across the join and does not tear. Call it when the frame is laid out as it really stands.
   */
  pose(): void {
    const a = new Vector3(), b = new Vector3(), n = new Vector3();
    for (const body of this.built.values()) {
      if (body.used !== this.clock || body.wearers.length < 2) continue;
      // From a member's own space, by way of another member's movement, back to its own space: nothing while the two have not moved against each other.
      const count = body.wearers.length;
      const carry: Array<Matrix4 | null | undefined> = new Array(count * count);
      const world = body.wearers.map((m) => m.matrixWorld);
      const inverse = world.map((m) => new Matrix4().copy(m).invert());
      const restInverse = body.rel.map((m) => new Matrix4().copy(m).invert());
      let moved = false;
      const between = (i: number, x: number): Matrix4 | null => {
        if (i === x) return null;
        let m = carry[i * count + x];
        if (m === undefined) {
          const d = new Matrix4().multiplyMatrices(inverse[i]!, world[x]!).multiply(restInverse[x]!).multiply(body.rel[i]!);
          m = isIdentity(d) ? null : d;
          carry[i * count + x] = m;
          if (m) moved = true;
        }
        return m;
      };
      for (let i = 0; i < count; i++) if (body.held[i]!.length) for (let x = 0; x < count; x++) between(i, x);
      if (!moved && !body.posed) continue;
      for (let i = 0; i < count; i++) {
        const hold = body.held[i] as Uint32Array;
        if (hold.length === 0) continue;
        const patch = body.patches[i] as Patch;
        const geo = body.geometries[i] as BufferGeometry;
        const position = geo.getAttribute('position') as BufferAttribute, normal = geo.getAttribute('normal') as BufferAttribute;
        const p = position.array as Float32Array, pn = normal.array as Float32Array;
        const rp = body.restPosition[i] as Float32Array, rn = body.restNormal[i] as Float32Array;
        for (let h = 0; h < hold.length; h++) {
          const v = hold[h] as number, at = v * 3;
          const t = patch.mix[v] as number;
          const one = between(i, body.memberOf[patch.owner[v] as number] as number), two = t > 0 ? between(i, body.memberOf[patch.other[v] as number] as number) : one;
          a.set(rp[at]!, rp[at + 1]!, rp[at + 2]!);
          b.copy(a);
          if (one) a.applyMatrix4(one);
          if (two) b.applyMatrix4(two);
          p[at] = a.x + (b.x - a.x) * t; p[at + 1] = a.y + (b.y - a.y) * t; p[at + 2] = a.z + (b.z - a.z) * t;
          a.set(rn[at]!, rn[at + 1]!, rn[at + 2]!);
          b.copy(a);
          if (one) a.transformDirection(one);
          if (two) b.transformDirection(two);
          n.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t).normalize();
          pn[at] = n.x; pn[at + 1] = n.y; pn[at + 2] = n.z;
        }
        position.needsUpdate = true;
        normal.needsUpdate = true;
        // its vertices are no longer where its bounds were measured: it is drawn without asking them
        (body.wearers[i] as Mesh).frustumCulled = !moved;
      }
      body.posed = moved;
    }
  }

  /**
   * What a cut shows of the bodies: on each plane that cuts a part, the face of its flesh in layers; in a hollow part, the lining of its cavity. Call it when
   * the cut's planes are on the parts' surfaces for this frame (after the cutaway has run).
   */
  section(): void {
    for (const held of this.held.values()) {
      const body = held.built;
      const surface = held.node.pieces[0]?.surface as (Surface & { clippingPlanes: Plane[] | null }) | undefined;
      const planes = body && body.used === this.clock && surface ? surface.clippingPlanes ?? [] : [];
      if (!body || !surface || planes.length === 0) { this.strip(held); continue; }
      const i = held.index;
      const mesh = held.mesh;
      const seen = surface.opacity > 0.003;
      // The lining of a hollow part: the inside of its wall, seen through the opening the cut makes.
      if (body.hollow[i]) {
        if (!body.lining) this.line(body);
        if (!body.lining) this.unfinished = true;
        const geo = body.lining?.geometries[i];
        if (geo && !held.lining) {
          const inner = makeSurface(surface.userData.name, TIERS[this.tier]);
          inner.vertexColors = true;
          held.lining = new Mesh(geo, inner);
          held.lining.castShadow = false;
          held.lining.receiveShadow = mesh.receiveShadow;
          mesh.add(held.lining);
        }
        if (held.lining) {
          const inner = held.lining.material as Surface;
          inner.clippingPlanes = planes;
          setSurfaceOpacity(inner, surface.opacity);
          held.lining.visible = seen;
          held.lining.renderOrder = mesh.renderOrder;
        }
      }
      // The faces: one for each plane, cut from the body's field where the plane lies in this member's own flesh.
      while (held.caps.length > planes.length) this.dropCap(held.caps.pop() as Cap);
      const toRest = new Matrix4().copy(mesh.matrixWorld).invert().premultiply(body.rel[i] as Matrix4); // the world to the body as it was cut, by way of this member
      const fromRest = new Matrix4().copy(body.rel[i] as Matrix4).invert();
      const hatch = !held.kind.living;
      for (let k = 0; k < planes.length; k++) {
        const plane = (planes[k] as Plane).clone().applyMatrix4(toRest);
        const step = body.cell * 0.25;
        const signature = `${Math.round(plane.normal.x * 2000)},${Math.round(plane.normal.y * 2000)},${Math.round(plane.normal.z * 2000)},${Math.round(plane.constant / step)}|${body.key}|${body.tints}|${body.innerKey}`;
        let cap = held.caps[k];
        // A face whose plane is moving is cut coarser, and cut fine once the plane has rested a few frames: its layers are drawn from depths, not from its
        // triangles, so the coarse face shows the same layers with a rougher edge.
        const moved = !cap || cap.signature !== signature;
        const refine = !moved && (cap as Cap).coarse && this.clock - (cap as Cap).since > FACE_REST && (!this.live || this.now() < this.deadline);
        if (!cap || moved || refine) {
          const coarse = this.live && !refine;
          // Across the plane, turned so that the face looks towards the side that was taken away; and only where this member's own flesh can be (its
          // box and the reach of its joins), since each member may stand a little differently to the plane when a machine moves them.
          const normal = plane.normal.clone().negate();
          const u = new Vector3(1, 0, 0);
          if (Math.abs(normal.x) > 0.9) u.set(0, 1, 0);
          u.addScaledVector(normal, -u.dot(normal)).normalize();
          const v = new Vector3().crossVectors(normal, u);
          const origin = plane.coplanarPoint(new Vector3());
          const size = body.cell * 0.7 * (coarse ? FACE_MOVING : 1);
          const part = body.field.parts[body.partOf[i] as number] as FieldPart;
          let room = 0;
          for (const p of body.field.parts) room = Math.max(room, p.soft);
          room += 2 * size;
          const own = { lo: [part.lo[0] - room, part.lo[1] - room, part.lo[2] - room], hi: [part.hi[0] + room, part.hi[1] + room, part.hi[2] + room] };
          const face = cutFace(body.field, [origin.x, origin.y, origin.z], [u.x, u.y, u.z], [v.x, v.y, v.z], size, body.hollow.some(Boolean), holesOf(body.inner), own);
          const geo = faceOf(body, face, i, fromRest, plane.normal.clone().negate());
          if (cap) {
            cap.mesh.geometry.dispose(); cap.mesh.geometry = geo; cap.signature = signature; cap.coarse = coarse;
            if (moved) cap.since = this.clock;
          } else {
            const material = hatch ? hatchSurface() : makeSectionSurface(surface.userData.name, TIERS[this.tier]);
            const made = new Mesh(geo, material);
            made.castShadow = false;
            made.receiveShadow = false;
            mesh.add(made);
            cap = { mesh: made, signature, hatch, coarse, since: this.clock };
            held.caps[k] = cap;
          }
        }
        const material = cap.mesh.material as MeshStandardMaterial;
        const others = planes.filter((_, j) => j !== k);
        material.clippingPlanes = others.length ? others : null;
        if (cap.hatch) sectionTone(held.color, material.color);
        else fitSection(material as unknown as SectionSurface, body.sizes[i] as number);
        const opacity = surface.opacity;
        if (material.transparent !== opacity < 1) { material.transparent = opacity < 1; material.needsUpdate = true; }
        material.opacity = opacity;
        material.depthWrite = opacity >= 1;
        cap.mesh.visible = seen;
        cap.mesh.renderOrder = mesh.renderOrder;
        if (cap.coarse) this.unfinished = true;
      }
    }
  }

  /** Cuts the lining of a hollow body's cavity: in steps, as its skin was (at least one a frame, and all of it when nothing is drawn live). */
  private line(body: Built): void {
    body.liningSteps ??= cutSkinSteps(body.field, { cell: body.cell, surface: 'lining', maxVertices: BODY_TRIANGLES[this.tier] });
    let skin: Skin | undefined;
    do {
      const step = body.liningSteps.next();
      if (step.done) skin = step.value;
    } while (!skin && (!this.live || this.now() < this.deadline));
    if (!skin) return;
    body.liningSteps = undefined;
    const cut = patches(skin, body.field.parts.length);
    const lining = { geometries: body.wearers.map((): BufferGeometry | undefined => undefined), patches: body.wearers.map(() => cut[0] as Patch) };
    cut.forEach((patch, part) => {
      const member = body.memberOf[part] as number;
      lining.patches[member] = patch;
      if (patch.index.length) lining.geometries[member] = toMember(patch, body.rel[member] as Matrix4, new BufferGeometry());
    });
    body.lining = lining;
    this.paintLining(body);
  }

  private paintLining(body: Built): void {
    if (!body.lining) return;
    const shade = (member: number): number => insideOf((body.wearers[member]?.material as { userData?: { name?: string } } | undefined)?.userData?.name).lining;
    body.lining.geometries.forEach((geo, m) => {
      if (geo) paint(body, body.lining!.patches[m] as Patch, geo, shade, false);
    });
  }

  private dropCap(cap: Cap): void {
    cap.mesh.removeFromParent();
    cap.mesh.geometry.dispose();
    (cap.mesh.material as Material).dispose();
  }

  /** Takes away what a cut added to a part (its faces and its lining). */
  private strip(held: Held): void {
    for (const cap of held.caps) this.dropCap(cap);
    held.caps.length = 0;
    if (held.lining) {
      held.lining.removeFromParent();
      (held.lining.material as Material).dispose(); // its geometry is the body's
      held.lining = undefined;
    }
  }

  /** Gives a node its ordinary geometry back. */
  private restore(held: Held): void {
    this.strip(held);
    held.built = undefined;
    const piece = held.node.pieces[0];
    // Only where a patch was put: a held tube that the flow code has drawn anew since is already its own.
    if (!piece || !piece.organic) return;
    const own = held.node.path?.geo ?? held.original;
    piece.organic = false;
    piece.fused = false;
    held.mesh.frustumCulled = true;
    if (held.mesh.geometry === own) return;
    held.mesh.geometry = own;
    if (piece.lines) piece.lines.visible = true;
    if (piece.surface) {
      const tint = fitTint(piece.surface.userData.name, held.color);
      piece.surface.color.setRGB(tint[0] / 255, tint[1] / 255, tint[2] / 255, 'srgb');
    }
    this.onSwap?.(held.node);
  }

  /** A drawn object is going: what was made for it is forgotten (its skins are thrown away with the others when nothing wears them). */
  release(key: number): void {
    const held = this.held.get(key);
    if (held) this.strip(held);
    this.held.delete(key);
  }

  dispose(): void {
    for (const held of this.held.values()) this.strip(held);
    for (const [key, b] of [...this.built]) this.discard(key, b);
    this.jobs.clear();
    this.held.clear();
  }
}

/** A patch of a body's skin as the geometry of one member, in the member's own space (`rel` leads from there to the body's). */
function toMember(patch: Patch, rel: Matrix4, geo: BufferGeometry): BufferGeometry {
  const fromBody = new Matrix4().copy(rel).invert();
  const position = new Float32Array(patch.position.length), normal = new Float32Array(patch.normal.length);
  const v = new Vector3();
  // a direction goes over by the inverse transpose: of fromBody's inverse, that is rel
  const n = rel.elements;
  for (let i = 0; i < patch.position.length; i += 3) {
    v.set(patch.position[i]!, patch.position[i + 1]!, patch.position[i + 2]!).applyMatrix4(fromBody);
    position[i] = v.x; position[i + 1] = v.y; position[i + 2] = v.z;
    const x = patch.normal[i]!, y = patch.normal[i + 1]!, z = patch.normal[i + 2]!;
    const nx = n[0]! * x + n[1]! * y + n[2]! * z, ny = n[4]! * x + n[5]! * y + n[6]! * z, nz = n[8]! * x + n[9]! * y + n[10]! * z;
    const l = Math.hypot(nx, ny, nz) || 1;
    normal[i] = nx / l; normal[i + 1] = ny / l; normal[i + 2] = nz / l;
  }
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('normal', new BufferAttribute(normal, 3));
  geo.setAttribute('color', new BufferAttribute(new Float32Array(patch.position.length), 3));
  geo.setIndex(new BufferAttribute(patch.index, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.triangles = patch.index.length / 3;
  return geo;
}

/** Writes a patch's colours: each vertex its own part's tint, running into the next part's across a join; `shade` darkens a member's, a crease is darker. */
function paint(body: Built, patch: Patch, geo: BufferGeometry, shade: (member: number) => number, creases: boolean): void {
  const attr = geo.getAttribute('color') as BufferAttribute;
  const out = attr.array as Float32Array;
  const linear = body.linear;
  for (let v = 0; v < patch.owner.length; v++) {
    const ma = body.memberOf[patch.owner[v] as number] as number, mb = body.memberOf[patch.other[v] as number] as number;
    const a = linear[ma] as number[], b = linear[mb] as number[];
    const sa = shade(ma), sb = shade(mb);
    const t = patch.mix[v] as number;
    const dark = creases ? 0.5 + 0.5 * (patch.open[v] as number) : 1;
    out[v * 3] = (a[0]! * sa + (b[0]! * sb - a[0]! * sa) * t) * dark;
    out[v * 3 + 1] = (a[1]! * sa + (b[1]! * sb - a[1]! * sa) * t) * dark;
    out[v * 3 + 2] = (a[2]! * sa + (b[2]! * sb - a[2]! * sa) * t) * dark;
  }
  attr.needsUpdate = true;
}

/** The part of a cut face that is one member's own flesh, as geometry in the member's space, facing along `facing` (the body's space). */
function faceOf(body: Built, face: Face, member: number, fromRest: Matrix4, facing: Vector3): BufferGeometry {
  const part = body.partOf[member] as number;
  const { index, owner } = face;
  const remap = new Map<number, number>();
  const idx: number[] = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = owner[index[t] as number] as number, b = owner[index[t + 1] as number] as number, c = owner[index[t + 2] as number] as number;
    if ((b === c ? b : a) !== part) continue;
    for (let k = 0; k < 3; k++) {
      const v = index[t + k] as number;
      let n = remap.get(v);
      if (n === undefined) { n = remap.size; remap.set(v, n); }
      idx.push(n);
    }
  }
  const count = remap.size;
  const position = new Float32Array(count * 3), normal = new Float32Array(count * 3), color = new Float32Array(count * 3), inside = new Float32Array(count * 2);
  const p = new Vector3();
  const nrm = facing.clone().transformDirection(fromRest);
  const linear = body.linear;
  for (const [v, n] of remap) {
    p.set(face.position[v * 3]!, face.position[v * 3 + 1]!, face.position[v * 3 + 2]!).applyMatrix4(fromRest);
    position[n * 3] = p.x; position[n * 3 + 1] = p.y; position[n * 3 + 2] = p.z;
    normal[n * 3] = nrm.x; normal[n * 3 + 1] = nrm.y; normal[n * 3 + 2] = nrm.z;
    const a = linear[body.memberOf[face.owner[v] as number] as number] as number[], b = linear[body.memberOf[face.other[v] as number] as number] as number[];
    const t = face.mix[v] as number;
    color[n * 3] = a[0]! + (b[0]! - a[0]!) * t; color[n * 3 + 1] = a[1]! + (b[1]! - a[1]!) * t; color[n * 3 + 2] = a[2]! + (b[2]! - a[2]!) * t;
    inside[n * 2] = face.inside[v * 2] as number; inside[n * 2 + 1] = face.inside[v * 2 + 1] as number;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(position, 3));
  geo.setAttribute('normal', new BufferAttribute(normal, 3));
  geo.setAttribute('color', new BufferAttribute(color, 3));
  geo.setAttribute('inside', new BufferAttribute(inside, 2));
  geo.setIndex(idx);
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/** The solids inside a body as one distance in the body's space (negative inside any of them), or nothing when there are none. */
function holesOf(inner: readonly Inner[]): ((x: number, y: number, z: number) => number) | undefined {
  if (inner.length === 0) return undefined;
  const p = new Vector3();
  return (x, y, z) => {
    let least = Infinity;
    for (const s of inner) {
      p.set(x, y, z).applyMatrix4(s.toLocal);
      const d = primDistance(s.prim, p.x, p.y, p.z) * s.scale;
      if (d < least) least = d;
    }
    return least;
  };
}

/** The face of a cut through a blob of something that is not alive (a lump of metal, of plastic): a drawing's hatched section, as every other solid has. */
function hatchSurface(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ side: DoubleSide, roughness: 0.82, metalness: 0.02, color: new Color(1, 1, 1) });
  hatched(m);
  return m;
}

function isIdentity(m: Matrix4): boolean {
  const e = m.elements;
  for (let i = 0; i < 16; i++) if (Math.abs(e[i]! - (i % 5 === 0 ? 1 : 0)) > 1e-5) return false;
  return true;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Two solids touch when their boxes overlap and neither is wholly inside the other (a kernel in a fruit, a lens in an eye stay their own). */
function touches(a: Member, b: Member): boolean {
  if (a.lo.x > b.hi.x || b.lo.x > a.hi.x || a.lo.y > b.hi.y || b.lo.y > a.hi.y || a.lo.z > b.hi.z || b.lo.z > a.hi.z) return false;
  const within = (p: Member, q: Member): boolean => p.lo.x >= q.lo.x && p.lo.y >= q.lo.y && p.lo.z >= q.lo.z && p.hi.x <= q.hi.x && p.hi.y <= q.hi.y && p.hi.z <= q.hi.z;
  return !within(a, b) && !within(b, a);
}

/** Each solid's middle lies outside the other: they meet from outside, neither sits in the other. */
function apart(a: Member, b: Member): boolean {
  const outside = (p: Vector3, of: Member): boolean => {
    const local = p.clone().applyMatrix4(new Matrix4().copy(of.held.rest).invert());
    return primDistance(of.kind.prim, local.x, local.y, local.z) > 0;
  };
  return outside(a.centre, b) && outside(b.centre, a);
}
