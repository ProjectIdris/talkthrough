import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPins, slug } from '../src/main/pins.ts';
import { createPrefs } from '../src/main/prefs.ts';

const at = new Date(2026, 10, 4, 22, 5, 9);
const input = {
  question: 'Why does this build fail?',
  thread: [{ question: 'What is this?', steps: [{ say: 'A build log.', actions: [] }] }, { question: 'Why does this build fail?', steps: [{ say: 'The link step failed.', actions: [{ op: 'box', id: 'err', x: 1, y: 2, w: 3, h: 4, color: 'red' }] }] }],
  steps: [{ say: 'The link step failed.', actions: [{ op: 'box', id: 'err', x: 1, y: 2, w: 3, h: 4, color: 'red' }] }],
};

function scratch() {
  const dir = mkdtempSync(join(tmpdir(), 'tt-pins-'));
  return { dir: join(dir, 'pins'), done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a pin is one JSON file with the question, what was said and the scene, and no picture unless one is given', () => {
  const { dir, done } = scratch();
  try {
    const pins = createPins({ dir, now: () => at });
    const saved = pins.save(input as never);
    assert.equal(saved.file, '2026-11-04-220509-why-does-this-build-fail.json');
    assert.deepEqual(readdirSync(dir), [saved.file], 'nothing else is written');
    const pin = JSON.parse(readFileSync(join(dir, saved.file), 'utf8'));
    assert.equal(pin.talkthrough, 'pin');
    assert.equal(pin.question, 'Why does this build fail?');
    assert.deepEqual(pin.thread, [{ question: 'What is this?', said: ['A build log.'] }, { question: 'Why does this build fail?', said: ['The link step failed.'] }]);
    assert.deepEqual(pin.scene, { v: 1, steps: input.steps });
    assert.equal(pin.screenshot, undefined);
    assert.equal('base64' in pin, false);
    assert.ok(!JSON.stringify(pin).includes('AAAA'));
  } finally {
    done();
  }
});

test('with a screenshot the picture is saved beside it and named in the pin; the same name twice gets a number', () => {
  const { dir, done } = scratch();
  try {
    const pins = createPins({ dir, now: () => at });
    const a = pins.save({ ...(input as never as Parameters<typeof pins.save>[0]), screenshot: { mime: 'image/png', base64: Buffer.from('PNGBYTES').toString('base64'), width: 1, height: 1 } });
    assert.equal(a.screenshot, '2026-11-04-220509-why-does-this-build-fail.png');
    assert.equal(readFileSync(join(dir, a.screenshot!), 'utf8'), 'PNGBYTES');
    assert.equal(JSON.parse(readFileSync(join(dir, a.file), 'utf8')).screenshot, a.screenshot);
    const b = pins.save(input as never);
    assert.equal(b.file, '2026-11-04-220509-why-does-this-build-fail-2.json');
    assert.equal(readdirSync(dir).filter((f) => f.endsWith('.tmp')).length, 0, 'no half-written file is left');
  } finally {
    done();
  }
});

test('file names come from the question without anything odd, and never from a path', () => {
  assert.equal(slug('Why does this build fail?'), 'why-does-this-build-fail');
  assert.equal(slug('../../etc/passwd'), 'etc-passwd');
  assert.equal(slug('???'), 'pin');
  assert.equal(slug('Ünïcode and emoji 😀 here'), 'unicode-and-emoji-here');
  assert.ok(slug('a'.repeat(200)).length <= 40);
});

test('the screenshot choice is remembered in the app\'s own file and starts off', () => {
  const { dir, done } = scratch();
  try {
    const file = join(dir, 'prefs.json');
    assert.equal(createPrefs(file).get().pinScreenshot, false);
    createPrefs(file).set({ pinScreenshot: true });
    assert.equal(createPrefs(file).get().pinScreenshot, true);
    createPrefs(file).set({ pinScreenshot: false });
    assert.equal(createPrefs(file).get().pinScreenshot, false);
  } finally {
    done();
  }
});

test('a pinned partial explanation retains its incomplete status alongside the useful scene', () => {
  const { dir, done } = scratch();
  try {
    const pins = createPins({ dir, now: () => at });
    const steps = [{ say: 'First part.', actions: [] }];
    const saved = pins.save({ question: 'Explain this', thread: [{ question: 'Explain this', steps, incomplete: true }], steps });
    const pin = JSON.parse(readFileSync(join(dir, saved.file), 'utf8'));
    assert.deepEqual(pin.thread, [{ question: 'Explain this', said: ['First part.'], incomplete: true }]);
    assert.deepEqual(pin.scene.steps, steps);
  } finally {
    done();
  }
});
