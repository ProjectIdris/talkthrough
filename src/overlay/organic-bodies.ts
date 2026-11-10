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
import { BodyField, lumpReach, primBounds, primDistance, primInside } from './organic-field.ts';
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

/** The triangles one body's skin is cut into, by tier, and those all the bodies of a scene may have together. */
export const BODY_TRIANGLES = { low: 9_000, mid: 26_000, high: 60_000 } as const;
export const SCENE_BODY_TRIANGLES = { low: 40_000, mid: 110_000, high: 220_000 } as const;
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
      prim = { kind: 'cone', r: Math.max(1e-4, sx / 2), half: Math.max(1e-4, sy / 2), depth: Math.max(0.05, sz / Math.max(sx, 1e-6)) };
      break;
    }
    case 'box': {
      const s = def.size;
      const least = Math.min(s[0], s[1], s[2]);
      prim = { kind: 'box', half: [s[0] / 2, s[1] / 2, s[2] / 2], round: Math.max(0, Math.min(def.bevel ?? softBevel(s), least * 0.4999)) };
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
      const pts = samplePath(def.pts, true, 6);
      const radii = pts.map((_, i) => def.radius * (def.swell ? swellAt(def.swell, pts.length > 1 ? i / (pts.length - 1) : 0) : 1));
      prim = { kind: 'tube', pts, radii };
      break;
    }
    default: return null;
  }
  return prim;
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

type Plan = { key: string; rel: Matrix4[]; budget: number; area: number };
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
    for (const [g, list] of bodies) {
      const a = areas.get(g) as number;
      const budget = Math.max(1_500, Math.min(BODY_TRIANGLES[this.tier], SCENE_BODY_TRIANGLES[this.tier] * (a / Math.max(area, 1e-9))));
      const plan = this.plan(list, a, budget);
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
    return { key, rel, budget, area: area / (worldScale * worldScale) };
  }

  /** Cuts the skin of one body, in steps (organic-mesh.ts): the last step returns it, each member's patch a geometry in the member's own space. */
  private *make(list: Member[], plan: Plan): Generator<void, Built, void> {
    const { key, rel, budget } = plan;
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
    const field = new BodyField(parts);
    // Fine enough for the budget, and finer (to a point) where the thinnest part would otherwise be lost.
    const byBudget = Math.sqrt((2 * plan.area) / budget);
    const cell = Math.min(byBudget, Math.max(thin / 3.2, byBudget / 2.4));
    const skin = yield* cutSkinSteps(field, { cell, maxVertices: BODY_TRIANGLES[this.tier] });
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
      key, field, cell: skin.cell || cell, geometries, patches: ordered, memberOf, partOf, rel, sizes, hollow: list.map((m) => m.hollow),
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
