import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ignoreMouse } from '../src/main/interaction.ts';

test('click-through unless the page wants clicks, and never click-through while the pen is on', () => {
  assert.equal(ignoreMouse(false, false), true);
  assert.equal(ignoreMouse(true, false), false);
  assert.equal(ignoreMouse(false, true), false); // the page says no, the pen says yes
  assert.equal(ignoreMouse(true, true), false);
  // the pen going off gives click-through back whatever the page last said
  assert.equal(ignoreMouse(false, false), true);
});
