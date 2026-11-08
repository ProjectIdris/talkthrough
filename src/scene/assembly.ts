// The assemblies, read. An `add part` of an assembly's name is not drawn as a part: it is expanded here into the actions of the scene language that make the
// mechanism (src/scene/assembly-rows.ts holds the rows): a group, one object for each piece under it (`<id>-<piece>`), the named points of the whole, and the
// spins, loops, joints and couplings that make it go. The validator then checks each of those like any the author wrote, so a wrong number cannot get past it
// and the author may take over any piece or motion afterwards. Nothing in this file touches a renderer.

import { evaluate, num } from './kit-expr.ts';
import type { Scope, Value } from './kit-expr.ts';
import { bind, fresh } from './movement-rows.ts';
import { ASSEMBLY_ROWS } from './assembly-rows.ts';
import type { AssemblyRow, AsmPiece, AsmStep } from './assembly-rows.ts';
import { norm } from './names.ts';

export type { AssemblyName } from './assembly-rows.ts';
type Raw = Record<string, unknown>;

/** The assembly names, in the order of the table. */
export const assemblyNames = (): string[] => Object.keys(ASSEMBLY_ROWS);
export const isAssembly = (name: unknown): name is string => typeof name === 'string' && Object.hasOwn(ASSEMBLY_ROWS, name);

/** The longest id the assemblies' ids may have so that every piece's id (`<id>-<piece>`) is a valid id of 32 characters at most. */
export const pieceKeyLength = (row: AssemblyRow): number => Math.max(...row.pieces.map((p) => p.key.replace(/\{[^}]*\}/g, '0').length));
export const maxAssemblyId = (name: string): number => 31 - pieceKeyLength(ASSEMBLY_ROWS[name]!);

const round = (v: number): number => Math.round(v * 10000) / 10000;
const triple = (e: readonly [Value, Value, Value], s: Scope): [number, number, number] => [round(num(e[0], s)), round(num(e[1], s)), round(num(e[2], s))];

/** Each pass of a `for` (or the single pass when there is none) with its `let`s bound, while `when` holds. */
function each(item: { for?: { as: string; count: Value }; let?: ReadonlyArray<readonly [string, Value]>; when?: Value }, scope: Scope, make: (s: Scope) => void): void {
  const count = item.for ? Math.max(0, Math.min(64, Math.floor(num(item.for.count, scope)))) : 1;
  for (let i = 0; i < count; i++) {
    const s = Object.create(scope) as Scope;
    if (item.for) s[item.for.as] = i;
    if (item.let) bind(s, item.let);
    if (item.when !== undefined && !evaluate(item.when, s)) continue;
    make(s);
  }
}

/** A key with its `{formula}` parts replaced by their values (whole numbers without a decimal point). */
function fill(key: string, s: Scope): string {
  return key.replace(/\{([^}]+)\}/g, (_m, e: string) => {
    const v = evaluate(e, s);
    return typeof v === 'number' ? String(Math.round(v) === v ? v : round(v)) : String(v);
  });
}

export type Expansion = {
  /** The actions, in order: the group, the pieces (a holder before what hangs from it), the points, then the motion. Each carries the add's `at`. */
  actions: Raw[];
  /** What the author was told: a count held to its range. */
  notes: string[];
  /** The ids of the pieces. */
  ids: string[];
};

/** The actions of one assembly asked for by an `add part` (`add`: its fields as written, `size` and `n` and `color` already read). */
export function expandAssembly(name: string, add: Raw): Expansion {
  const row = ASSEMBLY_ROWS[name]!;
  const id = add.id as string;
  const notes: string[] = [];
  const size = (Array.isArray(add.size) ? add.size : row.size) as number[];
  let n = typeof add.n === 'number' ? Math.round(add.n) : row.n.default;
  if (n < row.n.min || n > row.n.max) {
    const held = Math.max(row.n.min, Math.min(row.n.max, n));
    notes.push(`${name} takes ${row.n.min} to ${row.n.max} ${row.n.what}: ${n} was held to ${held}`);
    n = held;
  }
  const scope = bind(fresh({ sx: size[0]!, sy: size[1]!, sz: size[2]!, n }), row.values);
  const at = typeof add.at === 'number' ? { at: add.at } : {};
  const tint = typeof add.color === 'string' ? add.color : undefined;
  const opacity = typeof add.opacity === 'number' ? { opacity: add.opacity } : {};
  const group: Raw = { op: 'add', shape: 'group', id };
  for (const k of ['parent', 'parentAnchor', 'selfAnchor', 'explode', 'pos', 'rot', 'at']) if (add[k] !== undefined) group[k] = add[k];
  if (group.rot === undefined && row.rot) group.rot = [...row.rot];
  const actions: Raw[] = [group];
  const ids: string[] = [];
  const pid = (key: string): string => `${id}-${key}`;
  const holder = new Map<string, string>();

  const place = (p: AsmPiece, s: Scope): Raw => {
    const key = fill(p.key, s);
    const out: Raw = { op: 'add', shape: p.part ? 'part' : p.shape, id: pid(key), parent: p.on ? pid(fill(p.on, s)) : id };
    if (p.size) out.size = triple(p.size, s);
    if (p.link) { out.from = pid(fill(p.link.from, s)); out.to = pid(fill(p.link.to, s)); }
    if (p.part) out.part = p.part;
    if (p.pos) out.pos = triple(p.pos, s);
    for (const [k, v] of Object.entries(p.vecs ?? {})) out[k] = triple(v, s);
    if (p.rot) out.rot = triple(p.rot, s);
    if (p.n !== undefined) out.n = Math.round(num(p.n, s));
    for (const [k, e] of Object.entries(p.fields ?? {})) out[k] = typeof e === 'number' ? round(e) : evaluate(e, s);
    for (const [k, t] of Object.entries(p.texts ?? {})) out[k] = t;
    const colour = p.tint && tint !== undefined ? tint : p.color;
    if (colour !== undefined) out.color = colour;
    Object.assign(out, opacity, at);
    holder.set(key, out.parent as string);
    ids.push(out.id as string);
    return out;
  };
  for (const p of row.pieces) each(p, scope, (s) => actions.push(place(p, s)));

  for (const a of row.anchors ?? []) actions.push({ op: 'anchor', id, name: a.name, pos: triple(a.at, scope) });

  const step = (st: AsmStep, s: Scope): Raw => {
    const out: Raw = { op: st.op };
    for (const [k, ref] of Object.entries(st.refs)) out[k] = pid(fill(ref, s));
    for (const [k, e] of Object.entries(st.fields ?? {})) out[k] = typeof e === 'number' ? e : evaluate(e, s);
    for (const [k, v] of Object.entries(st.vecs ?? {})) out[k] = triple(v, s);
    for (const [k, t] of Object.entries(st.texts ?? {})) out[k] = t;
    for (const [k, v] of Object.entries(out)) if (typeof v === 'number') out[k] = round(v);
    return Object.assign(out, at);
  };
  for (const st of row.steps) each(st, scope, (s) => actions.push(step(st, s)));
  return { actions, notes, ids };
}

/**
 * What to tell a model when the question names a mechanism that has an assembly row, one sentence an assembly (two at most), never in the static guide: the part to
 * add, the pieces it makes (to label, recolour, explode or cut), what drives it and how to change that. Nothing when the question names none.
 */
export function assemblyHint(question: string): string | undefined {
  const named = assembliesNamed(question).slice(0, 2);
  if (named.length === 0) return undefined;
  const lines = named.map(assemblyLine);
  return `If the question is about a mechanism with a ready assembly, use it rather than building the parts one by one (it gets the meshing, the ratios and the directions right; you may still change, colour, label, explode or cut its pieces, or build your own): ${lines.join(' ')}`;
}

/** One assembly in a sentence: how to add it, what it makes, what its pieces are called and what drives it. */
export function assemblyLine(name: string): string {
  const row = ASSEMBLY_ROWS[name]!;
  const keys = [...new Set(row.pieces.map((p) => p.key.replace(/\{[^}]*\}/g, 'N')))].join(', ');
  const count = row.n.max > row.n.min ? ` (n sets the ${row.n.what}, ${row.n.min} to ${row.n.max})` : '';
  return `${name}: add {shape:part, part:"${name}", id:"<id>", size:[x,y,z]} (about [${row.size.join(',')}]) makes ${row.note}${count}, already meshed, attached and moving. Its pieces are <id>-<piece>: ${keys}; drive it through <id>-${row.drive.key}: ${row.drive.what}.`;
}

/** A question's wording names an assembly (whole words or phrases of its row): which ones. */
export function assembliesNamed(question: string): string[] {
  const text = ` ${norm(question).replace(/[^a-z0-9 ]+/g, ' ').replace(/ +/g, ' ')} `;
  return assemblyNames().filter((name) => ASSEMBLY_ROWS[name]!.asks.some((w) => text.includes(` ${norm(w)} `)));
}
