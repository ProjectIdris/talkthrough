import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalogue } from '../scripts/prototypes/catalogue-retrieval.ts';
import type { ComponentCard } from '../scripts/prototypes/catalogue-retrieval.ts';
import { partCards } from '../scripts/prototypes/catalogue-parts.ts';
const make = (id: string, tags: string[], extra = {}): ComponentCard => ({ id, summary: 'A round reusable component along the y axis.', tags, parameters: {}, example: {}, ...extra });
const ids = (query: string) => createCatalogue(partCards).search(query).cards.map(c => c.id);

test('description prose alone never admits a candidate and compound aliases stay atomic', () => {
  const index = createCatalogue([make('chip', ['integrated circuit'])]);
  for (const q of ['a round ball along an axis', 'integrated classroom', 'circuit diagram without components']) assert.deepEqual(index.search(q).cards, [], q);
  assert.deepEqual(index.search('an integrated circuit').cards.map(c => c.id), ['chip']);
});

test('normalized Unicode phrases and word inflections match maintained aliases', () => {
  const index = createCatalogue([make('gear', ['Zahnrad', 'engrenage', '歯車', 'rueda dentada']), make('spring', ['ressort hélicoïdal'])]);
  for (const q of ['Ein Zahnrad bitte', 'des engrenages', '歯車を描いて', 'Una rueda dentada', 'GEARS']) assert.deepEqual(index.search(q).cards.map(c => c.id), ['gear'], q);
  assert.deepEqual(index.search('un ressort he\u0301licoi\u0308dal').cards.map(c => c.id), ['spring']);
});

test('exclusion scopes reject named exclusions but keep later positive clauses', () => {
  for (const q of ['gear without bearing or wheel', 'not a wheel; draw a gear', 'omit the wheel, but include a gear', 'no wheel: gear instead']) assert.deepEqual(ids(q), ['gear'], q);
  assert.deepEqual(ids('not only a gear but also a bearing'), ['bearing', 'gear']);
  assert.ok(ids('gear without teeth').includes('gear'));
});

test('broad topics are explicit discovery rather than incidental context', () => {
  assert.equal(ids('mechanical').length, 4);
  assert.equal(ids('show engine parts').length, 4);
  assert.equal(ids('electronics components').length, 4);
  assert.deepEqual(ids('an engine mounting bracket'), []);
  assert.deepEqual(ids('a gear and an engine mounting bracket'), ['gear']);
  assert.ok(ids('gear and mechanical components').includes('gear'));
});

test('sense conflicts are local to a mention, not a global query blacklist', () => {
  assert.deepEqual(ids('a sea port and a cargo crane'), []);
  assert.deepEqual(ids('a coil spring beside a spring flower'), ['spring']);
  assert.deepEqual(ids('a USB socket next to a sea port'), ['port']);
  assert.deepEqual(ids('a human elbow and a gear'), ['gear']);
  assert.deepEqual(ids('potato chips beside a processor chip'), ['chip']);
});

test('all public IDs remain discoverable and mixed requests keep supported parts', () => {
  for (const c of partCards) assert.equal(ids(c.id)[0], c.id, c.id);
  assert.deepEqual(ids('a gear, a bearing, a screw and a flexible cable'), ['bearing', 'gear']);
  assert.deepEqual(ids('a clear glass sphere'), []);
  assert.deepEqual(ids('a plate and a threaded bolt'), ['bolt']);
});

test('request verbs are not mistaken for the depicted display object', () => {
  assert.deepEqual(ids('Could you display a piston?'), ['piston']);
  assert.deepEqual(ids('Display a bearing with a gear'), ['bearing', 'gear']);
  assert.deepEqual(ids('a small display beside a piston'), ['piston', 'screen']);
});

test('optional retrieval metadata stays cloned, order stable and response bounded', () => {
  const source = make('widget', ['rotating widget'], { topics: ['mechanical'], conflicts: ['food'] });
  const index = createCatalogue([source]);
  (source.topics as string[]).push('changed');
  (source.conflicts as string[]).push('rotating');
  assert.equal(index.search('rotating widget').cards[0]?.id, 'widget');
  assert.equal(index.search('changed').cards.length, 0);
  const result = index.search('mechanical');
  (result.cards[0]!.topics as string[]).push('changed');
  assert.equal(index.search('changed').cards.length, 0);
  const forward = createCatalogue(partCards), reverse = createCatalogue([...partCards].reverse());
  for (const q of ['mechanical components', 'USB socket and gear and a bearing', '歯車を描いて']) {
    assert.deepEqual(forward.search(q), reverse.search(q));
    for (const maxBytes of [512, 1024, 2048, 4096]) assert.ok(Buffer.byteLength(JSON.stringify(forward.search(q, { maxBytes }))) <= maxBytes);
  }
});

test('independent content words admit candidates without indexing description prose', () => {
  const index = createCatalogue([
    make('alpha', ['rotating fixture'], { keywords: ['serrated', 'disc', 'rotation'] }),
    make('beta', ['stationary fixture'], { keywords: ['smooth', 'disc', 'joint', 'protector'] }),
  ]);
  assert.equal(index.search('Can you depict the serrated disc?').cards[0]?.id, 'alpha');
  assert.equal(index.search('the joint protector').cards[0]?.id, 'beta');
  assert.deepEqual(index.search('a thing around the z axis').cards, []);
  assert.deepEqual(index.search('rotating classroom').cards, []);
});

test('noun-only aliases and later explicit positive commands survive exclusions', () => {
  assert.deepEqual(ids('display'), ['screen']);
  assert.deepEqual(ids('display and button'), ['button', 'screen']);
  assert.deepEqual(ids('No fan, add a gear'), ['gear']);
  assert.deepEqual(ids('Instead of a wheel, show a gear'), ['gear']);
});

test('negative commands and explicit exclusions also constrain category browsing', () => {
  for (const q of ['Do not show a gear', 'Do not draw any gear', 'Do not include a gear']) assert.deepEqual(ids(q), [], q);
  assert.ok(!ids('catalogue overview except bearings').includes('bearing'));
  assert.ok(!ids('mechanical parts without bearings').includes('bearing'));
  assert.ok(ids('no gear, but draw a gear').includes('gear'));
});

test('universal discovery is word bounded and conflicts do not cross coordinated objects', () => {
  assert.deepEqual(ids('all partially transparent cubes'), []);
  assert.deepEqual(ids('spring and water pipe'), ['pipe', 'spring']);
  assert.deepEqual(ids('a water pipe beside a spring'), ['pipe', 'spring']);
});
