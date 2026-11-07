import { VARIANTS } from "../../src/scene/spec.ts";
// A small checker for the JSON Schema subset the scene schema uses, so tests can hold scenes
// to the schema without a package. It also lints a schema for strict structured-output modes.

type Schema = Record<string, unknown>;

function resolve(root: Schema, s: Schema): Schema {
  if (typeof s.$ref !== 'string') return s;
  const parts = s.$ref.replace(/^#\//, '').split('/');
  let cur: unknown = root;
  for (const p of parts) cur = (cur as Record<string, unknown>)[p];
  return cur as Schema;
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Errors found checking value against schema; empty means it conforms. A missing property is fine when its schema allows null and allowMissingNullable is set. */
export function check(root: Schema, schema: Schema, value: unknown, path = '$', allowMissingNullable = false): string[] {
  const s = resolve(root, schema);
  if (Array.isArray(s.anyOf)) {
    const branches = (s.anyOf as Schema[]).map((b) => check(root, b, value, path, allowMissingNullable));
    return branches.some((e) => e.length === 0) ? [] : [`${path}: matches none of ${branches.length} alternatives (${branches[0]?.[0] ?? ''})`];
  }
  if (Array.isArray(s.enum)) {
    return (s.enum as unknown[]).includes(value) ? [] : [`${path}: ${JSON.stringify(value)} is not in the enum`];
  }
  const types = ([] as string[]).concat((s.type as string | string[]) ?? []);
  const t = typeOf(value);
  if (types.length && !types.includes(t)) return [`${path}: expected ${types.join('|')}, got ${t}`];
  const errors: string[] = [];
  if (t === 'array' && s.items) {
    (value as unknown[]).forEach((v, i) => errors.push(...check(root, s.items as Schema, v, `${path}[${i}]`, allowMissingNullable)));
  }
  if (t === 'object') {
    const obj = value as Record<string, unknown>;
    const props = (s.properties ?? {}) as Record<string, Schema>;
    for (const key of (s.required ?? []) as string[]) {
      if (key in obj) continue;
      const sub = resolve(root, props[key] as Schema);
      const nullable = ([] as string[]).concat((sub.type as string | string[]) ?? []).includes('null') ||
        (Array.isArray(sub.enum) && (sub.enum as unknown[]).includes(null));
      if (!(allowMissingNullable && nullable)) errors.push(`${path}.${key}: required`);
    }
    for (const key of Object.keys(obj)) {
      if (!(key in props)) {
        if (s.additionalProperties === false) errors.push(`${path}.${key}: not allowed`);
      } else {
        errors.push(...check(root, props[key] as Schema, obj[key], `${path}.${key}`, allowMissingNullable));
      }
    }
  }
  return errors;
}

const FORBIDDEN = [
  'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength',
  'pattern', 'format', 'minItems', 'maxItems', 'uniqueItems', 'oneOf', 'allOf', 'not', 'const', 'if', 'then', 'else',
  'default', 'patternProperties', 'additionalItems', 'contains', 'propertyNames', 'minProperties', 'maxProperties',
];

/** Things strict structured-output modes reject, found anywhere in the schema. */
export function strictProblems(root: Schema): string[] {
  const problems: string[] = [];
  let properties = 0;
  let enumValues = 0;
  function walk(s: Schema, path: string, depth: number): void {
    for (const k of FORBIDDEN) if (k in s) problems.push(`${path}: uses ${k}`);
    if (Array.isArray(s.enum)) enumValues += s.enum.length;
    if (typeof s.$ref === 'string') {
      if (!s.$ref.startsWith('#/$defs/')) problems.push(`${path}: non-local $ref`);
      return; // targets are walked from $defs
    }
    const types = ([] as string[]).concat((s.type as string | string[]) ?? []);
    if (types.includes('object')) {
      const props = (s.properties ?? {}) as Record<string, Schema>;
      const names = Object.keys(props);
      properties += names.length;
      if (s.additionalProperties !== false) problems.push(`${path}: object is not closed`);
      const required = (s.required ?? []) as string[];
      for (const n of names) if (!required.includes(n)) problems.push(`${path}.${n}: not required`);
      for (const n of names) walk(props[n] as Schema, `${path}.${n}`, depth + 1);
    }
    if (types.includes('array') && s.items) walk(s.items as Schema, `${path}[]`, depth + 1);
    if (Array.isArray(s.anyOf)) (s.anyOf as Schema[]).forEach((b, i) => walk(b, `${path}|${i}`, depth));
  }
  walk(root, '$', 1);
  for (const [name, def] of Object.entries((root.$defs ?? {}) as Record<string, Schema>)) walk(def, `$defs.${name}`, 1);
  if (properties > 5000) problems.push(`${properties} properties (limit 5000)`);
  if (enumValues > 1000) problems.push(`${enumValues} enum values (limit 1000)`);
  if ((root as { type?: unknown }).type !== 'object') problems.push('root is not an object');
  return problems;
}

/** Expand local references so assertions concern contract meaning, not compact transport names. */
export function expandedSchema(root: Schema, value: unknown = root): unknown {
  if (Array.isArray(value)) return value.map(v => expandedSchema(root, v));
  if (!value || typeof value !== 'object') return value;
  const object = value as Schema;
  if (typeof object.$ref === 'string') return expandedSchema(root, resolve(root, object));
  return Object.fromEntries(Object.entries(object).filter(([name]) => name !== '$defs')
    .map(([name, child]) => [name, expandedSchema(root, child)]));
}

/** Variants are offered in spec order in both full and compact schema unions. */
export function variantDefinitions(root: Schema): Record<string, { properties: Record<string, Schema>; required: string[] }> {
  const step = resolve(root, ((root.properties as Record<string, Schema>).steps!.items as Schema));
  const action = resolve(root, ((step.properties as Record<string, Schema>).actions!.items as Schema));
  return Object.fromEntries(VARIANTS.map((variant, i) => [variant.name,
    expandedSchema(root, (action.anyOf as Schema[])[i])])) as Record<string, { properties: Record<string, Schema>; required: string[] }>;
}
