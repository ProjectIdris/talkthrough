// Names written by a model, taken to the ones we have: a name is read as the same words in any case, with its plural, one inside the other or a slip or two. Pure functions
// over lists (the real models and their parts, the materials), shared by the validator and the guide.

export const norm = (text: string): string => text.toLowerCase().replace(/[_\s]+/g, ' ').replace(/-/g, ' ').trim();

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

