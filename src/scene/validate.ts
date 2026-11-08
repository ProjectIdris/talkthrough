import { prepareTaperedExtrusion } from './tapered-extrusion.ts';
// The scene validator: the only way a scene from a model reaches the renderer.
// It reads data and builds fresh objects from known fields. It never evaluates, imports,
// or interprets anything in a scene; strings stay plain text for the renderer to draw as text.

import { extrudeProfileIssue } from './extrude-profile.ts';
import { prepareSectorRings } from './sector-sweep.ts';
import { normalizeSectorProfile } from './sector-profile.ts';
import { PATCH_SEGMENTS, preparePatch, readPatchControls } from './patch.ts';
import { prepareSweep, SWEEP_SUBDIVISIONS } from './sweep.ts';
import { LOFT_STRIPS, prepareLoft } from './loft.ts';
import { prepareShell, SHELL_DETAIL } from './shell.ts';
import type { ShellTier } from './shell.ts';
import { nearestPaletteColor } from './colors.ts';
import { attachTolerance, FACE_NORMALS, landOn, mountPosition, turnToFace } from './attach.ts';
import { anchorsOf } from './anchors.ts';
import { partFacing, resolvePartGeometry } from './part-geometry.ts';
import { MODELS } from './model-catalogue.ts';
import { findModel, partId, resolveModel, resolvePart } from './models.ts';
import { resolveHullPoints } from './hull-points.ts';
import type { Body } from './attach.ts';
import { bindParts, bindUnknownId, BINDINGS } from './bind.ts';
import { DIAGRAM_PARTS, ID_PATTERN, LIMITS, PALETTE, RESERVED_IDS, SCREEN_KINDS, VARIANTS } from './spec.ts';
import type { DiagramKind, Field, ObjectKind, Variant } from './spec.ts';
import type { Action, AddPart, AttachEnd, Issue, IssueKind, Scene, Step, Vec2, Vec3 } from './types.ts';

/** What the scene holds so far. Keep one per session and pass it to every turn so follow-ups reach earlier ids. */
export type SceneState = {
  ids: Map<string, ObjectKind>;
  parents: Map<string, string | undefined>;
  depth: Map<string, number>;
  /** What each flat diagram on screen is (flow, timeline, steps or chart), which says what may be drawn in it. */
  diagramKinds: Map<string, DiagramKind>;
  /** The ready-made part (piston, valve, cylinder-block...) that each id made by `add` part is; ids of anything else are not here. */
  parts: Map<string, string>;
  /** What joint each object has been given (hinge, slide or fixed), what each coupled object follows, and what each fixed object rides with. */
  joints: Map<string, 'hinge' | 'slide' | 'fixed' | 'pivot' | 'ball'>;
  follows: Map<string, string>;
  rides: Map<string, string>;
  /** The axis each object has been set spinning about (a spin of rate zero takes it out): a part inside it turns with it already. */
  spins: Map<string, 'x' | 'y' | 'z'>;
  /** The two ends of each connector made so far: a muscle is one of them. */
  /** The real model each model object stands for (object id to catalogue id), so its parts can be named. */
  models?: Map<string, string>;
  connectors?: Map<string, { from: string; to: string }>;
  /** The tubes made so far, and whether each is a closed loop: a wave runs along an open tube. */
  tubes?: Map<string, { closed: boolean }>;
  /** The min and max each joint was given: a muscle on a joint with no room to turn cannot move it. */
  jointRanges?: Map<string, { min?: number; max?: number }>;
  /** The parts a muscle pulls: a loop or coupling written for one is dropped (the muscle drives it) until a loop stop frees it. */
  muscled?: Set<string>;
  /** Where each 3D solid and group stands and how big it is, with normalized kit dimensions: what a tube or line that ends on a part is held against (attach.ts). */
  bodies: Map<string, Body>;
  /** Tubes and lines with an end in the air so far: a part that arrives later may be what that end was meant for. */
  loose: Map<string, { action: Record<string, unknown>; step: number }>;
  /** Actions the validator itself adds after the one it has just accepted (a tube made over to end on a part that has just arrived). */
  after: Action[];
  turnSteps: number;
  turnActions: number;
  /** Copies made by `array` actions so far. */
  copies: number;
  /**
   * Ids that were on screen before this answer and may be written again (a detail pass writes a richer version of the
   * scene with the same ids). Writing one again, as a 3D object for a 3D object (or a mark, pin or text for its own kind), replaces it: the id is then in use like
   * any other and cannot be written a third time. Ids named but never written again stay valid to refer to.
   */
  replaceable?: Set<string>;
  /** Set when the ids on screen may be replaced by an ordinary answer (not a detail pass, which does it by design): each replacement is then said in a note. */
  replaceNote?: boolean;
  /** The size of the 3D stage as last written (a stage written with no size takes it). */
  stage?: { w: number; h: number };
  /** Set only while an action that named an id the scene does not have is tried once more, after the rest had their chance to make it. */
  bindUnknown?: boolean;
  bindOp?: string;
};

export type StepResult = { step: Step | null; issues: Issue[] };
export type SceneResult = { ok: boolean; scene: Scene | null; issues: Issue[] };

const MAX_ISSUES = LIMITS.maxSteps * LIMITS.maxActionsPerStep + LIMITS.maxSteps + 100;
const MAX_STRING_SCAN = 10_000;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// Control characters, zero-width and bidirectional-override characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function createSceneState(): SceneState {
  return { ids: new Map(), parents: new Map(), depth: new Map(), diagramKinds: new Map(), parts: new Map(), joints: new Map(), follows: new Map(), rides: new Map(), spins: new Map(), bodies: new Map(), loose: new Map(), after: [], turnSteps: 0, turnActions: 0, copies: 0 };
}

/**
 * A state for a detail pass over a scene already on screen: it knows every id on screen (so a part, pin or move may
 * name one the answer does not write again) and lets the answer write any of them again, richer.
 */
export function createDetailState(onScreen: SceneState): SceneState {
  return {
    ids: new Map(onScreen.ids), parents: new Map(onScreen.parents), depth: new Map(onScreen.depth), diagramKinds: new Map(onScreen.diagramKinds), parts: new Map(onScreen.parts), joints: new Map(onScreen.joints), follows: new Map(onScreen.follows), rides: new Map(onScreen.rides), spins: new Map(onScreen.spins),
    bodies: new Map(onScreen.bodies), loose: new Map(onScreen.loose), after: [], connectors: new Map(onScreen.connectors ?? []), tubes: new Map(onScreen.tubes ?? []), muscled: new Set(onScreen.muscled ?? []), jointRanges: new Map(onScreen.jointRanges ?? []),
    turnSteps: 0, turnActions: 0, copies: onScreen.copies, replaceable: new Set(onScreen.ids.keys()),
    ...(onScreen.stage ? { stage: { ...onScreen.stage } } : {}),
  };
}

/** Call at the start of each question's answer: the per-turn caps count from zero again. */
export function startTurn(state: SceneState): void {
  state.turnSteps = 0;
  state.turnActions = 0;
}

/**
 * A new answer begins on a scene that may already have things on screen from the last: it may write any of their ids again, and that replaces the thing
 * (a follow-up that says "move this" or "make this bigger" writes the part again). What the answer itself writes is then in use like any id.
 */
export function startAnswer(state: SceneState): void {
  startTurn(state);
  state.replaceable = new Set(state.ids.keys());
  state.replaceNote = true;
}

type Notes = Issue[];

function note(notes: Notes, kind: IssueKind, path: string, message: string): void {
  if (notes.length < MAX_ISSUES) { notes.push({ kind, path, message }); return; }
  if (kind === 'dropped') {
    const replace = notes.findIndex((n) => n.kind !== 'dropped' && n.message !== 'more issues not listed');
    if (replace >= 0) notes.splice(replace, 1, { kind, path, message });
  }
  if (notes.length === MAX_ISSUES) notes.push({ kind: 'trimmed', path: '', message: 'more issues not listed' });
}

function isObject(v: unknown): v is object {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** An own data property's value; getters and inherited properties are never read. */
function own(o: object, key: string): unknown {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && 'value' in d ? d.value : undefined;
}

function ownKeys(o: object): string[] {
  return Object.keys(o);
}

type Parsed = { ok: true; value: unknown } | { ok: false; why: string };
const bad = (why: string): Parsed => ({ ok: false, why });
const good = (value: unknown): Parsed => ({ ok: true, value });

function clampNum(n: number, min: number, max: number, path: string, notes: Notes): number {
  if (n < min || n > max) {
    const c = Math.min(max, Math.max(min, n));
    note(notes, 'clamped', path, `${n} clamped to ${c}`);
    return c;
  }
  return n;
}

function cleanText(v: string, min: number, max: number, path: string, notes: Notes): Parsed {
  let s = (v.length > MAX_STRING_SCAN ? v.slice(0, MAX_STRING_SCAN) : v).replace(/[\r\n\t]+/g, ' ').replace(INVISIBLE, '').replace(/ {2,}/g, ' ').trim();
  if (s.length > max) {
    let cut = s.slice(0, max);
    const last = cut.charCodeAt(cut.length - 1);
    if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
    // A cut that falls inside a word goes back to the end of the last whole word, when that keeps most of the text.
    if (max >= 12 && s.charAt(max) !== ' ') {
      const space = cut.lastIndexOf(' ');
      if (space >= max * 0.5) cut = cut.slice(0, space);
    }
    s = cut.replace(/[\s,;:(/&–—-]+$/, '');
    note(notes, 'trimmed', path, `text cut to ${max} characters`);
  }
  return s.length < min ? bad('text is empty') : good(s);
}

function parseVec3(v: unknown, min: number, max: number, path: string, notes: Notes): Parsed {
  if (!Array.isArray(v) || v.length !== 3) return bad('expected 3 numbers');
  const out: number[] = [];
  for (let i = 0; i < 3; i++) {
    const n = v[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) return bad('expected 3 finite numbers');
    out.push(clampNum(n, min, max, `${path}[${i}]`, notes));
  }
  return good(out);
}

function parseVec2(v: unknown, min: number, max: number, path: string, notes: Notes): Parsed {
  if (!Array.isArray(v) || v.length !== 2) return bad('expected 2 numbers');
  const out: number[] = [];
  for (let i = 0; i < 2; i++) {
    const n = v[i];
    if (typeof n !== 'number' || !Number.isFinite(n)) return bad('expected 2 finite numbers');
    out.push(clampNum(n, min, max, `${path}[${i}]`, notes));
  }
  return good(out);
}

function parseField(f: Field, v: unknown, path: string, state: SceneState, notes: Notes): Parsed {
  switch (f.k) {
    case 'num':
      if (typeof v !== 'number' || !Number.isFinite(v)) return bad('expected a finite number');
      return good(clampNum(f.int ? Math.round(v) : v, f.min, f.max, path, notes));
    case 'bool':
      return typeof v === 'boolean' ? good(v) : bad('expected true or false');
    case 'str':
      return typeof v === 'string' ? cleanText(v, f.min, f.max, path, notes) : bad('expected text');
    case 'color':
      if (typeof v === 'string' && ((PALETTE as readonly string[]).includes(v) || HEX.test(v))) return good(v);
      if (typeof v === 'string') {
        // A colour name the palette lacks ("gold", "navy") is read as the nearest palette colour.
        const near = nearestPaletteColor(v.slice(0, 40));
        if (near) {
          note(notes, 'trimmed', path, `colour "${v.slice(0, 40)}" read as ${near}`);
          return good(near);
        }
      }
      return bad('unknown colour');
    case 'enum':
      return typeof v === 'string' && f.values.includes(v) ? good(v) : bad(`expected one of ${f.values.join(', ')}`);
    case 'newId':
      if (typeof v !== 'string' || !ID_PATTERN.test(v)) return bad('not a valid id');
      if ((RESERVED_IDS as readonly string[]).includes(v)) return bad(`"${v}" is reserved`);
      return state.ids.has(v) && !state.replaceable?.has(v) ? bad(`id "${v}" is already in use`) : good(v);
    case 'ref': {
      if (typeof v !== 'string') return bad('expected an id');
      let id = v;
      let kind = state.ids.get(id);
      if (!kind && v.includes('.')) {
        // A part of a real model written by its name or an alias (h.Left ventricle): the part it meant, said in a note.
        const base = v.slice(0, v.indexOf('.'));
        const model = state.models?.has(base) ? MODELS.find((m) => m.id === state.models!.get(base)) : undefined;
        if (model?.single) return bad(`unknown id "${v}": the model "${base}" (${model.name}) is one piece with no parts to name; use "${base}" for the whole of it`);
        if (model) {
          const { part, near } = resolvePart(model, v.slice(v.indexOf('.') + 1));
          if (!part) {
            const list = (near.length ? near : model.parts.slice(0, 12)).map((p) => p.key);
            return bad(`unknown id "${v}": ${near.length ? 'the nearest parts of' : 'parts of'} ${base} are ${list.join(', ')}${!near.length && model.parts.length > list.length ? `, and ${model.parts.length - list.length} more` : ''}`);
          }
          id = partId(base, part.key);
          kind = state.ids.get(id);
          note(notes, 'trimmed', path, `repaired: "${v}" is the part "${id}"`);
        }
      }
      if (!kind && state.bindUnknown && (f.of === 'object3d' || f.of === 'any')) {
        // A name the model made up for what it acts on: the part it meant, said in a note (bind.ts).
        const found = bindUnknownId(v, state, f.of === 'any' ? [(k) => !SCREEN_KINDS.has(k), () => true] : [(k) => !SCREEN_KINDS.has(k)], state.bindOp ?? '');
        if (found !== undefined) {
          note(notes, 'trimmed', path, `repaired: "${v}" is not in the scene; bound to "${found}"`);
          id = found;
          kind = state.ids.get(found);
        }
      }
      if (!kind) return bad(`unknown id "${v}"`);
      if (f.of === 'object3d' && SCREEN_KINDS.has(kind)) return bad(`"${v}" is on the screen (a mark or diagram), not a 3D object`);
      if (f.of === 'diagram' && kind !== 'diagram') return bad(`"${v}" is not a diagram`);
      if (f.of === 'node' && kind !== 'node') return bad(`"${v}" is not a node`);
      return good(id);
    }
    case 'parent': {
      if (typeof v !== 'string') return bad('expected the id of a group or a part');
      // Any 3D object can hold children: a group, or a part or shape that others are attached to.
      const kind = state.ids.get(v);
      if (!kind) return bad(`unknown id "${v}"`);
      if (SCREEN_KINDS.has(kind) || kind === 'text') return bad(`"${v}" cannot hold parts`);
      return (state.depth.get(v) ?? 0) + 1 > LIMITS.maxDepth ? bad('groups nested too deep') : good(v);
    }
    case 'target':
      if (typeof v !== 'string') return bad('expected an id or all, marks, panel');
      return (RESERVED_IDS as readonly string[]).includes(v) || state.ids.has(v) ? good(v) : bad(`unknown id "${v}"`);
    case 'vec3':
      return parseVec3(v, f.min, f.max, path, notes);
    case 'vec2':
      return parseVec2(v, f.min, f.max, path, notes);
    case 'pts2': {
      if (!Array.isArray(v) || v.length < f.min) return bad(`expected at least ${f.min} points`);
      const src = v.length > f.max ? v.slice(0, f.max) : v;
      if (v.length > f.max) note(notes, 'trimmed', path, `points cut to ${f.max}`);
      const out: unknown[] = [];
      for (let i = 0; i < src.length; i++) {
        const p = parseVec2(src[i], f.lo, f.hi, `${path}[${i}]`, notes);
        if (!p.ok) return bad(`point ${i}: ${p.why}`);
        out.push(p.value);
      }
      return good(out);
    }
    case 'rings2': {
      if (!Array.isArray(v) || v.length > f.max) return bad(`expected at most ${f.max} hole rings`);
      const rings: Vec2[][] = [];
      for (let h = 0; h < v.length; h++) {
        const ring: unknown = v[h];
        if (!Array.isArray(ring) || ring.length < 3 || ring.length > f.points) return bad(`hole ${h}: expected 3 to ${f.points} points`);
        const points: Vec2[] = [];
        for (const point of ring) {
          if (!Array.isArray(point) || point.length !== 2 || [point[0], point[1]].some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < f.lo || n > f.hi)) return bad(`hole ${h}: expected finite coordinates from ${f.lo} to ${f.hi}`);
          points.push([point[0], point[1]]);
        }
        rings.push(points);
      }
      return good(rings);
    }
    case 'strs': {
      if (!Array.isArray(v)) return bad('expected a list of texts');
      const out: string[] = [];
      for (let i = 0; i < v.length && out.length < f.max; i++) {
        const item = v[i];
        if (typeof item !== 'string') return bad(`row ${i}: expected text`);
        const t = cleanText(item, 0, f.len, `${path}[${i}]`, notes);
        if (t.ok && (t.value as string) !== '') out.push(t.value as string);
      }
      if (v.length > f.max) note(notes, 'trimmed', path, `rows cut to ${f.max}`);
      return good(out);
    }
    case 'pts': {
      if (!Array.isArray(v) || v.length < f.min) return bad(`expected at least ${f.min} points`);
      const src = v.length > f.max ? v.slice(0, f.max) : v;
      if (v.length > f.max) note(notes, 'trimmed', path, `points cut to ${f.max}`);
      const out: unknown[] = [];
      for (let i = 0; i < src.length; i++) {
        const p = parseVec3(src[i], f.lo, f.hi, `${path}[${i}]`, notes);
        if (!p.ok) return bad(`point ${i}: ${p.why}`);
        out.push(p.value);
      }
      return good(out);
    }
  }
}

function pickVariant(raw: object): Variant | string {
  const op = own(raw, 'op');
  if (typeof op !== 'string') return 'missing op';
  const candidates = VARIANTS.filter((v) => v.op === op);
  if (candidates.length === 0) return `unknown action "${op.slice(0, 40)}"`;
  const only = candidates[0];
  if (candidates.length === 1 && only && !only.shapes) return only;
  const shape = own(raw, 'shape');
  const hit = typeof shape === 'string' ? candidates.find((v) => v.shapes?.includes(shape)) : undefined;
  return hit ?? `unknown shape for "${op}"`;
}

function isUnder(state: SceneState, id: string, ancestor: string): boolean {
  for (let cur = state.parents.get(id), n = 0; cur !== undefined && n < 64; cur = state.parents.get(cur), n++) {
    if (cur === ancestor) return true;
  }
  return false;
}

function removeWithDescendants(state: SceneState, id: string): void {
  const doomed = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [child, parent] of state.parents) {
      if (parent !== undefined && doomed.has(parent) && !doomed.has(child)) {
        doomed.add(child);
        grew = true;
      }
    }
  }
  for (const d of doomed) {
    state.ids.delete(d);
    state.parents.delete(d);
    state.depth.delete(d);
    state.diagramKinds.delete(d);
    state.parts.delete(d);
    state.joints.delete(d);
    state.follows.delete(d);
    state.rides.delete(d);
    state.spins.delete(d);
    state.bodies.delete(d);
    state.loose.delete(d);
    state.models?.delete(d);
  }
}

/** Takes a cleared id (or "all", "marks", "panel") out of what the scene holds; the guide clears the page by id between steps and tells the scene here. */
export function applyClear(state: SceneState, target: string): void {
  if (target === 'all') {
    state.ids.clear(); state.parents.clear(); state.depth.clear(); state.diagramKinds.clear(); state.parts.clear(); state.joints.clear(); state.follows.clear(); state.rides.clear(); state.spins.clear(); state.bodies.clear(); state.loose.clear(); state.models?.clear(); state.copies = 0;
  } else if (target === 'marks' || target === 'panel') {
    // Marks, pins and flat diagrams are the screen's; the 3D stage is the rest.
    const wantMark = target === 'marks';
    for (const [id, kind] of [...state.ids]) {
      if ((kind === 'mark' || kind === 'pin' || DIAGRAM_PARTS.has(kind)) === wantMark) removeWithDescendants(state, id);
    }
  } else {
    removeWithDescendants(state, target);
  }
}

type EndSlots = [AttachEnd | null, AttachEnd | null];
const ZERO: Vec3 = [0, 0, 0];

/** Accepted definitions in this step, including the body carried in from the previous step. */
type BodyVersions = ReadonlyMap<string, readonly { at: number; body: Body | undefined }[]>;

function bodyAt(versions: BodyVersions, id: string, at: number): Body | undefined {
  let found: { at: number; body: Body | undefined } | undefined;
  for (const version of versions.get(id) ?? []) {
    // Source order breaks ties, just as the chronological planner does.
    if (version.at <= at && (!found || version.at >= found.at)) found = version;
  }
  return found?.body;
}

/** The self anchor that names the side a facing part faces by (the one a part put "face to the surface" would be attached by). */
const FACING_SIDE = new Map<string, string>([['0,0,1', 'front'], ['0,1,0', 'top']]);

/**
 * A kit part with a front (a port's opening, a lens, a chip's top) attached by a face of its parent (right, top, front...) is meant to face out of that
 * face; written with no rot it would keep its default turn, which only suits one face in six. Its rot is set to turn it out, with a note. A rot the model
 * wrote, even [0,0,0], is its own call and stands, and so does a part attached by the very side it faces (it was asked to put that side on the surface).
 */
function faceTurn(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes, bodies: BodyVersions): void {
  if (out.shape !== 'part' || typeof out.part !== 'string' || out.rot !== undefined || typeof out.parent !== 'string') return;
  const facing = partFacing(out.part);
  const face = typeof out.parentAnchor === 'string' ? out.parentAnchor : undefined;
  const normal = face === undefined ? undefined : FACE_NORMALS[face];
  if (!facing || !face || !normal) return;
  if (out.selfAnchor === FACING_SIDE.get(facing.join(','))) return;
  if (out.parent === out.id || isUnder(state, out.parent, out.id as string)) return;
  const anchors = bodyAt(bodies, out.parent, (out.at as number | undefined) ?? 0)?.anchors;
  const at = anchors?.[face];
  if (!at) return;
  // A point the model named "right" that is not on the right of the parent's middle is not a face.
  const middle = anchors.center ?? anchors.origin ?? ZERO;
  if ((at[0] - middle[0]) * normal[0] + (at[1] - middle[1]) * normal[1] + (at[2] - middle[2]) * normal[2] <= 0) return;
  const rot = turnToFace(facing, normal);
  if (!rot) return;
  out.rot = rot;
  note(notes, 'trimmed', `${path}.rot`, `repaired: "${out.id as string}" is attached by ${face}, so its ${out.part} is turned to face out of it (rot [${rot.join(',')}]); write rot to turn it another way`);
}

/** Check declarative socket placement and preview its authored position for surface attachment. Playback resolves the creation-time base transforms. */
function checkMount(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes, bodies: BodyVersions): Vec3 | null | undefined {
  if (out.parentAnchor === undefined && out.selfAnchor === undefined) return undefined;
  const bad = (field: string, message: string): null => { note(notes, 'dropped', `${path}.${field}`, message); return null; };
  const parent = out.parent as string | undefined;
  if (parent === undefined) return bad('parent', 'anchor placement requires parent');
  if (parent === out.id || isUnder(state, parent, out.id as string)) return bad('parent', 'anchor placement would create a parent cycle');
  const parentAnchors = bodyAt(bodies, parent, (out.at as number | undefined) ?? 0)?.anchors ?? { origin: ZERO };
  const selfAnchors = anchorsOf(out);
  const parentName = (out.parentAnchor as string | undefined) ?? 'origin';
  const selfName = (out.selfAnchor as string | undefined) ?? 'origin';
  if (!Object.hasOwn(parentAnchors, parentName)) return bad('parentAnchor', `unknown anchor "${parentName}" on "${parent}"; available: ${Object.keys(parentAnchors).join(', ')}`);
  if (!Object.hasOwn(selfAnchors, selfName)) return bad('selfAnchor', `unknown anchor "${selfName}" on this part; available: ${Object.keys(selfAnchors).join(', ')}`);
  const pos = mountPosition(parentAnchors[parentName]!, selfAnchors[selfName]!, (out.rot as Vec3 | undefined) ?? ZERO, (out.pos as Vec3 | undefined) ?? ZERO);
  // A replacement inherits runtime rotation/scale, which this authored-state preview cannot know.
  // The planner checks its actual solved position before changing either object.
  if (!state.ids.has(out.id as string) && pos.some((v) => !Number.isFinite(v) || v < -100 || v > 100)) return bad('pos', 'resolved anchor placement is outside the scene position range [-100,100]; reduce the offset or part sizes');
  return pos;
}

/** A 3D solid or group is on record where it stands and how big it is; a tube or line has its ends held to the parts they lie on. */
function holdBody(state: SceneState, name: string, out: Record<string, unknown>, path: string, notes: Notes, mountedPos?: Vec3): void {
  const id = out.id as string;
  state.bodies.delete(id);
  state.loose.delete(id);
  const place = { pos: mountedPos ?? (out.pos as Vec3 | undefined) ?? ZERO, rot: (out.rot as Vec3 | undefined) ?? ZERO, parent: out.parent as string | undefined };
  const shape = out.shape as string;
  if (name === 'addSolid') {
    const size = out.size as Vec3;
    if (shape === 'box' || shape === 'sphere' || shape === 'cylinder') state.bodies.set(id, { shape, size, ...place });
    else if (shape === 'plane') state.bodies.set(id, { shape: 'box', size: [size[0], size[1], 0], ...place });
    else state.bodies.set(id, { shape: 'group', ...place }); // a cone or a torus is not asked about, but things hang from it
  } else if (name === 'addPart') state.bodies.set(id, { shape: 'box', ...resolvePartGeometry(out as AddPart), ...place });
  else if (name === 'addModel') state.bodies.set(id, { shape: 'group', ...place });
  else if (name === 'addBlob') state.bodies.set(id, { shape: 'blob', pts: out.pts as Vec3[], sizes: out.sizes as Vec3[], ...place });
  else if (name === 'addExtrude' || name === 'addHull' || name === 'addLathe' || name === 'addShell' || name === 'addLoft' || name === 'addSweep' || name === 'addPatch' || name === 'addGroup') state.bodies.set(id, { shape: 'group', ...place });
  else if (name === 'addTube' || (name === 'addPath' && shape === 'line')) {
    // A tube or line has its ends (start, end) for parts to be attached at, in the space it hangs from.
    if (name === 'addTube' || name === 'addPath') state.bodies.set(id, { shape: 'group', anchors: anchorsOf(out), pos: ZERO, rot: ZERO, ...(typeof out.parent === 'string' ? { parent: out.parent } : {}) });
    if (name === 'addTube' && out.closed === true) return; // A loop has no endpoints to attach.
    holdEnds(state, id, out, path, notes);
    return;
  } else return;
  const body = state.bodies.get(id);
  if (body) body.anchors = anchorsOf(out);
  if (state.bodies.get(id)?.shape !== 'group') landLate(state, id, (out.at as number | undefined) ?? 0, path, notes);
}

const ends = (pts: readonly Vec3[]): [number, number] => [0, pts.length - 1];

/** A tube or line with an end on a part (within a small tolerance of its surface, either side) is meant to touch it: the end is moved onto the surface and kept there. */
function holdEnds(state: SceneState, id: string, out: Record<string, unknown>, path: string, notes: Notes): void {
  const pts = (out.pts as Vec3[]).map((p): Vec3 => [p[0], p[1], p[2]]);
  const tol = attachTolerance(out.radius as number | undefined);
  const slots: EndSlots = [null, null];
  ends(pts).forEach((at, slot) => {
    const hit = landOn(state.bodies, out.parent as string | undefined, pts[at] as Vec3, tol);
    if (!hit) return;
    pts[at] = hit.snapped;
    slots[slot] = { to: hit.part, at: hit.local };
    note(notes, 'trimmed', `${path}.pts[${at}]`, `repaired: the ${slot === 0 ? 'start' : 'end'} of "${id}" lies on "${hit.part}"; it is joined to it and goes with it`);
  });
  if (slots[0] || slots[1]) {
    out.pts = pts;
    out.attach = slots;
  }
  if (!slots[0] || !slots[1]) state.loose.set(id, { action: out, step: state.turnSteps });
}

/** A part has just arrived: a tube or line with an end in the air that lies on it was meant for it, so the tube is made over to end on the part (the same id replaces it). */
function landLate(state: SceneState, part: string, at: number, path: string, notes: Notes): void {
  for (const [id, loose] of [...state.loose]) {
    if (id === part) continue;
    const a = loose.action;
    const pts = (a.pts as Vec3[]).map((p): Vec3 => [p[0], p[1], p[2]]);
    const slots: EndSlots = [...((a.attach as EndSlots | undefined) ?? [null, null])] as EndSlots;
    const tol = attachTolerance(a.radius as number | undefined);
    let changed = false;
    ends(pts).forEach((point, slot) => {
      if (slots[slot]) return;
      const hit = landOn(state.bodies, a.parent as string | undefined, pts[point] as Vec3, tol, part);
      if (!hit) return;
      pts[point] = hit.snapped;
      slots[slot] = { to: hit.part, at: hit.local };
      changed = true;
      note(notes, 'trimmed', path, `repaired: the ${slot === 0 ? 'start' : 'end'} of "${id}" lies on "${part}", which came after it; the tube is made over to end on it`);
    });
    if (!changed) continue;
    // Made over when the part comes in (and not before the tube's own time, when both are in this step).
    const next = { ...a, pts, attach: slots, at: Math.max(at, loose.step === state.turnSteps ? (a.at as number | undefined) ?? 0 : 0) };
    state.after.push(next as unknown as Action);
    if (slots[0] && slots[1]) state.loose.delete(id);
    else state.loose.set(id, { action: next, step: state.turnSteps });
  }
}

/** Validates one action against the state; on success the state has absorbed its effect. */
/** The least a 3D stage may be written (of the 0..1000 screen) before it is read as having no size, and the size it is given then. */
const MIN_STAGE = 40;
const DEFAULT_STAGE = { w: 330, h: 420 };

/**
 * A stage written with no size (0 by 0 has been seen, which drew a whole proof into a speck) takes the size of the stage before it, or a default, and is kept on the screen.
 * Said in a note: nothing the model wrote is changed without one.
 */
function fitStage(raw: Record<string, unknown>, state: SceneState, path: string, notes: Notes): Record<string, unknown> {
  const small = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n < MIN_STAGE;
  const w = own(raw, 'w'), h = own(raw, 'h');
  if (!small(w) && !small(h)) return raw;
  const size = state.stage ?? DEFAULT_STAGE;
  const next: Record<string, unknown> = Object.create(null);
  for (const key of ownKeys(raw)) {
    const d = Object.getOwnPropertyDescriptor(raw, key);
    if (d && 'value' in d) Object.defineProperty(next, key, { value: d.value, writable: true, configurable: true, enumerable: true });
  }
  if (small(w)) {
    next.w = size.w;
    note(notes, 'trimmed', `${path}.w`, `repaired: a stage ${w} wide is too small to hold a model; used ${size.w}`);
  }
  if (small(h)) {
    next.h = size.h;
    note(notes, 'trimmed', `${path}.h`, `repaired: a stage ${h} high is too small to hold a model; used ${size.h}`);
  }
  for (const [at, span] of [['x', 'w'], ['y', 'h']] as const) {
    const from = own(next, at), len = own(next, span);
    if (typeof from === 'number' && Number.isFinite(from) && typeof len === 'number' && Number.isFinite(len) && from + len > 1000) {
      const adjusted = Math.max(0, 1000 - len);
      next[at] = adjusted;
      if (adjusted !== from) note(notes, 'trimmed', `${path}.${at}`, `repaired: stage ${at} ${from} moved to ${adjusted} to fit`);
    }
  }
  return next;
}

/**
 * A shape written as the op (op "force" for add with shape force, as a model has done): read as the add it was meant to be, with a note.
 * This is general: any shape name an `add` takes (sphere, tube, array, group, connector, ...) written as an op is rewritten the same way,
 * each with its own note; a name that is no op and no shape stays dropped, and so does an op that also gives a different shape.
 */
function shapeAsOp(raw: object, path: string, notes: Notes): object {
  const op = own(raw, 'op');
  if (typeof op !== 'string' || VARIANTS.some((v) => v.op === op)) return raw;
  const shape = own(raw, 'shape');
  if (shape !== undefined && shape !== null) return raw;
  if (!VARIANTS.some((v) => v.op === 'add' && (v.shapes as readonly string[] | undefined)?.includes(op))) return raw;
  note(notes, 'trimmed', path, `repaired: op "${op}" read as add with shape ${op}`);
  return { ...raw, op: 'add', shape: op };
}

/**
 * The name of the thing an op acts on: every op calls it `id` except clear, which says `target` (it also takes all, marks and panel). A model writes the
 * one for the other (clear id "eth" seven times in one answer, every one dropped as "missing target"): read it as the field the op wants, with a note.
 * A field that is given in its own name wins, and the id is checked as usual, so a clear of an id that does not exist is still refused.
 */
function subjectName(raw: object, path: string, notes: Notes): object {
  const op = own(raw, 'op');
  if (typeof op !== 'string') return raw;
  const variant = VARIANTS.find((v) => v.op === op && !v.shapes);
  if (!variant) return raw;
  const [want, given] = op === 'clear' ? ['target', 'id'] : variant.fields.id?.k === 'ref' ? ['id', 'target'] : [undefined, undefined];
  if (!want || !given) return raw;
  const value = own(raw, given);
  if (typeof value !== 'string' || (own(raw, want) !== undefined && own(raw, want) !== null)) return raw;
  note(notes, 'trimmed', path, `repaired: ${op} takes ${want}; ${given} "${value.slice(0, 40)}" read as ${want}`);
  const { [given]: _moved, ...rest } = raw as Record<string, unknown>;
  return { ...rest, [want]: value };
}

/**
 * The model an `add model` asks for, by the name it gave: its id, its name or an alias is the model (said in a note when it was not the id). A name that is
 * no model of the catalogue is refused, with the models there are and the way back to building it from shapes.
 */
function modelName(raw: object, path: string, notes: Notes): object | null {
  if (own(raw, 'op') !== 'add' || own(raw, 'shape') !== 'model') return raw;
  const given = own(raw, 'model');
  const { model: found, near } = resolveModel(given);
  if (!found) {
    const nearest = near.length ? `the nearest are ${near.map((m) => m.id).join(', ')}; ` : '';
    note(notes, 'dropped', path, `no model ${typeof given === 'string' ? `"${given.slice(0, 40)}"` : 'name'}; ${nearest}the real models are ${MODELS.map((m) => m.id).join(', ')}: build it from shapes instead`);
    return null;
  }
  if (given !== found.id) note(notes, 'trimmed', path, `repaired: model "${String(given).slice(0, 40)}" is the model "${found.id}"`);
  return { ...raw, model: found.id };
}

function validateAction(rawIn: unknown, state: SceneState, path: string, notes: Notes, parentFirstAt: ReadonlyMap<string, number>, mountedChildrenAt: ReadonlyMap<string, number>, bodies: BodyVersions): Action | null {
  if (!isObject(rawIn)) {
    note(notes, 'dropped', path, 'action is not an object');
    return null;
  }
  const named = modelName(subjectName(shapeAsOp(rawIn, path, notes), path, notes), path, notes);
  if (named === null) return null;
  const raw = named;
  const variant = pickVariant(raw);
  if (typeof variant === 'string') {
    note(notes, 'dropped', path, variant);
    return null;
  }
  // A direction cannot be component-clamped without rotating the requested section.
  // Reject it as a whole before the ordinary vector parser; null still means absent.
  if (variant.name === 'cut') {
    const normal = own(raw, 'normal');
    if (normal !== undefined && normal !== null) {
      if (own(raw, 'axis') !== undefined && own(raw, 'axis') !== null) {
        note(notes, 'dropped', path, 'cut needs either axis or normal, not both');
        return null;
      }
      if (!Array.isArray(normal) || normal.length !== 3 ||
          [0, 1, 2].some(i => typeof normal[i] !== 'number' || !Number.isFinite(normal[i]) || Math.abs(normal[i]) > 100) ||
          normal.every(n => n === 0)) {
        note(notes, 'dropped', path, 'cut normal needs 3 finite numbers from -100 to 100, not all zero');
        return null;
      }
    }
  }
  // A model that is one piece (a scan, a single object) is labelled as a whole: nothing to take apart or cut open.
  if (variant.name === 'explode' || variant.name === 'cut') {
    const target = own(raw, 'id');
    const single = typeof target === 'string' && state.models?.has(target) ? MODELS.find((m) => m.id === state.models!.get(target)) : undefined;
    if (single?.single) {
      note(notes, 'dropped', path, `${variant.name}: "${target}" is the model "${single.id}" (${single.name}), which is one piece with no parts to ${variant.name === 'cut' ? 'cut open' : 'take apart'}; label it as a whole`);
      return null;
    }
  }
  // Strict admission precedes the ordinary, deliberately lenient field parser and any state changes.
  if (variant.name === 'addHull') {
    const result = resolveHullPoints(own(raw, 'pts'));
    if (!result.ok) {
      note(notes, 'dropped', path, `pts: ${result.message}`);
      return null;
    }
  }
  // Strict sector checks precede all field parsing/binding and any scene-state mutation.
  let sectorProfile: Vec2[] | undefined;
  if (variant.name === 'addLathe') {
    const descriptor = Object.getOwnPropertyDescriptor(raw, 'sweep');
    const sweep = own(raw, 'sweep');
    if (descriptor && !('value' in descriptor)) {
      note(notes, 'dropped', path, 'sweep must be a data value');
      return null;
    }
    if (sweep !== undefined && sweep !== null) {
      if (typeof sweep !== 'number' || !Number.isFinite(sweep) || sweep < 1 || sweep > 359) {
        note(notes, 'dropped', path, 'sector sweep must be finite and within 1..359 degrees');
        return null;
      }
      const normalized = normalizeSectorProfile(own(raw, 'profile'));
      if (!normalized.ok) {
        note(notes, 'dropped', path, normalized.reason);
        return null;
      }
      const sides = own(raw, 'sides');
      if (sides !== undefined && sides !== null && (typeof sides !== 'number' || !Number.isFinite(sides))) {
        note(notes, 'dropped', path, 'sector sides must be a finite number');
        return null;
      }
      const resolutions = typeof sides === 'number' ? [Math.min(64, Math.max(3, Math.round(sides)))] : [20, 36, 64];
      if (resolutions.some(resolution => prepareSectorRings(normalized.profile, resolution, sweep) === null)) {
        note(notes, 'dropped', path, 'sector profile loses triangle geometry or orientation after Float32 rotation');
        return null;
      }
      sectorProfile = normalized.profile;
    }
  }
  // Deformed outlines must not be clamped or truncated, nor consume replacement state on rejection.
  let taperedOutline: Vec2[] | undefined;
  if (variant.name === 'addExtrude') {
    const taper = own(raw, 'taper'), shift = own(raw, 'shift');
    for (const field of ['taper', 'shift']) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, field);
      if (descriptor && !('value' in descriptor)) { note(notes, 'dropped', path, `${field} must be a data value`); return null; }
    }
    if (taper != null || shift != null) {
      for (const field of ['outline', 'depth', 'bevel', 'holes']) {
        const descriptor = Object.getOwnPropertyDescriptor(raw, field);
        if (descriptor && !('value' in descriptor)) { note(notes, 'dropped', path, `${field} must be a data value`); return null; }
      }
      const bevel = own(raw, 'bevel'), holes = own(raw, 'holes');
      if ((bevel != null && bevel !== 0) || (holes != null && (!Array.isArray(holes) || holes.length !== 0))) {
        note(notes, 'dropped', path, 'tapered extrusions require zero bevel and no through-holes'); return null;
      }
      const prepared = prepareTaperedExtrusion(own(raw, 'outline'), own(raw, 'depth'), taper ?? 1, shift ?? [0, 0]);
      if (!prepared.ok) { note(notes, 'dropped', path, prepared.reason); return null; }
      taperedOutline = prepared.value.outline;
    }
  }
  // A fixed control net must not pass through ordinary list trimming or coordinate
  // clamping. Preflight before identity, hierarchy or replacement state can change.
  if (variant.name === 'addPatch') {
    const pts = readPatchControls(own(raw, 'pts'));
    if (!pts || !Object.values(PATCH_SEGMENTS).every((n) => preparePatch(pts, n))) {
      note(notes, 'dropped', `${path}.pts`, 'patch needs exactly 16 finite controls in -100..100, with no collapsed, singular or reversed sampled faces at any quality tier');
      return null;
    }
  }
  const input = variant.op === 'panel' ? fitStage(raw as Record<string, unknown>, state, path, notes) : raw;
  // Do not let the ordinary outline parser truncate or clamp a perforated profile.
  const rawHoles = variant.name === 'addExtrude' ? own(input, 'holes') : undefined;
  if (Array.isArray(rawHoles) && rawHoles.length > 0) {
    const outer = own(input, 'outline');
    if (!Array.isArray(outer) || outer.length < 3 || outer.length > LIMITS.maxOutline || outer.some((p) => !Array.isArray(p) || p.length !== 2 || [p[0], p[1]].some((n) => typeof n !== 'number' || !Number.isFinite(n) || n < -100 || n > 100))) {
      note(notes, 'dropped', `${path}.outline`, `perforated outline needs 3 to ${LIMITS.maxOutline} finite points in the world range`);
      return null;
    }
  }
  const out: Record<string, unknown> = { op: variant.op };
  // Fields that name a part already in the scene are bound in one place (bind.ts) once the others are read.
  const bindings = BINDINGS[variant.name];
  const bound = new Set(bindings?.flatMap((b) => (b.alias === undefined ? [b.field] : [b.field, b.alias])));
  for (const [name, f] of Object.entries(variant.fields)) {
    // Cheap id/parent checks precede expensive geometry. Held forward references
    // can be retried after every accepted action. Validate raw geometry before any
    // generic point parser can trim, clamp or read an accessor, and before state changes.
    if (variant.name === 'addSweep' && name === 'outline' && !Object.values(SWEEP_SUBDIVISIONS).every(n => prepareSweep(own(input, 'outline'), own(input, 'pts'), own(input, 'up'), n))) {
      note(notes, 'dropped', path, 'sweep needs a simple 3–24 point outline, 2–16 distinct path controls, a usable initial up direction and a nonfolded Float32 mesh at every quality');
      return null;
    }
    // Resolve cheap ID/parent fields first: held references can be retried often.
    // Check raw profiles before point parsing can trim, clamp or invoke a getter.
    if (variant.name === 'addLoft' && name === 'outline' && !Object.values(LOFT_STRIPS).every(n => prepareLoft(own(input, 'outline'), own(input, 'endOutline'), own(input, 'depth'), n))) {
      note(notes, 'dropped', path, 'loft needs matching 3–24 corner convex outlines with the same winding, depth 0.01–100, and safe intermediate sections and Float32 meshes at every quality');
      return null;
    }
    // ID/parent checks stay cheap for held references; geometry fields must not be clamped or invoke accessors.
    if (variant.name === 'addShell' && name === 'size' && !(Object.keys(SHELL_DETAIL) as ShellTier[]).every(tier => prepareShell(own(input, 'size'), own(input, 'inner'), own(input, 'latitude'), own(input, 'sweep'), tier))) {
      note(notes, 'dropped', path, 'shell needs size .01–100, inner .01–.99, increasing latitude -90–90 spanning at least 1 degree, sweep 1–360, and safe Float32 surfaces at every quality');
      return null;
    }
    if (bound.has(name)) continue;
    if (name === 'profile' && sectorProfile) { out.profile = sectorProfile; continue; }
    if (name === 'outline' && taperedOutline) { out.outline = taperedOutline; continue; }
    const v = own(input, name);
    const optional = 'opt' in f && f.opt === true;
    if (v === undefined || v === null) {
      if (!optional) {
        note(notes, 'dropped', path, `missing ${name}`);
        return null;
      }
      continue;
    }
    const p = parseField(f, v, `${path}.${name}`, state, notes);
    if (!p.ok) {
      note(notes, 'dropped', path, `${name}: ${p.why}`);
      return null;
    }
    out[name] = p.value;
  }
  if (variant.name === 'addExtrude' && Array.isArray(out.holes) && out.holes.length > 0) {
    const issue = extrudeProfileIssue(out.outline as Vec2[], out.holes as Vec2[][]);
    if (issue) {
      note(notes, 'dropped', `${path}.${issue.field}`, issue.message);
      return null;
    }
    if (typeof out.bevel === 'number' && out.bevel > 0) note(notes, 'clamped', `${path}.bevel`, 'perforated extrusions use flat edges; bevel reduced to 0');
    out.bevel = 0;
  }
  if (bindings && !bindParts(bindings, (n) => own(input, n), out, state, path, (kind, at, why) => note(notes, kind, at, why))) return null;
  if (variant.op === 'add' && typeof out.parent === 'string' && (parentFirstAt.get(out.parent) ?? 0) > ((out.at as number | undefined) ?? 0)) {
    note(notes, 'dropped', `${path}.parent`, `parent "${out.parent}" starts after this child; schedule the parent no later than the child`);
    return null;
  }
  if (variant.creates && state.ids.has(out.id as string) && (mountedChildrenAt.get(out.id as string) ?? -Infinity) >= ((out.at as number | undefined) ?? 0)) {
    note(notes, 'dropped', path, 'define or replace the parent before its mounted children; a later-written replacement cannot precede an accepted mount');
    return null;
  }
  faceTurn(out, state, path, notes, bodies);
  const mountedPos = checkMount(out, state, path, notes, bodies);
  if (mountedPos === null) return null;
  if (variant.op === 'panel' && typeof out.w === 'number' && typeof out.h === 'number') state.stage = { w: out.w, h: out.h };
  const locked = LOCKS[variant.name] !== undefined ? out[LOCKS[variant.name] as string] : undefined;
  if (typeof locked === 'string' && state.follows.has(locked)) {
    // A lock reads the angle the part spins at; a part that only follows another through a coupling has none of its own.
    let root = locked;
    for (let n = 0; state.follows.has(root) && n < 64; n++) root = state.follows.get(root) as string;
    note(notes, 'dropped', `${path}.${LOCKS[variant.name]}`, `"${locked}" follows "${root}" through a coupling, so nothing spins it itself; lock it to "${root}" (ratio sets the speed)`);
    return null;
  }
  for (const key of ownKeys(input)) {
    if (key !== 'op' && !(key in variant.fields)) note(notes, 'trimmed', `${path}.${key.slice(0, 40)}`, 'unknown field ignored');
  }
  if (variant.name === 'anchor') {
    if (!nameAnchor(out, state, path, notes)) return null;
    out.at = parentFirstAt.get(out.id as string) ?? 0; // the name exists from when its object does, so a part scheduled then can use it
  }
  if (variant.name === 'style' && out.color === undefined && out.opacity === undefined) {
    note(notes, 'dropped', path, 'style needs a colour or an opacity');
    return null;
  }
  if (variant.name === 'spin' && out.rpm === undefined && out.by === undefined) {
    note(notes, 'dropped', path, 'spin needs rpm or by');
    return null;
  }
  if (variant.name === 'spin' && !checkSpin(out, state, path, notes)) return null;
  if ((variant.name === 'loop' || variant.name === 'couple') && state.muscled?.has(out.id as string)) {
    if (variant.name === 'loop' && out.kind === 'stop') state.muscled.delete(out.id as string);
    else if (!(variant.name === 'couple' && out.stop === true)) {
      note(notes, 'dropped', path, `a muscle pulls "${out.id as string}" already; write loop with kind stop to free it first`);
      return null;
    }
  }
  if (variant.name === 'loop' && out.kind !== 'stop') {
    // The kind is the object's joint when left out; an amount is a travel, an angle or a size factor by its kind, each in a range that still reads as that motion.
    const joint = state.joints.get(out.id as string);
    const kind = (out.kind as string | undefined) ?? (joint === 'hinge' || joint === 'pivot' || joint === 'ball' ? 'swing' : joint === 'slide' ? 'slide' : undefined);
    if (kind === undefined) {
      note(notes, 'dropped', path, 'loop needs a kind, or a hinge, pivot, ball or slide joint on the object');
      return null;
    }
    const amount = out.amount as number | undefined;
    if (amount === undefined) {
      note(notes, 'dropped', path, 'loop needs an amount');
      return null;
    }
    const [low, high] = kind === 'slide' || kind === 'float' ? [0.01, 100] : kind === 'swing' ? [-180, 180] : kind === 'gate' ? [-170, 170] : [0.1, 5];
    const held = Math.min(high, Math.max(low, amount));
    if (held !== amount) {
      note(notes, 'clamped', `${path}.amount`, `${kind} amount ${amount} held to ${held}`);
      out.amount = held;
    }
  }
  if (variant.name === 'addConnector' && out.from === out.to) {
    note(notes, 'dropped', path, 'a connector joins two different objects (from and to are the same)');
    return null;
  }
  if (variant.name === 'addConnector' && out.kind === 'wrapped' && ['fromPoint', 'toPoint', 'swell', 'restLength'].some(k => out[k] !== undefined)) {
    note(notes, 'dropped', path, 'local endpoint points, swell and restLength require a straight or slack connector, not a wrapped belt');
    return null;
  }
  if (variant.name === 'addStream' && out.period === 0) {
    delete out.period;
    note(notes, 'trimmed', `${path}.period`, 'period 0 would not move; the default is used');
  }
  if (variant.name === 'joint' && !checkJoint(out, state, path, notes)) return null;
  if (variant.name === 'couple' && !checkCouple(out, state, path, notes)) return null;
  if (variant.name === 'lever' && !checkLever(out, state, path, notes)) return null;
  if (variant.name === 'pulley' && !checkPulley(out, state, path, notes)) return null;
  if (variant.name === 'muscle' && !checkMuscle(out, state, path, notes)) return null;
  if (variant.name === 'pendulum' && out.from === undefined && out.pivot === undefined) {
    note(notes, 'dropped', path, 'pendulum needs from (the part it hangs from) or pivot (the hang point, from the weight)');
    return null;
  }
  if (variant.name === 'pendulum' && out.from === out.id) {
    note(notes, 'dropped', `${path}.from`, 'a pendulum hangs from a different part');
    return null;
  }
  if (variant.name === 'wave' && !checkWave(out, state, path, notes)) return null;
  if (variant.name === 'addForce' && !checkForce(out, state, path, notes)) return null;
  if (variant.name === 'pump' && !checkPump(out, state, path, notes)) return null;
  if (variant.name === 'incline' && !checkIncline(out, state, path, notes)) return null;
  if (variant.name === 'wedge' && !checkMachine(out, state, path, notes, 'drives', 'slide')) return null;
  if (variant.name === 'screw' && !checkMachine(out, state, path, notes, 'screw', 'slide')) return null;
  if (variant.name === 'addTube' && out.closed === true && new Set((out.pts as Vec3[]).map((p) => p.join(','))).size < 3) {
    note(notes, 'dropped', `${path}.pts`, 'a closed tube needs at least three distinct points');
    return null;
  }
  if (variant.name === 'addBlob') {
    // One size for each lump: a short list repeats its last, a long one is cut.
    const pts = out.pts as unknown[];
    const sizes = out.sizes as unknown[];
    if (sizes.length !== pts.length) {
      note(notes, 'trimmed', `${path}.sizes`, `sizes made to ${pts.length} (one for each point)`);
      out.sizes = Array.from({ length: pts.length }, (_, i) => sizes[Math.min(i, sizes.length - 1)]);
    }
  }
  if (variant.name === 'card') {
    const rows = out.rows as string[] | undefined;
    if (out.title === undefined && (!rows || rows.length === 0)) {
      note(notes, 'dropped', path, 'card needs a title or rows');
      return null;
    }
  }
  if (DIAGRAM_PIECES.has(variant.name) && !checkDiagramPiece(variant.name, out, state, path, notes)) return null;
  if (variant.name === 'addArray') {
    const of = out.of as string;
    let subtree = 1;
    for (const [child] of state.parents) if (child !== of && isUnder(state, child, of)) subtree++;
    const made = ((out.count as number) - 1) * subtree;
    if (state.copies + made > LIMITS.maxCopies) {
      note(notes, 'dropped', path, `arrays may make ${LIMITS.maxCopies} copies in all`);
      return null;
    }
    state.copies += made;
  }
  if (variant.creates) {
    const id = out.id as string;
    // An id from the scene already on screen, written again, replaces the old one: any 3D object for any other (a box for a kit part, a cylinder for a tube), a mark, pin or text only for its own kind.
    const replacing = state.replaceable?.has(id) === true && state.ids.has(id);
    // A stream on an arrow of a flow diagram belongs to the diagram (a clear of the marks takes it); on a path it is a 3D object.
    const kind: ObjectKind = variant.name === 'addStream' && state.ids.get(out.along as string) === 'edge' ? 'dot' : variant.creates;
    if (replacing && !swappable(state.ids.get(id), kind)) {
      note(notes, 'dropped', path, `"${id}" is already on screen as something that cannot be swapped for this`);
      return null;
    }
    if (!replacing && state.ids.size >= LIMITS.maxObjects) {
      note(notes, 'dropped', path, `scene already holds ${LIMITS.maxObjects} objects`);
      return null;
    }
    if (replacing && state.replaceNote) note(notes, 'trimmed', path, `repaired: "${id}" was already on screen; this replaces it (clear it first to start it over)`);
    state.replaceable?.delete(id);
    const parent = (variant.attach ? out[variant.attach] : out.parent) as string | undefined;
    state.ids.set(id, kind);
    // A real model brings its named parts: each is an object of its own, under the model, so every op that names an object can name one.
    if (variant.name === 'addModel') {
      const model = findModel(out.model)!;
      // Written again, only its own named parts go (the new model brings its own); what the author attached to the model or to a part stays attached.
      const before = state.models?.has(id) ? MODELS.find((m) => m.id === state.models!.get(id)) : undefined;
      for (const p of before?.parts ?? []) {
        const old = partId(id, p.key);
        state.ids.delete(old); state.parents.delete(old); state.depth.delete(old);
      }
      (state.models ??= new Map()).set(id, model.id);
      // A model of one piece has no parts to name: only the whole is an id (the planner still draws it as one part).
      for (const p of model.single ? [] : model.parts) {
        const pid = partId(id, p.key);
        state.ids.set(pid, 'group');
        state.parents.set(pid, id);
        state.depth.set(pid, (parent === undefined ? 1 : (state.depth.get(parent) ?? 0) + 1) + 1);
      }
      // What hung from a part the new model does not have hangs from the model itself.
      for (const [child, owner] of state.parents) if (owner?.startsWith(`${id}.`) && owner !== undefined && !state.ids.has(owner)) state.parents.set(child, id);
    } else state.models?.delete(id);
    if (variant.creates === 'diagram') state.diagramKinds.set(id, out.kind as DiagramKind);
    else state.diagramKinds.delete(id);
    if (variant.name === 'addPart') state.parts.set(id, out.part as string);
    else state.parts.delete(id);
    if (variant.name === 'addConnector') (state.connectors ??= new Map()).set(id, { from: out.from as string, to: out.to as string });
    else state.connectors?.delete(id);
    if (variant.name === 'addTube') (state.tubes ??= new Map()).set(id, { closed: out.closed === true });
    else state.tubes?.delete(id);
    state.parents.set(id, parent);
    state.depth.set(id, parent === undefined ? 1 : (state.depth.get(parent) ?? 0) + 1);
    holdBody(state, variant.name, out, path, notes, mountedPos);
  } else if (variant.op === 'clear') {
    applyClear(state, out.target as string);
  }
  return out as Action;
}

/** Whether a chain of followers (a follows b follows c...) comes back to `start`. */
function comesBack(links: ReadonlyMap<string, string>, from: string, start: string): boolean {
  for (let cur: string | undefined = from, n = 0; cur !== undefined && n < 64; cur = links.get(cur), n++) if (cur === start) return true;
  return false;
}

/** A named point on an object, in its own space: on record with the object's others, so a later part can be attached at it. */
function nameAnchor(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  const name = out.name as string;
  const body = state.bodies.get(id);
  if (!body) {
    note(notes, 'dropped', path, `"${id}" has no shape to name a point on (a text, array or mark cannot have one)`);
    return false;
  }
  if (name === 'origin') {
    note(notes, 'dropped', `${path}.name`, 'origin is always the object\'s own zero; choose another name');
    return false;
  }
  body.anchors = { ...(body.anchors ?? { origin: ZERO }), [name]: out.pos as Vec3 };
  return true;
}

/** A joint: a fixed one needs the object it rides with (never in a ride that comes round to itself), limits run low to high; then it is on record. */
function checkJoint(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  if (out.kind === 'fixed') {
    const to = out.to as string | undefined;
    if (to === undefined) {
      note(notes, 'dropped', path, 'a fixed joint needs to, the object it rides with');
      return false;
    }
    if (comesBack(state.rides, to, id)) {
      note(notes, 'dropped', `${path}.to`, `${id} cannot ride with ${to}: that rides with ${id} already`);
      return false;
    }
    state.rides.set(id, to);
  } else {
    delete out.to;
    state.rides.delete(id);
  }
  if (typeof out.min === 'number' && typeof out.max === 'number' && out.min > out.max) {
    note(notes, 'trimmed', `${path}.min`, 'min was above max; they are swapped');
    [out.min, out.max] = [out.max, out.min];
  }
  // A point to turn about is named by the part's own points: one that is not there drops the joint, saying which are.
  if (out.about !== undefined) {
    const points = state.bodies.get(id)?.anchors ?? { origin: ZERO };
    if (!Object.hasOwn(points, out.about as string)) {
      note(notes, 'dropped', `${path}.about`, `unknown point "${String(out.about)}" on "${id}"; available: ${Object.keys(points).join(', ')}`);
      return false;
    }
    delete out.pivot;
  }
  if (out.kind !== 'ball') delete out.limit;
  if (out.kind !== 'hinge' && out.kind !== 'ball') delete out.about;
  state.joints.set(id, out.kind as 'hinge' | 'slide' | 'fixed' | 'pivot' | 'ball');
  (state.jointRanges ??= new Map()).set(id, { min: out.min as number | undefined, max: out.max as number | undefined });
  return true;
}

/**
 * A spin on a part inside a part that already spins about the same axis: it turns with its holder already, so a spin of its own would add to that and turn it
 * twice as fast (a bicycle's wheel parented to its spinning rear cog, then spun again). The second spin is dropped, saying which part it already turns with.
 * The other order is the same fault: a part inside this one already spins about the axis (the wheel was spun first, then its holder). The holder's spin
 * is the one kept, so the part's own is stopped (a spin of rate zero, written after) with a note.
 */
function checkSpin(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  const axis = (out.axis as 'x' | 'y' | 'z' | undefined) ?? state.spins.get(id) ?? 'z';
  if (out.rpm === 0) {
    // A stop aimed at one axis (the validator's own) leaves the spin it does not name; the record of a spin still running is kept.
    if (!(out.onlyAxis === true && state.spins.has(id) && state.spins.get(id) !== axis)) state.spins.delete(id);
    return true;
  }
  for (let cur = state.parents.get(id), n = 0; cur !== undefined && n < 32; cur = state.parents.get(cur), n++) {
    if (state.spins.get(cur) === axis) {
      note(notes, 'dropped', path, `${id} is inside ${cur}, which already spins about ${axis}: it turns with it, and a spin of its own would turn it twice as fast`);
      return false;
    }
  }
  for (const [inner, innerAxis] of [...state.spins]) {
    if (inner === id || innerAxis !== axis) continue;
    let inside = false;
    for (let cur = state.parents.get(inner), n = 0; cur !== undefined && n < 32; cur = state.parents.get(cur), n++) if (cur === id) { inside = true; break; }
    if (!inside) continue;
    note(notes, 'trimmed', path, `${inner} is inside ${id}, which now spins about ${axis}: it turns with it, so its own spin about ${axis} is stopped (it would turn twice as fast)`);
    state.spins.delete(inner);
    state.after.push({ op: 'spin', id: inner, rpm: 0, axis, onlyAxis: true, dur: 0, at: (out.at as number | undefined) ?? 0 } as unknown as Action);
  }
  state.spins.set(id, axis);
  return true;
}

/** A coupling: never an object to itself (bound out already), never a loop of followers, a hinge and a slide only through a pitch. */
function checkCouple(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  const by = out.by as string | undefined;
  if (out.stop === true) {
    state.follows.delete(id);
    return true;
  }
  if (by === undefined) {
    note(notes, 'dropped', path, 'couple needs by, the part that drives it (or stop)');
    return false;
  }
  if (comesBack(state.follows, by, id)) {
    note(notes, 'dropped', `${path}.by`, `${id} cannot follow ${by}: that follows ${id} already (a coupling loop)`);
    return false;
  }
  // A pivot is a hinge about the part's own axis: coupled to one as to a hinge.
  const kindOf = (k: string | undefined): string | undefined => (k === 'pivot' ? 'hinge' : k);
  const mine = kindOf(state.joints.get(id));
  const theirs = kindOf(state.joints.get(by));
  if (state.joints.get(id) === 'ball' || state.joints.get(by) === 'ball') {
    note(notes, 'dropped', path, 'a ball joint is driven by a swing loop or spin on each axis, not coupled');
    return false;
  }
  if (out.pitch === undefined && mine !== undefined && theirs !== undefined && mine !== 'fixed' && theirs !== 'fixed' && mine !== theirs) {
    note(notes, 'dropped', path, `a ${theirs} and a ${mine} are coupled with pitch (units of travel for a turn), not ratio`);
    return false;
  }
  state.follows.set(id, by);
  return true;
}

/** A lever is a hinge at a point of its beam: the point must be there. */
function checkLever(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  const fulcrum = (out.fulcrum as string | undefined) ?? 'center';
  const points = state.bodies.get(id)?.anchors ?? { origin: ZERO };
  if (!Object.hasOwn(points, fulcrum)) {
    note(notes, 'dropped', `${path}.fulcrum`, `unknown point "${fulcrum}" on "${id}"; available: ${Object.keys(points).join(', ')}`);
    return false;
  }
  out.fulcrum = fulcrum;
  state.joints.set(id, 'hinge');
  return true;
}

/** A muscle is a connector with an end on the part it pulls, and that part has a hinge or pivot for it to turn; its other end is on the part's holder or beside it. */
function checkMuscle(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  let pulls = out.pulls as string;
  const conn = state.connectors?.get(id);
  if (!conn) {
    note(notes, 'dropped', path, `muscle needs id to be a connector (add one with shape connector first); "${id}" is not`);
    return false;
  }
  // The end may be said as from or to, the connector's own names for them, when no part has that id.
  if ((pulls === 'from' || pulls === 'to') && !state.ids.has(pulls)) {
    pulls = conn[pulls];
    out.pulls = pulls;
  }
  if (!state.ids.has(pulls)) {
    note(notes, 'dropped', `${path}.pulls`, `unknown id "${pulls}" (the ends of "${id}" are ${conn.from} and ${conn.to})`);
    return false;
  }
  if (conn.from !== pulls && conn.to !== pulls) {
    note(notes, 'dropped', `${path}.pulls`, `"${pulls}" is not an end of connector "${id}" (it joins ${conn.from} and ${conn.to})`);
    return false;
  }
  const joint = state.joints.get(pulls);
  if (joint !== 'hinge' && joint !== 'pivot') {
    note(notes, 'dropped', `${path}.pulls`, `a muscle turns a hinge or pivot joint: give "${pulls}" one first (joint hinge about its end, or pivot) with min and max`);
    return false;
  }
  // Whether the joint can shorten the muscle depends on which way it pulls (the validator does not know), but a joint with no room at all is plain.
  const range = state.jointRanges?.get(pulls);
  if (range && range.min !== undefined && range.max !== undefined && range.max - range.min < 2) {
    note(notes, 'trimmed', `${path}.pulls`, `the joint of "${pulls}" can turn only ${Math.max(0, range.max - range.min)} degrees (min ${range.min}, max ${range.max}): the muscle cannot move it; give it min and max wide enough for the way it pulls (like -120 to 120)`);
  }
  (state.muscled ??= new Set()).add(pulls);
  return true;
}

/** A wave runs along a tube that is open at its ends. */
function checkWave(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  const tube = state.tubes?.get(id);
  if (!tube) {
    note(notes, 'dropped', path, `a wave runs along a tube: "${id}" is not one (add a tube first, or run a stream along a line)`);
    return false;
  }
  if (tube.closed) {
    note(notes, 'dropped', path, `"${id}" is a closed loop: a wave needs a tube open at both ends (a stream can run round a loop)`);
    return false;
  }
  if (out.period === 0) {
    delete out.period;
    note(notes, 'trimmed', `${path}.period`, 'period 0 would not move; the default is used');
  }
  return true;
}

/** A force arrow starts at a point of the part it acts on and points somewhere. */
function checkForce(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const dir = out.dir as Vec3;
  if (Math.hypot(dir[0], dir[1], dir[2]) < 1e-6) {
    note(notes, 'dropped', `${path}.dir`, 'a force needs a direction: [0,-1,0] is down');
    return false;
  }
  const on = out.on as string;
  const point = out.point as string | undefined;
  const points = state.bodies.get(on)?.anchors;
  if (point !== undefined && points && !Object.hasOwn(points, point)) {
    note(notes, 'dropped', `${path}.point`, `unknown point "${point}" on "${on}"; available: ${Object.keys(points).join(', ')}`);
    return false;
  }
  return true;
}

/** A pump has a chamber and at least one valve, all different parts; each valve is a hinge. */
function checkPump(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  const valves = ['inlet', 'outlet'].filter((k) => out[k] !== undefined);
  if (valves.length === 0) {
    note(notes, 'dropped', path, 'pump needs an inlet or an outlet valve (the parts that open and shut)');
    return false;
  }
  if (out.inlet !== undefined && out.inlet === out.outlet) {
    note(notes, 'dropped', path, 'the inlet and the outlet of a pump are different parts');
    return false;
  }
  for (const k of valves) {
    if (out[k] === id) {
      note(notes, 'dropped', `${path}.${k}`, 'a valve is a different part from the chamber');
      return false;
    }
  }
  const points = (key: string): Record<string, unknown> | undefined => state.bodies.get(out[key] as string)?.anchors;
  const hinge = (out.hinge as string | undefined) ?? 'left';
  for (const k of valves) {
    const known = points(k);
    if (known && !Object.hasOwn(known, hinge)) {
      note(notes, 'dropped', `${path}.hinge`, `unknown point "${hinge}" on "${out[k] as string}"; available: ${Object.keys(known).join(', ')}`);
      return false;
    }
  }
  for (const k of valves) state.joints.set(out[k] as string, 'hinge');
  return true;
}

/** An inclined plane needs its slope: the ramp it lies on, or an angle. */
function checkIncline(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  if (out.ramp === undefined && out.angle === undefined) {
    note(notes, 'dropped', path, 'incline needs ramp (the sloping part) or angle (degrees of slope)');
    return false;
  }
  if (out.ramp === out.id) {
    note(notes, 'dropped', `${path}.ramp`, 'the load and the ramp are different parts');
    return false;
  }
  state.joints.set(out.id as string, 'slide');
  return true;
}

/** A wedge and the part it drives, or a screw and its nut: two different parts, the second following the first. */
function checkMachine(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes, other: string, kind: 'slide'): boolean {
  const id = out.id as string;
  const mate = out[other] as string;
  if (mate === id) {
    note(notes, 'dropped', path, `${id} and ${mate} are different parts`);
    return false;
  }
  const follower = other === 'drives' ? mate : id;
  const leader = other === 'drives' ? id : mate;
  if (comesBack(state.follows, leader, follower)) {
    note(notes, 'dropped', `${path}.${other}`, `${follower} cannot follow ${leader}: that follows ${follower} already (a coupling loop)`);
    return false;
  }
  state.joints.set(follower, kind);
  if (other === 'drives') state.joints.set(id, 'slide');
  state.follows.set(follower, leader);
  return true;
}

/** A pulley's load slides and follows the wheel, which turns by its own spin: neither may be the other. */
function checkPulley(out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const id = out.id as string;
  const wheel = out.wheel as string;
  if (wheel === id) {
    note(notes, 'dropped', path, 'a pulley\'s load and wheel are different parts');
    return false;
  }
  if (comesBack(state.follows, wheel, id)) {
    note(notes, 'dropped', `${path}.wheel`, `${id} cannot follow ${wheel}: that follows ${id} already (a coupling loop)`);
    return false;
  }
  state.joints.set(id, 'slide');
  state.follows.set(id, wheel);
  return true;
}

/** The field of each machine op that names the part it is locked to. */
const LOCKS: Readonly<Record<string, string>> = { loop: 'by', spin: 'by', cam: 'by', flash: 'by', crank: 'shaft', addStream: 'by' };

const DIAGRAM_PIECES: ReadonlySet<string> = new Set(['diagram', 'node', 'edge', 'series', 'dot', 'tick']);

/** The diagram a node, edge, series or dot is drawn in (an edge hangs from its first node). */
function diagramOf(state: SceneState, id: string): string | undefined {
  for (let cur: string | undefined = id, n = 0; cur !== undefined && n < 8; cur = state.parents.get(cur), n++) {
    if (state.ids.get(cur) === 'diagram') return cur;
  }
  return undefined;
}

/** What each kind of diagram may hold, and how much. */
const DIAGRAM_HOLDS: Record<DiagramKind, readonly string[]> = {
  flow: ['node', 'edge'], timeline: ['node'], steps: ['node'], chart: ['series', 'dot'],
};
const PIECE_KIND: Record<string, ObjectKind> = { node: 'node', edge: 'edge', series: 'series', dot: 'dot' };
const PIECE_CAP: Record<string, number> = { node: LIMITS.maxNodes, edge: LIMITS.maxEdges, series: LIMITS.maxSeries, dot: LIMITS.maxDots };

/** Whether a diagram, or a piece of one, fits the diagram it is for: its kind, the caps, and what an edge joins. Notes why not. */
function checkDiagramPiece(name: string, out: Record<string, unknown>, state: SceneState, path: string, notes: Notes): boolean {
  const drop = (why: string): false => {
    note(notes, 'dropped', path, why);
    return false;
  };
  const id = out.id as string | undefined;
  if (name === 'diagram') {
    const replacing = id !== undefined && state.ids.get(id) === 'diagram';
    let alive = 0;
    for (const kind of state.ids.values()) if (kind === 'diagram') alive++;
    return !replacing && alive >= LIMITS.maxDiagrams ? drop(`${LIMITS.maxDiagrams} diagrams are on screen already; clear one first`) : true;
  }
  if (name === 'tick') {
    const home = diagramOf(state, out.id as string);
    return home !== undefined && state.diagramKinds.get(home) === 'steps' ? true : drop('tick is for a step of a steps diagram');
  }
  const home = name === 'edge' ? diagramOf(state, out.from as string) : (out.of as string);
  const homeKind = home !== undefined ? state.diagramKinds.get(home) : undefined;
  if (home === undefined || homeKind === undefined) return drop('no such diagram');
  if (!DIAGRAM_HOLDS[homeKind].includes(name)) return drop(`a ${homeKind} diagram holds ${DIAGRAM_HOLDS[homeKind].join(' and ')}, not ${name}`);
  if (name === 'edge') {
    if (out.from === out.to) return drop('an edge joins two different nodes');
    if (diagramOf(state, out.to as string) !== home) return drop('an edge joins nodes of the same diagram');
  }
  // The caps count what the diagram holds already; a piece written again under its id takes the old one's place.
  const kind = PIECE_KIND[name];
  const replacing = id !== undefined && state.ids.get(id) === kind && diagramOf(state, id) === home;
  let held = 0;
  for (const [other, k] of state.ids) if (k === kind && diagramOf(state, other) === home) held++;
  if (!replacing && held >= (PIECE_CAP[name] as number)) return drop(`a diagram holds at most ${PIECE_CAP[name]} ${name}s`);
  return true;
}

const SOLID_KINDS: ReadonlySet<string | undefined> = new Set(['solid', 'path', 'group']);

/** Whether an object of kind `now` may be replaced by one of kind `next`: any swap among 3D objects, the same kind for the rest. */
function swappable(now: string | undefined, next: string): boolean {
  return now === next || (SOLID_KINDS.has(now) && SOLID_KINDS.has(next));
}

/** What a live step tells its caller as the step is written. */
export type LiveStepEvents = {
  /** The step has begun: these are its words (cleaned), to be spoken. Always called before any action. */
  open(say: string): void;
  /** An action was accepted, and is to be drawn now. */
  action(action: Action, derived?: boolean): void;
};

export type LiveStep = {
  /** The step's `say` text arrived (raw). A second one is ignored. */
  say(raw: unknown): void;
  /** An action arrived (raw). */
  action(raw: unknown): void;
  /** The step is complete: what is still held is tried a last time, and the step is what was accepted. */
  finish(): StepResult;
  /** True once the step is over its place in the turn (too many steps): nothing in it will be kept. */
  readonly refused: boolean;
};

/** The per-step action cap also bounds held unresolved actions. */
const HELD_MAX = LIMITS.maxActionsPerStep;

type Held = { raw: unknown; path: string; why: Notes };

/**
 * A step validated as it is written: the words first, then each action as it arrives, against the ids
 * the scene already holds. An action that names an object not seen yet (an array before the object it
 * copies, a pin before its part) is held until the step ends, then conservatively repaired or dropped with its reason. Actions
 * that arrive before the words are kept until the words come, or the step ends. The same limits apply as
 * to a whole step, so what is drawn as it streams is exactly what validateStep would have kept.
 */
export function beginLiveStep(state: SceneState, events: LiveStepEvents, index: number = state.turnSteps, slotTaken = false): LiveStep {
  const notes: Notes = [];
  const path = `steps[${index}]`;
  const kept: Action[] = [];
  // A lower bound on parent birth, not lifetime validation: authored state cannot prove past clear/reparent timing.
  const parentFirstAt = new Map<string, number>([...state.ids.keys()].map((id) => [id, 0]));
  // Streaming preserves arrival order. A replacement cannot retroactively redefine a mount already emitted.
  const mountedChildrenAt = new Map<string, number>();
  // A future source-first replacement must not erase sockets that still exist at an earlier mount.
  const bodies = new Map<string, { at: number; body: Body | undefined }[]>(
    [...state.ids.keys()].map((id) => [id, [{ at: -Infinity, body: state.bodies.get(id) }]]),
  );
  const early: unknown[] = [];
  let held: Held[] = [];
  // Names declared in this bounded step remain reserved even if their creator fails.
  const declared = new Set<string>();
  let said = false;
  let spoken = '';
  let seen = 0;
  let cutNoted = false;
  let refused = false;
  if (!slotTaken) {
    state.turnSteps++;
    if (state.turnSteps > LIMITS.maxSteps) {
      note(notes, 'dropped', path, `more than ${LIMITS.maxSteps} steps in one turn (a new question needs startTurn)`);
      refused = true;
    }
  }

  /**
   * `bind` is the last try for an action that names an id nothing made: its ids are read as the part the model meant (bind.ts), except for a clear, which
   * must never remove a part it only resembles.
   */
  function attempt(raw: unknown, at: string, bind = false): { action: Action | null; why: Notes; after: Action[] } {
    const why: Notes = [];
    state.after.length = 0;
    const op = isObject(raw) ? own(raw, 'op') : undefined;
    state.bindUnknown = bind && op !== 'clear';
    state.bindOp = typeof op === 'string' ? op : undefined;
    try {
      const a = validateAction(raw, state, at, why, parentFirstAt, mountedChildrenAt, bodies);
      return { action: a, why, after: a ? state.after.splice(0) : [] };
    } finally {
      state.bindUnknown = false;
      state.bindOp = undefined;
    }
  }

  const missing = (why: Notes): boolean => why.some((n) => n.kind === 'dropped' && n.message.includes('unknown id "'));

  function accept(action: Action, why: Notes, after: Action[] = []): void {
    for (const n of why) note(notes, n.kind, n.path, n.message);
    for (const [i, a] of [action, ...after].entries()) {
      // Keep all historical births through clears and replacements so an earlier valid child is never dropped.
      if (a.op === 'add') {
        parentFirstAt.set(a.id, Math.min(parentFirstAt.get(a.id) ?? Infinity, a.at ?? 0));
        const versions = bodies.get(a.id) ?? [];
        versions.push({ at: a.at ?? 0, body: state.bodies.get(a.id) });
        bodies.set(a.id, versions);
      }
      if (a.op === 'add' && a.shape !== 'stream' && a.shape !== 'array' && a.parent !== undefined && ((a as { parentAnchor?: string }).parentAnchor !== undefined || (a as { selfAnchor?: string }).selfAnchor !== undefined)) {
        mountedChildrenAt.set(a.parent, Math.max(mountedChildrenAt.get(a.parent) ?? 0, a.at ?? 0));
      }
      kept.push(a);
      events.action(a, i > 0);
    }
  }

  function retryHeld(final: boolean): void {
    let progress = true;
    while (progress && held.length > 0) {
      progress = false;
      const still: Held[] = [];
      for (const h of held) {
        const r = attempt(h.raw, h.path);
        if (r.action) {
          accept(r.action, r.why, r.after);
          progress = true;
        } else if (missing(r.why)) {
          still.push({ ...h, why: r.why });
        } else {
          for (const n of r.why) note(notes, n.kind, n.path, n.message);
        }
      }
      held = still;
    }
    if (!final) return;
    // Each recovery can create an id. Give exact references another chance before any next guess.
    while (held.length > 0) {
      // A still-held creator may yet supply an exact id, even if it needs recovery itself.
      const creators = held.filter((h) => {
        if (!isObject(h.raw)) return false;
        const variant = pickVariant(h.raw);
        return typeof variant !== 'string' && !!variant.creates;
      });
      const waitsForCreator = (h: Held): boolean => {
        const missingIds = h.why.filter((n) => n.kind === 'dropped').map((n) => /unknown id "([^"]+)"/.exec(n.message)?.[1]);
        return missingIds.some((id) => id !== undefined && declared.has(id) && !state.ids.has(id));
      };
      const recover = (h: Held): boolean => !waitsForCreator(h) && tryBound(h.raw, h.path);
      const candidate = creators.find(recover) ?? held.filter((h) => !creators.includes(h)).find(recover);
      const at = candidate ? held.indexOf(candidate) : -1;
      if (at < 0) break;
      held.splice(at, 1);
      retryHeld(false);
    }
    for (const h of held) for (const n of h.why) note(notes, n.kind, n.path, n.message);
    held = [];
  }

  /** The last try for an action whose id never came: read as the part it meant. True when that gave an action. */
  function tryBound(raw: unknown, at: string): boolean {
    const r = attempt(raw, at, true);
    if (!r.action) return false;
    accept(r.action, r.why, r.after);
    return true;
  }

  function process(raw: unknown): void {
    const i = seen++;
    if (i >= LIMITS.maxActionsPerStep) {
      if (!cutNoted) note(notes, 'trimmed', `${path}.actions`, `actions cut to ${LIMITS.maxActionsPerStep}`);
      cutNoted = true;
      return;
    }
    const at = `${path}.actions[${i}]`;
    if (isObject(raw)) {
      const op = own(raw, 'op'), id = own(raw, 'id');
      if (typeof op === 'string' && typeof id === 'string' && VARIANTS.some((v) => v.op === op && !!v.creates)) declared.add(id);
    }
    if (state.turnActions >= LIMITS.maxActionsPerTurn) {
      note(notes, 'dropped', at, `more than ${LIMITS.maxActionsPerTurn} actions in one turn`);
      return;
    }
    state.turnActions++;
    const r = attempt(raw, at);
    if (r.action) {
      accept(r.action, r.why, r.after);
      retryHeld(false);
    } else if (missing(r.why) && held.length < HELD_MAX) {
      held.push({ raw, path: at, why: r.why });
    } else {
      for (const n of r.why) note(notes, n.kind, n.path, n.message);
    }

  }

  function open(raw: unknown): void {
    said = true;
    if (typeof raw === 'string') {
      const p = cleanText(raw, 0, LIMITS.maxSay, `${path}.say`, notes);
      spoken = p.ok ? (p.value as string) : '';
    } else {
      note(notes, 'dropped', `${path}.say`, 'say must be text');
    }
    events.open(spoken);
    for (const r of early.splice(0)) process(r);
  }

  return {
    get refused() {
      return refused;
    },
    say(raw) {
      if (refused || said) return;
      open(raw);
    },
    action(raw) {
      if (refused) return;
      if (!said) early.push(raw);
      else process(raw);
    },
    finish() {
      if (refused) return { step: null, issues: notes };
      if (!said) {
        // A step that never got its words is dropped, as a whole step without them is; early actions are never drawn.
        note(notes, 'dropped', path, 'say must be text');
        return { step: null, issues: notes };
      }
      retryHeld(true);
      if (spoken === '' && kept.length === 0) {
        note(notes, 'dropped', path, 'step has nothing to say or show');
        return { step: null, issues: notes };
      }
      return { step: { say: spoken, actions: kept }, issues: notes };
    },
  };
}

export function validateStep(raw: unknown, state: SceneState, index: number = state.turnSteps, acceptedInput?: (action: Action) => void): StepResult {
  const notes: Notes = [];
  const path = `steps[${index}]`;
  state.turnSteps++;
  if (state.turnSteps > LIMITS.maxSteps) {
    note(notes, 'dropped', path, `more than ${LIMITS.maxSteps} steps in one turn (a new question needs startTurn)`);
    return { step: null, issues: notes };
  }
  if (!isObject(raw)) {
    note(notes, 'dropped', path, 'step is not an object');
    return { step: null, issues: notes };
  }
  const say = own(raw, 'say');
  const list = own(raw, 'actions');
  if (typeof say !== 'string') {
    note(notes, 'dropped', path, 'say must be text');
    return { step: null, issues: notes };
  }
  if (!Array.isArray(list)) {
    note(notes, 'dropped', path, 'actions must be a list');
    return { step: null, issues: notes };
  }
  for (const key of ownKeys(raw)) {
    if (key !== 'say' && key !== 'actions') note(notes, 'trimmed', `${path}.${key.slice(0, 40)}`, 'unknown field ignored');
  }
  const live = beginLiveStep(state, { open: () => undefined, action: (action, derived) => { if (!derived) acceptedInput?.(action); } }, index, true);
  live.say(say);
  for (const a of list) live.action(a);
  const done = live.finish();
  return { step: done.step, issues: [...notes, ...done.issues] };
}

/** The reason text of an `escalate` field, cleaned and cut to length, or undefined when there is none worth keeping. */
export function validateEscalate(raw: unknown): { escalate: string | undefined; issues: Issue[] } {
  const notes: Notes = [];
  if (raw === undefined || raw === null) return { escalate: undefined, issues: notes };
  if (typeof raw !== 'string') {
    note(notes, 'dropped', 'escalate', 'escalate must be text');
    return { escalate: undefined, issues: notes };
  }
  const p = cleanText(raw, 1, LIMITS.maxEscalate, 'escalate', notes);
  if (!p.ok) note(notes, 'dropped', 'escalate', 'escalate is empty');
  return { escalate: p.ok ? (p.value as string) : undefined, issues: notes };
}

/** Validates a whole scene (one turn). ok is false only when the scene is not usable at all. */
export function validateScene(raw: unknown, state: SceneState = createSceneState()): SceneResult {
  const notes: Notes = [];
  if (!isObject(raw)) {
    note(notes, 'dropped', '', 'scene is not an object');
    return { ok: false, scene: null, issues: notes };
  }
  const v = own(raw, 'v');
  if (v !== undefined && v !== null && v !== 1) {
    note(notes, 'dropped', 'v', 'unsupported scene version');
    return { ok: false, scene: null, issues: notes };
  }
  const list = own(raw, 'steps');
  if (!Array.isArray(list)) {
    note(notes, 'dropped', 'steps', 'steps must be a list');
    return { ok: false, scene: null, issues: notes };
  }
  for (const key of ownKeys(raw)) {
    if (key !== 'v' && key !== 'steps' && key !== 'escalate') note(notes, 'trimmed', key.slice(0, 40), 'unknown field ignored');
  }
  startTurn(state);
  const steps: Step[] = [];
  const count = Math.min(list.length, LIMITS.maxSteps + 1);
  for (let i = 0; i < count; i++) {
    const r = validateStep(list[i], state, i);
    for (const issue of r.issues) note(notes, issue.kind, issue.path, issue.message);
    if (r.step) steps.push(r.step);
  }
  const esc = validateEscalate(own(raw, 'escalate'));
  for (const issue of esc.issues) note(notes, issue.kind, issue.path, issue.message);
  const scene: Scene = v === 1 ? { v: 1, steps } : { steps };
  if (esc.escalate !== undefined) scene.escalate = esc.escalate;
  return { ok: true, scene, issues: notes };
}
