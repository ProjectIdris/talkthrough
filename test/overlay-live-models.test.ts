// A live answer reaches the page as steps and actions one at a time, and a real model's file is fetched only when something asks for it:
// every message that can bring a model into the picture has to ask. (Before this, a live answer with a mousetrap or a heart drew an empty stage.)
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/overlay/overlay.ts', import.meta.url), 'utf8').replaceAll('\r\n', '\n');

function body(kind: string): string {
  const start = source.indexOf(`    case '${kind}':\n`);
  assert.ok(start >= 0, `the ${kind} message is handled`);
  const end = source.indexOf('\n      break;', start);
  assert.ok(end > start);
  return source.slice(start, end);
}

test('each message that adds scene content asks for the real models it names', () => {
  for (const kind of ['play', 'step', 'action']) assert.match(body(kind), /modelStore\.ensure\(modelsIn\(/, `${kind} asks for its models`);
});
