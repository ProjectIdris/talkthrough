// The JSON Schema a model is held to, built from the same table as the validator (spec.ts).
// Plain JSON Schema, kept to what strict structured-output modes accept: every property is
// required, optional ones are nullable, objects are closed, and there are no range, length,
// pattern or format keywords. The validator, not the schema, enforces ranges and lengths.

import { LIMITS, PALETTE, VARIANTS } from './spec.ts';
import type { Field, Variant } from './spec.ts';

type Schema = Record<string, unknown>;

function describe(f: Field): string | undefined {
  const parts: string[] = [];
  if (f.doc) parts.push(f.doc);
  if (f.k === 'num') parts.push(`${f.min} to ${f.max}`);
  if (f.k === 'vec3') parts.push(`[x,y,z], each ${f.min} to ${f.max}`);
  if (f.k === 'pts') parts.push(`${f.min} to ${f.max} points [x,y,z]`);
  if (f.k === 'str') parts.push(`up to ${f.max} characters`);
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
    case 'color': s = { enum: opt ? [...PALETTE, null] : [...PALETTE] }; break;
    case 'enum': s = { enum: [...f.values] }; break;
    case 'vec3': s = { type: nullable('array'), items: { type: 'number' } }; break;
    case 'pts': s = { type: 'array', items: { type: 'array', items: { type: 'number' } } }; break;
  }
  const d = descriptions ? describe(f) : undefined;
  return d ? { ...s, description: d } : s;
}

function variantSchema(v: Variant, descriptions: boolean): Schema {
  const properties: Record<string, Schema> = { op: { enum: [v.op] } };
  for (const [name, f] of Object.entries(v.fields)) properties[name] = fieldSchema(f, descriptions);
  const out: Schema = { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
  return descriptions ? { ...out, description: v.doc } : out;
}

function buildSchema(descriptions: boolean): Schema {
  const defs: Record<string, Schema> = {};
  for (const v of VARIANTS) defs[v.name] = variantSchema(v, descriptions);
  defs.action = { anyOf: VARIANTS.map((v) => ({ $ref: `#/$defs/${v.name}` })) };
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

/** The same structure without descriptions, for a smaller prompt; pair it with sceneGuide. */
export const sceneSchemaLean: Schema = buildSchema(false);
