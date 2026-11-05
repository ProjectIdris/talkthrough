// Machine ops (crank, cam, flash) act on parts that are already in the scene, by their ids. A model sometimes gives such a field a name of its own
// ("the linkage", "the intake cam"), or the id of the cylinder block or a group, and the validator once read that as the part to move. This is the one
// place every such reference passes through: each field says what part it needs, and what the model wrote is bound to the part that fits.
//
// A field is read like this: the name the model wrote (the plain field, or the alias that names the part outright) if it already is the right
// kind of part; otherwise the one part of that kind in the scene (beside the part it works with, when there are several); otherwise the one
// whose id shares a word with what was written ("intake-cam" and "intake-valve"); otherwise it is left out (an optional field) or the action is
// dropped (a needed one), with a line that says why. Nothing is guessed between two equally good parts.

import { SCREEN_KINDS } from './spec.ts';
import type { ObjectKind } from './spec.ts';
import type { SceneState } from './validate.ts';

/** What the scene knows of one id. */
export type PartInfo = { id: string; kind: ObjectKind; /** The ready-made part it is, when it is one (a group made by `add` part is not a group). */ part: string | undefined; parent: string | undefined };

export type Binding = {
  /** The field of the action. */
  field: string;
  /** Another field that names the same part outright (`piston` for crank's `id`); it is read first. */
  alias?: string;
  /** What the field needs, for the line in the log. */
  what: string;
  /** The ready-made part it is (the one to look for when what was written does not fit). */
  part?: string;
  /** Whether an id that exists already is what this field needs. */
  fits(i: PartInfo): boolean;
  /** The field that is bound before this one, and that this part sits beside (same parent). */
  beside?: string;
  /** Left out, not the whole action dropped, when nothing fits. */
  optional?: boolean;
  /** A field of the action whose part this one is never bound to (a part is not driven by itself). */
  not?: string;
  /** An optional field the model left out is still bound to the one part of its kind there is (a rod the model added but did not name). */
  infer?: boolean;
  /** A plain shape the model wrote gives way to the one ready-made part of this kind beside the shaft, when there is one (a plain cylinder called block beside a real piston). */
  preferPart?: boolean;
  /** For a field no ready-made part can stand for: the one object that can, given what was written (or nothing). */
  pick?(said: string | undefined, state: SceneState): string | undefined;
};

const primitive = (i: PartInfo): boolean => i.part === undefined && (i.kind === 'solid' || i.kind === 'path');
/** A part of this kind, or a plain shape the model built it from (never a group, a cylinder block or another kind of part). */
const isPart = (name: string) => (i: PartInfo): boolean => i.part === name || primitive(i);

/** Anything that can turn or drive another part: not a group, a cylinder block or a housing (they hold the machine; they are not in it). */
const mover = (i: PartInfo): boolean => !(i.part === undefined && i.kind === 'group') && i.part !== 'cylinder-block' && i.part !== 'housing' && !SCREEN_KINDS.has(i.kind);

// A cam's follower is a valve or any other part that is not what holds the machine (the guide says any follower), so it only repairs what cannot be one.

/** Bindings by the name of the action's variant, in the order they are read (what a field sits beside comes first). */
export const BINDINGS: Readonly<Record<string, readonly Binding[]>> = {
  crank: [
    { field: 'shaft', what: 'crankshaft', part: 'crankshaft', fits: mover },
    { field: 'id', alias: 'piston', what: 'piston', part: 'piston', fits: isPart('piston'), beside: 'shaft', preferPart: true },
    { field: 'rod', what: 'connecting rod', part: 'connecting-rod', fits: isPart('connecting-rod'), beside: 'shaft', optional: true, infer: true, preferPart: true },
  ],
  cam: [
    { field: 'by', what: 'camshaft', part: 'camshaft', fits: mover },
    { field: 'id', alias: 'valve', what: 'valve', part: 'valve', fits: mover, beside: 'by', preferPart: true },
  ],
  flash: [
    { field: 'by', what: 'crankshaft', part: 'crankshaft', fits: mover },
  ],
  joint: [
    { field: 'to', what: 'part it rides with', fits: mover, optional: true, not: 'id' },
  ],
  couple: [
    { field: 'by', what: 'driving part', fits: mover, optional: true, not: 'id' },
  ],
  loop: [
    { field: 'by', what: 'driving part', part: 'crankshaft', fits: mover, optional: true, not: 'id' },
  ],
  spin: [
    { field: 'by', what: 'driving part', part: 'crankshaft', fits: mover, optional: true, not: 'id' },
  ],
  addStream: [
    { field: 'along', what: 'path', fits: (i) => i.kind === 'path' || i.kind === 'edge', pick: pickPath },
    { field: 'by', what: 'driving part', fits: mover, optional: true, not: 'id' },
  ],
};

/** A stream's path when the name is not one: the one path under the object named (a heart group holding one vessel), else the one path there is. */
function pickPath(said: string | undefined, state: SceneState): string | undefined {
  const paths = [...state.ids].filter(([, kind]) => kind === 'path').map(([id]) => id);
  const under = said === undefined ? [] : paths.filter((id) => state.parents.get(id) === said);
  if (under.length === 1) return under[0];
  return under.length === 0 && paths.length === 1 ? paths[0] : undefined;
}

const infoOf = (state: SceneState, id: string): PartInfo | undefined => {
  const kind = state.ids.get(id);
  return kind === undefined ? undefined : { id, kind, part: state.parts.get(id), parent: state.parents.get(id) };
};

/** The words of an id, lower case ("intake-valve" gives intake and valve); words that name no one part are left out. */
const GENERIC = new Set(['part', 'the', 'a', 'drive', 'link', 'linkage', 'motion', 'main', 'cam', 'valve', 'piston', 'rod', 'crank', 'shaft', 'crankshaft', 'camshaft', 'engine']);
function words(id: string): string[] {
  return id.toLowerCase().split(/[^a-z0-9]+|(?<=[a-z])(?=[0-9])|(?<=[0-9])(?=[a-z])/).filter((w) => w !== '' && !GENERIC.has(w));
}

/**
 * Reads every bound field of an action. `get` reads what the model wrote. On success `out` holds the real ids (the alias is not kept); false
 * means a needed field fits no part and the action is to be dropped. `note` records what was repaired or left out.
 */
export function bindParts(
  bindings: readonly Binding[],
  get: (name: string) => unknown,
  out: Record<string, unknown>,
  state: SceneState,
  path: string,
  note: (kind: 'dropped' | 'trimmed', path: string, message: string) => void,
): boolean {
  const bound = new Map<string, string>();
  for (const b of bindings) {
    const written = [b.alias, b.field].flatMap((n) => (n === undefined ? [] : [get(n)])).filter((v): v is string => typeof v === 'string' && v !== '');
    // What was written fits: used as it is.
    const self = b.not === undefined ? undefined : get(b.not);
    const fitting = written.find((id) => {
      if (id === self) return false;
      const info = infoOf(state, id);
      return info !== undefined && b.fits(info);
    });
    // A plain shape stands only where no ready-made part of the kind can: say so and take the part.
    const plainOnly = fitting !== undefined && b.preferPart === true && state.parts.get(fitting) === undefined;
    const better = plainOnly ? repair(b, fitting, bound, state, self, true) : undefined;
    if (better !== undefined && better !== fitting) {
      bound.set(b.field, better);
      out[b.field] = better;
      note('trimmed', `${path}.${b.field}`, `repaired: "${fitting}" is not ${article(b.what)}; bound to "${better}"`);
      continue;
    }
    if (fitting !== undefined) {
      bound.set(b.field, fitting);
      out[b.field] = fitting;
      continue;
    }
    const said = written[0];
    if (said === undefined && b.optional && !b.infer) continue;
    const found = repair(b, said, bound, state, self);
    if (found !== undefined) {
      bound.set(b.field, found);
      out[b.field] = found;
      note('trimmed', `${path}.${b.field}`, `repaired: ${said === undefined ? `no ${b.what} named` : `"${said}" is not ${article(b.what)}`}; bound to "${found}"`);
      continue;
    }
    const why = `${said === undefined ? `no ${b.what} named` : `"${said}" is not ${article(b.what)}`} and no single ${b.what} part can stand for it`;
    if (b.optional) {
      if (said === undefined) continue;
      note('trimmed', `${path}.${b.field}`, `${why}; left out`);
      continue;
    }
    note('dropped', `${path}.${b.field}`, why);
    return false;
  }
  return true;
}

/** Recover only an explicit action designator attached to a whole existing id. */
export function bindUnknownId(said: string, state: SceneState, pools: ReadonlyArray<(kind: ObjectKind) => boolean>, op: string): string | undefined {
  const lower = said.toLowerCase();
  const names: Record<string, string[]> = { loop: ['lp', 'loop', 'pulse'], move: ['move'], style: ['style', 'color'], pin: ['pin'], highlight: ['highlight'], turn: ['turn'] };
  const designators = names[op] ?? [];
  const candidates = new Set<string>();
  for (const fits of pools) {
    for (const [id, kind] of state.ids) {
      if (id.length < 2 || !fits(kind)) continue;
      const part = id.toLowerCase();
      if (designators.some((d) => [d + part, d + '-' + part, d + '_' + part, part + d, part + '-' + d, part + '_' + d].includes(lower))) candidates.add(id);
    }
  }
  return candidates.size === 1 ? [...candidates][0] : undefined;
}

const article = (what: string): string => `${/^[aeiou]/.test(what) ? 'an' : 'a'} ${what} part`;

/** The one part that can stand for what was written, or undefined when none or more than one can. */
function repair(b: Binding, said: string | undefined, bound: ReadonlyMap<string, string>, state: SceneState, self: unknown, onlyOne = false): string | undefined {
  if (b.pick !== undefined) return b.pick(said, state);
  if (b.part === undefined) return undefined;
  let candidates: PartInfo[] = [];
  for (const id of state.ids.keys()) {
    const info = infoOf(state, id);
    if (info && info.part === b.part && id !== self) candidates.push(info);
  }
  const anchor = b.beside !== undefined ? bound.get(b.beside) : undefined;
  if (anchor !== undefined) {
    const parent = state.parents.get(anchor);
    const near = candidates.filter((c) => c.parent === parent);
    if (near.length > 0) candidates = near;
  }
  if (candidates.length === 1) return (candidates[0] as PartInfo).id;
  if (onlyOne || candidates.length === 0 || said === undefined) return undefined;
  // Several: the one whose id shares a word with what was written, when that is one alone.
  const mine = new Set(words(said));
  if (mine.size === 0) return undefined;
  const scored = candidates.map((c) => ({ id: c.id, shared: words(c.id).filter((w) => mine.has(w)).length })).filter((s) => s.shared > 0);
  const best = Math.max(0, ...scored.map((s) => s.shared));
  const top = scored.filter((s) => s.shared === best);
  return top.length === 1 ? (top[0] as { id: string }).id : undefined;
}
