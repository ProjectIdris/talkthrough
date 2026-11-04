// How well an answer builds in order: does every action that refers to an object (its parent group, the
// object a pin is on, the original an array copies, the object a move acts on) come after the action
// that made that object? A model builds on screen in the order it writes, so an answer that names things
// before they exist builds out of order (and the live step has to hold the early action back). This reads
// the raw answer, steps and actions as the model wrote them, before any validation. It is cheap, and it
// is a measure to watch, not a rule: nothing is dropped because of it.

import { RESERVED_IDS, VARIANTS } from './spec.ts';
import type { Variant } from './spec.ts';

export type OrderScore = {
  /** How many references to an object were looked at. */
  refs: number;
  /** References to an object the answer makes only later. */
  early: number;
  /** References to an object the answer never makes and the scene did not already hold. */
  missing: number;
  /** The share of references in order: 1 when every one comes after its object (or there are none). */
  score: number;
  /** The first few early references, as `op id -> object`, for a log line. */
  examples: string[];
};

type Raw = { actions?: unknown } | null | undefined;

const own = (o: object, k: string): unknown => (Object.hasOwn(o, k) ? (o as Record<string, unknown>)[k] : undefined);

function variantOf(raw: object): Variant | undefined {
  const op = own(raw, 'op');
  if (typeof op !== 'string') return undefined;
  const shape = own(raw, 'shape');
  return VARIANTS.find((v) => v.op === op && (!v.shapes || (typeof shape === 'string' && v.shapes.includes(shape))));
}

/** The id an action makes, and the ids it refers to, by what the spec says each field is. */
function readAction(raw: unknown): { makes?: string; refs: string[]; op: string } | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const variant = variantOf(raw);
  if (!variant) return undefined;
  const out: { makes?: string; refs: string[]; op: string } = { refs: [], op: variant.op };
  for (const [name, field] of Object.entries(variant.fields)) {
    const v = own(raw, name);
    if (typeof v !== 'string') continue;
    if (field.k === 'newId') out.makes = v;
    else if (field.k === 'ref' || field.k === 'parent') out.refs.push(v);
    else if (field.k === 'target' && !(RESERVED_IDS as readonly string[]).includes(v)) out.refs.push(v);
  }
  return out;
}

/**
 * Scores the order of an answer. `known` holds ids the scene already had before the answer (from earlier
 * turns), which may be referred to freely.
 */
export function orderScore(steps: readonly Raw[], known: Iterable<string> = []): OrderScore {
  const actions: Array<NonNullable<ReturnType<typeof readAction>>> = [];
  for (const step of steps) {
    const list = step && Array.isArray(step.actions) ? step.actions : [];
    for (const a of list) {
      const read = readAction(a);
      if (read) actions.push(read);
    }
  }
  const everMade = new Set<string>();
  for (const a of actions) if (a.makes !== undefined) everMade.add(a.makes);
  const had = new Set(known);
  const made = new Set<string>();
  const result: OrderScore = { refs: 0, early: 0, missing: 0, score: 1, examples: [] };
  for (const a of actions) {
    for (const ref of a.refs) {
      if (had.has(ref) && !everMade.has(ref)) continue; // an earlier turn's object, not part of this answer's order
      result.refs++;
      if (made.has(ref) || had.has(ref)) continue;
      if (everMade.has(ref)) {
        result.early++;
        if (result.examples.length < 5) result.examples.push(`${a.op}${a.makes ? ` ${a.makes}` : ''} -> ${ref}`);
      } else {
        result.missing++;
      }
    }
    if (a.makes !== undefined) made.add(a.makes);
  }
  result.score = result.refs === 0 ? 1 : (result.refs - result.early - result.missing) / result.refs;
  return result;
}
