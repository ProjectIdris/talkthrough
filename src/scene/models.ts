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

const tokens = (text: string): string[] => norm(text).split(' ').filter(Boolean);

/** Edit distance, for names that differ by a slip or a plural. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = row[j]!;
      row[j] = Math.min(up + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = up;
    }
  }
  return row[b.length]!;
}

/** How close a written name is to one label: 0 is the same words, 1 the words of one inside the other, 2 or more a slip or two, Infinity nothing alike. */
function closeness(name: string, label: string): number {
  const a = tokens(name), b = tokens(label);
  if (a.length === 0 || b.length === 0) return Infinity;
  const same = (x: string, y: string) => x === y || x === `${y}s` || y === `${x}s`;
  if (a.length === b.length && a.every((t) => b.some((u) => same(t, u)))) return 0;
  if (a.every((t) => b.some((u) => same(t, u))) || b.every((t) => a.some((u) => same(t, u)))) return 1;
  const d = distance(norm(name), norm(label));
  if (d <= Math.max(1, Math.floor(norm(label).length / 5))) return 1 + d;
  // Some of the words in common: near enough to be listed, never enough to be taken for it.
  const shared = a.filter((t) => b.some((u) => same(t, u))).length;
  return shared > 0 ? 10 - shared : Infinity;
}

export type Closest<T> = { /** The one it is certainly meant to be, when only one is close. */ pick?: T; /** The nearest, best first. */ near: T[] };

/** The names closest to the one written: a pick when exactly one is close (the same words, one inside the other, or a slip), else the nearest to list. */
export function closest<T>(name: unknown, items: readonly T[], labels: (item: T) => readonly string[]): Closest<T> {
  if (typeof name !== 'string' || !norm(name)) return { near: [] };
  const scored = items.map((item) => ({ item, score: Math.min(...labels(item).map((l) => closeness(name, l))) })).filter((x) => Number.isFinite(x.score)).sort((a, b) => a.score - b.score);
  const best = scored[0];
  const pick = best && best.score <= 3 && (scored.length === 1 || scored[1]!.score > best.score) ? best.item : undefined;
  return { ...(pick !== undefined ? { pick } : {}), near: scored.slice(0, 6).map((x) => x.item) };
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
