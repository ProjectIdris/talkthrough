// Real models: finding one by the name a model writes, its parts by theirs, and what size it takes in the scene. Pure functions over the generated
// catalogue (model-catalogue.ts), shared by the validator, the guide and the renderer.

import { MODELS } from './model-catalogue.ts';
import type { ModelEntry, ModelPart } from './model-catalogue.ts';
import type { Vec3 } from './types.ts';
import { closest, norm } from './names.ts';
import type { Closest } from './names.ts';

export { closest };
export type { Closest };

export type { ModelEntry, ModelPart };

/** Scene units to the metre: a model with no size written takes its real size at this scale (a heart about 5 units across, a brain about 7). */
export const SCENE_UNITS_PER_METRE = 40;

/** The model a name stands for: its id, its name or any alias, in any case. */
export function findModel(name: unknown): ModelEntry | undefined {
  if (typeof name !== 'string') return undefined;
  const n = norm(name);
  if (!n) return undefined;
  return MODELS.find((m) => norm(m.id) === n || norm(m.name) === n || m.aliases.some((a) => norm(a) === n));
}

/** A part of a model by its key, its name or an alias. */
export function findPart(model: ModelEntry, name: unknown): ModelPart | undefined {
  if (typeof name !== 'string') return undefined;
  const n = norm(name);
  if (!n) return undefined;
  return model.parts.find((p) => norm(p.key) === n || norm(p.name) === n || p.aliases.some((a) => norm(a) === n));
}

/** The id a part has in a scene: the model's id, a dot, the part's key. */
export const partId = (model: string, key: string): string => `${model}.${key}`;

/** Scene units to the metre for a model written with this `size` (its longest side), or at its real scale when none is. */
export function modelScale(model: ModelEntry, size?: number): number {
  const longest = Math.max(...model.size);
  return size !== undefined && size > 0 ? size / longest : SCENE_UNITS_PER_METRE;
}

/** The whole model's size in scene units. */
export function modelBounds(model: ModelEntry, size?: number): Vec3 {
  const s = modelScale(model, size);
  return [model.size[0] * s, model.size[1] * s, model.size[2] * s];
}

/** A model by the name written for it: exact (id, name, alias) or the one it is plainly meant to be; else the nearest to name. */
export function resolveModel(name: unknown): { model?: ModelEntry; exact: boolean; near: ModelEntry[] } {
  const exact = findModel(name);
  if (exact) return { model: exact, exact: true, near: [] };
  const c = closest(name, MODELS, (m) => [m.id, m.name, ...m.aliases]);
  return { ...(c.pick ? { model: c.pick } : {}), exact: false, near: c.near };
}

/** A part of a model by the name written for it, in the same way. */
export function resolvePart(model: ModelEntry, name: unknown): { part?: ModelPart; exact: boolean; near: ModelPart[] } {
  const exact = findPart(model, name);
  if (exact) return { part: exact, exact: true, near: [] };
  const c = closest(name, model.parts, (p) => [p.key, p.name, ...p.aliases]);
  return { ...(c.pick ? { part: c.pick } : {}), exact: false, near: c.near };
}

/** A model with at least this many named parts is one a shape-built stand-in cannot match (a heart's chambers, a brain's lobes); a handful of parts is not. */
const RICH_MODEL_PARTS = 6;

/**
 * What to tell a model when the question names a rich real model: the static guide lists every model in one line, and a model asked about a heart
 * still often builds a blob from shapes. A question that names the subject (its name or an alias, as whole words) gets one sentence saying the real one
 * exists, how many parts it has and what a few are called, and that it is the accurate choice. Nothing when no rich model is named.
 */
export function realModelHint(question: string): string | undefined {
  const text = ` ${norm(question).replace(/[^a-z0-9 ]+/g, ' ').replace(/ +/g, ' ')} `;
  const model = MODELS.find((m) => m.parts.length >= RICH_MODEL_PARTS && !m.single && [m.id, m.name, ...m.aliases].some((a) => text.includes(` ${norm(a)} `)));
  if (!model) return undefined;
  const sample = model.parts.slice(0, 4).map((p) => p.name.toLowerCase()).join(', ');
  return `This subject has a real, detailed model in the scene language: ${model.id} (add {shape:model, model:"${model.id}"}; its ${model.parts.length} parts include ${sample}). It is far more accurate than anything built from shapes: use it, and pin, highlight or cut its named parts; add shapes only for what the model does not hold.`;
}
