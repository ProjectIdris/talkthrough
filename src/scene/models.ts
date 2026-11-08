// Real models: finding one by the name a model writes, its parts by theirs, and what size it takes in the scene. Pure functions over the generated
// catalogue (model-catalogue.ts), shared by the validator, the guide and the renderer.

import { MODELS } from './model-catalogue.ts';
import type { ModelEntry, ModelPart } from './model-catalogue.ts';
import type { Vec3 } from './types.ts';

export type { ModelEntry, ModelPart };

/** Scene units to the metre: a model with no size written takes its real size at this scale (a heart about 5 units across, a brain about 7). */
export const SCENE_UNITS_PER_METRE = 40;

const norm = (text: string): string => text.toLowerCase().replace(/[_\s]+/g, ' ').replace(/-/g, ' ').trim();

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
