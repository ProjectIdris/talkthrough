// The scene validator: the only way a scene from a model reaches the renderer.
// It reads data and builds fresh objects from known fields. It never evaluates, imports,
// or interprets anything in a scene; strings stay plain text for the renderer to draw as text.

import { nearestPaletteColor } from './colors.ts';
import { DIAGRAM_PARTS, ID_PATTERN, LIMITS, PALETTE, RESERVED_IDS, SCREEN_KINDS, VARIANTS } from './spec.ts';
import type { DiagramKind, Field, ObjectKind, Variant } from './spec.ts';
import type { Action, Issue, IssueKind, Scene, Step } from './types.ts';

/** What the scene holds so far. Keep one per session and pass it to every turn so follow-ups reach earlier ids. */
export type SceneState = {
  ids: Map<string, ObjectKind>;
  parents: Map<string, string | undefined>;
  depth: Map<string, number>;
  /** What each flat diagram on screen is (flow, timeline, steps or chart), which says what may be drawn in it. */
  diagramKinds: Map<string, DiagramKind>;
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
};

export type StepResult = { step: Step | null; issues: Issue[] };
export type SceneResult = { ok: boolean; scene: Scene | null; issues: Issue[] };

const MAX_ISSUES = 100;
const MAX_STRING_SCAN = 10_000;
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
// Control characters, zero-width and bidirectional-override characters.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g;

export function createSceneState(): SceneState {
  return { ids: new Map(), parents: new Map(), depth: new Map(), diagramKinds: new Map(), turnSteps: 0, turnActions: 0, copies: 0 };
}

/**
 * A state for a detail pass over a scene already on screen: it knows every id on screen (so a part, pin or move may
 * name one the answer does not write again) and lets the answer write any of them again, richer.
 */
export function createDetailState(onScreen: SceneState): SceneState {
  return {
    ids: new Map(onScreen.ids), parents: new Map(onScreen.parents), depth: new Map(onScreen.depth), diagramKinds: new Map(onScreen.diagramKinds),
    turnSteps: 0, turnActions: 0, copies: onScreen.copies, replaceable: new Set(onScreen.ids.keys()),
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
      const kind = state.ids.get(v);
      if (!kind) return bad(`unknown id "${v}"`);
      if (f.of === 'object3d' && SCREEN_KINDS.has(kind)) return bad(`"${v}" is on the screen (a mark or diagram), not a 3D object`);
      if (f.of === 'diagram' && kind !== 'diagram') return bad(`"${v}" is not a diagram`);
      if (f.of === 'node' && kind !== 'node') return bad(`"${v}" is not a node`);
      return good(v);
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
  }
}

/** Takes a cleared id (or "all", "marks", "panel") out of what the scene holds; the guide clears the page by id between steps and tells the scene here. */
export function applyClear(state: SceneState, target: string): void {
  if (target === 'all') {
    state.ids.clear(); state.parents.clear(); state.depth.clear(); state.diagramKinds.clear(); state.copies = 0;
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

/** Validates one action against the state; on success the state has absorbed its effect. */
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
  const out: Record<string, unknown> = { op: variant.op };
  for (const [name, f] of Object.entries(variant.fields)) {
    const v = own(raw, name);
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
  for (const key of ownKeys(raw)) {
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
    if (replacing && !swappable(state.ids.get(id), variant.creates)) {
      note(notes, 'dropped', path, `"${id}" is already on screen as something that cannot be swapped for this`);
      return null;
    }
    if (!replacing && state.ids.size >= LIMITS.maxObjects) {
      note(notes, 'dropped', path, `scene already holds ${LIMITS.maxObjects} objects`);
      return null;
    }
    state.replaceable?.delete(id);
    const parent = (variant.attach ? out[variant.attach] : out.parent) as string | undefined;
    state.ids.set(id, variant.creates);
    if (variant.creates === 'diagram') state.diagramKinds.set(id, out.kind as DiagramKind);
    else state.diagramKinds.delete(id);
    state.parents.set(id, parent);
    state.depth.set(id, parent === undefined ? 1 : (state.depth.get(parent) ?? 0) + 1);
  } else if (variant.op === 'clear') {
    applyClear(state, out.target as string);
  }
  return out as Action;
}

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

  function attempt(raw: unknown, at: string): { action: Action | null; why: Notes } {
    const why: Notes = [];
    const a = validateAction(raw, state, at, why);
    return { action: a, why };
  }

  const missing = (why: Notes): boolean => why.some((n) => n.kind === 'dropped' && n.message.includes('unknown id "'));

  function accept(action: Action, why: Notes): void {
    for (const n of why) note(notes, n.kind, n.path, n.message);
    kept.push(action);
    events.action(action);
  }

  function retryHeld(final: boolean): void {
    let progress = true;
    while (progress && held.length > 0) {
      progress = false;
      const still: Held[] = [];
      for (const h of held) {
        const r = attempt(h.raw, h.path);
        if (r.action) {
          accept(r.action, r.why);
          progress = true;
        } else if (!final && missing(r.why)) {
          still.push({ ...h, why: r.why });
        } else {
          for (const n of r.why) note(notes, n.kind, n.path, n.message);
        }
      }
      held = still;
    }
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
      accept(r.action, r.why);
      retryHeld(false);
    } else if (missing(r.why) && held.length < HELD_MAX) {
      held.push({ raw, path: at, age: 0, why: r.why });
    } else {
      for (const n of r.why) note(notes, n.kind, n.path, n.message);
    }
    // A held action that has waited through enough later actions for its object is given up.
    for (const h of held) h.age++;
    const expired = held.filter((h) => h.age > HELD_FOR);
    if (expired.length > 0) {
      held = held.filter((h) => h.age <= HELD_FOR);
      for (const h of expired) for (const n of h.why) note(notes, n.kind, n.path, n.message);
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
