import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogue } from '../scripts/prototypes/catalogue-retrieval.ts';
import type { ComponentCard } from '../scripts/prototypes/catalogue-retrieval.ts';
import { partCards } from '../scripts/prototypes/catalogue-parts.ts';
const make = (id: string, descriptors: readonly (readonly (readonly string[])[])[]): ComponentCard => ({ id, tags: [], summary: 'Fixture', parameters: {}, example: {}, descriptors } as ComponentCard);
const lookup = (cards: readonly ComponentCard[], q: string) => createCatalogue(cards).search(q).cards.map(c => c.id);

test('descriptive profiles require every independent fact, not an entire request alias', () => {
  const cards = [make('alpha', [[['vanes', 'blades'], ['moves air', 'airflow']]]), make('beta', [[['blades'], ['cuts wood']]])];
  for (const q of ['vanes generating airflow', 'the blades that produce airflow']) assert.deepEqual(lookup(cards, q), ['alpha']);
  for (const q of ['vanes', 'blades and vanes', 'airflow alone']) assert.deepEqual(lookup(cards, q), []);
});

test('descriptive morphology supports regular inflections without changing name matching', () => {
  const cards = [make('alpha', [[['rotate'], ['blade']]])];
  for (const q of ['rotating blades', 'blades rotated slowly', 'a blade rotates']) assert.deepEqual(lookup(cards, q), ['alpha'], q);
  assert.deepEqual(lookup(cards, 'rotation blade'), []);
});

test('descriptive evidence cannot combine across clauses, negative scopes or distant mentions', () => {
  const cards = [make('alpha', [[['rotate'], ['blade']]])];
  for (const q of ['rotate. a blade', 'rotate without a blade', 'a rotating thing beside a blade', 'a rotating toy and a blade', 'rotate, blade', `rotate ${'empty '.repeat(18)}blade`]) assert.deepEqual(lookup(cards, q), [], q);
  assert.deepEqual(lookup(cards, 'not rotating blades; rotating blades instead'), ['alpha']);
});

test('one occurrence cannot count for two independent descriptor facts', () => {
  const cards = [make('alpha', [[['round', 'curved'], ['round', 'smooth']]])];
  assert.deepEqual(lookup(cards, 'round'), []);
  assert.deepEqual(lookup(cards, 'round and curved'), ['alpha']);
  assert.deepEqual(lookup(cards, 'curved smooth'), ['alpha']);
});

test('generic exclusions include remove and rather than', () => {
  for (const q of ['a gear rather than a wheel', 'remove the bearing, show a gear']) assert.deepEqual(lookup(partCards, q), ['gear']);
});

test('descriptors are maintained public component facts and allow indirect wording', () => {
  for (const [q, id] of [
    ['spinning vanes pushing air', 'fan'],
    ['an elastic helix recovering after a squeeze', 'spring'],
    ['curved glass concentrating incoming light', 'lens'],
  ]) assert.ok(lookup(partCards, q!).includes(id!), q);
});

test('descriptor payloads are snapshotted and malformed profiles are rejected', () => {
  const card = make('alpha', [[['rotate'], ['blade']]]);
  const index = createCatalogue([card]);
  (card as any).descriptors[0][0][0] = 'unrelated';
  assert.equal(index.search('rotating blades').cards[0]?.id, 'alpha');
  (index.search('rotating blades').cards[0] as any).descriptors[0][0][0] = 'changed';
  assert.equal(index.search('rotating blades').cards[0]?.id, 'alpha');
  for (const descriptors of [[], [[]], [[[]]], [[['rotate']]], [[[''], ['blade']]], [[['too many words in one alternative phrase'], ['blade']]]]) {
    assert.throws(() => createCatalogue([{ ...make('alpha', []), descriptors } as ComponentCard]), /descriptor/i);
  }
});

import { spawnSync } from 'node:child_process';
test('dense incomplete descriptors short-circuit within the bounded offline subprocess', () => {
  const run = spawnSync(process.execPath, ['--max-old-space-size=128', '--input-type=module', '-e', `
    import { createCatalogue } from './scripts/prototypes/catalogue-retrieval.ts';
    const cards = Array.from({ length: 1000 }, (_, i) => ({
      id: 'fixture-' + i, tags: [], summary: 'fixture', parameters: {}, example: {},
      descriptors: [[['x','x x','x x x','x x x x'], ['x','x x','x x x','x x x x'],
        ['x','x x','x x x','x x x x'], ['x missing' + i]]],
    }));
    const result = createCatalogue(cards).search('x '.repeat(255));
    if (result.cards.length !== 0) process.exit(1);
  `], { cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 5000 });
  assert.equal(run.status, 0, String(run.error ?? run.stderr));
});

test('scale runner reports descriptive and repeated-description work separately', () => {
  const run = spawnSync(process.execPath, ['scripts/prototypes/benchmark-catalogue.ts'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  for (const measure of report.measurements) {
    for (const kind of ['indirect', 'repeated-indirect']) {
      const lookup = measure.lookups.find((x: { kind: string }) => x.kind === kind);
      assert.ok(lookup, kind);
      assert.ok(lookup.p95Ms >= lookup.p50Ms);
      assert.ok(lookup.responseBytes <= 4096);
      assert.ok(lookup.cards > 0);
    }
  }
});

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
test('independent v4 CLI reproduces every frozen case and exact checkout provenance', () => {
  const run = spawnSync(process.execPath, ['scripts/prototypes/evaluate-catalogue.ts', '--corpus', 'independent-v4'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 30000,
  });
  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout);
  const recorded = JSON.parse(readFileSync(new URL('../scripts/prototypes/catalogue-indirect-results.json', import.meta.url), 'utf8'));
  assert.deepEqual(result.quality, recorded.corpora['independent-v4'].candidate);
  const corpus = readFileSync(new URL('../scripts/prototypes/catalogue-indirect-v4.json', import.meta.url));
  const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
  assert.equal(result.provenance.corpusSha256, hash(corpus));
  assert.equal(hash(corpus.toString('utf8').replace(/\r\n/g, '\n')), '1d9f157bf31f3e3e09afcf275c80bda20019231c7fb01eb27c5147ebdf12bbb8');
  assert.equal(result.quality.summary.cases, 64);
  assert.equal(result.scope.liveModelMeasured, false);
  assert.equal(result.scope.threeSecondTargetVerdict, null);
});
