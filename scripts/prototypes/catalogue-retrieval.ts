export interface ComponentCard {
  id: string;
  summary: string;
  tags: readonly string[];
  topics?: readonly string[];
  keywords?: readonly string[];
  conflicts?: readonly string[];
  parameters: Readonly<Record<string, unknown>>;
  example: Readonly<Record<string, unknown>>;
}
export const CATALOGUE_LIMITS = Object.freeze({ entries: 10_000, cardBytes: 2_048, queryChars: 512, queryTerms: 32, results: 4, responseBytes: 4_096 });
export interface CatalogueResult { cards: ComponentCard[]; truncated: boolean; fallback: string }
const FALLBACK = 'Use ordinary scene primitives for requested objects not covered by these lexical candidates. Cards may be incomplete or inappropriate; validate every authored action. Examples are not executable code or complete scenes.';
const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const segmenter = new Intl.Segmenter('und', { granularity: 'word' });
const normalize = (text: string): string => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[‐‑–—_-]/g, ' ');
// A narrow plural fold, not a language detector or general stemmer.
const fold = (word: string): string => /^[a-z]{4,}s$/.test(word) && !/(ss|us|is)$/.test(word) ? word.slice(0, -1) : word;
const terms = (text: string): string[] => [...segmenter.segment(normalize(text))].filter(s => s.isWordLike).map(s => fold(s.segment));
interface Word { value: string; excluded: boolean; clause: number }
function queryWords(text: string): Word[] {
  const segments = [...segmenter.segment(normalize(text).replace(/\b(?:don't|dont|doesn't|isn't|do not)\b/g, 'not'))];
  const words: Word[] = [];
  let excluded = false;
  let clause = 0;
  let afterComma = false;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    if (!s.isWordLike) {
      if (/[.;:!?\n]/.test(s.segment)) { excluded = false; clause++; afterComma = false; }
      else if (s.segment.includes(',')) afterComma = true;
      continue;
    }
    const value = fold(s.segment);
    const next = segments.slice(i + 1).find(s => s.isWordLike)?.segment;
    if (['but', 'however'].includes(value) || (afterComma && ['add', 'show', 'draw', 'include'].includes(value)) || (value === 'instead' && next !== 'of')) { excluded = false; clause++; }
    if ((['not', 'without', 'no', 'excluding', 'exclude', 'omit', 'omitting', 'except', 'sans', 'ohne', 'sin'].includes(value) || (value === 'instead' && next === 'of') || (value === 'leave' && next === 'out')) &&
        !(value === 'not' && ['only', 'just'].includes(next ?? '')) &&
        !(value === 'no' && ['more', 'fewer', 'less'].includes(next ?? ''))) excluded = true;
    words.push({ value, excluded, clause });
    afterComma = false;
  }
  return words;
}
// Conflicting senses apply within a clause/coordination, not to unrelated listed objects.
function hasConflict(words: readonly Word[], at: number, conflicts: ReadonlySet<string>): boolean {
  if (!conflicts.size) return false;
  return words.some((word, i) => !word.excluded && word.clause === words[at]!.clause && conflicts.has(word.value) &&
    !words.slice(Math.min(i, at) + 1, Math.max(i, at)).some(w => ['and', 'beside', 'alongside', 'versus'].includes(w.value)));
}
interface Phrase { card: number; words: string[]; weight: number; topic: boolean }
const browseWords = new Set(['part', 'component', 'option', 'catalogue', 'catalog', 'library', 'selection', 'family', 'familie', 'builtin', 'builtins']);
const browseFiller = new Set(['a', 'an', 'the', 'show', 'me', 'some', 'all', 'available', 'please', 'find', 'list', 'what', 'which', 'are', 'there', 'for', 'of', 'in', 'can', 'you', ...browseWords]);
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
  const postings = new Map<string, Phrase[]>();
  const conflicts: Set<string>[] = [];
  const contentPostings = new Map<string, number[]>();
  const tokenCache = new Map<string, string[]>();
  const tokenize = (text: string): string[] => {
    const cached = tokenCache.get(text);
    if (cached) return cached;
    const words = terms(text);
    tokenCache.set(text, words);
    return words;
  };
  for (const original of source) {
    assertJsonCard(original);
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(original.id)) throw new TypeError('Invalid catalogue id');
    if (ids.has(original.id)) throw new TypeError('Duplicate catalogue id');
    if (byteLength(original) > CATALOGUE_LIMITS.cardBytes) throw new RangeError('Catalogue card exceeds bytes limit');
    ids.add(original.id);
    // Snapshot both the indexed text and the returned payload so callers cannot desynchronise them.
    const card = structuredClone(original);
    const n = cards.push(card) - 1;
    for (const word of new Set((card.keywords ?? []).flatMap(tokenize))) {
      const posting = contentPostings.get(word) ?? [];
      posting.push(n);
      contentPostings.set(word, posting);
    }
    conflicts.push(new Set((card.conflicts ?? []).flatMap(tokenize)));
    // Descriptions teach use after selection; their grammar/orientation words are not evidence.
    const phrases = [[card.id, 8, false], ...card.tags.map(tag => [tag, 4, false]),
      ...(card.topics ?? []).map(topic => [topic, 1, true])] as [string, number, boolean][];
    const indexed = new Set<string>();
    for (const [text, weight, topic] of phrases) {
      const words = tokenize(text);
      const key = `${topic}:${words.join(' ')}`;
      if (!words.length || indexed.has(key)) continue;
      indexed.add(key);
      const first = words[0]!;
      const posting = postings.get(first) ?? [];
      posting.push({ card: n, words, weight, topic });
      postings.set(first, posting);
    }
  }

  // Index construction is complete; release the temporary phrase-normalization cache.
  tokenCache.clear();
  return {
    search(query: string, options: { maxResults?: number; maxBytes?: number } = {}): CatalogueResult {
      if (typeof query !== 'string') throw new TypeError('Catalogue query must be text');
      if (query.length > CATALOGUE_LIMITS.queryChars) throw new RangeError('Catalogue query too long');
      const words = queryWords(query);
      if (new Set(words.map(w => w.value)).size > CATALOGUE_LIMITS.queryTerms) throw new RangeError('Too many catalogue query terms');
      const maxResults = options.maxResults ?? CATALOGUE_LIMITS.results;
      const maxBytes = options.maxBytes ?? CATALOGUE_LIMITS.responseBytes;
      if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > CATALOGUE_LIMITS.results) throw new RangeError('Invalid catalogue result limit');
      if (!Number.isInteger(maxBytes) || maxBytes < 512 || maxBytes > CATALOGUE_LIMITS.responseBytes) throw new RangeError('Invalid catalogue byte limit');
      const scores = new Map<number, number>();
      const contentScores = new Map<number, Map<string, number>>();
      const topicScores = new Map<number, number>();
      const matchedPhrases = new Set<Phrase>();
      const excludedCards = new Set<number>();
      const explicitCards = new Set<number>();
      const browseIntent = words.some(w => !w.excluded && browseWords.has(w.value));
      const universalBrowse = /\b(?:(?:all|every) (?:the )?(?:built in|component|part|familie)|catalogue overview)\b/.test(words.filter(w => !w.excluded).map(w => w.value).join(' '));
      if (universalBrowse) for (let n = 0; n < cards.length; n++) topicScores.set(n, 1);
      for (let i = 0; i < words.length; i++) {
        const word = words[i]!;
        if (word.excluded) {
          for (const phrase of postings.get(word.value) ?? []) {
            if (!phrase.topic && phrase.words.every((value, offset) => words[i + offset]?.value === value &&
                words[i + offset]!.excluded && words[i + offset]!.clause === word.clause)) excludedCards.add(phrase.card);
          }
          continue;
        }
        // In a leading request, 'display a gear' uses display as a verb, not a second object.
        if (['show', 'draw', 'display', 'model', 'sketch', 'render', 'illustrate'].includes(word.value) &&
            ['a', 'an', 'the', 'me', 'some'].includes(words[i + 1]?.value ?? '') &&
            words.slice(0, i).every(w => ['please', 'can', 'could', 'would', 'will', 'you', 'me', 'kindly'].includes(w.value))) continue;
        for (const n of contentPostings.get(word.value) ?? []) {
          if (contentScores.get(n)?.has(word.value)) continue;
          if (hasConflict(words, i, conflicts[n]!)) continue;
          const evidence = contentScores.get(n) ?? new Map<string, number>();
          evidence.set(word.value, Math.log2(1 + cards.length / contentPostings.get(word.value)!.length));
          contentScores.set(n, evidence);
        }
        for (const phrase of postings.get(word.value) ?? []) {
          if (matchedPhrases.has(phrase)) continue;
          const end = i + phrase.words.length;
          if (!phrase.words.every((value, offset) => words[i + offset]?.value === value &&
              !words[i + offset]!.excluded && words[i + offset]!.clause === word.clause)) continue;
          if (phrase.topic) {
            const nearby = words.slice(Math.max(0, i - 2), Math.min(words.length, end + 2));
            const explicitBrowse = nearby.some(w => !w.excluded && w.clause === word.clause && browseWords.has(w.value));
            const categoryOnly = words.every(w => browseFiller.has(w.value) || phrase.words.includes(w.value));
            if (!explicitBrowse && !categoryOnly) {
              if (browseIntent) topicScores.set(phrase.card, 1);
              continue;
            }
          } else if (phrase.words.length === 1 && hasConflict(words, i, conflicts[phrase.card]!)) continue;
          matchedPhrases.add(phrase);
          if (!phrase.topic) explicitCards.add(phrase.card);
          // Strongest positive phrase wins. Repetition and overlapping aliases cannot inflate rank.
          const score = phrase.topic ? 1 : phrase.weight + Math.min(phrase.words.length, 8);
          scores.set(phrase.card, Math.max(scores.get(phrase.card) ?? 0, score));
        }
      }
      for (const [n, evidence] of contentScores) {
        if (evidence.size >= 2) scores.set(n, Math.max(scores.get(n) ?? 0, 2 + Math.min(2, [...evidence.values()].reduce((a, b) => a + b, 0) / 8)));
      }
      // Domain words can rescue explicit browsing, but never pad a specific object request.
      if (scores.size === 0 || universalBrowse) for (const [n, score] of topicScores) scores.set(n, Math.max(scores.get(n) ?? 0, score));
      for (const n of excludedCards) if (!explicitCards.has(n)) scores.delete(n);
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
