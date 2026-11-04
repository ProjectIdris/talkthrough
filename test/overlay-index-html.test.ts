import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../src/overlay/index.html', import.meta.url), 'utf8');

test('the overlay page holds no stray control characters, and the detail status reads "Adding detail" with an ellipsis', () => {
  const stray = [...html].filter((c) => c >= '\u0080' && c <= '\u009f');
  assert.equal(stray.length, 0, `control characters in index.html: ${stray.map((c) => 'U+' + c.charCodeAt(0).toString(16)).join(', ')}`);
  assert.match(html, /#status\.detail::after \{ content: "Adding detail\\2026"; \}/);
});
