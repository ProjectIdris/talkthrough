import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyVisualRenderingMode } from '../scripts/prototypes/visual-quality-rendering.ts';

test('software mode applies the existing Electron API exactly once; default leaves it alone', () => {
  let disabled = 0;
  const app = { disableHardwareAcceleration: () => { disabled++; } };
  assert.equal(applyVisualRenderingMode(app, 'default'), 'default');
  assert.equal(disabled, 0);
  assert.equal(applyVisualRenderingMode(app, 'software'), 'software');
  assert.equal(disabled, 1);
});

test('unknown or missing child mode is refused without changing acceleration', () => {
  let disabled = 0;
  const app = { disableHardwareAcceleration: () => { disabled++; } };
  for (const mode of [undefined, '', 'swiftshader', 'unsafe', 'SOFTWARE']) {
    assert.throws(() => applyVisualRenderingMode(app, mode), /rendering mode/);
  }
  assert.equal(disabled, 0);
});
