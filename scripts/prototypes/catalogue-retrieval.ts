export interface ComponentCard {
  id: string;
  summary: string;
  tags: readonly string[];
  parameters: Readonly<Record<string, unknown>>;
  example: Readonly<Record<string, unknown>>;
}
export const CATALOGUE_LIMITS = Object.freeze({ entries: 10_000, cardBytes: 2_048, queryChars: 512, queryTerms: 32, results: 4, responseBytes: 4_096 });
export interface CatalogueResult { cards: ComponentCard[]; truncated: boolean; fallback: string }
const FALLBACK = 'Use ordinary scene primitives when these cards do not fit. Validate every authored action; cards are examples, not executable code or complete scenes.';
const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const terms = (text: string): string[] => [...new Set(text.toLowerCase().match(/[a-z0-9]+/g) ?? [])];
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

// Reject JS-only containers before serialization: their apparent JSON bytes can be misleading,
// and shared buffers would defeat structuredClone's ownership isolation. Inputs remain trusted
// maintainer data, not arbitrary objects (in particular, this is not a Proxy sandbox).
function assertJsonCard(value: unknown): void {
  let nodes = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++nodes > 1024 || depth > 16) throw new TypeError('JSON card structure exceeds limits');
    if (value === null || typeof value === 'boolean') return;
    if (typeof value === 'string' && value.length <= CATALOGUE_LIMITS.cardBytes) return;
    if (typeof value === 'number' && Number.isFinite(value)) return;
    if (typeof value !== 'object') throw new TypeError('Catalogue cards must contain only bounded JSON data');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== (array ? Array.prototype : Object.prototype) && !(prototype === null && !array)) throw new TypeError('Catalogue cards must contain only JSON objects and arrays');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length > 1024) throw new TypeError('JSON card structure exceeds limits');
    if (array && keys.length !== (value as unknown[]).length + 1) throw new TypeError('JSON arrays must not be sparse or have extra properties');
    for (const key of keys) {
      if (array && key === 'length') continue;
      const descriptor = descriptors[key as string];
      if (typeof key !== 'string' || !descriptor || !('value' in descriptor) || !descriptor.enumerable) throw new TypeError('Catalogue cards must contain only JSON data properties');
      if (array && !/^(0|[1-9][0-9]*)$/.test(key)) throw new TypeError('JSON array has an extra property');
      visit(descriptor.value, depth + 1);
    }
  };
  visit(value, 0);
}

/** Offline experiment. Cards are trusted, maintainer-authored data, never model output or remote plugins. */
export function createCatalogue(source: readonly ComponentCard[]) {
  if (source.length > CATALOGUE_LIMITS.entries) throw new RangeError('Too many catalogue entries');
  const cards: ComponentCard[] = [];
  const ids = new Set<string>();
  const postings = new Map<string, Map<number, number>>();
  for (const original of source) {
    assertJsonCard(original);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(original.id)) throw new TypeError('Invalid catalogue id');
    if (ids.has(original.id)) throw new TypeError('Duplicate catalogue id');
    if (byteLength(original) > CATALOGUE_LIMITS.cardBytes) throw new RangeError('Catalogue card exceeds bytes limit');
    ids.add(original.id);
    // Snapshot both the indexed text and the returned payload so callers cannot desynchronise them.
    const card = structuredClone(original);
    const n = cards.push(card) - 1;
    for (const [text, weight] of [[card.id, 8], [card.tags.join(' '), 4], [card.summary, 1]] as const) {
      for (const term of terms(text)) {
        let posting = postings.get(term);
        if (!posting) { posting = new Map(); postings.set(term, posting); }
        posting.set(n, (posting.get(n) ?? 0) + weight);
      }
    }
  }

  return {
    search(query: string, options: { maxResults?: number; maxBytes?: number } = {}): CatalogueResult {
      if (typeof query !== 'string') throw new TypeError('Catalogue query must be text');
      if (query.length > CATALOGUE_LIMITS.queryChars) throw new RangeError('Catalogue query too long');
      const queryTerms = terms(query);
      if (queryTerms.length > CATALOGUE_LIMITS.queryTerms) throw new RangeError('Too many catalogue query terms');
      const maxResults = options.maxResults ?? CATALOGUE_LIMITS.results;
      const maxBytes = options.maxBytes ?? CATALOGUE_LIMITS.responseBytes;
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > CATALOGUE_LIMITS.results) throw new RangeError('Invalid catalogue result limit');
      if (!Number.isInteger(maxBytes) || maxBytes < 512 || maxBytes > CATALOGUE_LIMITS.responseBytes) throw new RangeError('Invalid catalogue byte limit');
      const scores = new Map<number, number>();
      for (const term of queryTerms) {
        for (const [n, weight] of postings.get(term) ?? []) scores.set(n, (scores.get(n) ?? 0) + weight);
      }
      const ranked = [...scores].sort(([a, sa], [b, sb]) => sb - sa || order(cards[a]!.id, cards[b]!.id));
      const result: CatalogueResult = { cards: [], truncated: false, fallback: FALLBACK };
      // Reserve the longer boolean spelling, so changing truncated cannot exceed the byte budget.
      for (const [n] of ranked) {
        if (result.cards.length === maxResults) break;
        const card = cards[n]!;
        const candidate = { ...result, cards: [...result.cards, card] };
        if (byteLength(candidate) <= maxBytes) result.cards.push(card);
      }
      result.truncated = result.cards.length < ranked.length;
      // Consumers may edit a returned example. That must not change any subsequent retrieval.
      return structuredClone(result);
    },
  };
}
