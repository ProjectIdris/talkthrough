import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../src/overlay/index.html', import.meta.url), 'utf8');

test('the overlay page holds no stray control characters', () => {
  const stray = [...html].filter((c) => c >= '\u0080' && c <= '\u009f');
  assert.equal(stray.length, 0, `control characters in index.html: ${stray.map((c) => 'U+' + c.charCodeAt(0).toString(16)).join(', ')}`);
});

test('the model frame has no visible backing panel and follow-up controls are present', () => {
  assert.match(html, /#panel\s*\{[^}]*background:\s*transparent[^}]*border:\s*0[^}]*box-shadow:\s*none/s);
  assert.match(html, /id="ask-more"[^>]*>Ask more<\/button>/);
  assert.match(html, /id="send-followup"[^>]*>Send<\/button>/);
  assert.match(html, /id="cancel-followup"[^>]*>Cancel<\/button>/);
});
