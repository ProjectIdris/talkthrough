import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOGUE_LIMITS as limits, createCatalogue } from '../scripts/prototypes/catalogue-retrieval.ts';
import type { ComponentCard } from '../scripts/prototypes/catalogue-retrieval.ts';

const card = (id: string, summary = 'A reusable component.', tags = ['mechanical']): ComponentCard => ({
  id, summary, tags, parameters: { size: 'Three positive lengths.' },
  example: { op: 'add', shape: 'part', part: 'gear', id: 'example', size: [2, 2, 1] },
});
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value), 'utf8');

test('discovers exact IDs and aliases in stable rank order', () => {
  const cards = [card('wheel', 'A wheel, not a gear.', ['tyre']), card('gear', 'Toothed wheel.', ['cog', 'gears'])];
  const index = createCatalogue(cards);
  assert.equal(index.search('gear').cards[0]?.id, 'gear');
  assert.equal(index.search('COG').cards[0]?.id, 'gear');
  assert.equal(index.search('gears').cards[0]?.id, 'gear');
  assert.deepEqual(index.search('wheel'), createCatalogue([...cards].reverse()).search('wheel'));
  assert.deepEqual(index.search('gear gear gear'), index.search('gear'));
});

test('whole response is bounded by card count and UTF-8 bytes without cutting cards', () => {
  const cards = Array.from({ length: 20 }, (_, i) => card(`part${i}`, '部品'.repeat(70)));
  const index = createCatalogue(cards);
  const result = index.search('mechanical');
  assert.ok(result.cards.length > 0);
  assert.ok(result.cards.length <= limits.results);
  assert.ok(bytes(result) <= limits.responseBytes);
  assert.equal(result.truncated, true);
  const tight = index.search('mechanical', { maxResults: 1, maxBytes: 512 });
  assert.equal(tight.cards.length, 0);
  assert.equal(tight.truncated, true);
  assert.ok(bytes(tight) <= 512);
  const one = index.search('mechanical', { maxResults: 1 });
  assert.equal(one.cards.length, 1);
  assert.deepEqual(one.cards[0], cards.find(c => c.id === one.cards[0]?.id));
});

test('no-match and empty queries retain an explicit ordinary-primitive fallback', () => {
  const index = createCatalogue([card('gear')]);
  for (const query of ['', '   ', '🦉', 'zymurgy', '<script>throw new Error()</script>']) {
    const result = index.search(query);
    assert.deepEqual(result.cards, []);
    assert.equal(result.truncated, false);
    assert.match(result.fallback, /ordinary scene primitives/);
    assert.ok(!JSON.stringify(result).includes(query) || query.trim() === '');
  }
});

test('refuses oversized queries and invalid caller budgets before searching', () => {
  const index = createCatalogue([card('gear')]);
  for (const query of ['x'.repeat(limits.queryChars + 1), Array.from({ length: limits.queryTerms + 1 }, (_, i) => `q${i}`).join(' ')]) {
    assert.throws(() => index.search(query), RangeError);
  }
  assert.throws(() => index.search(null as unknown as string), TypeError);
  for (const maxResults of [0, -1, 1.5, 5, NaN, Infinity]) assert.throws(() => index.search('gear', { maxResults }), RangeError);
  for (const maxBytes of [0, 511, 512.5, 4097, NaN, Infinity]) assert.throws(() => index.search('gear', { maxBytes }), RangeError);
});

test('snapshots source data and does not expose mutable internal cards', () => {
  const source = card('gear');
  const index = createCatalogue([source]);
  source.summary = 'Changed source';
  (source.tags as string[]).push('changed');
  const result = index.search('gear');
  result.cards[0]!.summary = 'Changed result';
  (result.cards[0]!.example.size as number[])[0] = 999;
  assert.equal(index.search('changed').cards.length, 0);
  assert.equal(index.search('gear').cards[0]?.summary, 'A reusable component.');
  assert.deepEqual(index.search('gear').cards[0]?.example.size, [2, 2, 1]);
});

test('catalogue input has finite entry and card budgets and unique stable IDs', () => {
  assert.throws(() => createCatalogue([card('gear'), card('gear')]), /duplicate/i);
  assert.throws(() => createCatalogue([card('bad id')]), /id/i);
  assert.throws(() => createCatalogue([card('big', 'x'.repeat(limits.cardBytes))]), /bytes/i);
  assert.throws(() => createCatalogue(Array.from({ length: limits.entries + 1 }, (_, i) => card(`item${i}`))), /entries/i);
});

test('ten thousand synthetic cards preserve bounded output and exact discovery', () => {
  const index = createCatalogue(Array.from({ length: limits.entries }, (_, i) => card(`item${i}`)));
  const found = index.search('item9999');
  assert.deepEqual(found.cards.map(c => c.id), ['item9999']);
  assert.equal(found.truncated, false);
  const broad = index.search('mechanical');
  assert.equal(broad.cards.length, limits.results);
  assert.ok(bytes(broad) <= limits.responseBytes);
  assert.equal(broad.truncated, true);
});

// These cards describe public built-ins. Their sample is an ordinary action, not a macro.
import { partCards } from '../scripts/prototypes/catalogue-parts.ts';
import { PARTS, VARIANTS } from '../src/scene/spec.ts';
import { createSceneState, validateScene } from '../src/scene/index.ts';

test('catalogue covers each public built-in once with spec-derived parameter bounds', () => {
  assert.deepEqual(partCards.map(c => c.id).sort(), [...PARTS].sort());
  const part = VARIANTS.find(v => v.name === 'addPart')!;
  for (const c of partCards) {
    assert.deepEqual(c.parameters.size, part.fields.size, c.id);
    if (c.parameters.n) assert.deepEqual(c.parameters.n, part.fields.n, c.id);
  }
});

test('every built-in example validates unchanged and remains individually addressable', () => {
  assert.equal(partCards.length, 33);
  for (const c of partCards) {
    const state = createSceneState();
    const scene = { steps: [{ say: 'An example.', actions: [c.example] }] };
    const accepted = validateScene(scene, state);
    assert.equal(accepted.ok, true, c.id);
    assert.deepEqual(accepted.issues, [], c.id);
    assert.deepEqual(accepted.scene, scene, c.id);
    const followup = { steps: [{ say: 'The same part.', actions: [{ op: 'pin', id: 'name', on: 'example', text: c.id }] }] };
    const next = validateScene(followup, state);
    assert.deepEqual(next.issues, [], c.id);
    assert.deepEqual(next.scene, followup, c.id);
  }
});

test('curated aliases find existing parts and do not promise unavailable assemblies', () => {
  const index = createCatalogue(partCards);
  for (const [query, expected] of [['usb-c', 'port'], ['cog', 'gear'], ['tyre', 'wheel'], ['coil', 'coil'], ['helical spring', 'spring'], ['enclosure', 'housing']]) {
    assert.equal(index.search(query!).cards[0]?.id, expected, query);
  }
  assert.deepEqual(index.search('ribosome').cards, []);
});

test('rejects non-JSON card values before byte counting or cloning', () => {
  for (const value of [new SharedArrayBuffer(1), new Map(), new Date(), NaN, Infinity, undefined, () => 1, [,,], { value: undefined }]) {
    const unsafe = card('gear');
    unsafe.example = { value };
    assert.throws(() => createCatalogue([unsafe]), /JSON/);
  }
});

test('does not execute card accessors or toJSON functions', () => {
  let called = false;
  const accessor = Object.defineProperty({}, 'payload', { enumerable: true, get() { called = true; return 1; } });
  const unsafe = card('gear');
  unsafe.example = accessor;
  assert.throws(() => createCatalogue([unsafe]), /JSON/);
  assert.equal(called, false);
  unsafe.example = { toJSON: () => { called = true; return {}; } };
  assert.throws(() => createCatalogue([unsafe]), /JSON/);
  assert.equal(called, false);
});

test('rejects cyclic and excessive card structures with a bounded error', () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  const unsafe = card('gear');
  unsafe.example = cyclic;
  assert.throws(() => createCatalogue([unsafe]), /structure/);
  unsafe.example = { many: Array(1025).fill(null) };
  assert.throws(() => createCatalogue([unsafe]), /structure/);
});
