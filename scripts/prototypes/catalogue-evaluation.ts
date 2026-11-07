// Offline relevance scoring over maintained labels. No model calls or runtime integration.
import { CATALOGUE_LIMITS } from './catalogue-retrieval.ts';
import type { CatalogueResult } from './catalogue-retrieval.ts';

export interface RelevanceCase {
  id: string;
  query: string;
  language: string;
  category: string;
  relevantIds: readonly string[];
  rationale: string;
}
export interface CaseResult extends RelevanceCase {
  returnedIds: string[];
  missingIds: string[];
  unexpectedIds: string[];
  precision: number | null;
  recall: number | null;
  reciprocalRank: number | null;
  correctAbstention: boolean | null;
  responseBytes: number | null;
  withinBudget: boolean | null;
  truncated: boolean | null;
  error: string | null;
}
const ratio = (numerator: number, denominator: number): number | null => denominator ? numerator / denominator : null;
const nonempty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

function validateCases(cases: readonly RelevanceCase[], known: Set<string>): void {
  if (!Array.isArray(cases) || cases.length === 0) throw new TypeError('Cases must be a nonempty array');
  const ids = new Set<string>();
  for (const c of cases) {
    if (!c || !nonempty(c.id) || typeof c.query !== 'string' || !nonempty(c.language) || !nonempty(c.category) || !nonempty(c.rationale)) {
      throw new TypeError('Every case needs an id, text query, language, category and rationale');
    }
    if (ids.has(c.id)) throw new TypeError(`Duplicate case id: ${c.id}`);
    ids.add(c.id);
    if (!Array.isArray(c.relevantIds) || [...c.relevantIds].some(id => !known.has(id)) || new Set(c.relevantIds).size !== c.relevantIds.length) {
      throw new TypeError(`Invalid relevance labels for case: ${c.id}`);
    }
  }
}

function summarise(results: readonly CaseResult[]) {
  const positive = results.filter(r => r.relevantIds.length > 0);
  const absent = results.filter(r => r.relevantIds.length === 0);
  const expectedTargets = positive.reduce((sum, r) => sum + r.relevantIds.length, 0);
  const retrievedCards = results.reduce((sum, r) => sum + r.returnedIds.length, 0);
  const relevantRetrieved = results.reduce((sum, r) => sum + r.returnedIds.length - r.unexpectedIds.length, 0);
  const correctAbstentions = absent.filter(r => r.correctAbstention).length;
  return {
    cases: results.length, relevantCases: positive.length, absentCases: absent.length,
    searchErrors: results.filter(r => r.error !== null).length,
    hitRate: ratio(positive.filter(r => r.reciprocalRank! > 0).length, positive.length),
    top1Accuracy: ratio(positive.filter(r => r.reciprocalRank === 1).length, positive.length),
    meanReciprocalRank: ratio(positive.reduce((sum, r) => sum + r.reciprocalRank!, 0), positive.length),
    macroRecall: ratio(positive.reduce((sum, r) => sum + r.recall!, 0), positive.length),
    microRecall: ratio(relevantRetrieved, expectedTargets),
    microPrecision: ratio(relevantRetrieved, retrievedCards),
    expectedTargets, retrievedCards, relevantRetrieved,
    correctAbstentions, falsePositiveCases: absent.filter(r => r.returnedIds.length > 0).length,
    abstentionAccuracy: ratio(correctAbstentions, absent.length),
    emptyRelevantCases: positive.filter(r => r.error === null && r.returnedIds.length === 0).length,
    maxResponseBytes: Math.max(0, ...results.map(r => r.responseBytes ?? 0)),
    budgetViolations: results.filter(r => r.withinBudget === false).length,
  };
}

/** Labels and retriever responses must refer to the same explicit catalogue revision. */
export function evaluateCatalogue(cases: readonly RelevanceCase[], knownCardIds: readonly string[], retrieve: (query: string) => CatalogueResult) {
  const known = new Set(knownCardIds);
  if (known.size !== knownCardIds.length || [...known].some(id => !nonempty(id))) throw new TypeError('Invalid or duplicate known card id');
  validateCases(cases, known);
  const results: CaseResult[] = cases.map(c => {
    let response: CatalogueResult | null = null;
    let error: string | null = null;
    try { response = retrieve(c.query); }
    catch (e) { error = e instanceof Error ? e.message : String(e); }
    if (error === null && (!response || !Array.isArray(response.cards) ||
      [...response.cards].some(card => !card || !nonempty(card.id)) ||
      typeof response.truncated !== 'boolean' || !nonempty(response.fallback))) {
      throw new TypeError(`Malformed retrieval response in case: ${c.id}`);
    }
    const returnedIds = response?.cards.map(card => card.id) ?? [];
    if (new Set(returnedIds).size !== returnedIds.length) throw new TypeError(`Duplicate retrieved id in case: ${c.id}`);
    if (returnedIds.some(id => !known.has(id))) throw new TypeError(`Unknown retrieved id in case: ${c.id}`);
    const relevant = new Set(c.relevantIds);
    const missingIds = c.relevantIds.filter(id => !returnedIds.includes(id));
    const unexpectedIds = returnedIds.filter(id => !relevant.has(id));
    const hits = returnedIds.length - unexpectedIds.length;
    const firstHit = returnedIds.findIndex(id => relevant.has(id));
    const responseBytes = response ? Buffer.byteLength(JSON.stringify(response), 'utf8') : null;
    return {
      ...c, relevantIds: [...c.relevantIds], returnedIds, missingIds, unexpectedIds,
      precision: ratio(hits, returnedIds.length), recall: ratio(hits, relevant.size),
      reciprocalRank: relevant.size ? (firstHit < 0 ? 0 : 1 / (firstHit + 1)) : null,
      correctAbstention: relevant.size ? null : error === null && returnedIds.length === 0,
      responseBytes, withinBudget: responseBytes === null ? null : responseBytes <= CATALOGUE_LIMITS.responseBytes && returnedIds.length <= CATALOGUE_LIMITS.results,
      truncated: response?.truncated ?? null, error,
    };
  });
  const slices = (key: 'category' | 'language') => Object.fromEntries(
    [...new Set(results.map(r => r[key]))].sort().map(value => [value, summarise(results.filter(r => r[key] === value))]),
  );
  return { summary: summarise(results), byCategory: slices('category'), byLanguage: slices('language'), results };
}
