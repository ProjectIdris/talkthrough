// The JSON Schema a model is held to, built from the same table as the validator (spec.ts).
// Plain JSON Schema, kept to what strict structured-output modes accept: every property is
// required, optional ones are nullable, objects are closed, and there are no range, length,
// pattern or format keywords. The validator, not the schema, enforces ranges and lengths.

import { LIMITS, PALETTE, VARIANTS } from './spec.ts';
import { MATERIAL_FAMILIES } from './material-library.ts';
import type { Field, Variant } from './spec.ts';

type Schema = Record<string, unknown>;

function describe(f: Field): string | undefined {
  const parts: string[] = [];
  if (f.doc) parts.push(f.doc);
  if (f.k === 'num') parts.push(`${f.min} to ${f.max}`);
  if (f.k === 'vec3') parts.push(`[x,y,z], each ${f.min} to ${f.max}`);
  if (f.k === 'vec2') parts.push(`[x,y], each ${f.min} to ${f.max}`);
  if (f.k === 'pts2') parts.push(`${f.min} to ${f.max} points [x,y], each ${f.lo} to ${f.hi}`);
  if (f.k === 'rings2') parts.push(`up to ${f.max} rings, 3 to ${f.points} points [x,y] each, each coordinate ${f.lo} to ${f.hi}`);
  if (f.k === 'strs') parts.push(`up to ${f.max} texts of up to ${f.len} characters`);
  if (f.k === 'pts') parts.push(`${f.min} to ${f.max} points [x,y,z]`);
  if (f.k === 'str') parts.push(`up to ${f.max} characters`);
  if (f.k === 'material') parts.push(`a material name (families: ${MATERIAL_FAMILIES.join(', ')}); another name is taken to the nearest material`);
  if (f.k === 'color') parts.push(`a colour name (${PALETTE.join(', ')}) or hex "#rrggbb"`);
  if (f.k === 'target') parts.push('an id, or "all", "marks" or "panel"');
  return parts.length ? parts.join('; ') : undefined;
}

function fieldSchema(f: Field, descriptions: boolean): Schema {
  const opt = 'opt' in f && f.opt === true;
  const nullable = (t: string): string | string[] => (opt ? [t, 'null'] : t);
  let s: Schema;
  switch (f.k) {
    case 'num': s = { type: nullable('number') }; break;
    case 'str': case 'newId': case 'ref': case 'parent': case 'target': s = { type: nullable('string') }; break;
    case 'color': case 'material': s = { type: nullable('string') }; break;
    case 'enum': s = { enum: opt ? [...f.values, null] : [...f.values] }; break;
    case 'bool': s = { type: nullable('boolean') }; break;
    case 'vec2': s = { type: nullable('array'), items: { type: 'number' } }; break;
    case 'pts2': s = { type: nullable('array'), items: { type: 'array', items: { type: 'number' } } }; break;
    case 'rings2': s = { type: nullable('array'), items: { type: 'array', items: { type: 'array', items: { type: 'number' } } } }; break;
    case 'strs': s = { type: nullable('array'), items: { type: 'string' } }; break;
    case 'vec3': s = { type: nullable('array'), items: { type: 'number' } }; break;
    case 'pts': s = { type: nullable('array'), items: { type: 'array', items: { type: 'number' } } }; break;
  }
  const d = descriptions ? describe(f) : undefined;
  return d ? { ...s, description: d } : s;
}

/**
 * Fields the language has but the lean schema (the one models are held to) leaves out: in a strict schema every
 * optional field is written as null on every action, and these are rarely wanted, so they would cost output on
 * each part. The validator and the full schema still know them.
 */
const LEAN_OMITS: ReadonlySet<string> = new Set(['explode', 'loop.pivot', 'spin.onlyAxis']);

/** Whether the prompt (the lean schema, and the guide's field lists) leaves a field out: by its name on any action, or as `action.field`. */
export function leanOmits(variant: string, field: string): boolean {
  return LEAN_OMITS.has(field) || LEAN_OMITS.has(`${variant}.${field}`);
}

function variantSchema(v: Variant, descriptions: boolean): Schema {
  const properties: Record<string, Schema> = { op: { enum: [v.op] } };
  for (const [name, f] of Object.entries(v.fields)) {
    if (!descriptions && leanOmits(v.name, name)) continue;
    properties[name] = fieldSchema(f, descriptions);
  }
  const out: Schema = { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  return descriptions ? { ...out, description: v.doc } : out;
}

/** Reuse identical fields without dropping anything from the lean contract.
 * The CLI transports this schema in one Windows argument, so independent shapes
 * must not duplicate the same arrays/enums until the command exceeds its limit. */
function shareLeanFields(defs: Record<string, Schema>): void {
  const repeated = new Map<string, { schema: Schema; uses: Array<{ properties: Record<string, Schema>; name: string }> }>();
  for (const variant of Object.values(defs)) {
    const properties = variant.properties as Record<string, Schema>;
    for (const [name, schema] of Object.entries(properties)) {
      const key = JSON.stringify(schema);
      const entry = repeated.get(key) ?? { schema, uses: [] };
      entry.uses.push({ properties, name });
      repeated.set(key, entry);
    }
  }
  let index = 0;
  for (const [key, { schema, uses }] of repeated) {
    const name = `f${index}`, reference = { $ref: `#/$defs/${name}` };
    const saved = uses.length * (key.length - JSON.stringify(reference).length);
    if (saved <= key.length + name.length + 4) continue;
    defs[name] = schema;
    for (const use of uses) use.properties[use.name] = reference;
    index++;
  }
}

/** Definition names are transport details; short local names also save the
 * escaping overhead on Windows without changing the resolved schema. */
function compactDefinitionNames(schema: Schema): Schema {
  const definitions = schema.$defs as Record<string, Schema>;
  const references = new Map<string, number>();
  const count = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(count); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === '$ref' && typeof child === 'string') references.set(child, (references.get(child) ?? 0) + 1);
      else count(child);
    }
  };
  count(schema);
  // Give the most reused definitions the single-character names first.
  const ordered = Object.keys(definitions).sort((a, b) => (references.get(`#/$defs/${b}`) ?? 0) - (references.get(`#/$defs/${a}`) ?? 0));
  const names = new Map(ordered.map((name, index) => [name, index.toString(36)]));
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (key === '$ref' && typeof child === 'string' && child.startsWith('#/$defs/')) {
        const name = names.get(child.slice('#/$defs/'.length));
        if (name === undefined) throw new Error(`Missing local schema definition: ${child}`);
        return [key, `#/$defs/${name}`];
      }
      if (key === '$defs') return [key, Object.fromEntries(Object.entries(child as Record<string, Schema>)
        .map(([name, definition]) => [names.get(name)!, rewrite(definition)]))];
      return [key, rewrite(child)];
    }));
  };
  return rewrite(schema) as Schema;
}

function buildSchema(descriptions: boolean): Schema {
  const defs: Record<string, Schema> = {};
  const contracts = new Map<string, string>();
  const variants: string[] = [];
  for (const v of VARIANTS) {
    const schema = variantSchema(v, descriptions);
    const properties = schema.properties as Record<string, Schema>;
    const { op: _op, ...fields } = properties;
    const contract = JSON.stringify({ ...schema, properties: fields });
    const shared = descriptions ? undefined : contracts.get(contract);
    if (shared) {
      // These actions differ only by their discriminator in the lean contract
      // (move/turn/scale, for example). Keep every field and every op, without
      // paying for identical object definitions in the Windows CLI argument.
      const ops = ((defs[shared]!.properties as Record<string, Schema>).op!.enum as string[]);
      if (!ops.includes(v.op)) ops.push(v.op);
    } else {
      defs[v.name] = schema;
      contracts.set(contract, v.name);
      variants.push(v.name);
    }
  }
  if (!descriptions) shareLeanFields(defs);
  defs.action = { anyOf: variants.map((name) => ({ $ref: `#/$defs/${name}` })) };
  defs.step = {
    type: 'object',
    ...(descriptions ? { description: `What is said and what appears while it is said. At most ${LIMITS.maxActionsPerStep} actions.` } : {}),
    properties: {
      say: { type: 'string', ...(descriptions ? { description: `The words spoken for this step, up to ${LIMITS.maxSay} characters` } : {}) },
      actions: { type: 'array', items: { $ref: '#/$defs/action' } },
    },
    required: ['say', 'actions'],
    additionalProperties: false,
  };
  return {
    type: 'object',
    ...(descriptions ? { description: 'An explanation in steps. Screen coordinates run 0 to 1000 across the screenshot, x to the right, y down.' } : {}),
    properties: {
      steps: { type: 'array', items: { $ref: '#/$defs/step' } },
      escalate: {
        type: ['string', 'null'],
        ...(descriptions ? { description: `Set when the question is beyond what you can answer well here, so a slower, deeper helper can be offered: a short reason, up to ${LIMITS.maxEscalate} characters. steps may then be empty. Otherwise null.` } : {}),
      },
    },
    required: ['steps', 'escalate'],
    additionalProperties: false,
    $defs: defs,
  };
}

/** The full schema, with a description on every action and field. */
export const sceneSchema: Schema = buildSchema(true);

/** The same resolved structure without descriptions, using shared fields and short local definition names. Pair with sceneGuide. */
export const sceneSchemaLean: Schema = compactDefinitionNames(buildSchema(false));

/**
 * The lean schema with two more fields, for an answer written one step to a call (see adapters/step-by-step.ts): `plan`, the titles of the
 * steps still to come (the first call writes it, the others leave it null), and `done`, true when the step just written is the last.
 */
export const sceneSchemaChain: Schema = (() => {
  const lean = sceneSchemaLean as Schema & { properties: Record<string, Schema>; required: string[] };
  return {
    ...lean,
    properties: { steps: lean.properties.steps!, plan: { type: ['array', 'null'], items: { type: 'string' } }, done: { type: ['boolean', 'null'] }, escalate: lean.properties.escalate! },
    required: ['steps', 'plan', 'done', 'escalate'],
  };
})();
