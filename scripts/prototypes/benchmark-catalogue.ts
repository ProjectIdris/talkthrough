// Synthetic scale and local CPU/payload measurements only. No model or provider call.
import { performance } from 'node:perf_hooks';
import { arch, cpus, platform } from 'node:os';
import { partCards } from './catalogue-parts.ts';
import { CATALOGUE_LIMITS, createCatalogue } from './catalogue-retrieval.ts';
import { sceneGuide } from '../../src/scene/guide.ts';
import { sceneSchemaLean } from '../../src/scene/schema.ts';

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');
const samples = 100;
const warmups = 20;
const measurements = [21, 1_000, 10_000].map(count => {
  const cards = count === 21 ? partCards : Array.from({ length: count }, (_, i) => ({ ...partCards[i % partCards.length]!, id: `item${i}` }));
  const start = performance.now();
  const index = createCatalogue(cards);
  const initializationMs = performance.now() - start;
  const queries = { exact: count === 21 ? 'gear' : `item${count - 1}`, broad: 'mechanical', absent: 'ribosome' };
  const lookups = Object.entries(queries).map(([kind, query]) => {
    for (let n = 0; n < warmups; n++) index.search(query);
    const times = Array.from({ length: samples }, () => {
      const before = performance.now();
      index.search(query);
      return performance.now() - before;
    }).sort((a, b) => a - b);
    const response = index.search(query);
    return { kind, query, p50Ms: times[49], p95Ms: times[94], maxMs: times[99], cards: response.cards.length, responseBytes: bytes(response), truncated: response.truncated };
  });
  return { entries: count, synthetic: count !== 21, completeCatalogueBytes: bytes(cards), initializationMs, lookups };
});
const guideAndSchema = sceneGuide + JSON.stringify(sceneSchemaLean);
console.log(JSON.stringify({
  note: 'Local lexical lookup and JSON bytes, not tokens, model latency, retrieval recall or rendered quality. Synthetic entries repeat the same 21 cards; no new components are added.',
  runtime: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
  samples, warmups, limits: CATALOGUE_LIMITS,
  unchangedGuideAndLeanSchema: { characters: guideAndSchema.length, utf8Bytes: Buffer.byteLength(guideAndSchema, 'utf8') },
  measurements,
}, null, 2));
