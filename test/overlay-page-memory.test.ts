import test from 'node:test';
import assert from 'node:assert/strict';
import { PageMemory } from '../src/overlay/page-memory.ts';

test('what is worked out from a page is kept for that page and made again for the next, though the element is the same', () => {
  const memory = new PageMemory();
  const element = {}; // the one screenshot element, reused for every capture
  let made = 0;
  const make = (): number => ++made;
  assert.equal(memory.recall('snapper', element, '', make), 1);
  assert.equal(memory.recall('snapper', element, '', make), 1, 'kept while it is the same picture');
  memory.renew(); // a second chord: a new screenshot is loaded into the same element
  assert.equal(memory.recall('snapper', element, '', make), 2, 'made again for the new picture');
  assert.equal(memory.recall('snapper', element, '', make), 2);
});

test('a different element or key (the screen shape) also counts as new, and slots do not share', () => {
  const memory = new PageMemory();
  let made = 0;
  const make = (): number => ++made;
  const a = {}, b = {};
  assert.equal(memory.recall('placer', a, '1.78', make), 1);
  assert.equal(memory.recall('placer', a, '1.6', make), 2, 'a new aspect');
  assert.equal(memory.recall('placer', b, '1.6', make), 3, 'a new element');
  assert.equal(memory.recall('snapper', b, '1.6', make), 4, 'another slot');
});
