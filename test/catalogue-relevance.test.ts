import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateCatalogue } from '../scripts/prototypes/catalogue-evaluation.ts';
import type { RelevanceCase } from '../scripts/prototypes/catalogue-evaluation.ts';
import { createCatalogue } from '../scripts/prototypes/catalogue-retrieval.ts';
import type { ComponentCard } from '../scripts/prototypes/catalogue-retrieval.ts';

const cards: ComponentCard[] = [
  { id: 'cog', summary: 'copper', tags: [], parameters: {}, example: {} },
  { id: 'wheel', summary: 'copper silver', tags: [], parameters: {}, example: {} },
  { id: 'spring', summary: 'silver', tags: [], parameters: {}, example: {} },
];
const known = cards.map(c => c.id);
const index = createCatalogue(cards);
const c = (id: string, query: string, relevantIds: string[], category = 'direct', language = 'en'): RelevanceCase => ({
  id, query, relevantIds, category, language, rationale: 'Explicit test relevance labels.',
});

test('scores missed targets, distractors, rank and absent-query fallback without hiding failures', () => {
  const report = evaluateCatalogue([
    c('one', 'copper', ['cog']), c('two', 'silver', ['cog', 'spring'], 'multi-part'),
    c('three', 'absent', ['cog'], 'paraphrase', 'fr'), c('four', 'none', [], 'absent'),
    c('five', 'copper', [], 'absent'),
  ], known, q => index.search(q));
  assert.deepEqual(report.summary, {
    cases: 5, relevantCases: 3, absentCases: 2, searchErrors: 0,
    hitRate: 2 / 3, top1Accuracy: 2 / 3, meanReciprocalRank: 2 / 3,
    macroRecall: 0.5, microRecall: 0.5, microPrecision: 1 / 3,
    expectedTargets: 4, retrievedCards: 6, relevantRetrieved: 2,
    correctAbstentions: 1, falsePositiveCases: 1, abstentionAccuracy: 0.5,
    emptyRelevantCases: 1, maxResponseBytes: Math.max(...report.results.map(r => r.responseBytes ?? 0)),
    budgetViolations: 0,
  });
  assert.deepEqual(report.results[1]!.missingIds, ['cog']);
  assert.deepEqual(report.results[1]!.unexpectedIds, ['wheel']);
  assert.equal(report.results[2]!.recall, 0);
  assert.equal(report.results[3]!.precision, null);
  assert.equal(report.results[3]!.recall, null);
  assert.equal(report.results[3]!.correctAbstention, true);
  assert.equal(report.results[4]!.correctAbstention, false);
  assert.equal(report.byCategory['multi-part']!.microRecall, 0.5);
  assert.equal(report.byLanguage['fr']!.hitRate, 0);
});

test('rank metrics distinguish a relevant card below an irrelevant first result', () => {
  const report = evaluateCatalogue([c('rank', 'copper', ['wheel'])], known, q => index.search(q));
  assert.equal(report.summary.hitRate, 1);
  assert.equal(report.summary.top1Accuracy, 0);
  assert.equal(report.summary.meanReciprocalRank, 0.5);
});

test('empty denominators remain null, rather than perfect scores', () => {
  const report = evaluateCatalogue([c('negative', 'absent', [])], known, q => index.search(q));
  for (const key of ['hitRate', 'top1Accuracy', 'meanReciprocalRank', 'macroRecall', 'microRecall', 'microPrecision'] as const) {
    assert.equal(report.summary[key], null, key);
  }
  const positive = evaluateCatalogue([c('positive', 'cog', ['cog'])], known, q => index.search(q));
  assert.equal(positive.summary.abstentionAccuracy, null);
  assert.throws(() => evaluateCatalogue([], known, q => index.search(q)), /empty/i);
});

test('search errors are reported, positive targets remain misses and errors are not correct abstentions', () => {
  const report = evaluateCatalogue([c('long-positive', 'x'.repeat(513), ['cog']), c('long-negative', 'x'.repeat(514), [])], known, q => index.search(q));
  assert.equal(report.summary.searchErrors, 2);
  assert.equal(report.summary.microRecall, 0);
  assert.equal(report.summary.correctAbstentions, 0);
  assert.equal(report.summary.abstentionAccuracy, 0);
  assert.equal(report.summary.falsePositiveCases, 0);
  assert.match(report.results[0]!.error!, /too long/i);
  assert.equal(report.results[0]!.responseBytes, null);
  assert.deepEqual(report.results[0]!.missingIds, ['cog']);
});

test('rejects malformed labels rather than silently treating them as absent requests', () => {
  const valid = c('valid', 'cog', ['cog']);
  for (const bad of [null, {}, { ...valid, relevantIds: undefined }, { ...valid, relevantIds: ['missing'] },
    { ...valid, relevantIds: ['cog', 'cog'] }, { ...valid, query: 7 }, { ...valid, rationale: '' },
    { ...valid, language: '' }, { ...valid, category: '' }, { ...valid, id: '' }]) {
    assert.throws(() => evaluateCatalogue([bad] as RelevanceCase[], known, q => index.search(q)), /case|label|id/i);
  }
  assert.throws(() => evaluateCatalogue([valid, valid], known, q => index.search(q)), /duplicate/i);
});

test('rejects unknown or duplicate retrieved IDs rather than inflating scores', () => {
  const valid = c('valid', 'cog', ['cog']);
  const result = index.search('cog');
  assert.throws(() => evaluateCatalogue([valid], known, () => ({ ...result, cards: [cards[0]!, cards[0]!] })), /duplicate/i);
  assert.throws(() => evaluateCatalogue([valid], known, () => ({ ...result, cards: [{ ...cards[0]!, id: 'missing' }] })), /unknown/i);
});

test('reports response-budget violations separately from relevance', () => {
  const result = { cards: [cards[0]!], truncated: false, fallback: 'x'.repeat(4096) };
  const report = evaluateCatalogue([c('budget', 'cog', ['cog'])], known, () => result);
  assert.equal(report.summary.hitRate, 1);
  assert.equal(report.summary.budgetViolations, 1);
  assert.equal(report.results[0]!.withinBudget, false);
});

test('refuses sparse labels and malformed retrieval responses, not false successful fallbacks', () => {
  const valid = c('valid', 'cog', ['cog']);
  assert.throws(() => evaluateCatalogue([{ ...valid, relevantIds: Array(1) }], known, q => index.search(q)), /label/i);
  for (const response of [null, {}, { cards: null, truncated: false, fallback: 'fallback' },
    { cards: Array(1), truncated: false, fallback: 'fallback' }, { cards: [], truncated: false, fallback: '' }]) {
    assert.throws(() => evaluateCatalogue([valid], known, () => response as never), /response/i);
  }
});

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { partCards } from '../scripts/prototypes/catalogue-parts.ts';

test('independent challenge covers each public family and preserves bounded baseline responses', () => {
  const cases = JSON.parse(readFileSync(new URL('../scripts/prototypes/catalogue-requests.json', import.meta.url), 'utf8')) as RelevanceCase[];
  const index = createCatalogue(partCards);
  const report = evaluateCatalogue(cases, partCards.map(c => c.id), q => index.search(q));
  assert.equal(report.summary.cases, 36);
  assert.equal(report.summary.absentCases, 8);
  assert.deepEqual([...new Set(cases.flatMap(c => c.relevantIds))].sort(), [...partCards.map(c => c.id)].sort());
  assert.deepEqual(Object.keys(report.byLanguage), ['de', 'en', 'es', 'fr', 'ja']);
  assert.equal(report.summary.searchErrors, 0);
  assert.equal(report.summary.budgetViolations, 0);
});

test('offline CLI provides reproducible provenance, quality and separately labelled timing', () => {
  const run = spawnSync(process.execPath, ['scripts/prototypes/evaluate-catalogue.ts'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30_000,
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  assert.equal(result.scope.liveModelMeasured, false);
  assert.equal(result.scope.threeSecondTargetVerdict, null);
  assert.equal(result.quality.summary.cases, 36);
  assert.equal(result.timing.samplesPerQuery, 100);
  assert.equal(result.timing.queries, 36);
  assert.ok(result.timing.initializationMs >= 0);
  assert.ok(result.timing.warmLookupAndEncodeMs.p95 >= result.timing.warmLookupAndEncodeMs.p50);
  assert.match(result.provenance.corpusSha256, /^[0-9a-f]{64}$/);
  assert.match(result.provenance.cardsSha256, /^[0-9a-f]{64}$/);
  assert.match(result.provenance.retrieverSha256, /^[0-9a-f]{64}$/);
  assert.equal(result.quality.results.length, 36);
});
