// Real models: finding one by the name a model writes, its parts by theirs, and what size it takes in the scene. Pure functions over the generated
// catalogue (model-catalogue.ts), shared by the validator, the guide and the renderer.

import { MODELS } from './model-catalogue.ts';
import type { ModelEntry, ModelPart } from './model-catalogue.ts';
import type { Vec3 } from './types.ts';
import { assemblyLine } from './assembly.ts';
import { ASSEMBLY_ROWS } from './assembly-rows.ts';
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

/** About how wide a real model and the mechanism beside it each stand on the stage (scene units): the size of a ready assembly. */
const STAGE_ACROSS = 10;

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

/** A question about how a thing works or what is inside it (a model that holds no mechanism cannot answer it). */
const HOW_IT_WORKS = /\b(how|why)\b|\b(work|works|working|mechanism|operate|operates|inside)\b/i;

/**
 * What to tell a model when the question names a real model, one sentence a question, never in the static guide.
 * A model with many named parts (a heart, a brain) is the accurate choice, so it is named with some of its parts. A model whose parts hold no working mechanism
 * (every other one today) is a picture of what a thing looks like, not of how it works: when the question asks how, the mechanism is to be built from shapes
 * and kit parts, and the real model may stand small beside it so the thing is recognised. Nothing when the question names no model.
 */
export function realModelHint(question: string): string | undefined {
  const text = ` ${norm(question).replace(/[^a-z0-9 ]+/g, ' ').replace(/ +/g, ' ')} `;
  const named = MODELS.filter((m) => [m.id, m.name, ...m.aliases].some((a) => text.includes(` ${norm(a)} `)));
  const rich = named.find((m) => m.parts.length >= RICH_MODEL_PARTS && !m.single);
  if (rich) {
    const sample = rich.parts.slice(0, 4).map((p) => p.name.toLowerCase()).join(', ');
    return `If the question is about the ${rich.name.toLowerCase()} itself: the scene language has a real, detailed model of it, ${rich.id} (add {shape:model, model:"${rich.id}"}; its ${rich.parts.length} parts include ${sample}). It is far more accurate than anything built from shapes: use it, and pin, highlight or cut its named parts; add shapes only for what the model does not hold.`;
  }
  const plain = HOW_IT_WORKS.test(question) ? named.find((m) => !m.mechanism) : undefined;
  if (!plain) return undefined;
  const across = Math.round(Math.max(...plain.size) * SCENE_UNITS_PER_METRE * 10) / 10;
  if (plain.works) return worksHint(plain, across);
  return `If the question is about the ${plain.name.toLowerCase()} itself: a real model of it exists (${plain.id}); it shows how the thing looks and where its parts are, and holds no working mechanism. Build the working mechanism from shapes and kit parts (a cutaway or a simplified working version) and show it large and animated; the real model may stand small beside it, at its own size (about ${across} units across, so leave its size off), so the thing is recognised.`;
}

/** The action written for a part of the model, as the model should write it: the part's id in the scene (`<id>` is the id the model gives the real model), and `by` named the same way. */
export function worksAction(model: ModelEntry, motion: NonNullable<NonNullable<ModelEntry['works']>['motion']>[number]): Record<string, unknown> {
  const { by, ...rest } = motion.action;
  return { ...rest, id: `<id>.${motion.part}`, ...(by ? { by: `<id>.${by}` } : {}) };
}

/**
 * For a how-does-it-work question about a real model that holds no mechanism of its own but whose catalogue entry says how it works: the real model comes first at stage size and the
 * working mechanism, built from the ready assemblies and kit parts the entry names, and the model's own named parts are moved the way the entry says.
 */
function worksHint(model: ModelEntry, across: number): string {
  const w = model.works!;
  const out = [`If the question is about the ${model.name.toLowerCase()} itself: a real model of it exists (${model.id}); it shows how the thing looks and where its parts are, but not its inside. How it works: ${w.how} Show it in this order, and plan the steps that way: step 1 opens on the real model at stage size, add {shape:model, id:"<id>", model:"${model.id}", size:${STAGE_ACROSS}, pos:[-${STAGE_ACROSS / 2 + 1},0,0]} (left unsized it stands only about ${across} units across), so the thing is recognised first; the next steps build the working mechanism large and animated beside it, at the right (pos about [${STAGE_ACROSS / 2 + 1},0,0]), and keep the real model on stage.`];
  const ready = (w.assemblies ?? []).filter((a) => ASSEMBLY_ROWS[a.name]);
  if (ready.length) out.push(`Ready assemblies for the mechanism (use them rather than building the parts one by one): ${ready.map((a) => `${a.role} - ${assemblyLine(a.name)}`).join(' ')}`);
  if (w.kit?.length) out.push(`Kit parts for what has no assembly: ${w.kit.map((k) => `${k.part} (${k.role})`).join('; ')}.`);
  if (w.motion?.length) {
    const named = (key: string): string => model.parts.find((p) => p.key === key)?.name.toLowerCase() ?? key;
    out.push(`Move the real model's own parts, writing these with its id in place of <id>: ${w.motion.map((m) => `${named(m.part)} - ${JSON.stringify(worksAction(model, m))} (${m.what})`).join('; ')}.`);
  }
  return out.join(' ');
}
