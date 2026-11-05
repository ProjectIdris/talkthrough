// The scene validator: the only way a scene from a model reaches the renderer.
// It reads data and builds fresh objects from known fields. It never evaluates, imports,
// or interprets anything in a scene; strings stay plain text for the renderer to draw as text.

import { nearestPaletteColor } from './colors.ts';
import { attachTolerance, landOn } from './attach.ts';
import type { Body } from './attach.ts';
import { bindParts, bindUnknownId, BINDINGS } from './bind.ts';
import { DIAGRAM_PARTS, ID_PATTERN, LIMITS, PALETTE, RESERVED_IDS, SCREEN_KINDS, VARIANTS } from './spec.ts';
import type { DiagramKind, Field, ObjectKind, Variant } from './spec.ts';
import type { Action, AttachEnd, Issue, IssueKind, Scene, Step, Vec3 } from './types.ts';

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
  joints: Map<string, 'hinge' | 'slide' | 'fixed'>;
  follows: Map<string, string>;
  rides: Map<string, string>;
  /** Where each 3D solid and group stands and how big it is, as written: what a tube or line that ends on a part is held against (attach.ts). */
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
  /** The size of the 3D stage as last written (a stage written with no size takes it). */
  stage?: { w: number; h: number };
  /** Set only while an action that named an id the scene does not have is tried once more, after the rest had their chance to make it. */
  bindUnknown?: boolean;
};

export type StepResult = { step: Step | null; issues: Issue[] };
export type SceneResult = { ok: boolean; scene: Scene | null; issues: Issue[] };

const MAX_ISSUES = 100;
const MAX_STRING_SCAN = 10_000;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// Control characters, zero-width and bidirectional-override characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function createSceneState(): SceneState {
  return { ids: new Map(), parents: new Map(), depth: new Map(), diagramKinds: new Map(), parts: new Map(), joints: new Map(), follows: new Map(), rides: new Map(), bodies: new Map(), loose: new Map(), after: [], turnSteps: 0, turnActions: 0, copies: 0 };
}

/**
 * A state for a detail pass over a scene already on screen: it knows every id on screen (so a part, pin or move may
 * name one the answer does not write again) and lets the answer write any of them again, richer.
 */
export function createDetailState(onScreen: SceneState): SceneState {
  return {
    ids: new Map(onScreen.ids), parents: new Map(onScreen.parents), depth: new Map(onScreen.depth), diagramKinds: new Map(onScreen.diagramKinds), parts: new Map(onScreen.parts), joints: new Map(onScreen.joints), follows: new Map(onScreen.follows), rides: new Map(onScreen.rides),
    bodies: new Map(onScreen.bodies), loose: new Map(onScreen.loose), after: [],
    turnSteps: 0, turnActions: 0, copies: onScreen.copies, replaceable: new Set(onScreen.ids.keys()),
    ...(onScreen.stage ? { stage: { ...onScreen.stage } } : {}),
  };
}

/** Call at the start of each question's answer: the per-turn caps count from zero again. */
export function startTurn(state: SceneState): void {
  state.turnSteps = 0;
  state.turnActions = 0;
}

type Notes = Issue[];

function note(notes: Notes, kind: IssueKind, path: string, message: string): void {
  if (notes.length < MAX_ISSUES) notes.push({ kind, path, message });
  else if (notes.length === MAX_ISSUES) notes.push({ kind: 'trimmed', path: '', message: 'more issues not listed' });
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
      if (!kind && state.bindUnknown && (f.of === 'object3d' || f.of === 'any')) {
        // A name the model made up for what it acts on: the part it meant, said in a note (bind.ts).
        const found = bindUnknownId(v, state, f.of === 'any' ? [(k) => !SCREEN_KINDS.has(k), () => true] : [(k) => !SCREEN_KINDS.has(k)]);
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
    state.bodies.delete(d);
    state.loose.delete(d);
  }
}

/** Takes a cleared id (or "all", "marks", "panel") out of what the scene holds; the guide clears the page by id between steps and tells the scene here. */
export function applyClear(state: SceneState, target: string): void {
  if (target === 'all') {
    state.ids.clear(); state.parents.clear(); state.depth.clear(); state.diagramKinds.clear(); state.parts.clear(); state.joints.clear(); state.follows.clear(); state.rides.clear(); state.bodies.clear(); state.loose.clear(); state.copies = 0;
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

/** A 3D solid or group is on record where it stands and how big it is; a tube or line has its ends held to the parts they lie on. */
function holdBody(state: SceneState, name: string, out: Record<string, unknown>, path: string, notes: Notes): void {
  const id = out.id as string;
  state.bodies.delete(id);
  state.loose.delete(id);
  const place = { pos: (out.pos as Vec3 | undefined) ?? ZERO, rot: (out.rot as Vec3 | undefined) ?? ZERO, parent: out.parent as string | undefined };
  const shape = out.shape as string;
  if (name === 'addSolid') {
    const size = out.size as Vec3;
    if (shape === 'box' || shape === 'sphere' || shape === 'cylinder') state.bodies.set(id, { shape, size, ...place });
    else if (shape === 'plane') state.bodies.set(id, { shape: 'box', size: [size[0], size[1], 0], ...place });
    else state.bodies.set(id, { shape: 'group', ...place }); // a cone or a torus is not asked about, but things hang from it
  } else if (name === 'addPart') state.bodies.set(id, { shape: 'box', size: out.size as Vec3, ...place });
  else if (name === 'addBlob') state.bodies.set(id, { shape: 'blob', pts: out.pts as Vec3[], sizes: out.sizes as Vec3[], ...place });
  else if (name === 'addExtrude' || name === 'addLathe' || name === 'addGroup') state.bodies.set(id, { shape: 'group', ...place });
  else if (name === 'addTube' || (name === 'addPath' && shape === 'line')) {
    holdEnds(state, id, out, path, notes);
    return;
  } else return;
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
  const next: Record<string, unknown> = { ...raw };
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
    if (typeof from === 'number' && typeof len === 'number' && from + len > 1000) next[at] = Math.max(0, 1000 - len);
  }
  return next;
}

function validateAction(raw: unknown, state: SceneState, path: string, notes: Notes): Action | null {
  if (!isObject(raw)) {
    note(notes, 'dropped', path, 'action is not an object');
    return null;
  }
  const variant = pickVariant(raw);
  if (typeof variant === 'string') {
    note(notes, 'dropped', path, variant);
    return null;
  }
  const input = variant.op === 'panel' ? fitStage(raw as Record<string, unknown>, state, path, notes) : raw;
  const out: Record<string, unknown> = { op: variant.op };
  // Fields that name a part already in the scene are bound in one place (bind.ts) once the others are read.
  const bindings = BINDINGS[variant.name];
  const bound = new Set(bindings?.flatMap((b) => (b.alias === undefined ? [b.field] : [b.field, b.alias])));
  for (const [name, f] of Object.entries(variant.fields)) {
    if (bound.has(name)) continue;
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
  if (bindings && !bindParts(bindings, (n) => own(input, n), out, state, path, (kind, at, why) => note(notes, kind, at, why))) return null;
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
  if (variant.name === 'style' && out.color === undefined && out.opacity === undefined) {
    note(notes, 'dropped', path, 'style needs a colour or an opacity');
    return null;
  }
  if (variant.name === 'spin' && out.rpm === undefined && out.by === undefined) {
    note(notes, 'dropped', path, 'spin needs rpm or by');
    return null;
  }
  if (variant.name === 'loop' && out.kind !== 'stop') {
    // The kind is the object's joint when left out; an amount is a travel, an angle or a size factor by its kind, each in a range that still reads as that motion.
    const joint = state.joints.get(out.id as string);
    const kind = (out.kind as string | undefined) ?? (joint === 'hinge' ? 'swing' : joint === 'slide' ? 'slide' : undefined);
    if (kind === undefined) {
      note(notes, 'dropped', path, 'loop needs a kind, or a hinge or slide joint on the object');
      return null;
    }
    const amount = out.amount as number | undefined;
    if (amount === undefined) {
      note(notes, 'dropped', path, 'loop needs an amount');
      return null;
    }
    const [low, high] = kind === 'slide' ? [0.01, 100] : kind === 'swing' ? [0.01, 180] : [0.1, 5];
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
  if (variant.name === 'addStream' && out.period === 0) {
    delete out.period;
    note(notes, 'trimmed', `${path}.period`, 'period 0 would not move; the default is used');
  }
  if (variant.name === 'joint' && !checkJoint(out, state, path, notes)) return null;
  if (variant.name === 'couple' && !checkCouple(out, state, path, notes)) return null;
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
    const replacing = state.replaceable?.has(id) === true;
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
    state.replaceable?.delete(id);
    const parent = (variant.attach ? out[variant.attach] : out.parent) as string | undefined;
    state.ids.set(id, kind);
    if (variant.creates === 'diagram') state.diagramKinds.set(id, out.kind as DiagramKind);
    else state.diagramKinds.delete(id);
    if (variant.name === 'addPart') state.parts.set(id, out.part as string);
    else state.parts.delete(id);
    state.parents.set(id, parent);
    state.depth.set(id, parent === undefined ? 1 : (state.depth.get(parent) ?? 0) + 1);
    holdBody(state, variant.name, out, path, notes);
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
  state.joints.set(id, out.kind as 'hinge' | 'slide' | 'fixed');
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
  const mine = state.joints.get(id);
  const theirs = state.joints.get(by);
  if (out.pitch === undefined && mine !== undefined && theirs !== undefined && mine !== 'fixed' && theirs !== 'fixed' && mine !== theirs) {
    note(notes, 'dropped', path, `a ${theirs} and a ${mine} are coupled with pitch (units of travel for a turn), not ratio`);
    return false;
  }
  state.follows.set(id, by);
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
  action(action: Action): void;
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

/** Held actions: how many may wait for the object they name, and for how many later actions. */
const HELD_MAX = 8;
const HELD_FOR = 6;

type Held = { raw: unknown; path: string; age: number; why: Notes };

/**
 * A step validated as it is written: the words first, then each action as it arrives, against the ids
 * the scene already holds. An action that names an object not seen yet (an array before the object it
 * copies, a pin before its part) is held for a few more actions, and then dropped with its reason. Actions
 * that arrive before the words are kept until the words come, or the step ends. The same limits apply as
 * to a whole step, so what is drawn as it streams is exactly what validateStep would have kept.
 */
export function beginLiveStep(state: SceneState, events: LiveStepEvents, index: number = state.turnSteps, slotTaken = false): LiveStep {
  const notes: Notes = [];
  const path = `steps[${index}]`;
  const kept: Action[] = [];
  const early: unknown[] = [];
  let held: Held[] = [];
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
    state.bindUnknown = bind && !(isObject(raw) && (raw as { op?: unknown }).op === 'clear');
    try {
      const a = validateAction(raw, state, at, why);
      return { action: a, why, after: a ? state.after.splice(0) : [] };
    } finally {
      state.bindUnknown = false;
    }
  }

  const missing = (why: Notes): boolean => why.some((n) => n.kind === 'dropped' && n.message.includes('unknown id "'));

  function accept(action: Action, why: Notes, after: Action[] = []): void {
    for (const n of why) note(notes, n.kind, n.path, n.message);
    for (const a of [action, ...after]) {
      kept.push(a);
      events.action(a);
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
        } else if (!final && missing(r.why)) {
          still.push({ ...h, why: r.why });
        } else if (final && missing(r.why) && tryBound(h.raw, h.path)) {
          progress = true;
        } else {
          for (const n of r.why) note(notes, n.kind, n.path, n.message);
        }
      }
      held = still;
    }
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
      held.push({ raw, path: at, age: 0, why: r.why });
    } else if (missing(r.why) && tryBound(raw, at)) {
      // the held list was full: the id is read as the part it meant at once
    } else {
      for (const n of r.why) note(notes, n.kind, n.path, n.message);
    }
    // A held action that has waited through enough later actions for its object is given up.
    for (const h of held) h.age++;
    const expired = held.filter((h) => h.age > HELD_FOR);
    if (expired.length > 0) {
      held = held.filter((h) => h.age <= HELD_FOR);
      for (const h of expired) if (!tryBound(h.raw, h.path)) for (const n of h.why) note(notes, n.kind, n.path, n.message);
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

export function validateStep(raw: unknown, state: SceneState, index: number = state.turnSteps): StepResult {
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
  const live = beginLiveStep(state, { open: () => undefined, action: () => undefined }, index, true);
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
