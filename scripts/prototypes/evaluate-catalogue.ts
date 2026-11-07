// Reproducible offline smoke evaluation. Only original maintained fixture text is read.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { arch, cpus, platform } from 'node:os';
import { evaluateCatalogue } from './catalogue-evaluation.ts';
import type { RelevanceCase } from './catalogue-evaluation.ts';
import { partCards } from './catalogue-parts.ts';
import { CATALOGUE_LIMITS, createCatalogue } from './catalogue-retrieval.ts';

const corpora = { regression: 'catalogue-requests.json', 'challenge-v2': 'catalogue-heldout-v2.json', 'validation-v3': 'catalogue-validation-v3.json' };
const args = process.argv.slice(2);
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--corpus' || !Object.hasOwn(corpora, args[1]!))) {
  throw new Error('Usage: node scripts/prototypes/evaluate-catalogue.ts [--corpus regression|challenge-v2|validation-v3]');
}
const corpusName = (args[1] ?? 'regression') as keyof typeof corpora;
const corpusFile = corpora[corpusName];
const corpus = readFileSync(new URL(`./${corpusFile}`, import.meta.url));
const cases = JSON.parse(corpus.toString('utf8')) as RelevanceCase[];
const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
const start = performance.now();
const index = createCatalogue(partCards);
const initializationMs = performance.now() - start;
const quality = evaluateCatalogue(cases, partCards.map(c => c.id), query => index.search(query));
const warmupsPerQuery = 20;
const samplesPerQuery = 100;
const encode = (query: string) => JSON.stringify(index.search(query));
const timedCases = cases.filter((_, i) => quality.results[i]!.error === null);
for (const c of timedCases) for (let i = 0; i < warmupsPerQuery; i++) encode(c.query);
const times: number[] = [];
for (let i = 0; i < samplesPerQuery; i++) for (const c of timedCases) {
  const before = performance.now();
  encode(c.query);
  times.push(performance.now() - before);
}
times.sort((a, b) => a - b);
console.log(JSON.stringify({
  scope: {
    description: 'Offline relevance smoke evaluation of 21 existing parts, with independent AI-authored labels. Not user traffic, human judgments, representative accuracy or rendered quality.',
    tuning: 'All corpora were independently AI-authored without seeing retrieval or its results. The original and v2 corpora became development evidence; v3 was first scored after the successor retriever/cards were frozen. All are now public regression material, not future held-out tests.',
    liveModelMeasured: false, physicalDisplayMeasured: false, threeSecondTargetVerdict: null,
  },
  provenance: {
    corpus: `scripts/prototypes/${corpusFile}`, corpusSha256: hash(corpus),
    cardsSha256: hash(JSON.stringify(partCards)),
    retrieverSha256: hash(readFileSync(new URL('./catalogue-retrieval.ts', import.meta.url))),
    evaluatorSha256: hash(readFileSync(new URL('./catalogue-evaluation.ts', import.meta.url))),
  },
  runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  limits: CATALOGUE_LIMITS,
  metricDefinitions: {
    relevance: 'A labelled existing family is directly useful for a depicted object, not merely mentioned, excluded or an incidental shape. Multiple instances/variants count once per family.',
    hitRate: 'Positive cases with any relevant returned card / all positive cases. Search errors are misses.',
    top1Accuracy: 'Positive cases with a relevant first card / all positive cases.',
    meanReciprocalRank: 'Mean 1 / first relevant rank over positive cases; zero when none is returned.',
    macroRecall: 'Mean per-positive-case fraction of labelled families returned.',
    microRecall: 'Total relevant returned cards / total labelled families over positive cases.',
    microPrecision: 'Total relevant returned cards / all returned cards, including cards returned for absent cases.',
    abstentionAccuracy: 'Successful empty responses / absent cases. An exception is not an abstention; fallback text accompanying unrelated cards is not an abstention.',
    emptyDenominators: 'Null, not zero or a perfect score. Every result and failure is retained.',
  },
  timing: {
    description: 'Local CPU only: in-memory construction separately from pooled, equally sampled warm search plus JSON encoding. Excludes file read, imports, model inference and rendering. Not a speed guarantee.',
    initializationMs, warmupsPerQuery, samplesPerQuery, queries: timedCases.length,
    skippedErrorCases: quality.results.filter(r => r.error !== null).map(r => r.id),
    warmLookupAndEncodeMs: {
      p50: times[Math.ceil(times.length * 0.50) - 1] ?? null, p95: times[Math.ceil(times.length * 0.95) - 1] ?? null, max: times.at(-1) ?? null,
    },
  },
  quality,
}, null, 2));
