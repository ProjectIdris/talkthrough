import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogue } from '../scripts/prototypes/catalogue-retrieval.ts';

// Independently authored exhaustive oracle. This checks the defined interval semantics,
// not retrieval relevance, and uses no corpus text or component vocabulary.
test('descriptor matching agrees with an exhaustive independent interval oracle', () => {
  let seed = 19873;
  const random = (n: number): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const vocabulary = ['x', 'y', 'z'];
  interface Span { start: number; end: number }
  for (let run = 0; run < 1000; run++) {
    const query = Array.from({ length: 1 + random(24) }, () => vocabulary[random(3)]!);
    const profiles = Array.from({ length: 3 }, () => Array.from({ length: 2 + random(3) }, () =>
      Array.from({ length: 1 + random(4) }, () => Array.from({ length: 1 + random(4) }, () => vocabulary[random(3)]!).join(' '))));
    const expected = profiles.flatMap((profile, id) => {
      const evidence: Span[][] = profile.map(group => group.flatMap(text => {
        const tokens = text.split(' ');
        return query.flatMap((_, start) => tokens.every((word, offset) => query[start + offset] === word)
          ? [{ start, end: start + tokens.length }] : []);
      }));
      const search = (group: number, chosen: Span[]): boolean => group === evidence.length
        ? Math.max(...chosen.map(e => e.end)) - Math.min(...chosen.map(e => e.start)) <= 16
        : evidence[group]!.some(e => chosen.every(other => e.end <= other.start || other.end <= e.start) && search(group + 1, [...chosen, e]));
      return search(0, []) ? ['fixture-' + id] : [];
    });
    const cards = profiles.map((profile, id) => ({ id: 'fixture-' + id, tags: [], summary: '', parameters: {}, example: {}, descriptors: [profile] }));
    const actual = createCatalogue(cards).search(query.join(' ')).cards.map(card => card.id).sort();
    assert.deepEqual(actual, expected, JSON.stringify({ run, query, profiles }));
  }
});
